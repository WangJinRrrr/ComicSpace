import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  LayoutGrid,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { SourceInfoDto } from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { CoverFlow } from "../components/CoverFlow";
import { CoverStack } from "../components/CoverStack";
import { EmptySources } from "../components/EmptySources";
import { useSearchPanel } from "../components/SearchPanel";
import { formatRelative, mangaHref, readerHref } from "../lib/format";
import { cn } from "../lib/cn";
import { ErrorState, Spinner } from "../components/ui";

export function HomePage() {
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => api.getSources(signal),
  });
  const libraryQuery = useQuery({
    queryKey: queryKeys.library,
    queryFn: ({ signal }) => api.getLibrary(signal),
  });

  const sources = sourcesQuery.data?.sources ?? [];
  const enabledSources = sources.filter((source) => source.enabled);
  const continueItems = (libraryQuery.data ?? [])
    .filter((item) => item.progress)
    .sort(
      (a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0),
    );

  if (sourcesQuery.isLoading) return <Spinner label="正在检查内容源" />;
  if (sourcesQuery.isError) {
    return (
      <ErrorState
        message={
          sourcesQuery.error instanceof Error
            ? sourcesQuery.error.message
            : undefined
        }
        onRetry={() => void sourcesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-section">
      <h1 className="sr-only">发现</h1>

      {continueItems.length > 0 ? (
        <section className="animate-rise space-y-3" aria-label="继续阅读">
          <RowHeader icon={<BookOpen className="size-4" />} title="继续阅读">
            <span className="label-mono text-muted tabular">
              {continueItems.length}
            </span>
          </RowHeader>
          <CoverFlow
            label="继续阅读"
            items={continueItems.slice(0, 12).map((item) => ({
              key: `${item.manga.sourceId}:${item.manga.id}`,
              title: item.manga.title,
              coverUrl: item.manga.coverUrl,
              href: readerHref({
                sourceId: item.manga.sourceId,
                mangaId: item.manga.id,
                chapterId: item.progress?.chapterId ?? "",
                page: item.progress?.pageIndex,
              }),
              actionLabel: "继续阅读",
              detailHref: mangaHref(item.manga.sourceId, item.manga.id),
              eyebrow: item.progress
                ? formatRelative(item.progress.updatedAt)
                : undefined,
              meta: [
                `P${(item.progress?.pageIndex ?? 0) + 1}`,
                item.unreadCount ? `${item.unreadCount} 未读` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        </section>
      ) : null}

      {enabledSources.length === 0 ? (
        <EmptySources />
      ) : (
        enabledSources.map((source, index) => (
          <SourceRow key={source.id} source={source} index={index} />
        ))
      )}
    </div>
  );
}

function RowHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-accent" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
      <span className="h-px min-w-6 flex-1 bg-line" aria-hidden="true" />
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

const rowIconClass =
  "press grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-3/70 hover:text-ink";

function SourceRow({
  source,
  index,
}: {
  source: SourceInfoDto;
  index: number;
}) {
  const { openSearch } = useSearchPanel();
  const ready = source.status === "ready";
  const canBrowse = ready && source.capabilities.browse;

  const browseQuery = useInfiniteQuery({
    queryKey: queryKeys.browse(source.id, {}),
    queryFn: ({ pageParam, signal }) =>
      api.browse(source.id, { page: pageParam, filters: {} }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.hasNextPage ? last.page + 1 : undefined,
    enabled: canBrowse,
    staleTime: 60_000,
  });

  const items = browseQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const uniqueItems = [
    ...new Map(items.map((item) => [`${item.sourceId}:${item.id}`, item])).values(),
  ];

  return (
    <section
      className="animate-rise space-y-1"
      style={{ animationDelay: `${80 + index * 60}ms` }}
      aria-label={source.name}
    >
      <RowHeader
        icon={<StackGlyph />}
        title={source.name}
      >
        {canBrowse ? (
          <>
            {uniqueItems.length > 0 ? (
              <span className="label-mono mr-1 text-muted tabular">
                {uniqueItems.length}
                {browseQuery.hasNextPage ? "+" : ""}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void browseQuery.refetch()}
              disabled={browseQuery.isFetching}
              aria-label="刷新"
              title="刷新"
              className={cn(rowIconClass, "disabled:opacity-60")}
            >
              <RefreshCw
                className={cn("size-4", browseQuery.isFetching && "animate-spin")}
                aria-hidden="true"
              />
            </button>
            <Link
              to="/search"
              search={{ sourceId: source.id }}
              aria-label="筛选与网格浏览"
              title="筛选与网格浏览"
              className={rowIconClass}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </Link>
          </>
        ) : null}
      </RowHeader>

      {source.status === "needs_config" ? (
        <RowNotice
          icon={<SlidersHorizontal className="size-5" />}
          text="需要配置"
        >
          <Link to="/settings" aria-label="去配置" title="去配置" className={rowIconClass}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Link>
        </RowNotice>
      ) : ready && source.capabilities.accountSync && !source.capabilities.browse ? (
        <RowNotice
          icon={<BookOpen className="size-5" />}
          text="到设置页从网站同步收藏和阅读历史"
        >
          <Link to="/settings" aria-label="去设置同步" title="去设置同步" className={rowIconClass}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Link>
        </RowNotice>
      ) : ready && !source.capabilities.browse ? (
        <RowNotice icon={<Search className="size-5" />} text="仅支持搜索">
          <button
            type="button"
            onClick={openSearch}
            aria-label="打开搜索"
            title="打开搜索"
            className={rowIconClass}
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
        </RowNotice>
      ) : browseQuery.isError ? (
        <ErrorState
          message={
            browseQuery.error instanceof Error
              ? browseQuery.error.message
              : undefined
          }
          onRetry={() => void browseQuery.refetch()}
        />
      ) : !browseQuery.isLoading && uniqueItems.length === 0 ? (
        <RowNotice icon={<BookOpen className="size-5" />} text="暂无内容" />
      ) : (
        <CoverStack
          label={source.name}
          items={uniqueItems}
          loading={browseQuery.isLoading || browseQuery.isFetchingNextPage}
          hasMore={Boolean(browseQuery.hasNextPage)}
          onEndReached={() => {
            if (browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
              void browseQuery.fetchNextPage();
            }
          }}
        />
      )}
    </section>
  );
}

function RowNotice({
  icon,
  text,
  children,
}: {
  icon: React.ReactNode;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
      <span aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {children}
    </div>
  );
}

/** Small stacked-books glyph used as the per-source row marker. */
function StackGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="4" height="10.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect
        x="6.2"
        y="2.2"
        width="4"
        height="10.5"
        rx="1"
        transform="rotate(-12 8.2 7.45)"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M11.5 13.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
