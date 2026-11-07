import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppEnv {
  repoRoot: string;
  host: string;
  port: number;
  webOrigin: string;
  dataDir: string;
  pluginsDir: string;
  pluginSdkEntry: string;
  webDist: string;
  imageExtraAllowedHosts: string[];
  cacheLimitMb: number;
  proxyUrl: string;
}

function findRepoRoot(): string {
  const starts = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
  ];
  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      if (
        fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(current, "apps", "server", "package.json"))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

function resolveDir(root: string, value: string | undefined, fallback: string): string {
  return path.resolve(root, value?.trim() || fallback);
}

function parseCacheLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1024;
  return Math.min(10240, Math.max(128, Math.trunc(parsed)));
}

function parseHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function loadEnv(): AppEnv {
  const repoRoot = findRepoRoot();
  const envFile = path.join(repoRoot, ".env");
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // A malformed .env should not stop the local app; explicit env vars win.
    }
  }

  return {
    repoRoot,
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: Number(process.env.PORT) || 4000,
    webOrigin: process.env.WEB_ORIGIN?.trim() || "http://127.0.0.1:5173",
    dataDir: resolveDir(repoRoot, process.env.COMICSPACE_DATA_DIR, "data"),
    pluginsDir: resolveDir(repoRoot, process.env.COMICSPACE_PLUGINS_DIR, "plugins"),
    pluginSdkEntry: resolveDir(
      repoRoot,
      process.env.COMICSPACE_SDK_ENTRY,
      "packages/plugin-sdk/runtime.mjs",
    ),
    webDist: resolveDir(repoRoot, process.env.COMICSPACE_WEB_DIST, "apps/web/dist"),
    imageExtraAllowedHosts: parseHosts(process.env.COMICSPACE_IMAGE_ALLOW_HOSTS),
    cacheLimitMb: parseCacheLimit(process.env.COMICSPACE_CACHE_LIMIT_MB),
    proxyUrl: process.env.COMICSPACE_PROXY_URL?.trim() || "",
  };
}
