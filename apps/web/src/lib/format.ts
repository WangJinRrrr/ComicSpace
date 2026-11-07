import type { DownloadStatus, MangaStatus } from "@comicspace/contracts";

export function formatDate(value: number | string | undefined): string {
  if (value === undefined) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatRelative(value: number): string {
  const diff = Date.now() - value;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function statusLabel(status: MangaStatus | undefined): string {
  switch (status) {
    case "ongoing":
      return "连载中";
    case "completed":
      return "已完结";
    case "hiatus":
      return "休载";
    case "cancelled":
      return "已取消";
    default:
      return "状态未知";
  }
}

export function downloadStatusLabel(status: DownloadStatus | "none"): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "下载中";
    case "completed":
      return "已下载";
    case "failed":
      return "下载失败";
    case "cancelled":
      return "已取消";
    default:
      return "";
  }
}

export function mangaHref(sourceId: string, mangaId: string): string {
  return `/manga?sourceId=${encodeURIComponent(sourceId)}&mangaId=${encodeURIComponent(mangaId)}`;
}

export function readerHref(input: {
  sourceId: string;
  mangaId: string;
  chapterId: string;
  page?: number;
}): string {
  const params = new URLSearchParams({
    sourceId: input.sourceId,
    mangaId: input.mangaId,
    chapterId: input.chapterId,
  });
  if (input.page !== undefined) params.set("page", String(input.page));
  return `/read?${params.toString()}`;
}
