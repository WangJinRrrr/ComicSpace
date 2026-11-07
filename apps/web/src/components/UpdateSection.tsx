import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { formatBytes } from "../lib/format";
import { Button, Card } from "./ui";

export function UpdateSection() {
  const queryClient = useQueryClient();
  const updateQuery = useQuery({
    queryKey: queryKeys.update,
    queryFn: ({ signal }) => api.getUpdate(signal),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const fetchMutation = useMutation({
    mutationFn: () => api.fetchUpdate(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.update });
    },
  });
  const openMutation = useMutation({
    mutationFn: () => api.openUpdate(),
  });

  const data = updateQuery.data;
  const failed = data?.status === "error";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">软件更新</h2>
        <Button
          size="sm"
          onClick={() => void updateQuery.refetch()}
          disabled={updateQuery.isFetching}
        >
          <RefreshCw
            className={updateQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
          />
          {updateQuery.isFetching ? "正在检查…" : "检查更新"}
        </Button>
      </div>
      <Card className="space-y-3 text-sm">
        <p className="text-xs leading-5 text-muted">
          对照 GitHub Releases 检查新版本。不会在后台下载，也不会静默安装或自动重启。当前发行方式没有
          electron-updater 所需的 latest.yml，因此不能在安装后自动重启。Windows x64
          安装版需要你确认安装程序；便携版要手动替换 exe。其他系统没有对应安装包。
        </p>
        {updateQuery.isLoading ? (
          <p className="text-muted">正在检查更新…</p>
        ) : updateQuery.isError ? (
          <p className="text-danger" role="alert">
            {updateQuery.error instanceof Error
              ? updateQuery.error.message
              : "无法检查更新"}
          </p>
        ) : data ? (
          <>
            <p className={failed ? "text-danger" : "text-ink"} role="status">
              {data.message}
            </p>
            <p className="text-xs text-muted">
              当前版本 {data.currentVersion}
              {data.latestVersion ? ` · 已发布 ${data.latestVersion}` : ""} · {data.platform}{" "}
              {data.arch}
            </p>
            {data.asset ? (
              <p className="text-xs text-muted">
                安装包 {data.asset.name}
                {data.asset.size > 0 ? ` · ${formatBytes(data.asset.size)}` : ""}
              </p>
            ) : null}
            {data.status === "update_available" && data.releaseNotes ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs leading-5 text-ink-soft">
                {data.releaseNotes}
              </pre>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {data.canDownload ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => fetchMutation.mutate()}
                  disabled={fetchMutation.isPending}
                >
                  <Download className="size-3.5" />
                  {fetchMutation.isPending ? "正在下载…" : "获取更新"}
                </Button>
              ) : null}
              {data.releaseUrl && data.status === "update_available" ? (
                <a
                  href={data.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent underline-offset-2 hover:underline"
                >
                  打开发布页面
                </a>
              ) : null}
              {fetchMutation.data?.installMode === "manual-nsis" ? (
                <Button
                  size="sm"
                  onClick={() => openMutation.mutate()}
                  disabled={openMutation.isPending}
                >
                  打开安装程序
                </Button>
              ) : null}
            </div>
            {fetchMutation.isError ? (
              <p className="text-xs text-danger" role="alert">
                {fetchMutation.error instanceof Error
                  ? fetchMutation.error.message
                  : "下载失败"}
              </p>
            ) : null}
            {fetchMutation.data ? (
              <p className="whitespace-pre-wrap text-xs leading-5 text-muted" role="status">
                {fetchMutation.data.message}
              </p>
            ) : null}
            {openMutation.data ? (
              <p className="text-xs leading-5 text-muted" role="status">
                {openMutation.data.message}
              </p>
            ) : null}
            {openMutation.isError ? (
              <p className="text-xs text-danger" role="alert">
                {openMutation.error instanceof Error
                  ? openMutation.error.message
                  : "无法打开安装程序"}
              </p>
            ) : null}
          </>
        ) : null}
      </Card>
    </section>
  );
}
