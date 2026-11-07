export type ReadingDirection = "rtl" | "ltr" | "ttb";

export type MangaStatus =
  | "ongoing"
  | "completed"
  | "hiatus"
  | "cancelled"
  | "unknown";

/** The canonical manga shape every source must return. */
export interface Manga {
  /** Stable within this source. */
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
}

export interface Chapter {
  /** Stable within this source + manga. */
  id: string;
  title: string;
  number?: number;
  volume?: string;
  language?: string;
  group?: string;
  publishedAt?: string;
  pageCount?: number;
}

/**
 * A server-side operation applied to a page image after it is fetched and
 * before it is cached, downloaded, or served.
 *
 * - `band-reverse`: the stored image is split into `bands` horizontal bands;
 *   the bottom band carries the `height % bands` extra rows. The bands are
 *   reversed vertically to restore the original image.
 */
export type ImageTransform = {
  type: "band-reverse";
  bands: number;
};

export interface Page {
  /** Absolute http(s) URL. Array order is authoritative. */
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  referer?: string;
  /** Sealed into the local image ticket; never sent to the browser. */
  headers?: Record<string, string>;
  /** Optional server-side fix-up for sources that store scrambled images. */
  transform?: ImageTransform;
}

export interface PagedResult<T> {
  items: T[];
  /** 1-based. */
  page: number;
  hasNextPage: boolean;
  total?: number;
}

export type ReaderMode = "single" | "double" | "webtoon";
