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
  // One visible row per manga: the chapter that was actually read last.
  // Older chapter rows stay in the table so per-chapter progress is not lost.
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT h.source_id, h.manga_id, h.chapter_id, h.page_index, h.read_at,
                h.chapter_title,
                ROW_NUMBER() OVER (
                  PARTITION BY h.source_id, h.manga_id
                  ORDER BY h.read_at DESC, h.rowid DESC
                ) AS rn
         FROM history h
       )
       SELECT r.source_id, r.manga_id, r.chapter_id, r.page_index, r.read_at,
              m.title AS manga_title, m.cover_url,
              COALESCE(
                NULLIF(c.title, ''),
                NULLIF(r.chapter_title, ''),
                r.chapter_id
              ) AS chapter_title
       FROM ranked r
       LEFT JOIN manga_cache m
         ON m.source_id = r.source_id AND m.manga_id = r.manga_id
       LEFT JOIN chapter_cache c
         ON c.source_id = r.source_id
        AND c.manga_id = r.manga_id
        AND c.chapter_id = r.chapter_id
       WHERE r.rn = 1
       ORDER BY r.read_at DESC
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

export type MergeReadResult = "added" | "updated" | "kept";

interface StoredRead {
  pageIndex: number;
  readAt: number;
  mode: ReaderMode | null;
  completed: boolean;
  chapterTitle: string | null;
}

function readStoredChapter(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): StoredRead | null {
  const progress = getProgressForChapter(db, sourceId, mangaId, chapterId);
  const history = db
    .prepare(
      `SELECT page_index, read_at, chapter_title
       FROM history
       WHERE source_id = ? AND manga_id = ? AND chapter_id = ?`,
    )
    .get(sourceId, mangaId, chapterId) as
    | {
        page_index: number;
        read_at: number;
        chapter_title: string | null;
      }
    | undefined;
  if (!progress && !history) return null;
  const times = [progress?.updatedAt, history ? Number(history.read_at) : undefined].filter(
    (value): value is number => typeof value === "number",
  );
  return {
    pageIndex: progress?.pageIndex ?? Number(history?.page_index ?? 0),
    readAt: times.length > 0 ? Math.max(...times) : 0,
    mode: progress?.mode ?? null,
    completed: progress?.completed ?? false,
    chapterTitle: history?.chapter_title ?? null,
  };
}

/**
 * Import one remote chapter read without discarding a newer local read.
 * Equal timestamps keep the further page. Unknown remote times never win.
 */
export function mergeRemoteRead(
  db: Db,
  input: {
    sourceId: string;
    mangaId: string;
    chapterId: string;
    chapterTitle?: string;
    pageIndex: number;
    readAt: number | null;
  },
): MergeReadResult {
  const pageIndex = Math.max(0, Math.min(100_000, Math.trunc(input.pageIndex)));
  const remoteTime =
    input.readAt != null && Number.isFinite(input.readAt)
      ? Math.max(0, Math.trunc(input.readAt))
      : null;
  const existing = readStoredChapter(
    db,
    input.sourceId,
    input.mangaId,
    input.chapterId,
  );

  let adopt = false;
  if (!existing) {
    adopt = true;
  } else if (remoteTime == null) {
    adopt = false;
  } else if (remoteTime > existing.readAt) {
    adopt = true;
  } else if (remoteTime === existing.readAt && pageIndex > existing.pageIndex) {
    adopt = true;
  }

  if (!adopt) return "kept";

  const readAt = remoteTime ?? 0;
  const mode = existing?.mode ?? "single";
  const completed = existing
    ? existing.completed && pageIndex >= existing.pageIndex
    : false;
  const chapterTitle = input.chapterTitle?.trim() || existing?.chapterTitle || null;

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
    pageIndex,
    mode,
    completed ? 1 : 0,
    readAt,
  );
  db.prepare(
    `INSERT INTO history
       (source_id, manga_id, chapter_id, page_index, read_at, chapter_title)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, manga_id, chapter_id) DO UPDATE SET
       page_index = excluded.page_index,
       read_at = excluded.read_at,
       chapter_title = COALESCE(excluded.chapter_title, history.chapter_title)`,
  ).run(
    input.sourceId,
    input.mangaId,
    input.chapterId,
    pageIndex,
    readAt,
    chapterTitle,
  );

  return existing ? "updated" : "added";
}
