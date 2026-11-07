import { createContext, useContext, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  PanelRightClose,
  Search,
  X,
} from "lucide-react";
import type { MangaDto, SourceInfoDto } from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { useDebouncedValue } from "../lib/hooks/useDebouncedValue";
import { cn } from "../lib/cn";
import { CoverImage } from "./CoverImage";
import { Skeleton } from "./ui";

const PREVIEW_LIMIT = 6;

interface SearchPanelState {
  open: boolean;
  term: string;
  setTerm: (term: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** Closes the panel only when it overlays the page (narrow screens). */
  dismissOverlay: () => void;
  /** Bumped on every openSearch() so the input can re-focus. */
  focusToken: number;
}

export const SearchPanelContext = createContext<SearchPanelState | null>(null);

export function useSearchPanel() {
  const value = useContext(SearchPanelContext);
  if (!value) throw new Error("useSearchPanel must be used inside AppShell");
  return value;
}

/** Sources the panel can query: enabled, configured and searchable. */
export function searchableSources(sources: SourceInfoDto[]) {
  return sources.filter(
    (source) =>
      source.enabled && source.status === "ready" && source.capabilities.search,
  );
}

/**
 * Right-hand search column. One query box fans out to every searchable source
 * in parallel; results come back grouped by source.
 */
export function SearchPanel({ className }: { className?: string }) {
  const { term, setTerm, closeSearch, dismissOverlay, focusToken } =
    useSearchPanel();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebouncedValue(term.trim(), 350);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => api.getSources(signal),
  });
  const sources = searchableSources(sourcesQuery.data?.sources ?? []);

  const results = useQueries({
    queries: sources.map((source) => ({
      queryKey: queryKeys.searchPreview(source.id, debounced),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.search(source.id, { term: debounced, page: 1, filters: {} }, signal),
      enabled: debounced.length > 0,
      staleTime: 60_000,
    })),
  });

  return (
    <aside
      className={cn("glass flex flex-col border-l border-line", className)}
      aria-label="搜索"
    >
      <form
        role="search"
        className="flex items-center gap-1 border-b border-line p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="relative flex-1">
          <span className="sr-only">搜索所有内容源</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
            className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-9 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-muted/70 hover:border-line-strong focus:border-accent-soft focus:outline-none focus:ring-4 focus:ring-accent-soft/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {term ? (
            <button
              type="button"
              onClick={() => {
                setTerm("");
                inputRef.current?.focus();
              }}
              aria-label="清空"
              title="清空"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={closeSearch}
          aria-label="收起搜索栏"
          title="收起搜索栏"
          className="press grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3/70 hover:text-ink"
        >
          <PanelRightClose className="size-4" aria-hidden="true" />
        </button>
      </form>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {!debounced ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-muted/50">
            <Search className="size-12" strokeWidth={1.25} aria-hidden="true" />
            <div className="flex flex-wrap justify-center gap-1.5">
              {sources.map((source) => (
                <span
                  key={source.id}
                  className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted"
                >
                  {source.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {sources.map((source, index) => {
              const result = results[index];
              return (
                <SourceResults
                  key={source.id}
                  source={source}
                  term={debounced}
                  items={result?.data?.items ?? []}
                  hasMore={Boolean(
                    result?.data?.hasNextPage ||
                      (result?.data?.items.length ?? 0) > PREVIEW_LIMIT,
                  )}
                  loading={Boolean(result?.isLoading)}
                  error={
                    result?.isError
                      ? result.error instanceof Error
                        ? result.error.message
                        : "搜索失败"
                      : undefined
                  }
                  onNavigate={dismissOverlay}
                />
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function SourceResults({
  source,
  term,
  items,
  hasMore,
  loading,
  error,
  onNavigate,
}: {
  source: SourceInfoDto;
  term: string;
  items: MangaDto[];
  hasMore: boolean;
  loading: boolean;
  error?: string;
  onNavigate: () => void;
}) {
  return (
    <section className="space-y-1.5" aria-label={source.name}>
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-xs font-semibold text-ink-soft">{source.name}</h3>
        {!loading && !error ? (
          <span className="label-mono text-[10px] text-muted tabular">
            {items.length}
            {hasMore ? "+" : ""}
          </span>
        ) : null}
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        {items.length > 0 ? (
          <Link
            to="/search"
            search={{ sourceId: source.id, q: term }}
            onClick={onNavigate}
            aria-label={`在 ${source.name} 中查看全部结果`}
            title="全部结果"
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
          >
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-1.5">
              <Skeleton className="h-14 w-10 shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          className="flex items-center gap-2 px-1.5 py-1 text-xs text-danger"
          title={error}
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{error}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="px-1.5 py-1 text-xs text-muted/70" aria-label="没有结果">
          —
        </div>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, PREVIEW_LIMIT).map((manga) => (
            <li key={`${manga.sourceId}:${manga.id}`}>
              <Link
                to="/manga"
                search={{ sourceId: manga.sourceId, mangaId: manga.id }}
                onClick={onNavigate}
                className="group flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-surface-3/60"
              >
                <CoverImage
                  src={manga.coverUrl}
                  className="h-14 w-10 shrink-0 rounded-md ring-1 ring-line"
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium leading-5 text-ink group-hover:text-accent">
                    {manga.title}
                  </span>
                  {manga.authors?.length ? (
                    <span className="block truncate text-[11px] text-muted">
                      {manga.authors.join(" / ")}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { SearchPanelState };
