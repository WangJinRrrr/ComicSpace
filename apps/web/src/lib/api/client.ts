import {
  ApiRequestError,
  type ApiErrorBody,
  type ApiSuccess,
  type BrowseRequest,
  type CacheStatsDto,
  type ChaptersDto,
  type DownloadCreateRequest,
  type DownloadsDto,
  type FilterDefDto,
  type HistoryItemDto,
  type LibraryItemDto,
  type MangaDetailDto,
  type MangaDto,
  type PagedResultDto,
  type PagesQuery,
  type ProgressUpdateRequest,
  type ReaderPayload,
  type SearchRequest,
  type SettingsDto,
  type SourceConfigDto,
  type SourcesDto,
  type UpdateCheckDto,
  type UpdateFetchDto,
  type UpdateOpenDto,
  type AccountSyncResultDto,
} from "@comicspace/contracts";

const API_BASE = "/api";

function queryString(
  values: Record<string, string | number | boolean | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiRequestError({
      status: 0,
      code: "network_error",
      message: "无法连接本地 ComicSpace 服务",
      retryable: true,
    });
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) {
        throw new ApiRequestError({
          status: response.status,
          code: "internal_error",
          message: response.statusText || "服务返回了非 JSON 响应",
        });
      }
      throw new ApiRequestError({
        status: response.status,
        code: "parse_error",
        message: "服务返回了无法解析的响应",
      });
    }
  }

  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiRequestError({
      status: response.status,
      code: error?.code ?? "internal_error",
      message: error?.message ?? response.statusText ?? "请求失败",
      retryable: error?.retryable,
      details: error?.details,
    });
  }

  return (body as ApiSuccess<T>).data;
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(value),
  };
}

function putBody(value: unknown): RequestInit {
  return {
    method: "PUT",
    body: JSON.stringify(value),
  };
}

export const api = {
  getSources: (signal?: AbortSignal) =>
    request<SourcesDto>("/sources", { signal }),

  reloadSources: () =>
    request<SourcesDto>("/sources/reload", { method: "POST" }),

  getSourceConfig: (sourceId: string, signal?: AbortSignal) =>
    request<SourceConfigDto>(
      `/sources/${encodeURIComponent(sourceId)}/config`,
      { signal },
    ),

  updateSourceConfig: (
    sourceId: string,
    body: {
      enabled?: boolean;
      values?: Record<string, string | number | boolean | null>;
    },
  ) =>
    request<SourceConfigDto>(
      `/sources/${encodeURIComponent(sourceId)}/config`,
      putBody(body),
    ),

  search: (
    sourceId: string,
    body: SearchRequest,
    signal?: AbortSignal,
  ) =>
    request<PagedResultDto<MangaDto>>(
      `/sources/${encodeURIComponent(sourceId)}/search`,
      { ...jsonBody(body), signal },
    ),

  browse: (
    sourceId: string,
    body: BrowseRequest,
    signal?: AbortSignal,
  ) =>
    request<PagedResultDto<MangaDto>>(
      `/sources/${encodeURIComponent(sourceId)}/browse`,
      { ...jsonBody(body), signal },
    ),

  getFilters: (sourceId: string, signal?: AbortSignal) =>
    request<FilterDefDto[]>(
      `/sources/${encodeURIComponent(sourceId)}/filters`,
      { signal },
    ),

  getManga: (
    params: { sourceId: string; mangaId: string; refresh?: boolean },
    signal?: AbortSignal,
  ) =>
    request<MangaDetailDto>(
      `/manga${queryString({
        sourceId: params.sourceId,
        mangaId: params.mangaId,
        refresh: params.refresh,
      })}`,
      { signal },
    ),

  getChapters: (
    params: { sourceId: string; mangaId: string; refresh?: boolean },
    signal?: AbortSignal,
  ) =>
    request<ChaptersDto>(
      `/chapters${queryString({
        sourceId: params.sourceId,
        mangaId: params.mangaId,
        refresh: params.refresh,
      })}`,
      { signal },
    ),

  getPages: (params: PagesQuery, signal?: AbortSignal) =>
    request<ReaderPayload>(
      `/pages${queryString({
        sourceId: params.sourceId,
        mangaId: params.mangaId,
        chapterId: params.chapterId,
        refresh: params.refresh,
      })}`,
      { signal },
    ),

  getLibrary: (signal?: AbortSignal) =>
    request<LibraryItemDto[]>("/library", { signal }),

  addToLibrary: (sourceId: string, mangaId: string) =>
    request<MangaDetailDto>("/library", jsonBody({ sourceId, mangaId })),

  removeFromLibrary: (sourceId: string, mangaId: string) =>
    request<{ removed: boolean }>(
      `/library${queryString({ sourceId, mangaId })}`,
      { method: "DELETE" },
    ),

  saveProgress: (body: ProgressUpdateRequest) =>
    request<unknown>("/progress", putBody(body)),

  getHistory: (signal?: AbortSignal) =>
    request<HistoryItemDto[]>("/history", { signal }),

  clearHistory: () =>
    request<{ cleared: boolean }>("/history", { method: "DELETE" }),

  getDownloads: (signal?: AbortSignal) =>
    request<DownloadsDto>("/downloads", { signal }),

  startDownloads: (body: DownloadCreateRequest, signal?: AbortSignal) =>
    request<DownloadsDto>("/downloads", { ...jsonBody(body), signal }),

  cancelDownload: (id: number) =>
    request<DownloadsDto["downloads"][number]>(
      `/downloads/${id}/cancel`,
      { method: "POST" },
    ),

  retryDownload: (id: number) =>
    request<DownloadsDto["downloads"][number]>(
      `/downloads/${id}/retry`,
      { method: "POST" },
    ),

  removeDownload: (id: number) =>
    request<{ removed: boolean }>(`/downloads/${id}`, { method: "DELETE" }),

  getCache: (signal?: AbortSignal) =>
    request<CacheStatsDto>("/cache", { signal }),

  clearCache: () =>
    request<CacheStatsDto>("/cache", { method: "DELETE" }),

  getSettings: (signal?: AbortSignal) =>
    request<SettingsDto>("/settings", { signal }),

  updateSettings: (body: {
    imageExtraAllowedHosts?: string[];
    cacheLimitMb?: number;
    proxyUrl?: string;
  }) => request<SettingsDto>("/settings", putBody(body)),

  getUpdate: (signal?: AbortSignal) =>
    request<UpdateCheckDto>("/updates", { signal }),

  fetchUpdate: () =>
    request<UpdateFetchDto>("/updates/fetch", { method: "POST" }),

  openUpdate: () =>
    request<UpdateOpenDto>("/updates/open", { method: "POST" }),

  syncAccount: (sourceId: string) =>
    request<AccountSyncResultDto>(
      `/sources/${encodeURIComponent(sourceId)}/sync-account`,
      { method: "POST" },
    ),
};
