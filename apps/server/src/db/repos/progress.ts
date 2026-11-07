import type { ReaderMode } from "@comicspace/contracts";
import { withTransaction, type Db } from "../client.js";

interface ProgressRow {
  source_id: string;
  manga_id: string;
  chapter_id: string;
  page_index: number;
  mode: ReaderMode;
  completed: number;
  updated_at: number;
}

export interface ProgressRecord {
  sourceId: string;
  mangaId: string;
  chapterId: string;
  pageIndex: number;
  mode: ReaderMode;
  completed: boolean;
  updatedAt: number;
}

export interface HistoryRecord {
  sourceId: string;
  mangaId: string;
  mangaTitle: string;
  coverUrl?: string;
  chapterId: string;
  chapterTitle: string;
  pageIndex: number;
  readAt: number;
}

function mapProgress(row: ProgressRow): ProgressRecord {
  return {
    sourceId: row.source_id,
    mangaId: row.manga_id,
    chapterId: row.chapter_id,
    pageIndex: Number(row.page_index),
    mode: row.mode,
    completed: Boolean(row.completed),
    updatedAt: Number(row.updated_at),
  };
}

export function upsertProgress(
  db: Db,
  input: {
    sourceId: string;
    mangaId: string;
    chapterId: string;
    pageIndex: number;
    mode: ReaderMode;
    completed: boolean;
  },
  updatedAt = Date.now(),
): void {
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO chapter_progress
         (source_id, manga_id, chapter_id, page_index, mode, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, manga_id, chapter_id) DO UPDATE SET
         page_index = excluded.page_index,
         mode = excluded.mode,
         completed = excluded.completed,
         updated_at = excluded.updated_at`,
    ).run(
      input.sourceId,
      input.mangaId,
      input.chapterId,
      input.pageIndex,
      input.mode,
      input.completed ? 1 : 0,
      updatedAt,
    );
    db.prepare(
      `INSERT INTO history
         (source_id, manga_id, chapter_id, page_index, read_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, manga_id, chapter_id) DO UPDATE SET
         page_index = excluded.page_index,
         read_at = excluded.read_at`,
    ).run(
      input.sourceId,
      input.mangaId,
      input.chapterId,
      input.pageIndex,
      updatedAt,
    );
  });
}

export function getProgressForChapter(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): ProgressRecord | null {
  const row = db
    .prepare(
      `SELECT source_id, manga_id, chapter_id, page_index, mode, completed, updated_at
       FROM chapter_progress
       WHERE source_id = ? AND manga_id = ? AND chapter_id = ?`,
    )
    .get(sourceId, mangaId, chapterId) as ProgressRow | undefined;
  return row ? mapProgress(row) : null;
}

export function getLatestProgress(
  db: Db,
  sourceId: string,
  mangaId: string,
): ProgressRecord | null {
  const row = db
    .prepare(
      `SELECT source_id, manga_id, chapter_id, page_index, mode, completed, updated_at
       FROM chapter_progress
       WHERE source_id = ? AND manga_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(sourceId, mangaId) as ProgressRow | undefined;
  return row ? mapProgress(row) : null;
}

export function listProgressForManga(
  db: Db,
  sourceId: string,
  mangaId: string,
): ProgressRecord[] {
  const rows = db
    .prepare(
      `SELECT source_id, manga_id, chapter_id, page_index, mode, completed, updated_at
       FROM chapter_progress
       WHERE source_id = ? AND manga_id = ?`,
    )
    .all(sourceId, mangaId) as unknown as ProgressRow[];
  return rows.map(mapProgress);
}

export function listHistory(db: Db, limit = 100): HistoryRecord[] {
  const rows = db
    .prepare(
      `SELECT h.source_id, h.manga_id, h.chapter_id, h.page_index, h.read_at,
              m.title AS manga_title, m.cover_url,
              c.title AS chapter_title
       FROM history h
       LEFT JOIN manga_cache m
         ON m.source_id = h.source_id AND m.manga_id = h.manga_id
       LEFT JOIN chapter_cache c
         ON c.source_id = h.source_id
        AND c.manga_id = h.manga_id
        AND c.chapter_id = h.chapter_id
       ORDER BY h.read_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    source_id: string;
    manga_id: string;
    chapter_id: string;
    page_index: number;
    read_at: number;
    manga_title: string | null;
    cover_url: string | null;
    chapter_title: string | null;
  }>;

  return rows.map((row) => ({
    sourceId: row.source_id,
    mangaId: row.manga_id,
    mangaTitle: row.manga_title ?? row.manga_id,
    coverUrl: row.cover_url ?? undefined,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title ?? row.chapter_id,
    pageIndex: Number(row.page_index),
    readAt: Number(row.read_at),
  }));
}

export function clearHistory(db: Db): void {
  db.prepare("DELETE FROM history").run();
}
