import type { ConfigValues } from "@comicspace/plugin-sdk";
import { parseJson, type Db } from "../client.js";

interface ConfigRow {
  source_id: string;
  enabled: number;
  config_json: string;
  updated_at: number;
}

export interface StoredPluginConfig {
  sourceId: string;
  enabled: boolean;
  values: ConfigValues;
  updatedAt: number | null;
}

export function getPluginConfig(db: Db, sourceId: string): StoredPluginConfig {
  const row = db
    .prepare(
      "SELECT source_id, enabled, config_json, updated_at FROM plugin_configs WHERE source_id = ?",
    )
    .get(sourceId) as ConfigRow | undefined;
  if (!row) {
    return { sourceId, enabled: true, values: {}, updatedAt: null };
  }
  return {
    sourceId: row.source_id,
    enabled: Boolean(row.enabled),
    values: parseJson<ConfigValues>(row.config_json, {}),
    updatedAt: Number(row.updated_at),
  };
}

export function savePluginConfig(
  db: Db,
  sourceId: string,
  values: ConfigValues,
  enabled?: boolean,
): StoredPluginConfig {
  const existing = getPluginConfig(db, sourceId);
  const nextEnabled = enabled ?? existing.enabled;
  const now = Date.now();
  db.prepare(
    `INSERT INTO plugin_configs (source_id, enabled, config_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       enabled = excluded.enabled,
       config_json = excluded.config_json,
       updated_at = excluded.updated_at`,
  ).run(
    sourceId,
    nextEnabled ? 1 : 0,
    JSON.stringify(values),
    now,
  );
  return { sourceId, enabled: nextEnabled, values, updatedAt: now };
}
