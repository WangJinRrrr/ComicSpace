import type { Dispatcher } from "undici";
import { AppError } from "../lib/errors.js";
import {
  assertImageUrlAllowed,
  type ImageHostPolicy,
} from "./guard.js";

export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
/** How long the first body byte may take before the connection is written off. */
const FIRST_CHUNK_TIMEOUT_MS = 10_000;
/** Idle gap allowed between body chunks; a stalled CDN otherwise hangs forever. */
export const STREAM_IDLE_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 4_000;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

/**
 * Some mangafun shards answer images with `binary/octet-stream` (not
 * `image/*` and not even `application/octet-stream`). Treat generic binary
 * types as images when the URL has an image extension, so the proxy serves a
 * type the browser can render with `nosniff`.
 */
export function resolveImageMime(
  remoteMime: string | null,
  url: string,
): string | null {
  const normalized = (remoteMime ?? "").split(";")[0]?.trim().toLowerCase();
  if (normalized?.startsWith("image/")) return normalized;
  const generic =
    !normalized ||
    normalized === "application/octet-stream" ||
    normalized === "binary/octet-stream";
  if (!generic) return null;

  try {
    const match = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname);
    const extension = match?.[1]?.toLowerCase();
    if (extension && IMAGE_MIME_BY_EXTENSION[extension]) {
      return IMAGE_MIME_BY_EXTENSION[extension] as string;
    }
  } catch {
    // Fall through to a generic binary type.
  }
  return "application/octet-stream";
}

export interface RemoteImageOptions {
  headers?: Record<string, string>;
  policy: ImageHostPolicy;
  signal?: AbortSignal;
  /** Optional proxy dispatcher (global HTTP(S) proxy). */
  dispatcher?: Dispatcher;
}

/**
 * Parses a `Retry-After` header (seconds or HTTP date) into milliseconds,
 * capped so a hostile or mistaken header cannot stall a reader for minutes.
 */
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
  maxMs = RETRY_MAX_MS,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, maxMs);
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), maxMs);
}

function retryAfterOf(error: unknown): number | null {
  if (!(error instanceof AppError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object") return null;
  const value = (details as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Exponential backoff with jitter. Jitter matters when several pages fail at
 * once: without it every retry lands on the CDN in the same instant.
 */
export function retryDelayMs(attempt: number, error?: unknown): number {
  const exponential = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attempt),
  );
  const jitter = Math.random() * exponential * 0.35;
  const retryAfter = retryAfterOf(error);
  return Math.min(RETRY_MAX_MS, Math.max(exponential + jitter, retryAfter ?? 0));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError(499, "cancelled", "Request cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AppError(499, "cancelled", "Request cancelled"));
    };
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Image CDNs used by the sources occasionally reset a cold connection or answer
 * a burst with 429/5xx. Retry transient failures with backoff; permanent
 * failures (403/404/parse) fail on the first try so a dead URL does not cost
 * three round trips.
 */
export async function fetchRemoteImage(
  url: string,
  options: RemoteImageOptions,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchRemoteImageOnce(url, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Errors that escape as plain TypeErrors ("terminated") are body resets
      // and are worth retrying; AppError carries the explicit decision.
      const retryable = !(error instanceof AppError) || error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
      lastError = error;
      await sleep(retryDelayMs(attempt, error), options.signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError(502, "network_error", "Could not fetch image");
}

async function fetchRemoteImageOnce(
  url: string,
  options: RemoteImageOptions,
): Promise<Response> {
  // The deadline guards connection + response headers only. Applying it to the
  // body aborts downloads that are slow but progressing, which shows up as
  // half-loaded pages and connection resets from slow image CDNs.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  try {
    return await fetchRemoteImageFollow(url, options, signal, deadline.signal);
  } finally {
    // Headers are in (or the attempt failed): the body may take as long as it
    // needs, while the caller's own signal still cancels it.
    clearTimeout(timer);
  }
}

async function fetchRemoteImageFollow(
  url: string,
  options: RemoteImageOptions,
  signal: AbortSignal,
  headerAbort: AbortSignal,
): Promise<Response> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value);
  }
  if (!headers.has("accept")) {
    headers.set(
      "accept",
      "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    );
  }

  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const parsed = await assertImageUrlAllowed(current, options.policy);
    let response: Response;
    try {
      response = await fetch(parsed, {
        headers,
        redirect: "manual",
        signal,
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (
        headerAbort.aborted ||
        (error as { name?: string }).name === "TimeoutError"
      ) {
        // A full header deadline already cost the reader a minute; retrying it
        // would double the wait on a host that is simply down.
        throw new AppError(504, "timeout", "Image request timed out", {
          retryable: false,
        });
      }
      throw new AppError(
        502,
        "network_error",
        `Could not fetch image: ${parsed.host}`,
        { retryable: true },
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError(502, "network_error", "Image redirect had no location");
      }
      if (redirects === 3) {
        throw new AppError(502, "network_error", "Too many image redirects");
      }
      const next = new URL(location, parsed);
      if (next.origin !== parsed.origin) {
        headers.delete("cookie");
        headers.delete("authorization");
      }
      current = next.href;
      continue;
    }

    if (!response.ok) {
      const retryAfter = parseRetryAfter(
        response.headers.get("retry-after"),
      );
      const retryableStatus =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      const code =
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "forbidden"
            : "network_error";
      throw new AppError(
        response.status === 401 || response.status === 403
          ? response.status
          : response.status === 429
            ? 429
            : 502,
        code,
        `Remote image returned HTTP ${response.status}`,
        {
          retryable: retryableStatus,
          ...(retryAfter !== null
            ? { details: { retryAfterMs: retryAfter } }
            : {}),
        },
      );
    }

    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
      throw new AppError(502, "network_error", "Image is too large to proxy");
    }

    const contentType = response.headers.get("content-type");
    if (!resolveImageMime(contentType, current)) {
      throw new AppError(502, "parse_error", "Remote URL did not return an image");
    }

    if (!response.body) return response;
    const body = await peekFirstChunk(response.body);
    if (!body) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  throw new AppError(502, "network_error", "Too many image redirects");
}

export function limitImageStream(
  maxBytes = MAX_IMAGE_BYTES,
): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(
          new AppError(502, "network_error", "Image is too large to proxy"),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Fails the stream when the upstream stops sending. The header deadline is
 * deliberately not applied to the body (slow CDNs are fine), but a connection
 * that has gone silent must not keep a reader waiting forever.
 */
export function guardStreamIdle(
  idleMs = STREAM_IDLE_TIMEOUT_MS,
  onStall?: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  let timer: NodeJS.Timeout | undefined;
  let settled = false;

  const settle = () => {
    settled = true;
    clearTimeout(timer);
  };

  const arm = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (settled) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onStall?.();
      try {
        controller.error(new AppError(504, "timeout", "Image stream stalled"));
      } catch {
        // The stream already closed; nothing to fail.
      }
    }, idleMs);
    timer.unref?.();
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      arm(controller);
    },
    transform(chunk, controller) {
      arm(controller);
      controller.enqueue(chunk);
    },
    flush() {
      settle();
    },
    cancel() {
      settle();
    },
  });
}

function rewrapStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  firstChunk: Uint8Array,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      const pump = (): void => {
        reader.read().then(
          (next) => {
            if (next.done) controller.close();
            else {
              controller.enqueue(next.value);
              pump();
            }
          },
          (error) => controller.error(error),
        );
      };
      pump();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Reads the first body chunk before handing the response on. Anti-leech CDNs
 * accept the request, send headers, then reset the connection; doing this here
 * moves that reset inside fetchRemoteImage's retry window instead of letting it
 * surface as a half-downloaded page.
 */
async function peekFirstChunk(
  body: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  let timer: NodeJS.Timeout | undefined;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AppError(504, "timeout", "Image stream stalled", {
                // A cold CDN may need a moment; this one is cheap to retry.
                retryable: true,
              }),
            ),
          FIRST_CHUNK_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    if (first.done) return null;
    return rewrapStream(reader, first.value);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
