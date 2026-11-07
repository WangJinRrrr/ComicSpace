import type { Manga } from "@comicspace/plugin-sdk";
import { parseJson, type Db } from "../client.js";

interface LibraryRow {
  source_id: string;
  manga_id: string;
  added_at: number;
  title: string;
  cover_url: string | null;
  data_json: string;
}

export interface LibraryEntryRow {
  sourceId: string;
  mangaId: string;
  addedAt: number;
  manga: Manga;
}

export function addToLibrary(
  db: Db,
  sourceId: string,
  mangaId: string,
  addedAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO library (source_id, manga_id, added_at)
     VALUES (?, ?, ?)
     ON CONFLICT(source_id, manga_id) DO UPDATE SET added_at = library.added_at`,
  ).run(sourceId, mangaId, addedAt);
}

export function removeFromLibrary(db: Db, sourceId: string, mangaId: string): void {
  db.prepare("DELETE FROM library WHERE source_id = ? AND manga_id = ?").run(
    sourceId,
    mangaId,
  );
}

export function isInLibrary(db: Db, sourceId: string, mangaId: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS present FROM library WHERE source_id = ? AND manga_id = ? LIMIT 1",
    )
    .get(sourceId, mangaId) as { present: number } | undefined;
  return Boolean(row);
}

export function listLibrary(db: Db): LibraryEntryRow[] {
  const rows = db
    .prepare(
      `SELECT l.source_id, l.manga_id, l.added_at, m.title, m.cover_url, m.data_json
       FROM library l
       LEFT JOIN manga_cache m
         ON m.source_id = l.source_id AND m.manga_id = l.manga_id
       ORDER BY l.added_at DESC`,
    )
    .all() as unknown as LibraryRow[];

  return rows.map((row) => ({
    sourceId: row.source_id,
    mangaId: row.manga_id,
    addedAt: Number(row.added_at),
    manga: parseJson<Manga>(row.data_json, {
      id: row.manga_id,
      title: row.title,
      coverUrl: row.cover_url ?? undefined,
    }),
  }));
}

export function getLibraryEntry(
  db: Db,
  sourceId: string,
  mangaId: string,
): LibraryEntryRow | null {
  const row = db
    .prepare(
      `SELECT l.source_id, l.manga_id, l.added_at, m.title, m.cover_url, m.data_json
       FROM library l
       LEFT JOIN manga_cache m
         ON m.source_id = l.source_id AND m.manga_id = l.manga_id
       WHERE l.source_id = ? AND l.manga_id = ?`,
    )
    .get(sourceId, mangaId) as LibraryRow | undefined;
  if (!row) return null;
  return {
    sourceId: row.source_id,
    mangaId: row.manga_id,
    addedAt: Number(row.added_at),
    manga: parseJson<Manga>(row.data_json, {
      id: row.manga_id,
      title: row.title,
      coverUrl: row.cover_url ?? undefined,
    }),
  };
}

export function getUnreadCount(
  db: Db,
  sourceId: string,
  mangaId: string,
): number | null {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM chapter_cache c
          WHERE c.source_id = ? AND c.manga_id = ?) AS total,
         (SELECT COUNT(*) FROM chapter_cache c
          JOIN chapter_progress p
            ON p.source_id = c.source_id
           AND p.manga_id = c.manga_id
           AND p.chapter_id = c.chapter_id
          WHERE c.source_id = ? AND c.manga_id = ? AND p.completed = 1) AS done`,
    )
    .get(sourceId, mangaId, sourceId, mangaId) as
    | { total: number; done: number }
    | undefined;
  if (!row || Number(row.total) === 0) return null;
  return Math.max(0, Number(row.total) - Number(row.done));
}
