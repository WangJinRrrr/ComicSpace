import { parseJson, type Db } from "../client.js";

interface SettingRow {
  key: string;
  value_json: string;
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db
    .prepare("SELECT key, value_json FROM settings WHERE key = ?")
    .get(key) as SettingRow | undefined;
  if (!row) return fallback;
  return parseJson<T>(row.value_json, fallback);
}

export function setSetting<T>(db: Db, key: string, value: T): void {
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(value));
}

