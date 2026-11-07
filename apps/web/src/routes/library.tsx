import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  BookMarked,
  CalendarPlus,
  Clock,
  Download,
  Library,
  Search,
} from "lucide-react";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { cn } from "../lib/cn";
import { MangaCard } from "../components/MangaCard";
import { mangaGridClass } from "../components/MangaGrid";
import { CoverImage } from "../components/CoverImage";
import { DownloadsPanel, useDownloadsQuery } from "../components/DownloadsPanel";
import { useSearchPanel } from "../components/SearchPanel";
import {
  Button,
  EmptyState,
  ErrorState,
  SectionHeader,
  Spinner,
} from "../components/ui";

type SortMode = "added" | "recent" | "title";
export type LibraryTab = "shelf" | "downloads";

const sortModes: { value: SortMode; label: string; icon: typeof Clock }[] = [
  { value: "recent", label: "最近阅读", icon: Clock },
  { value: "added", label: "最近加入", icon: CalendarPlus },
  { value: "title", label: "标题", icon: ArrowDownAZ },
];

export function LibraryPage() {
  const { tab } = useSearch({ from: "/library" });
  const navigate = useNavigate({ from: "/library" });
  const libraryQuery = useQuery({
    queryKey: queryKeys.library,
    queryFn: ({ signal }) => api.getLibrary(signal),
  });
  const downloadsQuery = useDownloadsQuery();
  const activeDownloads =
    downloadsQuery.data?.downloads.filter(
      (item) => item.status === "queued" || item.status === "running",
    ).length ?? 0;

  const setTab = (next: LibraryTab) =>
    void navigate({ search: { tab: next === "shelf" ? undefined : next } });

  return (
    <div className="space-y-6">
      <h1 className="sr-only">书架</h1>
      <div
        role="tablist"
        aria-label="书架分栏"
        className="inline-flex rounded-full border border-line bg-surface p-1 shadow-soft"
      >
        <TabButton
          active={tab !== "downloads"}
          label="书架"
          onClick={() => setTab("shelf")}
          icon={<Library className="size-4" />}
          count={libraryQuery.data?.length}
        />
        <TabButton
          active={tab === "downloads"}
          label="下载"
          onClick={() => setTab("downloads")}
          icon={<Download className="size-4" />}
          count={downloadsQuery.data?.downloads.length}
          pulse={activeDownloads > 0}
        />
      </div>

      {tab === "downloads" ? <DownloadsPanel /> : <Shelf />}
    </div>
  );
}

function TabButton({
  active,
  label,
  icon,
  count,
  pulse = false,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  count?: number;
  pulse?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "press relative flex h-9 items-center gap-2 rounded-full px-4 text-sm transition-colors",
        active ? "bg-ink text-canvas" : "text-muted hover:text-ink",
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {count !== undefined ? (
        <span className="label-mono tabular" aria-hidden="true">
          {count}
        </span>
      ) : null}
      {pulse ? (
        <span
          className="absolute right-1.5 top-1.5 size-1.5 animate-pulse rounded-full bg-accent"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

function Shelf() {
  const { openSearch } = useSearchPanel();
  const [sort, setSort] = useState<SortMode>("recent");
  const libraryQuery = useQuery({
    queryKey: queryKeys.library,
    queryFn: ({ signal }) => api.getLibrary(signal),
  });

  const items = useMemo(() => {
    const list = [...(libraryQuery.data ?? [])];
    list.sort((a, b) => {
      if (sort === "title") return a.manga.title.localeCompare(b.manga.title);
      if (sort === "recent") {
        return (b.progress?.updatedAt ?? b.addedAt) - (a.progress?.updatedAt ?? a.addedAt);
      }
      return b.addedAt - a.addedAt;
    });
    return list;
  }, [libraryQuery.data, sort]);

  if (libraryQuery.isLoading) return <Spinner label="正在加载书架" />;
  if (libraryQuery.isError) {
    return (
      <ErrorState
        message={
          libraryQuery.error instanceof Error
            ? libraryQuery.error.message
            : undefined
        }
        onRetry={() => void libraryQuery.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="书架还是空的"
        icon={<BookMarked className="size-10" />}
        description="在漫画详情页加入书架，阅读进度会自动保存。"
      >
        <Button variant="primary" onClick={openSearch}>
          <Search className="size-4" /> 去找漫画
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div
          role="radiogroup"
          aria-label="书架排序"
          className="inline-flex rounded-full border border-line bg-surface p-0.5"
        >
          {sortModes.map((mode) => {
            const Icon = mode.icon;
            const active = sort === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={mode.label}
                title={mode.label}
                onClick={() => setSort(mode.value)}
                className={cn(
                  "press grid size-8 place-items-center rounded-full transition-colors",
                  active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <div className={`stagger ${mangaGridClass}`}>
        {items.map((item, index) => (
          <div
            key={`${item.manga.sourceId}:${item.manga.id}`}
            style={{ "--i": index } as React.CSSProperties}
          >
            <MangaCard
              manga={item.manga}
              footer={
                <div className="flex items-center justify-between pt-1 text-[11px] text-muted">
                  <span className={cn("tabular", item.progress && "text-ink-soft")}>
                    {item.progress ? `P${item.progress.pageIndex + 1}` : "—"}
                  </span>
                  {item.unreadCount ? (
                    <span
                      className="rounded-full bg-accent/10 px-1.5 py-px font-medium text-accent tabular"
                      title={`${item.unreadCount} 章未读`}
                    >
                      +{item.unreadCount}
                    </span>
                  ) : null}
                </div>
              }
            />
          </div>
        ))}
      </div>

      {items.some((item) => item.progress) ? (
        <section className="space-y-4">
          <SectionHeader index="R" title="继续阅读" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((item) => item.progress)
              .slice(0, 5)
              .map((item) => (
                <Link
                  key={`${item.manga.sourceId}:${item.manga.id}`}
                  to="/read"
                  search={{
                    sourceId: item.manga.sourceId,
                    mangaId: item.manga.id,
                    chapterId: item.progress?.chapterId ?? "",
                    page: item.progress?.pageIndex,
                  }}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-2 pr-4 text-sm shadow-soft transition-[border-color,box-shadow,transform] duration-300 ease-out-expo hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
                >
                  <CoverImage
                    src={item.manga.coverUrl}
                    className="h-14 w-10 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium group-hover:text-accent">
                    {item.manga.title}
                  </span>
                  <span className="label-mono shrink-0 text-muted">
                    P{(item.progress?.pageIndex ?? 0) + 1}
                  </span>
                </Link>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
