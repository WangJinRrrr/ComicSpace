import type {
  HistoryItemDto,
  LibraryItemDto,
  MangaDetailDto,
} from "@comicspace/contracts";
import type { Db } from "../db/client.js";
import {
  addToLibrary,
  getLibraryEntry,
  getUnreadCount,
  isInLibrary,
  listLibrary,
  removeFromLibrary,
} from "../db/repos/library.js";
import {
  getCachedManga,
} from "../db/repos/manga.js";
import {
  getLatestProgress,
  listHistory,
} from "../db/repos/progress.js";
import {
  coverUrlFor,
  getMangaDetail,
  toProgressDto,
  type CatalogDeps,
} from "./catalog.js";

export async function listLibraryItems(
  deps: CatalogDeps,
): Promise<LibraryItemDto[]> {
  const rows = listLibrary(deps.db);
  const result: LibraryItemDto[] = [];

  for (const row of rows) {
    const plugin = await deps.registry.getPlugin(row.sourceId);
    const progress = getLatestProgress(deps.db, row.sourceId, row.mangaId);
    result.push({
      manga: {
        ...row.manga,
        sourceId: row.sourceId,
        coverUrl: coverUrlFor(
          deps,
          row.sourceId,
          row.manga,
          plugin?.manifest,
        ),
        inLibrary: true,
      },
      addedAt: row.addedAt,
      progress: toProgressDto(progress),
      unreadCount: getUnreadCount(deps.db, row.sourceId, row.mangaId),
    });
  }

  return result;
}

export async function addLibraryItem(
  deps: CatalogDeps,
  sourceId: string,
  mangaId: string,
): Promise<MangaDetailDto> {
  let detail: MangaDetailDto;
  try {
    detail = await getMangaDetail(deps, { sourceId, mangaId });
  } catch (error) {
    const cached = getCachedManga(deps.db, sourceId, mangaId);
    if (!cached) throw error;
    detail = {
      ...cached.manga,
      sourceId,
      coverUrl: undefined,
      inLibrary: false,
      progress: null,
      stale: true,
    };
  }

  addToLibrary(deps.db, sourceId, mangaId);
  const entry = getLibraryEntry(deps.db, sourceId, mangaId);
  const plugin = await deps.registry.getPlugin(sourceId);

  return {
    ...detail,
    coverUrl: entry
      ? coverUrlFor(deps, sourceId, entry.manga, plugin?.manifest)
      : detail.coverUrl,
    inLibrary: true,
  };
}

export function removeLibraryItem(
  db: Db,
  sourceId: string,
  mangaId: string,
): boolean {
  if (!isInLibrary(db, sourceId, mangaId)) return false;
  removeFromLibrary(db, sourceId, mangaId);
  return true;
}

export async function listHistoryItems(
  deps: CatalogDeps,
  limit = 100,
): Promise<HistoryItemDto[]> {
  const rows = listHistory(deps.db, limit);
  const result: HistoryItemDto[] = [];

  for (const row of rows) {
    const plugin = await deps.registry.getPlugin(row.sourceId);
    const cached = getCachedManga(deps.db, row.sourceId, row.mangaId);
    const coverUrl = cached
      ? coverUrlFor(
          deps,
          row.sourceId,
          cached.manga,
          plugin?.manifest,
        )
      : undefined;
    result.push({
      ...row,
      coverUrl,
    });
  }

  return result;
}
