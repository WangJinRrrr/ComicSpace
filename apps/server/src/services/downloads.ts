import type {
  DownloadDto,
  DownloadsDto,
} from "@comicspace/contracts";
import type { Db } from "../db/client.js";
import {
  createDownload,
  getDownloadByChapter,
  getDownloadById,
  getDownloadsTotalBytes,
  listDownloads,
  type DownloadRecord,
} from "../db/repos/downloads.js";
import { upsertPages } from "../db/repos/manga.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { invokePlugin } from "../plugins/invoke.js";
import { validatePages } from "../plugins/validate.js";
import type { DownloadWorker } from "../downloads/worker.js";
import { getCallableSource } from "./sources.js";

export function toDownloadDto(record: DownloadRecord): DownloadDto {
  return {
    id: record.id,
    sourceId: record.sourceId,
    mangaId: record.mangaId,
    mangaTitle: record.mangaTitle,
    chapterId: record.chapterId,
    chapterTitle: record.chapterTitle,
    status: record.status,
    totalPages: record.totalPages,
    completedPages: record.completedPages,
    bytes: record.bytes,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class DownloadService {
  constructor(
    private readonly db: Db,
    private readonly registry: PluginRegistry,
    private readonly worker: DownloadWorker,
  ) {}

  list(): DownloadsDto {
    return {
      downloads: listDownloads(this.db).map(toDownloadDto),
      totalBytes: getDownloadsTotalBytes(this.db),
    };
  }

  async start(input: {
    sourceId: string;
    mangaId: string;
    chapterIds: string[];
    signal?: AbortSignal;
  }): Promise<DownloadsDto> {
    for (const chapterId of input.chapterIds) {
      const existing = getDownloadByChapter(
        this.db,
        input.sourceId,
        input.mangaId,
        chapterId,
      );
      if (
        existing &&
        (existing.status === "completed" ||
          existing.status === "queued" ||
          existing.status === "running")
      ) {
        continue;
      }

      const source = await getCallableSource(
        this.registry,
        this.db,
        input.sourceId,
      );
      const raw = await invokePlugin<unknown>(
        source.plugin,
        "getPages",
        [input.mangaId, chapterId],
        {
          config: source.config,
          limiter: this.registry.limiterFor(source.plugin),
          signal: input.signal,
          timeoutMs: 30_000,
        },
      );
      const pages = validatePages(raw);
      upsertPages(
        this.db,
        input.sourceId,
        input.mangaId,
        chapterId,
        pages,
      );
      const created = createDownload(this.db, {
        sourceId: input.sourceId,
        mangaId: input.mangaId,
        chapterId,
        totalPages: pages.length,
      });
      this.worker.enqueue(created.id);
    }

    return this.list();
  }

  async cancel(id: number): Promise<DownloadDto | null> {
    const download = getDownloadById(this.db, id);
    if (!download) return null;
    await this.worker.cancel(id);
    const updated = getDownloadById(this.db, id);
    return updated ? toDownloadDto(updated) : null;
  }

  async retry(id: number): Promise<DownloadDto | null> {
    const updated = await this.worker.retry(id);
    return updated ? toDownloadDto(updated) : null;
  }

  async remove(id: number): Promise<boolean> {
    return this.worker.remove(id);
  }

  getPageFile(pageId: number) {
    return this.worker.getPageFile(pageId);
  }
}
