import type {
  ConfigFieldDto,
  SourceInfoDto,
  SourcesDto,
} from "@comicspace/contracts";
import {
  PluginError,
  type ConfigValues,
  type PluginManifest,
} from "@comicspace/plugin-sdk";
import type { Db } from "../db/client.js";
import { getPluginConfig } from "../db/repos/config.js";
import type { LoadedPlugin } from "../plugins/loader.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { resolveConfig } from "../plugins/config.js";

function toConfigDtos(manifest: PluginManifest): ConfigFieldDto[] {
  return (manifest.config ?? []) as ConfigFieldDto[];
}

export function sourceInfo(plugin: LoadedPlugin, db: Db): SourceInfoDto {
  const stored = getPluginConfig(db, plugin.id);
  const resolved = resolveConfig(plugin.manifest, stored.values);
  const status = !stored.enabled
    ? "disabled"
    : resolved.missing.length > 0
      ? "needs_config"
      : "ready";

  return {
    id: plugin.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    author: plugin.manifest.author,
    languages: plugin.manifest.languages,
    capabilities: plugin.capabilities,
    status,
    configFields: toConfigDtos(plugin.manifest),
    missingConfig: resolved.missing,
    enabled: stored.enabled,
  };
}

export async function listSources(
  registry: PluginRegistry,
  db: Db,
): Promise<SourcesDto> {
  const scan = await registry.scan();
  const sources = scan.plugins
    .map((plugin) => sourceInfo(plugin, db))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    sources,
    failures: scan.failures.map((failure) => ({
      sourceId: failure.sourceId,
      dir: failure.dir,
      message: failure.message,
    })),
    scannedAt: scan.scannedAt,
  };
}

export interface CallableSource {
  plugin: LoadedPlugin;
  config: ConfigValues;
}

export async function getCallableSource(
  registry: PluginRegistry,
  db: Db,
  sourceId: string,
): Promise<CallableSource> {
  const plugin = await registry.getPlugin(sourceId);
  if (!plugin) {
    throw new PluginError("not_found", `Unknown source: ${sourceId}`);
  }
  const stored = getPluginConfig(db, sourceId);
  if (!stored.enabled) {
    throw new PluginError("unsupported", `Source ${sourceId} is disabled`);
  }
  const resolved = resolveConfig(plugin.manifest, stored.values);
  if (resolved.missing.length > 0) {
    throw new PluginError(
      "config_required",
      `Source ${sourceId} needs configuration: ${resolved.missing.join(", ")}`,
    );
  }
  return { plugin, config: resolved.values };
}
