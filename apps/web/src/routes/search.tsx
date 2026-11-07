import { useEffect, useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { FilterValuesDto } from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { useDebouncedValue } from "../lib/hooks/useDebouncedValue";
import { useLocalStorage } from "../lib/hooks/useLocalStorage";
import { EmptySources } from "../components/EmptySources";
import { FilterPanel } from "../components/FilterPanel";
import { MangaGrid, mangaGridClass } from "../components/MangaGrid";
import { SourceSelect } from "../components/SourceSelect";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
} from "../components/ui";

export function SearchPage() {
  const search = useSearch({ from: "/search" });
  const [storedSource, setStoredSource] = useLocalStorage(
    "comicspace:source",
    "",
  );
  const [selectedSource, setSelectedSource] = useState(
    search.sourceId ?? storedSource,
  );
  const [term, setTerm] = useState(search.q ?? "");
  const [filters, setFilters] = useState<FilterValuesDto>({});
  const debouncedTerm = useDebouncedValue(term, 300);

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => api.getSources(signal),
  });
  const sources = sourcesQuery.data?.sources ?? [];
  const enabledSources = sources.filter((source) => source.enabled);
  const selected = sources.find((source) => source.id === selectedSource);
  const ready = selected?.status === "ready";
  const canSearch = ready && Boolean(selected?.capabilities.search);
  const canBrowse = ready && Boolean(selected?.capabilities.browse);
  const active = canSearch || canBrowse;

  useEffect(() => {
    if (enabledSources.length === 0) {
      if (selectedSource) setSelectedSource("");
      return;
    }
    if (!enabledSources.some((source) => source.id === selectedSource)) {
      const next = enabledSources[0]?.id ?? "";
      setSelectedSource(next);
      setStoredSource(next);
    }
  }, [enabledSources, selectedSource, setStoredSource]);

  useEffect(() => {
    if (selectedSource) setStoredSource(selectedSource);
  }, [selectedSource, setStoredSource]);

  const filtersQuery = useQuery({
    queryKey: queryKeys.filters(selectedSource),
    queryFn: ({ signal }) => api.getFilters(selectedSource, signal),
    enabled: Boolean(selectedSource) && ready && Boolean(selected?.capabilities.filters),
    staleTime: 5 * 60_000,
  });

  const effectiveFilters = useMemo(() => {
    const cleaned: FilterValuesDto = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
        continue;
      }
      cleaned[key] = value;
    }
    return cleaned;
  }, [filters]);

  const resultsQuery = useInfiniteQuery({
    queryKey: debouncedTerm
      ? queryKeys.search(selectedSource, debouncedTerm, effectiveFilters)
      : queryKeys.browse(selectedSource, effectiveFilters),
    queryFn: ({ pageParam, signal }) =>
      debouncedTerm && canSearch
        ? api.search(
            selectedSource,
            { term: debouncedTerm, page: pageParam, filters: effectiveFilters },
            signal,
          )
        : api.browse(
            selectedSource,
            { page: pageParam, filters: effectiveFilters },
            signal,
          ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.hasNextPage ? last.page + 1 : undefined,
    enabled: Boolean(selectedSource) && active,
    staleTime: 30_000,
  });

  const items = resultsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const uniqueItems = [
    ...new Map(items.map((item) => [`${item.sourceId}:${item.id}`, item])).values(),
  ];

  if (sourcesQuery.isLoading) {
    return <SearchSkeleton />;
  }
  if (sourcesQuery.isError) {
    return (
      <ErrorState
        message={sourcesQuery.error instanceof Error ? sourcesQuery.error.message : undefined}
        onRetry={() => void sourcesQuery.refetch()}
      />
    );
  }
  if (sources.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Search / Query"
          title="搜索"
          description="安装内容源后即可搜索。"
        />
        <EmptySources />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search / Query"
        title="搜索"
        description="搜索词留空时，会展示当前源的浏览结果。"
        actions={
          <SourceSelect
            sources={sources}
            value={selectedSource}
            onChange={setSelectedSource}
          />
        }
      />

      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-3 shadow-soft sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={canSearch ? "搜索标题、作者…" : "当前源不支持搜索"}
            className="pl-9"
            disabled={!canSearch}
          />
        </div>
        {term ? (
          <Button variant="ghost" onClick={() => setTerm("")}>
            清空
          </Button>
        ) : null}
      </div>

      {selected?.status === "needs_config" ? (
        <EmptyState
          title={`${selected.name} 还需要配置`}
          description="请先在设置页填写这个源需要的 API Key、Cookie 或镜像地址。"
        />
      ) : null}

      {selected && selected.status !== "needs_config" && !active ? (
        <EmptyState
          title="这个源暂时无法搜索或浏览"
          description="它可能没有实现 search/browse，或者已被停用。"
        />
      ) : null}

      {filtersQuery.data ? (
        <FilterPanel
          filters={filtersQuery.data}
          values={filters}
          onChange={setFilters}
          onReset={() => setFilters({})}
        />
      ) : null}

      {active ? (
        <section className="space-y-4">
          {resultsQuery.isLoading ? (
            <div className={mangaGridClass}>
              {Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className="aspect-[2/3]" />
              ))}
            </div>
          ) : resultsQuery.isError ? (
            <ErrorState
              message={
                resultsQuery.error instanceof Error
                  ? resultsQuery.error.message
                  : undefined
              }
              onRetry={() => void resultsQuery.refetch()}
            />
          ) : uniqueItems.length === 0 ? (
            <EmptyState
              title={debouncedTerm ? "没有找到漫画" : "这个源没有返回内容"}
              description={
                debouncedTerm
                  ? "换个关键词，或清除筛选条件再试一次。"
                  : "可以尝试刷新，或输入关键词搜索。"
              }
            />
          ) : (
            <>
              <div className="text-xs text-muted">
                共 {uniqueItems.length} 项
                {resultsQuery.hasNextPage ? "（还有更多）" : ""}
              </div>
              <MangaGrid items={uniqueItems} />
              {resultsQuery.hasNextPage ? (
                <div className="flex justify-center pt-2">
                  <Button
                    onClick={() => void resultsQuery.fetchNextPage()}
                    disabled={resultsQuery.isFetchingNextPage}
                  >
                    {resultsQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-16 w-full" />
      <div className={mangaGridClass}>
        {Array.from({ length: 12 }).map((_, index) => (
          <Skeleton key={index} className="aspect-[2/3]" />
        ))}
      </div>
    </div>
  );
}
