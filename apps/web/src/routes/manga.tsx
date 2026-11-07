import { useCallback, useEffect, useRef } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  Check,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import {
  Button,
  Badge,
  ErrorState,
  IconButton,
  SectionHeader,
  Skeleton,
  Spinner,
} from "../components/ui";
import { CoverImage } from "../components/CoverImage";
import { usePrefetchPolicy } from "../lib/reader/network";
import { cn } from "../lib/cn";
import {
  COVER_TRANSITION_NAME,
  mangaKey,
  readCoverHandoff,
} from "../lib/viewTransition";
import {
  downloadStatusLabel,
  formatDate,
  statusLabel,
} from "../lib/format";

export function MangaPage() {
  const search = useSearch({ from: "/manga" });
  const { sourceId, mangaId } = search;
  const queryClient = useQueryClient();

  const mangaQuery = useQuery({
    queryKey: queryKeys.manga(sourceId, mangaId),
    queryFn: ({ signal }) => api.getManga({ sourceId, mangaId }, signal),
    enabled: Boolean(sourceId && mangaId),
  });
  const chaptersQuery = useQuery({
    queryKey: queryKeys.chapters(sourceId, mangaId),
    queryFn: ({ signal }) => api.getChapters({ sourceId, mangaId }, signal),
    enabled: Boolean(sourceId && mangaId),
  });

  const addMutation = useMutation({
    mutationFn: () => api.addToLibrary(sourceId, mangaId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.manga(sourceId, mangaId),
      });
    },
  });
  const removeMutation = useMutation({
    mutationFn: () => api.removeFromLibrary(sourceId, mangaId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.manga(sourceId, mangaId),
      });
    },
  });
  const downloadMutation = useMutation({
    mutationFn: (chapterId: string) =>
      api.startDownloads({ sourceId, mangaId, chapterIds: [chapterId] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chapters(sourceId, mangaId),
      });
    },
  });

  // Hovering a chapter is a strong signal that it is about to be read. Fetch
  // its page list (and let the server warm the first images) so the reader
  // opens without waiting on the source. A short delay keeps a mouse swept
  // across the list from firing a request per row.
  const prefetchPolicy = usePrefetchPolicy();
  const prefetchTimers = useRef(new Map<string, number>());

  const prefetchChapter = useCallback(
    (chapterId: string) => {
      if (!prefetchPolicy.enabled || !sourceId || !mangaId) return;
      void queryClient.prefetchQuery({
        queryKey: queryKeys.pages(sourceId, mangaId, chapterId),
        queryFn: ({ signal }) =>
          api.getPages({ sourceId, mangaId, chapterId }, signal),
        staleTime: 60_000,
      });
    },
    [prefetchPolicy.enabled, sourceId, mangaId, queryClient],
  );

  const scheduleChapterPrefetch = useCallback(
    (chapterId: string) => {
      if (!prefetchPolicy.enabled) return;
      const existing = prefetchTimers.current.get(chapterId);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        prefetchTimers.current.delete(chapterId);
        prefetchChapter(chapterId);
      }, 160);
      prefetchTimers.current.set(chapterId, timer);
    },
    [prefetchPolicy.enabled, prefetchChapter],
  );

  const cancelChapterPrefetch = useCallback((chapterId: string) => {
    const timer = prefetchTimers.current.get(chapterId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      prefetchTimers.current.delete(chapterId);
    }
  }, []);

  useEffect(() => {
    const timers = prefetchTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const chaptersForPrefetch = chaptersQuery.data?.chapters ?? [];
  const resumeChapterId = mangaQuery.data?.progress?.chapterId;
  const autoPrefetchChapterId = resumeChapterId
    ? (chaptersForPrefetch.find((chapter) => chapter.id === resumeChapterId)
        ?.id ?? chaptersForPrefetch[0]?.id)
    : chaptersForPrefetch[0]?.id;

  // Warm the chapter the "continue reading" button points at once the page is
  // quiet. This is the one chapter the user is most likely to open next.
  useEffect(() => {
    if (!autoPrefetchChapterId || !prefetchPolicy.enabled) return;
    const timer = window.setTimeout(
      () => prefetchChapter(autoPrefetchChapterId),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [autoPrefetchChapterId, prefetchPolicy.enabled, prefetchChapter]);

  if (!sourceId || !mangaId) {
    return (
      <ErrorState
        title="缺少漫画参数"
        message="链接不完整，请从搜索或书架重新打开。"
      />
    );
  }
  const handoff = readCoverHandoff(mangaKey(sourceId, mangaId));
  if (mangaQuery.isLoading) {
    // Render the morph target straight away when we came from a card.
    return handoff ? (
      <MangaHero coverUrl={handoff.coverUrl} title={handoff.title}>
        <div className="mt-6 space-y-2.5">
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </MangaHero>
    ) : (
      <Spinner label="正在加载漫画" />
    );
  }
  if (mangaQuery.isError) {
    return (
      <ErrorState
        message={
          mangaQuery.error instanceof Error
            ? mangaQuery.error.message
            : undefined
        }
        onRetry={() => void mangaQuery.refetch()}
      />
    );
  }

  const manga = mangaQuery.data;
  if (!manga) return null;
  const chapters = chaptersForPrefetch;
  const continueChapter = manga.progress?.chapterId
    ? chapters.find((chapter) => chapter.id === manga.progress?.chapterId)
    : chapters[0];
  const continuePage = manga.progress?.pageIndex ?? 0;
  const readCount = chapters.filter((chapter) => chapter.read?.completed).length;
  const refreshing = mangaQuery.isFetching || chaptersQuery.isFetching;

  return (
    <div className="space-y-section">
      <MangaHero
        coverUrl={manga.coverUrl}
        title={manga.title}
        eyebrow={`${sourceId} / ${statusLabel(manga.status)}`}
      >
        {manga.authors?.length ? (
          <p className="mt-2 text-sm text-ink-soft">
            {manga.authors.join(" / ")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {manga.year ? <Badge>{manga.year}</Badge> : null}
          {manga.readingDirection ? (
            <Badge>{manga.readingDirection === "rtl" ? "右→左" : "左→右"}</Badge>
          ) : null}
          {manga.stale ? <Badge tone="danger">缓存内容</Badge> : null}
          {manga.inLibrary ? <Badge tone="accent">在书架</Badge> : null}
          {manga.genres?.map((genre) => (
            <Badge key={genre}>{genre}</Badge>
          ))}
        </div>
        <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-ink-soft">
          {manga.description || "这个源没有提供简介。"}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {continueChapter ? (
            <Link
              to="/read"
              search={{
                sourceId,
                mangaId,
                chapterId: continueChapter.id,
                page: continuePage,
              }}
              onPointerEnter={() => scheduleChapterPrefetch(continueChapter.id)}
              onPointerLeave={() => cancelChapterPrefetch(continueChapter.id)}
              onFocus={() => scheduleChapterPrefetch(continueChapter.id)}
              onBlur={() => cancelChapterPrefetch(continueChapter.id)}
              onClick={() => prefetchChapter(continueChapter.id)}
            >
              <Button variant="primary" size="lg">
                <Play className="size-4" />
                {manga.progress ? "继续阅读" : "开始阅读"}
              </Button>
            </Link>
          ) : null}
          <Button
            size="lg"
            onClick={() =>
              manga.inLibrary ? removeMutation.mutate() : addMutation.mutate()
            }
            disabled={addMutation.isPending || removeMutation.isPending}
          >
            {manga.inLibrary ? (
              <>
                <Trash2 className="size-4" /> 移出书架
              </>
            ) : (
              <>
                <BookMarked className="size-4" /> 加入书架
              </>
            )}
          </Button>
          <IconButton
            label="刷新"
            onClick={() => {
              void mangaQuery.refetch();
              void chaptersQuery.refetch();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          </IconButton>
        </div>

        <dl className="mt-7 grid max-w-xl grid-cols-3 divide-x divide-line border-y border-line">
          <Stat label="已读" value={`${readCount} / ${chapters.length || "?"}`} />
          <Stat
            label="进度"
            value={manga.progress ? `第 ${manga.progress.pageIndex + 1} 页` : "未开始"}
          />
          <Stat
            label="更新"
            value={manga.updatedAt ? formatDate(manga.updatedAt) : "—"}
          />
        </dl>
      </MangaHero>

      <section className="space-y-4">
        <SectionHeader
          index="02"
          title="章节"
          meta={
            chaptersQuery.isFetching
              ? "更新中…"
              : `${chapters.length} 章${chaptersQuery.data?.stale ? " · 缓存" : ""}`
          }
        />

        {chaptersQuery.isLoading ? (
          <Spinner label="正在加载章节" />
        ) : chaptersQuery.isError ? (
          <ErrorState
            message={
              chaptersQuery.error instanceof Error
                ? chaptersQuery.error.message
                : undefined
            }
            onRetry={() => void chaptersQuery.refetch()}
          />
        ) : chapters.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            这个源还没有返回章节。
          </div>
        ) : (
          <div className="max-h-[36rem] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface shadow-soft scrollbar-thin">
            {chapters.map((chapter) => (
              <div
                key={chapter.id}
                className={cn(
                  "group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
                  chapter.id === manga.progress?.chapterId && "bg-accent-soft/10",
                )}
              >
                <Link
                  to="/read"
                  search={{
                    sourceId,
                    mangaId,
                    chapterId: chapter.id,
                    page: chapter.read?.pageIndex,
                  }}
                  onPointerEnter={() => scheduleChapterPrefetch(chapter.id)}
                  onPointerLeave={() => cancelChapterPrefetch(chapter.id)}
                  onFocus={() => scheduleChapterPrefetch(chapter.id)}
                  onBlur={() => cancelChapterPrefetch(chapter.id)}
                  onClick={() => prefetchChapter(chapter.id)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <span className="label-mono w-10 shrink-0 text-muted/70 tabular">
                    {chapter.number !== undefined ? `#${chapter.number}` : "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {chapter.read?.completed ? (
                        <Check className="size-3.5 shrink-0 text-success" />
                      ) : null}
                      <span
                        className={cn(
                          "truncate text-sm transition-colors group-hover:text-accent",
                          chapter.read?.completed ? "text-muted" : "text-ink",
                        )}
                      >
                        {chapter.title}
                      </span>
                      {chapter.read && !chapter.read.completed ? (
                        <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px text-[10px] font-medium text-accent">
                          读到第 {chapter.read.pageIndex + 1} 页
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex gap-2 text-[11px] text-muted">
                      {chapter.publishedAt ? (
                        <span>{formatDate(chapter.publishedAt)}</span>
                      ) : null}
                      {chapter.pageCount ? <span>{chapter.pageCount} 页</span> : null}
                      {chapter.downloadStatus !== "none" ? (
                        <span>{downloadStatusLabel(chapter.downloadStatus)}</span>
                      ) : null}
                    </span>
                  </span>
                </Link>
                <IconButton
                  label={chapter.downloadStatus === "completed" ? "已下载" : "下载本章"}
                  className="size-8"
                  onClick={() => downloadMutation.mutate(chapter.id)}
                  disabled={
                    chapter.downloadStatus === "completed" ||
                    chapter.downloadStatus === "queued" ||
                    chapter.downloadStatus === "running" ||
                    (downloadMutation.isPending &&
                      downloadMutation.variables === chapter.id)
                  }
                >
                  {downloadMutation.isPending &&
                  downloadMutation.variables === chapter.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : chapter.downloadStatus === "completed" ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MangaHero({
  coverUrl,
  title,
  eyebrow,
  children,
}: {
  coverUrl?: string;
  title: string;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
      {coverUrl ? (
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          <img
            src={coverUrl}
            alt=""
            className="size-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
          />
          <div className="absolute inset-0 bg-linear-to-br from-surface/30 via-surface/85 to-surface" />
        </div>
      ) : null}
      <div className="grid gap-6 p-5 sm:grid-cols-[180px_minmax(0,1fr)] md:gap-10 md:p-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <CoverImage
          src={coverUrl}
          eager
          className="mx-auto aspect-[2/3] w-44 self-start rounded-xl shadow-float ring-1 ring-black/5 sm:w-full"
          style={{ viewTransitionName: COVER_TRANSITION_NAME }}
        />
        <div className="min-w-0">
          {eyebrow ? (
            <div className="label-mono flex items-center gap-2.5 text-muted">
              <span className="h-px w-6 bg-accent-soft" aria-hidden="true" />
              {eyebrow}
            </div>
          ) : null}
          <h1 className="mt-3 break-words text-headline font-semibold text-ink xl:text-display">
            {title}
          </h1>
          {children}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 first:pl-0">
      <dt className="label-mono text-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-ink tabular">{value}</dd>
    </div>
  );
}
