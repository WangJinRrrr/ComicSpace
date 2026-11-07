import { createHash } from "node:crypto";
import type { ImageTransform } from "@comicspace/plugin-sdk";

export function normalizeImageUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function stableHeaders(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => [key.trim().toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
}

function stableTransform(transform: ImageTransform | undefined): string {
  if (!transform) return "";
  return JSON.stringify({ type: transform.type, bands: transform.bands });
}

export function imageCacheKey(
  sourceId: string,
  kind: "page" | "cover",
  url: string,
  headers?: Record<string, string>,
  transform?: ImageTransform,
): string {
  return createHash("sha256")
    .update(sourceId)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(normalizeImageUrl(url))
    .update("\0")
    .update(stableHeaders(headers))
    .update("\0")
    .update(stableTransform(transform))
    .digest("hex");
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "img";
}
