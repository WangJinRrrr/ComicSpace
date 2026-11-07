import type { ConfigValues } from "./config";
import type { FilterDef, FilterValues } from "./filters";
import type { Chapter, Manga, Page, PagedResult } from "./models";

/**
 * One chapter the signed-in site says the user has opened.
 * `readAt` is Unix epoch milliseconds. Omit it when the page has no timestamp.
 */
export interface RemoteHistoryEntry {
  manga: Manga;
  chapterId: string;
  chapterTitle?: string;
  /** 0-based. */
  pageIndex?: number;
  readAt?: number;
}

/**
 * One-way account import. `available: false` means that side was not read;
 * callers must not treat an empty list as "the account has nothing".
 */
export interface RemoteAccountSnapshot {
  favorites: {
    available: boolean;
    items: Manga[];
    message?: string;
  };
  history: {
    available: boolean;
    items: RemoteHistoryEntry[];
    message?: string;
  };
}

export interface PluginLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface PluginContext {
  readonly config: Readonly<ConfigValues>;
  /** Aborted on request cancellation or the server timeout. Pass it to fetches. */
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  readonly fetch: typeof fetch;
}

export interface SearchQuery {
  term: string;
  page: number;
  filters?: FilterValues;
}

export interface BrowseQuery {
  page: number;
  filters?: FilterValues;
}

export interface MangaPlugin {
  search?(
    query: SearchQuery,
    context: PluginContext,
  ): Promise<PagedResult<Manga>>;
  browse?(
    query: BrowseQuery,
    context: PluginContext,
  ): Promise<PagedResult<Manga>>;
  getFilters?(context: PluginContext): FilterDef[] | Promise<FilterDef[]>;
  getManga?(mangaId: string, context: PluginContext): Promise<Manga>;
  getChapters(mangaId: string, context: PluginContext): Promise<Chapter[]>;
  getPages(
    mangaId: string,
    chapterId: string,
    context: PluginContext,
  ): Promise<Page[]>;
  /**
   * Optional read-only import of the user's favorites and reading history.
   * Must not write to the remote site.
   */
  pullAccount?(context: PluginContext): Promise<RemoteAccountSnapshot>;
}

export function definePlugin<T extends MangaPlugin>(plugin: T): T {
  return plugin;
}
