import type { Chapter, Manga, Page } from "@comicspace/plugin-sdk";
import { parseJson, withTransaction, type Db } from "../client.js";

interface MangaRow {
  source_id: string;
  manga_id: string;
  title: string;
  cover_url: string | null;
  data_json: string;
  fetched_at: number;
  chapters_fetched_at: number | null;
}

interface ChapterRow {
  source_id: string;
  manga_id: string;
  chapter_id: string;
  title: string;
  number: number | null;
  data_json: string;
  fetched_at: number;
}

interface PageRow {
  source_id: string;
  manga_id: string;
  chapter_id: string;
  page_index: number;
  url: string;
  referer: string | null;
  headers_json: string | null;
  transform_json: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  fetched_at: number;
}

export interface CachedManga {
  manga: Manga;
  fetchedAt: number;
  chaptersFetchedAt: number | null;
}

export interface CachedChapters {
  chapters: Chapter[];
  fetchedAt: number;
}

export interface CachedPages {
  pages: Page[];
  fetchedAt: number;
}

export function upsertManga(
  db: Db,
  sourceId: string,
  manga: Manga,
  fetchedAt = Date.now(),
  chaptersFetchedAt: number | null = null,
): void {
  db.prepare(
    `INSERT INTO manga_cache
       (source_id, manga_id, title, cover_url, data_json, fetched_at, chapters_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, manga_id) DO UPDATE SET
       title = excluded.title,
       cover_url = excluded.cover_url,
       data_json = excluded.data_json,
       fetched_at = excluded.fetched_at,
       chapters_fetched_at = COALESCE(excluded.chapters_fetched_at, manga_cache.chapters_fetched_at)`,
  ).run(
    sourceId,
    manga.id,
    manga.title,
    manga.coverUrl ?? null,
    JSON.stringify(manga),
    fetchedAt,
    chaptersFetchedAt,
  );
}

export function getCachedManga(
  db: Db,
  sourceId: string,
  mangaId: string,
): CachedManga | null {
  const row = db
    .prepare(
      `SELECT source_id, manga_id, title, cover_url, data_json, fetched_at, chapters_fetched_at
       FROM manga_cache WHERE source_id = ? AND manga_id = ?`,
    )
    .get(sourceId, mangaId) as MangaRow | undefined;
  if (!row) return null;
  return {
    manga: parseJson<Manga>(row.data_json, {
      id: row.manga_id,
      title: row.title,
    }),
    fetchedAt: Number(row.fetched_at),
    chaptersFetchedAt:
      row.chapters_fetched_at == null ? null : Number(row.chapters_fetched_at),
  };
}

export function upsertChapters(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapters: Chapter[],
  fetchedAt = Date.now(),
): void {
  withTransaction(db, () => {
    db.prepare("DELETE FROM chapter_cache WHERE source_id = ? AND manga_id = ?").run(
      sourceId,
      mangaId,
    );
    const insert = db.prepare(
      `INSERT INTO chapter_cache
         (source_id, manga_id, chapter_id, title, number, data_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const chapter of chapters) {
      insert.run(
        sourceId,
        mangaId,
        chapter.id,
        chapter.title,
        chapter.number ?? null,
        JSON.stringify(chapter),
        fetchedAt,
      );
    }
    db.prepare(
      "UPDATE manga_cache SET chapters_fetched_at = ? WHERE source_id = ? AND manga_id = ?",
    ).run(fetchedAt, sourceId, mangaId);
  });
}

export function getCachedChapters(
  db: Db,
  sourceId: string,
  mangaId: string,
): CachedChapters | null {
  const rows = db
    .prepare(
      `SELECT source_id, manga_id, chapter_id, title, number, data_json, fetched_at
       FROM chapter_cache WHERE source_id = ? AND manga_id = ?
       ORDER BY (number IS NULL), number DESC, chapter_id`,
    )
    .all(sourceId, mangaId) as unknown as ChapterRow[];
  if (rows.length === 0) return null;
  return {
    chapters: rows.map((row) =>
      parseJson<Chapter>(row.data_json, {
        id: row.chapter_id,
        title: row.title,
        number: row.number ?? undefined,
      }),
    ),
    fetchedAt: Math.max(...rows.map((row) => Number(row.fetched_at))),
  };
}

export function upsertPages(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
  pages: Page[],
  fetchedAt = Date.now(),
): void {
  withTransaction(db, () => {
    db.prepare(
      "DELETE FROM chapter_pages WHERE source_id = ? AND manga_id = ? AND chapter_id = ?",
    ).run(sourceId, mangaId, chapterId);
    const insert = db.prepare(
      `INSERT INTO chapter_pages
         (source_id, manga_id, chapter_id, page_index, url, referer, headers_json,
          transform_json, width, height, mime, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    pages.forEach((page, index) => {
      insert.run(
        sourceId,
        mangaId,
        chapterId,
        index,
        page.url,
        page.referer ?? null,
        page.headers ? JSON.stringify(page.headers) : null,
        page.transform ? JSON.stringify(page.transform) : null,
        page.width ?? null,
        page.height ?? null,
        page.mimeType ?? null,
        fetchedAt,
      );
    });
  });
}

export function getCachedPages(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): CachedPages | null {
  const rows = db
    .prepare(
      `SELECT source_id, manga_id, chapter_id, page_index, url, referer, headers_json,
              transform_json, width, height, mime, fetched_at
       FROM chapter_pages
       WHERE source_id = ? AND manga_id = ? AND chapter_id = ?
       ORDER BY page_index`,
    )
    .all(sourceId, mangaId, chapterId) as unknown as PageRow[];
  if (rows.length === 0) return null;
  return {
    pages: rows.map((row) => ({
      url: row.url,
      referer: row.referer ?? undefined,
      headers: row.headers_json
        ? parseJson<Record<string, string>>(row.headers_json, {})
        : undefined,
      transform: row.transform_json
        ? parseJson<Page["transform"]>(row.transform_json, undefined)
        : undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      mimeType: row.mime ?? undefined,
    })),
    fetchedAt: Math.max(...rows.map((row) => Number(row.fetched_at))),
  };
}
