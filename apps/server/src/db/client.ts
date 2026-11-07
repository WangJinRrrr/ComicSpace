import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { migrate } from "./migrations.js";

// Keep node:sqlite out of the bundler's static import rewriting. esbuild
// rewrites `node:sqlite` to bare `sqlite`, which is not a resolvable package.
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite",
) as typeof import("node:sqlite");

export type Db = DatabaseSyncType;

export function createDatabase(filename: string): Db {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  migrate(db);
  return db;
}

export function openDatabase(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  return createDatabase(path.join(dataDir, "comicspace.db"));
}

export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
