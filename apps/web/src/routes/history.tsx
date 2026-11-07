import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Trash2 } from "lucide-react";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
} from "../components/ui";
import { CoverImage } from "../components/CoverImage";
import { formatRelative } from "../lib/format";

export function HistoryPage() {
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: queryKeys.history,
    queryFn: ({ signal }) => api.getHistory(signal),
  });
  const clearMutation = useMutation({
    mutationFn: () => api.clearHistory(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });

  if (historyQuery.isLoading) return <Spinner label="正在加载历史" />;
  if (historyQuery.isError) {
    return (
      <ErrorState
        message={
          historyQuery.error instanceof Error
            ? historyQuery.error.message
            : undefined
        }
        onRetry={() => void historyQuery.refetch()}
      />
    );
  }

  const items = historyQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="03 / History"
        title="历史"
        description="每本漫画只显示最后一次实际阅读的章节和页码，按最近阅读排序。清空历史不会重置阅读进度。"
        actions={
          items.length > 0 ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              <Trash2 className="size-3.5" /> 清空历史
            </Button>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="还没有阅读记录"
          icon={<History className="size-10" />}
          description="打开任意章节后，这里会留下这本书最后阅读的位置。"
        />
      ) : (
        <div className="stagger divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          {items.map((item, index) => (
            <Link
              key={`${item.sourceId}:${item.mangaId}:${item.chapterId}`}
              to="/read"
              search={{
                sourceId: item.sourceId,
                mangaId: item.mangaId,
                chapterId: item.chapterId,
                page: item.pageIndex,
              }}
              style={{ "--i": index } as React.CSSProperties}
              className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span className="label-mono hidden w-6 shrink-0 text-muted/70 tabular sm:block">
                {String(index + 1).padStart(2, "0")}
              </span>
              <CoverImage
                src={item.coverUrl}
                className="h-16 w-11 shrink-0 rounded-md ring-1 ring-black/5 transition-transform duration-300 ease-spring group-hover:-translate-y-0.5 group-hover:rotate-[-2deg]"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium transition-colors group-hover:text-accent">
                  {item.mangaTitle}
                </div>
                <div className="truncate text-xs text-muted">
                  {item.chapterTitle} · 第 {item.pageIndex + 1} 页
                </div>
              </div>
              <div className="label-mono shrink-0 text-muted">
                {formatRelative(item.readAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
