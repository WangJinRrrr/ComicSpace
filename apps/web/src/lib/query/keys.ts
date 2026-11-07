import type { FilterValuesDto } from "@comicspace/contracts";

export const queryKeys = {
  sources: ["sources"] as const,
  sourceConfig: (sourceId: string) => ["source-config", sourceId] as const,
  filters: (sourceId: string) => ["filters", sourceId] as const,
  browse: (sourceId: string, filters: FilterValuesDto) =>
    ["browse", sourceId, filters] as const,
  search: (sourceId: string, term: string, filters: FilterValuesDto) =>
    ["search", sourceId, term, filters] as const,
  /** First page only, used by the multi-source search panel. */
  searchPreview: (sourceId: string, term: string) =>
    ["search-preview", sourceId, term] as const,
  manga: (sourceId: string, mangaId: string) =>
    ["manga", sourceId, mangaId] as const,
  chapters: (sourceId: string, mangaId: string) =>
    ["chapters", sourceId, mangaId] as const,
  pages: (sourceId: string, mangaId: string, chapterId: string) =>
    ["pages", sourceId, mangaId, chapterId] as const,
  library: ["library"] as const,
  history: ["history"] as const,
  downloads: ["downloads"] as const,
  cache: ["cache"] as const,
  settings: ["settings"] as const,
  update: ["update"] as const,
};
