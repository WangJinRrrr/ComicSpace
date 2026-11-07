import type {
  ChapterDto,
  ChaptersDto,
  DownloadStatus,
  MangaDetailDto,
  MangaDto,
  MangaProgressDto,
  PageDto,
  PagedResultDto,
  ReaderPayload,
} from "@comicspace/contracts";
import type {
  Chapter,
  FilterDef,
  Manga,
  Page,
  PluginManifest,
} from "@comicspace/plugin-sdk";
import { PluginError } from "@comicspace/plugin-sdk";
import type { Db } from "../db/client.js";
import {
  getCachedChapters,
  getCachedManga,
  getCachedPages,
  upsertChapters,
  upsertManga,
  upsertPages,
} from "../db/repos/manga.js";
import { getDownloadByChapter, listDownloadPages } from "../db/repos/downloads.js";
import { findCacheDimensions } from "../db/repos/cache.js";
import { isInLibrary } from "../db/repos/library.js";
import {
  getLatestProgress,
  listProgressForManga,
} from "../db/repos/progress.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { invokePlugin } from "../plugins/invoke.js";
import {
  getCallableSource,
  type CallableSource,
} from "./sources.js";
import type { ImageProxy } from "../images/proxy.js";
import {
  validateChapters,
  validateFilters,
  validateManga,
  validatePagedManga,
  validatePages,
} from "../plugins/validate.js";

const MANGA_TTL = 60 * 60 * 1000;
const CHAPTERS_TTL = 15 * 60 * 1000;
const PAGES_TTL = 24 * 60 * 60 * 1000;
/** Pages to pull into the image cache ahead of the resume point. */
const WARM_PAGES = 5;
/** Pages behind it, so a quick flip back is not a cold fetch. */
const WARM_BEHIND = 2;

export interface CatalogDeps {
  db: Db;
  registry: PluginRegistry;
  imageProxy: ImageProxy;
}

function isFresh(fetchedAt: number, ttl: number): boolean {
  return Date.now() - fetchedAt < ttl;
}

export function coverUrlFor(
  deps: CatalogDeps,
  sourceId: string,
  manga: Manga,
  manifest?: PluginManifest,
): string | undefined {
  if (!manga.coverUrl) return undefined;
  try {
    const token = deps.imageProxy.createTicket(sourceId, "cover", manga.coverUrl, {
      allowedHosts: manifest?.allowedImageHosts,
      headers: manifest?.imageHeaders,
    });
    return `/api/image/${token}`;
  } catch {
    return undefined;
  }
}

function toMangaDto(
  deps: CatalogDeps,
  sourceId: string,
  manga: Manga,
  options: { inLibrary?: boolean; manifest?: PluginManifest } = {},
): MangaDto {
  return {
    ...manga,
    sourceId,
    coverUrl: coverUrlFor(deps, sourceId, manga, options.manifest),
    inLibrary: options.inLibrary,
  };
}

export function toProgressDto(progress: ReturnType<typeof getLatestProgress>): MangaProgressDto | null {
  if (!progress) return null;
  return {
    chapterId: progress.chapterId,
    pageIndex: progress.pageIndex,
    mode: progress.mode,
    completed: progress.completed,
    updatedAt: progress.updatedAt,
  };
}

async function trySource(
  deps: CatalogDeps,
  sourceId: string,
): Promise<CallableSource | null> {
  try {
    return await getCallableSource(deps.registry, deps.db, sourceId);
  } catch {
    return null;
  }
}

async function runPagedQuery(
  deps: CatalogDeps,
  source: CallableSource,
  sourceId: string,
  method: "search" | "browse",
  args: unknown[],
  signal?: AbortSignal,
): Promise<PagedResultDto<MangaDto>> {
  const raw = await invokePlugin<unknown>(source.plugin, method, args, {
    config: source.config,
    limiter: deps.registry.limiterFor(source.plugin),
    signal,
    timeoutMs: 20_000,
  });
  const result = validatePagedManga(raw);
  const fetchedAt = Date.now();
  for (const manga of result.items) {
    upsertManga(deps.db, sourceId, manga, fetchedAt);
  }
  return {
    items: result.items.map((manga) =>
      toMangaDto(deps, sourceId, manga, {
        manifest: source.plugin.manifest,
      }),
    ),
    page: result.page,
    hasNextPage: result.hasNextPage,
    total: result.total,
  };
}

export async function searchSource(
  deps: CatalogDeps,
  input: {
    sourceId: string;
    term: string;
    page: number;
    filters?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<PagedResultDto<MangaDto>> {
  const source = await getCallableSource(
    deps.registry,
    deps.db,
    input.sourceId,
  );
  if (!source.plugin.capabilities.search) {
    throw new PluginError("unsupported", "This source does not support search");
  }
  return runPagedQuery(
    deps,
    source,
    input.sourceId,
    "search",
    [{ term: input.term, page: input.page, filters: input.filters }],
    input.signal,
  );
}

export async function browseSource(
  deps: CatalogDeps,
  input: {
    sourceId: string;
    page: number;
    filters?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<PagedResultDto<MangaDto>> {
  const source = await getCallableSource(
    deps.registry,
    deps.db,
    input.sourceId,
  );
  if (!source.plugin.capabilities.browse) {
    throw new PluginError("unsupported", "This source does not support browse");
  }
  return runPagedQuery(
    deps,
    source,
    input.sourceId,
    "browse",
    [{ page: input.page, filters: input.filters }],
    input.signal,
  );
}

export async function getFilters(
  deps: CatalogDeps,
  sourceId: string,
  signal?: AbortSignal,
): Promise<FilterDef[]> {
  const source = await getCallableSource(deps.registry, deps.db, sourceId);
  if (!source.plugin.capabilities.filters) return [];
  const raw = await invokePlugin<unknown>(
    source.plugin,
    "getFilters",
    [],
    {
      config: source.config,
      limiter: deps.registry.limiterFor(source.plugin),
      signal,
      timeoutMs: 20_000,
    },
  );
  return validateFilters(raw);
}

export async function getMangaDetail(
  deps: CatalogDeps,
  input: { sourceId: string; mangaId: string; refresh?: boolean; signal?: AbortSignal },
): Promise<MangaDetailDto> {
  const cached = getCachedManga(deps.db, input.sourceId, input.mangaId);
  const source = await trySource(deps, input.sourceId);

  let manga: Manga | null = cached?.manga ?? null;
  let stale = Boolean(!source && cached);
  const manifest: PluginManifest | undefined = source?.plugin.manifest;

  // Search/browse results often carry only a summary. When the source can
  // produce full details, refresh the cached summary instead of reusing it
  // for the whole TTL (which would hide description and cover data).
  const hasDetails = Boolean(cached?.manga.description && cached?.manga.coverUrl);
  const canFetchDetails =
    typeof source?.plugin.impl.getManga === "function";
  const shouldRefresh =
    input.refresh ||
    !cached ||
    !isFresh(cached.fetchedAt, MANGA_TTL) ||
    (canFetchDetails && !hasDetails);

  if (shouldRefresh && source) {
    if (typeof source.plugin.impl.getManga === "function") {
      try {
        const raw = await invokePlugin<unknown>(
          source.plugin,
          "getManga",
          [input.mangaId],
          {
            config: source.config,
            limiter: deps.registry.limiterFor(source.plugin),
            signal: input.signal,
            timeoutMs: 20_000,
          },
        );
        manga = validateManga(raw);
        upsertManga(deps.db, input.sourceId, manga);
      } catch (error) {
        if (!cached) throw error;
        stale = true;
      }
    } else if (!cached) {
      throw new PluginError(
        "not_found",
        "This source cannot load manga details",
      );
    }
  } else if (!manga) {
    throw new PluginError("not_found", "Manga is not cached");
  }

  if (!manga) {
    throw new PluginError("not_found", "Manga is not cached");
  }

  const inLibrary = isInLibrary(deps.db, input.sourceId, input.mangaId);
  const progress = getLatestProgress(deps.db, input.sourceId, input.mangaId);

  return {
    ...toMangaDto(deps, input.sourceId, manga, { inLibrary, manifest }),
    inLibrary,
    progress: toProgressDto(progress),
    ...(stale ? { stale: true } : {}),
  };
}

function sortChaptersForReading(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => {
    const aNumber = a.number ?? Number.POSITIVE_INFINITY;
    const bNumber = b.number ?? Number.POSITIVE_INFINITY;
    if (aNumber !== bNumber) return aNumber - bNumber;
    return a.id.localeCompare(b.id);
  });
}

function downloadStatusFor(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): DownloadStatus | "none" {
  return getDownloadByChapter(db, sourceId, mangaId, chapterId)?.status ?? "none";
}

function toChapterDto(
  db: Db,
  sourceId: string,
  mangaId: string,
  chapter: Chapter,
  progress: Map<string, { pageIndex: number; completed: boolean }>,
): ChapterDto {
  const read = progress.get(chapter.id);
  return {
    sourceId,
    mangaId,
    ...chapter,
    read: read ? { pageIndex: read.pageIndex, completed: read.completed } : null,
    downloadStatus: downloadStatusFor(db, sourceId, mangaId, chapter.id),
  };
}

/** One refresh per manga at a time, so quick page turns don't stampede a source. */
const chaptersRefreshing = new Set<string>();

async function fetchChapters(
  deps: CatalogDeps,
  source: CallableSource,
  sourceId: string,
  mangaId: string,
  signal?: AbortSignal,
): Promise<Chapter[]> {
  const raw = await invokePlugin<unknown>(
    source.plugin,
    "getChapters",
    [mangaId],
    {
      config: source.config,
      limiter: deps.registry.limiterFor(source.plugin),
      signal,
      timeoutMs: 30_000,
    },
  );
  const chapters = validateChapters(raw);
  upsertChapters(deps.db, sourceId, mangaId, chapters);
  return chapters;
}

function refreshChaptersInBackground(
  deps: CatalogDeps,
  source: CallableSource,
  sourceId: string,
  mangaId: string,
): void {
  const key = `${sourceId}:${mangaId}`;
  if (chaptersRefreshing.has(key)) return;
  chaptersRefreshing.add(key);
  void fetchChapters(
    deps,
    source,
    sourceId,
    mangaId,
    AbortSignal.timeout(30_000),
  )
    .catch(() => undefined)
    .finally(() => chaptersRefreshing.delete(key));
}

export async function getChapters(
  deps: CatalogDeps,
  input: {
    sourceId: string;
    mangaId: string;
    refresh?: boolean;
    signal?: AbortSignal;
    /** Reader path: return the cached list at once and refresh in background. */
    preferCache?: boolean;
  },
): Promise<ChaptersDto> {
  const cached = getCachedChapters(deps.db, input.sourceId, input.mangaId);
  const source = await trySource(deps, input.sourceId);
  let chapters: Chapter[] | null = cached?.chapters ?? null;
  let stale = Boolean(!source && cached);

  const shouldRefresh =
    input.refresh ||
    !cached ||
    !isFresh(cached.fetchedAt, CHAPTERS_TTL);

  if (shouldRefresh && source) {
    if (input.preferCache && cached && !input.refresh) {
      // Opening a chapter should not wait for a chapter-list round trip. The
      // cached list is enough for prev/next and titles; the refresh lands in
      // the store for the next open.
      refreshChaptersInBackground(deps, source, input.sourceId, input.mangaId);
    } else {
      try {
        chapters = await fetchChapters(
          deps,
          source,
          input.sourceId,
          input.mangaId,
          input.signal,
        );
      } catch (error) {
        if (!cached) throw error;
        stale = true;
      }
    }
  }

  const list = chapters ?? [];
  const progress = new Map(
    listProgressForManga(deps.db, input.sourceId, input.mangaId).map((item) => [
      item.chapterId,
      { pageIndex: item.pageIndex, completed: item.completed },
    ]),
  );

  return {
    // Reading order: chapter 1 first. The detail page lists them top-down and
    // the reader's prev/next walk the same array, so no reversal here.
    chapters: sortChaptersForReading(list)
      .map((chapter) =>
        toChapterDto(
          deps.db,
          input.sourceId,
          input.mangaId,
          chapter,
          progress,
        ),
      ),
    ...(stale ? { stale: true } : {}),
  };
}

function pageDtosFromDownload(
  deps: CatalogDeps,
  sourceId: string,
  mangaId: string,
  chapterId: string,
): PageDto[] {
  const download = getDownloadByChapter(deps.db, sourceId, mangaId, chapterId);
  if (!download || download.status !== "completed") return [];
  const pages = listDownloadPages(deps.db, download.id).filter(
    (page) => page.status === "done" && page.filePath,
  );
  return pages.map((page) => ({
    index: page.pageIndex,
    src: `/api/downloads/pages/${page.id}`,
    local: true,
  }));
}

function pageDtosFromRemote(
  deps: CatalogDeps,
  sourceId: string,
  pages: Page[],
  manifest?: PluginManifest,
  tokens?: string[],
): PageDto[] {
  // Sources rarely report pixel size, but once a page has been through the
  // cache we know it. Returning it lets the reader reserve space up front
  // instead of collapsing to zero height and reflowing as images arrive.
  const sizes = findCacheDimensions(
    deps.db,
    sourceId,
    "page",
    pages.map((page) => page.url),
  );

  return pages.map((page, index) => {
    const headers = {
      ...(manifest?.imageHeaders ?? {}),
      ...(page.headers ?? {}),
    };
    const token = deps.imageProxy.createTicket(sourceId, "page", page.url, {
      allowedHosts: manifest?.allowedImageHosts,
      headers,
      referer: page.referer,
      transform: page.transform,
    });
    tokens?.push(token);
    const known = sizes.get(page.url);
    return {
      index,
      src: `/api/image/${token}`,
      width: page.width ?? known?.width,
      height: page.height ?? known?.height,
      local: false,
    };
  });
}

/** One background page-list refresh per chapter at a time. */
const pagesRefreshing = new Set<string>();

interface PageSourceInput {
  sourceId: string;
  mangaId: string;
  chapterId: string;
  signal?: AbortSignal;
}

async function fetchPages(
  deps: CatalogDeps,
  source: CallableSource,
  input: PageSourceInput,
): Promise<Page[]> {
  const raw = await invokePlugin<unknown>(
    source.plugin,
    "getPages",
    [input.mangaId, input.chapterId],
    {
      config: source.config,
      limiter: deps.registry.limiterFor(source.plugin),
      signal: input.signal,
      timeoutMs: 30_000,
    },
  );
  const pages = validatePages(raw);
  upsertPages(deps.db, input.sourceId, input.mangaId, input.chapterId, pages);
  return pages;
}

function refreshPagesInBackground(
  deps: CatalogDeps,
  source: CallableSource,
  input: PageSourceInput,
): void {
  const key = `${input.sourceId}:${input.mangaId}:${input.chapterId}`;
  if (pagesRefreshing.has(key)) return;
  pagesRefreshing.add(key);
  void fetchPages(deps, source, {
    ...input,
    signal: AbortSignal.timeout(30_000),
  })
    .catch(() => undefined)
    .finally(() => pagesRefreshing.delete(key));
}

export async function getReaderPayload(
  deps: CatalogDeps,
  input: {
    sourceId: string;
    mangaId: string;
    chapterId: string;
    refresh?: boolean;
    signal?: AbortSignal;
  },
): Promise<ReaderPayload> {
  const source = await trySource(deps, input.sourceId);
  const chaptersResult = await getChapters(deps, {
    sourceId: input.sourceId,
    mangaId: input.mangaId,
    refresh: input.refresh,
    signal: input.signal,
    preferCache: true,
  }).catch(() => ({ chapters: [] as ChapterDto[] }));
  // getChapters() already returns reading order (chapter 1 first).
  const readingOrder = chaptersResult.chapters;
  const index = readingOrder.findIndex((item) => item.id === input.chapterId);
  const chapterDto =
    readingOrder[index] ??
    ({
      sourceId: input.sourceId,
      mangaId: input.mangaId,
      id: input.chapterId,
      title: input.chapterId,
      read: null,
      downloadStatus: "none",
    } satisfies ChapterDto);

  const mangaCached = getCachedManga(deps.db, input.sourceId, input.mangaId);
  const mangaTitle = mangaCached?.manga.title ?? input.mangaId;

  const downloadedPages = pageDtosFromDownload(
    deps,
    input.sourceId,
    input.mangaId,
    input.chapterId,
  );
  const downloaded = downloadedPages.length > 0;

  let pages: PageDto[] = downloadedPages;
  let stale = false;
  const pageTokens: string[] = [];
  const progress = getLatestProgress(deps.db, input.sourceId, input.mangaId);

  if (!downloaded) {
    const cached = getCachedPages(
      deps.db,
      input.sourceId,
      input.mangaId,
      input.chapterId,
    );
    let remotePages: Page[] | null = cached?.pages ?? null;
    if (!source && cached) stale = true;
    const shouldRefresh =
      input.refresh ||
      !cached ||
      !isFresh(cached.fetchedAt, PAGES_TTL);

    if (shouldRefresh && source) {
      if (cached && !input.refresh) {
        // Same deal as the chapter list: a 24h-old page list is almost always
        // still valid, so returning it beats blocking the reader on a source
        // round trip. `refresh=1` (the reader's error recovery) stays synced.
        refreshPagesInBackground(deps, source, input);
      } else {
        try {
          remotePages = await fetchPages(deps, source, input);
        } catch (error) {
          if (!cached) throw error;
          stale = true;
        }
      }
    }

    if (!remotePages) {
      throw new PluginError("not_found", "No pages available for this chapter");
    }
    pages = pageDtosFromRemote(
      deps,
      input.sourceId,
      remotePages,
      source?.plugin.manifest,
      pageTokens,
    );
    // Warm the pages the reader is about to show, not always page 1: resuming
    // at page 120 should not spend bandwidth on pages 1-4. Remote hosts are the
    // slow part of a cold chapter, so warming here keeps the first scroll out
    // of a loading state.
    if (pageTokens.length > 0) {
      const resumeIndex =
        progress?.chapterId === input.chapterId ? progress.pageIndex : 0;
      const warmStart = Math.min(
        Math.max(0, resumeIndex),
        Math.max(0, pageTokens.length - 1),
      );
      const warmFrom = Math.max(0, warmStart - WARM_BEHIND);
      deps.imageProxy.warm(
        pageTokens.slice(warmFrom, warmStart + WARM_PAGES),
      );
    }
  }

  const chapterProgress = progress?.chapterId === input.chapterId ? progress : null;

  return {
    sourceId: input.sourceId,
    mangaId: input.mangaId,
    mangaTitle,
    chapter: {
      ...chapterDto,
      downloadStatus: downloaded ? "completed" : chapterDto.downloadStatus,
    },
    pages,
    prevChapterId: index > 0 ? readingOrder[index - 1]?.id ?? null : null,
    nextChapterId:
      index >= 0 && index < readingOrder.length - 1
        ? readingOrder[index + 1]?.id ?? null
        : null,
    progress: chapterProgress
      ? {
          pageIndex: chapterProgress.pageIndex,
          mode: chapterProgress.mode,
          completed: chapterProgress.completed,
        }
      : null,
    downloaded,
    readingDirection: mangaCached?.manga.readingDirection,
    ...(stale ? { stale: true } : {}),
  };
}
