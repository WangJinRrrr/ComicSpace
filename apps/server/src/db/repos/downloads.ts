import type { DownloadStatus } from "@comicspace/contracts";
import { type Db } from "../client.js";

interface DownloadRow {
  id: number;
  source_id: string;
  manga_id: string;
  chapter_id: string;
  status: DownloadStatus;
  total_pages: number;
  completed_pages: number;
  bytes: number;
  error: string | null;
  dir: string;
  created_at: number;
  updated_at: number;
  manga_title?: string | null;
  chapter_title?: string | null;
}

export interface DownloadRecord {
  id: number;
  sourceId: string;
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  chapterTitle: string;
  status: DownloadStatus;
  totalPages: number;
  completedPages: number;
  bytes: number;
  error?: string;
  dir: string;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadPageRecord {
  id: number;
  downloadId: number;
  pageIndex: number;
  filePath: string | null;
  mime: string | null;
  bytes: number | null;
  status: "pending" | "done" | "failed";
  error: string | null;
}

function mapDownload(row: DownloadRow): DownloadRecord {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    mangaId: row.manga_id,
    mangaTitle: row.manga_title ?? row.manga_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title ?? row.chapter_id,
    status: row.status,
    totalPages: Number(row.total_pages),
    completedPages: Number(row.completed_pages),
    bytes: Number(row.bytes),
    error: row.error ?? undefined,
    dir: row.dir,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function listDownloads(db: Db): DownloadRecord[] {
  const rows = db
    .prepare(
      `SELECT d.*, m.title AS manga_title, c.title AS chapter_title
       FROM downloads d
       LEFT JOIN manga_cache m
         ON m.source_id = d.source_id AND m.manga_id = d.manga_id
       LEFT JOIN chapter_cache c
         ON c.source_id = d.source_id
        AND c.manga_id = d.manga_id
        AND c.chapter_id = d.chapter_id
       ORDER BY d.created_at DESC`,
    )
    .all() as unknown as DownloadRow[];
  return rows.map(mapDownload);
}

export function getDownloadById(db: Db, id: number): DownloadRecord | null {
  const row = db
    .prepare(
      `SELECT d.*, m.title AS manga_title, c.title AS chapter_title
       FROM downloads d
       LEFT JOIN manga_cache m
         ON m.source_id = d.source_id AND m.manga_id = d.manga_id
       LEFT JOIN chapter_cache c
         ON c.source_id = d.source_id
        AND c.manga_id = d.manga_id
        AND c.chapter_id = d.chapter_id
       WHERE d.id = ?`,
    )
    .get(id) as DownloadRow | undefined;
  return row ? mapDownload(row) : null;
}

export function getDownloadByChapter(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): DownloadRecord | null {
  const row = db
    .prepare(
      `SELECT d.*, m.title AS manga_title, c.title AS chapter_title
       FROM downloads d
       LEFT JOIN manga_cache m
         ON m.source_id = d.source_id AND m.manga_id = d.manga_id
       LEFT JOIN chapter_cache c
         ON c.source_id = d.source_id
        AND c.manga_id = d.manga_id
        AND c.chapter_id = d.chapter_id
       WHERE d.source_id = ? AND d.manga_id = ? AND d.chapter_id = ?`,
    )
    .get(sourceId, mangaId, chapterId) as DownloadRow | undefined;
  return row ? mapDownload(row) : null;
}

export function createDownload(
  db: Db,
  input: {
    sourceId: string;
    mangaId: string;
    chapterId: string;
    totalPages: number;
  },
  createdAt = Date.now(),
): DownloadRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO downloads
         (source_id, manga_id, chapter_id, status, total_pages, completed_pages,
          bytes, error, dir, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, 0, 0, NULL, '', ?, ?)
       ON CONFLICT(source_id, manga_id, chapter_id) DO UPDATE SET
         status = 'queued',
         total_pages = excluded.total_pages,
         completed_pages = 0,
         bytes = 0,
         error = NULL,
         updated_at = excluded.updated_at`,
    ).run(
      input.sourceId,
      input.mangaId,
      input.chapterId,
      input.totalPages,
      createdAt,
      createdAt,
    );

    const row = db
      .prepare(
        `SELECT id FROM downloads
         WHERE source_id = ? AND manga_id = ? AND chapter_id = ?`,
      )
      .get(input.sourceId, input.mangaId, input.chapterId) as
      | { id: number }
      | undefined;
    if (!row) throw new Error("Failed to create download row");
    const id = Number(row.id);
    db.prepare("UPDATE downloads SET dir = ? WHERE id = ?").run(String(id), id);
    db.prepare("DELETE FROM download_pages WHERE download_id = ?").run(id);
    const insertPage = db.prepare(
      `INSERT INTO download_pages
         (download_id, page_index, file_path, mime, bytes, status, error)
       VALUES (?, ?, NULL, NULL, NULL, 'pending', NULL)`,
    );
    for (let index = 0; index < input.totalPages; index += 1) {
      insertPage.run(id, index);
    }
    db.exec("COMMIT");
    const created = getDownloadById(db, id);
    if (!created) throw new Error("Failed to read created download");
    return created;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateDownloadStatus(
  db: Db,
  id: number,
  status: DownloadStatus,
  error?: string,
): void {
  db.prepare(
    "UPDATE downloads SET status = ?, error = ?, updated_at = ? WHERE id = ?",
  ).run(status, error ?? null, Date.now(), id);
}

export function updateDownloadProgress(db: Db, id: number): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
              COALESCE(SUM(CASE WHEN status = 'done' THEN bytes ELSE 0 END), 0) AS bytes
       FROM download_pages WHERE download_id = ?`,
    )
    .get(id) as { total: number; done: number; bytes: number } | undefined;
  if (!row) return;
  db.prepare(
    "UPDATE downloads SET completed_pages = ?, bytes = ?, updated_at = ? WHERE id = ?",
  ).run(Number(row.done), Number(row.bytes), Date.now(), id);
}

export function listDownloadPages(db: Db, downloadId: number): DownloadPageRecord[] {
  const rows = db
    .prepare(
      `SELECT id, download_id, page_index, file_path, mime, bytes, status, error
       FROM download_pages WHERE download_id = ? ORDER BY page_index`,
    )
    .all(downloadId) as Array<{
    id: number;
    download_id: number;
    page_index: number;
    file_path: string | null;
    mime: string | null;
    bytes: number | null;
    status: "pending" | "done" | "failed";
    error: string | null;
  }>;
  return rows.map((row) => ({
    id: Number(row.id),
    downloadId: Number(row.download_id),
    pageIndex: Number(row.page_index),
    filePath: row.file_path,
    mime: row.mime,
    bytes: row.bytes == null ? null : Number(row.bytes),
    status: row.status,
    error: row.error,
  }));
}

export function getDownloadPageById(
  db: Db,
  pageId: number,
): DownloadPageRecord | null {
  const row = db
    .prepare(
      `SELECT id, download_id, page_index, file_path, mime, bytes, status, error
       FROM download_pages WHERE id = ?`,
    )
    .get(pageId) as
    | {
        id: number;
        download_id: number;
        page_index: number;
        file_path: string | null;
        mime: string | null;
        bytes: number | null;
        status: "pending" | "done" | "failed";
        error: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    downloadId: Number(row.download_id),
    pageIndex: Number(row.page_index),
    filePath: row.file_path,
    mime: row.mime,
    bytes: row.bytes == null ? null : Number(row.bytes),
    status: row.status,
    error: row.error,
  };
}

export function markDownloadPageDone(
  db: Db,
  pageId: number,
  filePath: string,
  mime: string,
  bytes: number,
): void {
  db.prepare(
    `UPDATE download_pages
     SET file_path = ?, mime = ?, bytes = ?, status = 'done', error = NULL
     WHERE id = ?`,
  ).run(filePath, mime, bytes, pageId);
}

export function markDownloadPageFailed(
  db: Db,
  pageId: number,
  error: string,
): void {
  db.prepare(
    "UPDATE download_pages SET status = 'failed', error = ? WHERE id = ?",
  ).run(error, pageId);
}

export function resetDownloadPagesForRetry(db: Db, downloadId: number): void {
  db.prepare(
    "UPDATE download_pages SET status = 'pending', error = NULL WHERE download_id = ? AND status = 'failed'",
  ).run(downloadId);
}

export function deleteDownload(db: Db, id: number): void {
  db.prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

export function recoverInterruptedDownloads(db: Db): number {
  const result = db
    .prepare(
      "UPDATE downloads SET status = 'queued', updated_at = ? WHERE status = 'running'",
    )
    .run(Date.now());
  return Number(result.changes);
}

export function getDownloadsTotalBytes(db: Db): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(bytes), 0) AS total FROM downloads WHERE status = 'completed'",
    )
    .get() as { total: number } | undefined;
  return Number(row?.total ?? 0);
}
