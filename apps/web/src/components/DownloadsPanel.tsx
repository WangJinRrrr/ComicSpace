import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  Download,
  HardDrive,
  LoaderCircle,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { DownloadDto } from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { cn } from "../lib/cn";
import {
  downloadStatusLabel,
  formatBytes,
  formatRelative,
} from "../lib/format";
import {
  EmptyState,
  ErrorState,
  IconButton,
  ProgressBar,
  Spinner,
} from "./ui";

export function useDownloadsQuery() {
  return useQuery({
    queryKey: queryKeys.downloads,
    queryFn: ({ signal }) => api.getDownloads(signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.downloads.some(
        (item) => item.status === "queued" || item.status === "running",
      )
        ? 1500
        : false;
    },
  });
}

/** Offline downloads, shown as a special shelf inside the library. */
export function DownloadsPanel() {
  const queryClient = useQueryClient();
  const downloadsQuery = useDownloadsQuery();

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloads });
  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.cancelDownload(id),
    onSuccess: invalidate,
  });
  const retryMutation = useMutation({
    mutationFn: (id: number) => api.retryDownload(id),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: number) => api.removeDownload(id),
    onSuccess: invalidate,
  });

  if (downloadsQuery.isLoading) return <Spinner label="正在加载下载" />;
  if (downloadsQuery.isError) {
    return (
      <ErrorState
        message={
          downloadsQuery.error instanceof Error
            ? downloadsQuery.error.message
            : undefined
        }
        onRetry={() => void downloadsQuery.refetch()}
      />
    );
  }

  const downloads = downloadsQuery.data?.downloads ?? [];
  const active = downloads.filter(
    (item) => item.status === "queued" || item.status === "running",
  );
  const completed = downloads.filter((item) => item.status === "completed");
  const failed = downloads.filter(
    (item) => item.status === "failed" || item.status === "cancelled",
  );

  if (downloads.length === 0) {
    return (
      <EmptyState
        title="还没有下载"
        icon={<Download className="size-10" />}
        description="在漫画详情页的章节右侧点击下载按钮。"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="flex items-center justify-end gap-1.5 text-xs text-muted"
        title="下载占用空间（缓存清理不会删除下载）"
      >
        <HardDrive className="size-4" aria-hidden="true" />
        <span className="tabular">
          {formatBytes(downloadsQuery.data?.totalBytes ?? 0)}
        </span>
      </div>
      {active.length > 0 ? (
        <Section
          icon={<LoaderCircle className="size-4 animate-spin text-accent" />}
          label="进行中"
          count={active.length}
        >
          {active.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onCancel={() => cancelMutation.mutate(item.id)}
            />
          ))}
        </Section>
      ) : null}
      {failed.length > 0 ? (
        <Section
          icon={<CircleAlert className="size-4 text-danger" />}
          label="失败 / 已取消"
          count={failed.length}
        >
          {failed.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onRetry={() => retryMutation.mutate(item.id)}
              onRemove={() => removeMutation.mutate(item.id)}
            />
          ))}
        </Section>
      ) : null}
      {completed.length > 0 ? (
        <Section
          icon={<CircleCheck className="size-4 text-success" />}
          label="已完成"
          count={completed.length}
        >
          {completed.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onRemove={() => removeMutation.mutate(item.id)}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={label}>
      <h2 className="flex items-center gap-2 px-1" title={label}>
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">{label}</span>
        <span className="label-mono text-muted tabular">{count}</span>
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
        {children}
      </div>
    </section>
  );
}

function DownloadRow({
  item,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: DownloadDto;
  onCancel?: () => void;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  const percentage =
    item.totalPages > 0 ? (item.completedPages / item.totalPages) * 100 : 0;
  const running = item.status === "running" || item.status === "queued";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.mangaTitle}</span>
          <StatusDot status={item.status} />
        </div>
        <div className="truncate text-xs text-muted">{item.chapterTitle}</div>
        {running ? (
          <div className="mt-1.5">
            <ProgressBar value={percentage} label="下载进度" />
          </div>
        ) : null}
        {item.error ? (
          <p className="mt-0.5 truncate text-xs text-danger" title={item.error}>
            {item.error}
          </p>
        ) : null}
      </div>
      <div
        className="hidden shrink-0 text-right text-[11px] leading-4 text-muted tabular sm:block"
        title={formatRelative(item.updatedAt)}
      >
        <div>
          {item.completedPages}/{item.totalPages}
        </div>
        <div>{formatBytes(item.bytes)}</div>
      </div>
      <div className="flex shrink-0 items-center">
        {item.status === "completed" ? (
          <Link
            to="/read"
            search={{
              sourceId: item.sourceId,
              mangaId: item.mangaId,
              chapterId: item.chapterId,
            }}
            aria-label="阅读"
            title="阅读"
            className="press grid size-9 place-items-center rounded-full text-accent hover:bg-surface-3/70"
          >
            <BookOpen className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        {onCancel ? (
          <IconButton label="取消" onClick={onCancel} className="size-9">
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {onRetry ? (
          <IconButton label="重试" onClick={onRetry} className="size-9">
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {onRemove ? (
          <IconButton label="删除" onClick={onRemove} className="size-9">
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: DownloadDto["status"] }) {
  const label = downloadStatusLabel(status);
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "completed" && "bg-success",
        status === "failed" && "bg-danger",
        status === "cancelled" && "bg-muted",
        (status === "running" || status === "queued") && "animate-pulse bg-accent",
      )}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
