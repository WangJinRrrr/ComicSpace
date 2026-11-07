import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti, type Jiti } from "jiti";
import type {
  MangaPlugin,
  PluginManifest,
} from "@comicspace/plugin-sdk";
import { createLogger } from "../lib/logger.js";
import { validateManifest } from "./validate.js";

export interface PluginCapabilities {
  search: boolean;
  browse: boolean;
  filters: boolean;
  accountSync: boolean;
}

export interface LoadedPlugin {
  id: string;
  dir: string;
  manifest: PluginManifest;
  impl: MangaPlugin;
  capabilities: PluginCapabilities;
  signature: string;
  loadedAt: number;
}

export interface PluginFailure {
  sourceId: string;
  dir: string;
  message: string;
}

export interface PluginScan {
  plugins: LoadedPlugin[];
  failures: PluginFailure[];
  scannedAt: number;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function walkSourceFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function directorySignature(dir: string): string {
  const files: string[] = [];
  walkSourceFiles(dir, files);
  files.sort();
  const hash = createHash("sha1");
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      hash.update(path.relative(dir, file));
      hash.update(String(stat.mtimeMs));
      hash.update(String(stat.size));
    } catch {
      // Ignore files that disappear during the scan.
    }
  }
  return hash.digest("hex");
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class PluginLoader {
  private readonly pluginsDir: string;
  private readonly sdkEntry: string;
  private jiti: Jiti;
  private readonly logger = createLogger("plugins");

  constructor(options: { pluginsDir: string; sdkEntry?: string }) {
    this.pluginsDir = options.pluginsDir;
    this.sdkEntry =
      options.sdkEntry ??
      path.resolve(process.cwd(), "packages/plugin-sdk/runtime.mjs");
    this.jiti = this.createJiti();
  }

  private createJiti(): Jiti {
    const alias: Record<string, string> = {};
    if (fs.existsSync(this.sdkEntry)) {
      alias["@comicspace/plugin-sdk"] = this.sdkEntry;
    }
    return createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
      fsCache: true,
      sourceMaps: true,
      alias,
    });
  }

  get root(): string {
    return this.pluginsDir;
  }

  async scan(options: { forceReload?: boolean } = {}): Promise<PluginScan> {
    if (options.forceReload) {
      this.jiti = this.createJiti();
    }

    const plugins: LoadedPlugin[] = [];
    const failures: PluginFailure[] = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    } catch {
      return { plugins, failures, scannedAt: Date.now() };
    }

    const dirs = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !entry.name.startsWith("_") &&
          entry.name !== "node_modules",
      )
      .map((entry) => entry.name)
      .sort();

    for (const folder of dirs) {
      const dir = path.join(this.pluginsDir, folder);
      try {
        const plugin = await this.loadOne(dir, folder);
        plugins.push(plugin);
      } catch (error) {
        const message = describeError(error);
        failures.push({ sourceId: folder, dir, message });
        this.logger.warn(`Failed to load ${folder}: ${message}`);
      }
    }

    return { plugins, failures, scannedAt: Date.now() };
  }

  private async loadOne(dir: string, folder: string): Promise<LoadedPlugin> {
    const manifestPath = path.join(dir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("plugin.json is missing");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `plugin.json is not valid JSON: ${describeError(error)}`,
        { cause: error },
      );
    }

    const manifest = validateManifest(raw);
    if (manifest.id !== folder) {
      throw new Error(
        `manifest id "${manifest.id}" must match folder name "${folder}"`,
      );
    }

    const entryPath = path.resolve(dir, manifest.entry);
    if (!isInside(dir, entryPath)) {
      throw new Error("entry must stay inside the plugin folder");
    }
    if (!fs.existsSync(entryPath)) {
      throw new Error(`entry not found: ${manifest.entry}`);
    }

    const realDir = fs.realpathSync(dir);
    const realEntry = fs.realpathSync(entryPath);
    if (!isInside(realDir, realEntry)) {
      throw new Error("entry resolves outside the plugin folder");
    }

    const imported = await this.jiti.import<Record<string, unknown>>(
      pathToFileURL(realEntry).href,
      { default: true },
    );
    const impl = (
      imported &&
      typeof imported === "object" &&
      "default" in imported
        ? imported.default
        : imported
    ) as MangaPlugin | undefined;

    if (!impl || typeof impl !== "object") {
      throw new Error("plugin entry must default-export an object");
    }
    const search = typeof impl.search === "function";
    const browse = typeof impl.browse === "function";
    const accountSync = typeof impl.pullAccount === "function";
    if (!search && !browse && !accountSync) {
      throw new Error("plugin must implement search(), browse(), or pullAccount()");
    }
    if (search || browse) {
      if (typeof impl.getChapters !== "function") {
        throw new Error("plugin must implement getChapters()");
      }
      if (typeof impl.getPages !== "function") {
        throw new Error("plugin must implement getPages()");
      }
    }

    return {
      id: manifest.id,
      dir,
      manifest,
      impl,
      capabilities: {
        search,
        browse,
        filters: typeof impl.getFilters === "function",
        accountSync,
      },
      signature: directorySignature(dir),
      loadedAt: Date.now(),
    };
  }
}
