export type ReadingDirection = "rtl" | "ltr" | "ttb";
export type MangaStatus =
  | "ongoing"
  | "completed"
  | "hiatus"
  | "cancelled"
  | "unknown";
export type ReaderMode = "single" | "double" | "webtoon";

export interface ConfigOptionDto {
  label: string;
  value: string;
}

export type ConfigFieldDto =
  | {
      key: string;
      label: string;
      type: "string" | "password" | "url";
      required?: boolean;
      default?: string;
      placeholder?: string;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "number";
      required?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "boolean";
      default?: boolean;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: ConfigOptionDto[];
      required?: boolean;
      default?: string;
      description?: string;
    };

export type FilterValueDto = string | string[] | boolean | number | undefined;
export type FilterValuesDto = Record<string, FilterValueDto>;

export type FilterDefDto =
  | {
      key: string;
      label: string;
      type: "text";
      placeholder?: string;
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: ConfigOptionDto[];
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "multi-select";
      options: ConfigOptionDto[];
      default?: string[];
    }
  | { key: string; label: string; type: "boolean"; default?: boolean }
  | {
      key: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      default?: number;
    }
  | {
      key: string;
      label: string;
      type: "sort";
      options: ConfigOptionDto[];
      default?: string;
    };

export interface SourceCapabilitiesDto {
  search: boolean;
  browse: boolean;
  filters: boolean;
}

export type SourceStatus = "ready" | "needs_config" | "disabled";

export interface SourceInfoDto {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  languages?: string[];
  capabilities: SourceCapabilitiesDto;
  status: SourceStatus;
  configFields: ConfigFieldDto[];
  missingConfig: string[];
  enabled: boolean;
}

export interface SourceFailureDto {
  sourceId: string;
  dir: string;
  message: string;
}

export interface SourcesDto {
  sources: SourceInfoDto[];
  failures: SourceFailureDto[];
  scannedAt: number;
}

export interface SourceConfigDto {
  sourceId: string;
  enabled: boolean;
  values: Record<string, string | number | boolean | null>;
  secretKeys: string[];
}

export interface MangaDto {
  sourceId: string;
  id: string;
  title: string;
  altTitles?: string[];
  coverUrl?: string;
  description?: string;
  authors?: string[];
  artists?: string[];
  genres?: string[];
  status?: MangaStatus;
  year?: number;
  originalLanguage?: string;
  readingDirection?: ReadingDirection;
  chapterCount?: number;
  updatedAt?: string;
  url?: string;
  inLibrary?: boolean;
}

export interface MangaProgressDto {
  chapterId: string;
  pageIndex: number;
  mode: ReaderMode;
  completed: boolean;
  updatedAt: number;
}

export interface MangaDetailDto extends MangaDto {
  inLibrary: boolean;
  progress: MangaProgressDto | null;
  stale?: boolean;
}

export type DownloadStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChapterDto {
  sourceId: string;
  mangaId: string;
  id: string;
  title: string;
  number?: number;
  volume?: string;
  language?: string;
  group?: string;
  publishedAt?: string;
  pageCount?: number;
  read: { pageIndex: number; completed: boolean } | null;
  downloadStatus: DownloadStatus | "none";
}

export interface ChaptersDto {
  /** Reading order: chapter 1 first. */
  chapters: ChapterDto[];
  stale?: boolean;
}

export interface PageDto {
  /** 0-based position in the chapter. */
  index: number;
  /** Local image proxy or downloaded-page URL. */
  src: string;
  width?: number;
  height?: number;
  local: boolean;
}

export interface ReaderProgressDto {
  pageIndex: number;
  mode: ReaderMode;
  completed: boolean;
}

export interface ReaderPayload {
  sourceId: string;
  mangaId: string;
  mangaTitle: string;
  chapter: ChapterDto;
  pages: PageDto[];
  prevChapterId: string | null;
  nextChapterId: string | null;
  progress: ReaderProgressDto | null;
  downloaded: boolean;
  readingDirection?: ReadingDirection;
  stale?: boolean;
}

export interface PagedResultDto<T> {
  items: T[];
  page: number;
  hasNextPage: boolean;
  total?: number;
}

export interface LibraryItemDto {
  manga: MangaDto;
  addedAt: number;
  progress: MangaProgressDto | null;
  unreadCount: number | null;
}

export interface HistoryItemDto {
  sourceId: string;
  mangaId: string;
  mangaTitle: string;
  coverUrl?: string;
  chapterId: string;
  chapterTitle: string;
  pageIndex: number;
  readAt: number;
}

export interface DownloadDto {
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
  createdAt: number;
  updatedAt: number;
}

export interface DownloadsDto {
  downloads: DownloadDto[];
  totalBytes: number;
}

export interface CacheStatsDto {
  bytes: number;
  entries: number;
  limitBytes: number;
  hits: number;
  misses: number;
}

export interface SettingsDto {
  imageExtraAllowedHosts: string[];
  cacheLimitMb: number;
  /** Global HTTP(S) proxy; empty string means direct connections. */
  proxyUrl: string;
  dataDir: string;
  pluginsDir: string;
}
