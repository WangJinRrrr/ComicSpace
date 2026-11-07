import fs from "node:fs";
import path from "node:path";
import type { Page } from "@comicspace/plugin-sdk";
import type { Db } from "../db/client.js";
import {
  deleteDownload,
  getDownloadById,
  getDownloadPageById,
  listDownloadPages,
  listDownloads,
  markDownloadPageDone,
  markDownloadPageFailed,
  recoverInterruptedDownloads,
  resetDownloadPagesForRetry,
  updateDownloadProgress,
  updateDownloadStatus,
  type DownloadRecord,
} from "../db/repos/downloads.js";
import {
  getCachedPages,
  upsertPages,
} from "../db/repos/manga.js";
import { invokePlugin } from "../plugins/invoke.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { getCallableSource } from "../services/sources.js";
import { validatePages } from "../plugins/validate.js";
import type { ImageProxy } from "../images/proxy.js";
import { downloadDir, downloadPagePath, isPathInside, removeDir } from "./paths.js";
import { downloadImageToFile } from "./fetcher.js";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";

const CHAPTER_CONCURRENCY = 2;
const IMAGE_CONCURRENCY = 3;

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await fn(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Retry only what can plausibly succeed on a second try. A 403/404 or a
 * malformed page list will fail the same way three times; sleeping between
 * those attempts just makes the queue slower.
 */
function isRetryable(error: unknown): boolean {
  // AppError carries an explicit decision from the image pipeline. A 404 or a
  // bad transform will fail the same way again; a reset connection or a 429
  // will not.
  return !(error instanceof AppError) || error.retryable;
}

/** Exponential backoff with jitter, so parallel page retries spread out. */
function backoffMs(attempt: number): number {
  const base = 500 * 2 ** Math.max(0, attempt);
  return base + Math.random() * base * 0.3;
}

export class DownloadWorker {
  private readonly logger = createLogger("downloads");
  private running = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private wakeResolve: (() => void) | null = null;
  private readonly active = new Map<number, Promise<void>>();
  private readonly controllers = new Map<number, AbortController>();
  /** Source id per active download; one chapter per source at a time. */
  private readonly activeSources = new Map<number, string>();

  constructor(
    private readonly db: Db,
    private readonly registry: PluginRegistry,
    private readonly imageProxy: ImageProxy,
    private readonly rootDir: string,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    recoverInterruptedDownloads(this.db);
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    for (const controller of this.controllers.values()) controller.abort();
    this.wakeResolve?.();
  }

  enqueue(id: number): void {
    this.wakeResolve?.();
    if (!this.running) this.start();
    void id;
  }

  async cancel(id: number): Promise<boolean> {
    const download = getDownloadById(this.db, id);
    if (!download) return false;
    this.controllers.get(id)?.abort();
    updateDownloadStatus(this.db, id, "cancelled");
    return true;
  }

  async retry(id: number): Promise<DownloadRecord | null> {
    const download = getDownloadById(this.db, id);
    if (!download) return null;
    if (this.active.has(id)) {
      throw new Error("Download is still active");
    }
    resetDownloadPagesForRetry(this.db, id);
    updateDownloadStatus(this.db, id, "queued");
    this.enqueue(id);
    return getDownloadById(this.db, id);
  }

  async remove(id: number): Promise<boolean> {
    const download = getDownloadById(this.db, id);
    if (!download) return false;
    this.controllers.get(id)?.abort();
    await this.active.get(id);
    deleteDownload(this.db, id);
    await removeDir(downloadDir(this.rootDir, id));
    return true;
  }

  private wake(): void {
    this.wakeResolve?.();
    this.wakeResolve = null;
  }

  private async waitForWake(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.wakeResolve = null;
        resolve();
      };
      this.wakeResolve = finish;
      this.loopTimer = setTimeout(finish, ms);
    });
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const queued = listDownloads(this.db).filter(
        (item) => item.status === "queued" && !this.active.has(item.id),
      );
      // Sources often rate-limit by IP/window. Running two chapters from the
      // same source doubles the request rate for no wall-clock gain; keep one
      // chapter per source and use the second slot for a different source.
      const busySources = new Set(this.activeSources.values());
      let started = 0;
      for (const download of queued) {
        if (this.active.size >= CHAPTER_CONCURRENCY) break;
        if (busySources.has(download.sourceId)) continue;
        const promise = this.runOne(download.id).finally(() => {
          this.active.delete(download.id);
          this.controllers.delete(download.id);
          this.activeSources.delete(download.id);
          this.wake();
        });
        this.active.set(download.id, promise);
        this.activeSources.set(download.id, download.sourceId);
        busySources.add(download.sourceId);
        started += 1;
      }
      if (started === 0) {
        await this.waitForWake(1000);
      } else {
        await this.waitForWake(250);
      }
    }
  }

  private async runOne(id: number): Promise<void> {
    const download = getDownloadById(this.db, id);
    if (!download || download.status !== "queued") return;

    const controller = new AbortController();
    this.controllers.set(id, controller);
    updateDownloadStatus(this.db, id, "running");

    try {
      const pages = await this.ensurePages(download, controller.signal);
      const plugin = await this.registry.getPlugin(download.sourceId);
      const policy = {
        allowedHosts: plugin?.manifest.allowedImageHosts,
        extraAllowedHosts: this.imageProxy.getExtraAllowedHosts(),
      };
      const dir = downloadDir(this.rootDir, id);
      await fs.promises.mkdir(dir, { recursive: true });
      const rows = listDownloadPages(this.db, id);
      let failedPages = 0;

      await mapLimit(rows, IMAGE_CONCURRENCY, async (row) => {
        if (controller.signal.aborted) return;
        if (row.status === "done" && row.filePath && fs.existsSync(row.filePath)) {
          return;
        }
        const page = pages[row.pageIndex];
        if (!page) {
          failedPages += 1;
          markDownloadPageFailed(this.db, row.id, "Page metadata is missing");
          return;
        }

        const headers = {
          ...(plugin?.manifest.imageHeaders ?? {}),
          ...(page.headers ?? {}),
        };
        if (page.referer) headers.referer = page.referer;

        let lastError = "Unknown download error";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (controller.signal.aborted) return;
          try {
            const filePath = downloadPagePath(dir, row.pageIndex, page.mimeType ?? "image/jpeg");
            const result = await downloadImageToFile({
              url: page.url,
              headers,
              policy,
              filePath,
              signal: controller.signal,
              transform: page.transform,
            });
            markDownloadPageDone(
              this.db,
              row.id,
              result.filePath,
              result.mime,
              result.bytes,
            );
            updateDownloadProgress(this.db, id);
            return;
          } catch (error) {
            lastError = describeError(error);
            if (controller.signal.aborted) return;
            if (!isRetryable(error)) break;
            await sleep(backoffMs(attempt));
          }
        }
        failedPages += 1;
        markDownloadPageFailed(this.db, row.id, lastError);
      });

      updateDownloadProgress(this.db, id);
      if (controller.signal.aborted) {
        updateDownloadStatus(this.db, id, "cancelled");
      } else if (failedPages > 0) {
        updateDownloadStatus(
          this.db,
          id,
          "failed",
          `${failedPages} page(s) failed`,
        );
      } else {
        updateDownloadStatus(this.db, id, "completed");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        updateDownloadStatus(this.db, id, "cancelled");
      } else {
        this.logger.warn(`Download ${id} failed`, error);
        updateDownloadStatus(this.db, id, "failed", describeError(error));
      }
    }
  }

  private async ensurePages(
    download: DownloadRecord,
    signal: AbortSignal,
  ): Promise<Page[]> {
    const cached = getCachedPages(
      this.db,
      download.sourceId,
      download.mangaId,
      download.chapterId,
    );
    if (cached && cached.pages.length > 0) return cached.pages;

    const source = await getCallableSource(
      this.registry,
      this.db,
      download.sourceId,
    );
    const raw = await invokePlugin<unknown>(
      source.plugin,
      "getPages",
      [download.mangaId, download.chapterId],
      {
        config: source.config,
        limiter: this.registry.limiterFor(source.plugin),
        signal,
        timeoutMs: 30_000,
      },
    );
    const pages = validatePages(raw);
    upsertPages(
      this.db,
      download.sourceId,
      download.mangaId,
      download.chapterId,
      pages,
    );
    return pages;
  }

  getPageFile(pageId: number): { filePath: string; mime: string } | null {
    const page = getDownloadPageById(this.db, pageId);
    if (!page || page.status !== "done" || !page.filePath) return null;
    if (!isPathInside(this.rootDir, page.filePath)) return null;
    return {
      filePath: path.resolve(page.filePath),
      mime: page.mime ?? "application/octet-stream",
    };
  }
}
