import type { Db } from "../client.js";

export interface CacheEntryRecord {
  cacheKey: string;
  sourceId: string;
  kind: "page" | "cover";
  remoteUrl: string;
  filePath: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  lastAccessedAt: number;
}

interface CacheRow {
  cache_key: string;
  source_id: string;
  kind: "page" | "cover";
  remote_url: string;
  file_path: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: number;
  last_accessed_at: number;
}

function mapCache(row: CacheRow): CacheEntryRecord {
  return {
    cacheKey: row.cache_key,
    sourceId: row.source_id,
    kind: row.kind,
    remoteUrl: row.remote_url,
    filePath: row.file_path,
    mime: row.mime,
    bytes: Number(row.bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    createdAt: Number(row.created_at),
    lastAccessedAt: Number(row.last_accessed_at),
  };
}

export function getCacheEntry(db: Db, key: string): CacheEntryRecord | null {
  const row = db
    .prepare("SELECT * FROM page_cache WHERE cache_key = ?")
    .get(key) as CacheRow | undefined;
  return row ? mapCache(row) : null;
}

export function insertCacheEntry(
  db: Db,
  entry: {
    cacheKey: string;
    sourceId: string;
    kind: "page" | "cover";
    remoteUrl: string;
    filePath: string;
    mime: string;
    bytes: number;
    width?: number;
    height?: number;
  },
  createdAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO page_cache
       (cache_key, source_id, kind, remote_url, file_path, mime, bytes, width, height,
        created_at, last_accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       file_path = excluded.file_path,
       mime = excluded.mime,
       bytes = excluded.bytes,
       width = excluded.width,
       height = excluded.height,
       last_accessed_at = excluded.last_accessed_at`,
  ).run(
    entry.cacheKey,
    entry.sourceId,
    entry.kind,
    entry.remoteUrl,
    entry.filePath,
    entry.mime,
    entry.bytes,
    entry.width ?? null,
    entry.height ?? null,
    createdAt,
    createdAt,
  );
}

export function touchCacheEntry(db: Db, key: string, now = Date.now()): void {
  db.prepare(
    `UPDATE page_cache SET last_accessed_at = ?
     WHERE cache_key = ? AND last_accessed_at < ?`,
  ).run(now, key, now - 60 * 60 * 1000);
}

/**
 * Pixel sizes already recorded for these remote URLs. The reader uses them to
 * reserve layout space, so a cached page renders without a height jump.
 */
export function findCacheDimensions(
  db: Db,
  sourceId: string,
  kind: "page" | "cover",
  urls: string[],
): Map<string, { width: number; height: number }> {
  const result = new Map<string, { width: number; height: number }>();
  const unique = [...new Set(urls.filter(Boolean))];
  // SQLite caps bound parameters; chapters stay well below this, but chunking
  // keeps the helper safe for browse responses with many covers.
  const CHUNK = 400;
  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT remote_url, width, height FROM page_cache
         WHERE source_id = ? AND kind = ? AND width IS NOT NULL AND height IS NOT NULL
           AND remote_url IN (${placeholders})`,
      )
      .all(sourceId, kind, ...chunk) as Array<{
      remote_url: string;
      width: number;
      height: number;
    }>;
    for (const row of rows) {
      result.set(row.remote_url, {
        width: Number(row.width),
        height: Number(row.height),
      });
    }
  }
  return result;
}

export function getCacheStats(db: Db): {
  bytes: number;
  entries: number;
} {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS entries FROM page_cache",
    )
    .get() as { bytes: number; entries: number } | undefined;
  return {
    bytes: Number(row?.bytes ?? 0),
    entries: Number(row?.entries ?? 0),
  };
}

export function listCacheForEviction(
  db: Db,
  limit = 1000,
): Array<{ cacheKey: string; filePath: string; bytes: number }> {
  const rows = db
    .prepare(
      `SELECT cache_key, file_path, bytes FROM page_cache
       ORDER BY last_accessed_at ASC LIMIT ?`,
    )
    .all(limit) as Array<{
    cache_key: string;
    file_path: string;
    bytes: number;
  }>;
  return rows.map((row) => ({
    cacheKey: row.cache_key,
    filePath: row.file_path,
    bytes: Number(row.bytes),
  }));
}

export function deleteCacheEntry(db: Db, key: string): void {
  db.prepare("DELETE FROM page_cache WHERE cache_key = ?").run(key);
}

export function clearCacheEntries(db: Db): void {
  db.prepare("DELETE FROM page_cache").run();
}

export function listAllCacheEntries(db: Db): CacheEntryRecord[] {
  const rows = db.prepare("SELECT * FROM page_cache").all() as unknown as CacheRow[];
  return rows.map(mapCache);
}
