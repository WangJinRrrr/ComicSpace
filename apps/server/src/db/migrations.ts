import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS manga_cache (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        title TEXT NOT NULL,
        cover_url TEXT,
        data_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        chapters_fetched_at INTEGER,
        PRIMARY KEY (source_id, manga_id)
      );

      CREATE TABLE IF NOT EXISTS chapter_cache (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        title TEXT NOT NULL,
        number REAL,
        data_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, manga_id, chapter_id)
      );

      CREATE TABLE IF NOT EXISTS chapter_pages (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        url TEXT NOT NULL,
        referer TEXT,
        headers_json TEXT,
        width INTEGER,
        height INTEGER,
        mime TEXT,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, manga_id, chapter_id, page_index)
      );

      CREATE TABLE IF NOT EXISTS library (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, manga_id)
      );

      CREATE TABLE IF NOT EXISTS chapter_progress (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('single', 'double', 'webtoon')),
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, manga_id, chapter_id)
      );

      CREATE TABLE IF NOT EXISTS history (
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        read_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, manga_id, chapter_id)
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        total_pages INTEGER NOT NULL DEFAULT 0,
        completed_pages INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        dir TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (source_id, manga_id, chapter_id)
      );

      CREATE TABLE IF NOT EXISTS download_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        download_id INTEGER NOT NULL,
        page_index INTEGER NOT NULL,
        file_path TEXT,
        mime TEXT,
        bytes INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
        error TEXT,
        UNIQUE (download_id, page_index),
        FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS page_cache (
        cache_key TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('page', 'cover')),
        remote_url TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plugin_configs (
        source_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chapter_progress_updated
        ON chapter_progress (updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_read_at
        ON history (read_at DESC);
      CREATE INDEX IF NOT EXISTS idx_library_added
        ON library (added_at DESC);
      CREATE INDEX IF NOT EXISTS idx_downloads_status
        ON downloads (status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_page_cache_lru
        ON page_cache (last_accessed_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE chapter_pages ADD COLUMN transform_json TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_page_cache_source_url
        ON page_cache (source_id, kind, remote_url);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE history ADD COLUMN chapter_title TEXT;
    `,
  },
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const current = Number(row?.user_version ?? 0);

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
