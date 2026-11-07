import fs from "node:fs";
import { Readable } from "node:stream";
import type { ImageTransform } from "@comicspace/plugin-sdk";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { getGlobalProxyDispatcher } from "../lib/network.js";
import type { ReadingCache } from "../cache/store.js";
import { imageCacheKey } from "../cache/key.js";
import type { PluginRegistry } from "../plugins/registry.js";
import {
  assertStaticImageHostAllowed,
  type ImageHostPolicy,
} from "./guard.js";
import {
  fetchRemoteImage,
  guardStreamIdle,
  limitImageStream,
  resolveImageMime,
  STREAM_IDLE_TIMEOUT_MS,
} from "./fetch.js";
import { applyImageTransform } from "./transform.js";
import {
  openTicket,
  sealTicket,
  TicketError,
  type ImageTicketPayload,
} from "./ticket.js";

/** Longest a request waits for an in-flight warm-up before fetching its own copy. */
const INFLIGHT_WAIT_MS = 3_000;
/**
 * Warm-ups are speculative. Keeping a small global cap means ten open tabs (or
 * a long chapter list) cannot saturate the source CDN ahead of the pages a
 * reader is actually looking at.
 */
const MAX_WARM_CONCURRENCY = 3;
const MAX_WARM_QUEUE = 96;

function waitBriefly(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

const PAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";
const COVER_CACHE_CONTROL = "private, max-age=86400";

export interface TicketOptions {
  headers?: Record<string, string>;
  referer?: string;
  allowedHosts?: string[];
  transform?: ImageTransform;
}

function mergeImageHeaders(
  pageHeaders: Record<string, string> | undefined,
  referer: string | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageHeaders ?? {})) {
    merged[key.toLowerCase()] = value;
  }
  if (referer) merged.referer = referer;
  return merged;
}

function cacheControl(kind: "page" | "cover"): string {
  return kind === "page" ? PAGE_CACHE_CONTROL : COVER_CACHE_CONTROL;
}

function fileResponse(filePath: string, entry: { mime: string; bytes: number; kind: "page" | "cover" }) {
  const nodeStream = fs.createReadStream(filePath);
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(body, {
    headers: {
      "content-type": entry.mime,
      "content-length": String(entry.bytes),
      "cache-control": cacheControl(entry.kind),
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}

export class ImageProxy {
  private readonly logger = createLogger("images");
  private extraAllowedHosts: string[];

  constructor(
    private readonly registry: PluginRegistry,
    private readonly cache: ReadingCache,
    private readonly secret: Buffer,
    options: { extraAllowedHosts?: string[] } = {},
  ) {
    this.extraAllowedHosts = (options.extraAllowedHosts ?? []).map((host) =>
      host.toLowerCase(),
    );
  }

  setExtraAllowedHosts(hosts: string[]): void {
    this.extraAllowedHosts = hosts
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }

  getExtraAllowedHosts(): string[] {
    return [...this.extraAllowedHosts];
  }

  createTicket(
    sourceId: string,
    kind: "page" | "cover",
    url: string,
    options: TicketOptions = {},
  ): string {
    assertStaticImageHostAllowed(url, {
      allowedHosts: options.allowedHosts,
      extraAllowedHosts: this.extraAllowedHosts,
    });
    const headers = mergeImageHeaders(options.headers, options.referer);
    return sealTicket(
      {
        u: url,
        p: sourceId,
        k: kind,
        ...(options.referer ? { r: options.referer } : {}),
        ...(Object.keys(headers).length > 0 ? { h: headers } : {}),
        ...(options.transform ? { t: options.transform } : {}),
      },
      { secret: this.secret },
    );
  }

  /**
   * Cache fills currently in progress, keyed by cache key. Warm-up and the
   * reader frequently ask for the same image at the same moment; sharing one
   * upstream fetch avoids double bandwidth and the rename race on Windows.
   */
  private readonly inflight = new Map<string, Promise<void>>();

  private trackFill(key: string, task: Promise<unknown>): void {
    const tracked: Promise<void> = task
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.inflight.get(key) === tracked) this.inflight.delete(key);
      });
    this.inflight.set(key, tracked);
  }

  private readonly warmQueue: string[] = [];
  private readonly warmQueued = new Set<string>();
  private warmActive = 0;

  /**
   * Fills the disk cache for tickets the reader will ask for next, so the first
   * paint does not wait on the remote host. Best effort: failures are ignored
   * and a later real request retries normally.
   *
   * Tokens go through one shared queue so concurrent chapter opens share the
   * same concurrency budget instead of each starting its own workers.
   */
  warm(tokens: string[]): void {
    for (const token of tokens) {
      if (this.warmQueued.has(token)) continue;
      if (this.warmQueue.length >= MAX_WARM_QUEUE) break;
      this.warmQueued.add(token);
      this.warmQueue.push(token);
    }
    this.pumpWarm();
  }

  private pumpWarm(): void {
    while (
      this.warmActive < MAX_WARM_CONCURRENCY &&
      this.warmQueue.length > 0
    ) {
      const token = this.warmQueue.shift();
      if (!token) continue;
      this.warmQueued.delete(token);
      this.warmActive += 1;
      void this.warmOne(token).finally(() => {
        this.warmActive = Math.max(0, this.warmActive - 1);
        this.pumpWarm();
      });
    }
  }

  private async warmOne(token: string): Promise<void> {
    try {
      const payload = openTicket(token, { secret: this.secret });
      const cacheKey = imageCacheKey(
        payload.p,
        payload.k,
        payload.u,
        payload.h,
        payload.t,
      );
      if (await this.cache.get(cacheKey)) return;
      // Another warm-up or a reader request is already fetching this image.
      if (this.inflight.has(cacheKey)) return;
      // Safety cap: a warm-up has no client to abort it if the CDN stalls.
      const response = await this.fetchAndCache(
        payload,
        cacheKey,
        AbortSignal.timeout(120_000),
      );
      // Draining matters for streamed pages: the cache write only finishes
      // once the teed branch has been consumed.
      await response.arrayBuffer();
      await this.inflight.get(cacheKey)?.catch(() => undefined);
    } catch (error) {
      this.logger.debug("Warm-up failed", error);
    }
  }

  async serve(token: string, signal?: AbortSignal): Promise<Response> {
    let payload: ImageTicketPayload;
    try {
      payload = openTicket(token, { secret: this.secret });
    } catch (error) {
      if (error instanceof TicketError) {
        throw new AppError(
          error.code === "expired" ? 410 : 403,
          "forbidden",
          error.message,
        );
      }
      throw error;
    }

    const cacheKey = imageCacheKey(
      payload.p,
      payload.k,
      payload.u,
      payload.h,
      payload.t,
    );
    const cached = await this.cache.get(cacheKey);
    if (cached) return this.serveCached(cached, payload.k);

    // A warm-up may already be downloading this exact image. Waiting for it is
    // cheaper than fetching a second copy.
    const pending = this.inflight.get(cacheKey);
    if (pending) {
      // Wait only briefly: if the warm-up is stuck on a slow CDN, serving our
      // own request beats blocking the reader on someone else's download.
      await waitBriefly(pending, INFLIGHT_WAIT_MS);
      const filled = await this.cache.get(cacheKey);
      if (filled) return this.serveCached(filled, payload.k);
    }

    return this.fetchAndCache(payload, cacheKey, signal);
  }

  private serveCached(
    entry: { filePath: string; mime: string; bytes: number },
    kind: "page" | "cover",
  ): Response {
    return fileResponse(entry.filePath, {
      mime: entry.mime,
      bytes: entry.bytes,
      kind,
    });
  }

  private async fetchAndCache(
    payload: ImageTicketPayload,
    cacheKey: string,
    outerSignal?: AbortSignal,
  ): Promise<Response> {
    const plugin = await this.registry.getPlugin(payload.p);
    const policy: ImageHostPolicy = {
      allowedHosts: plugin?.manifest.allowedImageHosts,
      extraAllowedHosts: this.extraAllowedHosts,
    };

    const headers: Record<string, string> = { ...(payload.h ?? {}) };
    if (payload.r) headers.referer = payload.r;
    // Aborting this controller is how a stalled upstream is torn down.
    const stall = new AbortController();
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, stall.signal])
      : stall.signal;
    const response = await fetchRemoteImage(payload.u, {
      headers,
      policy,
      signal,
      dispatcher: getGlobalProxyDispatcher(),
    });
    const mime =
      resolveImageMime(response.headers.get("content-type"), payload.u) ??
      "application/octet-stream";
    if (!response.body) {
      throw new AppError(502, "network_error", "Remote image had no body", {
        retryable: true,
      });
    }
    // Forward the upstream length so a truncated body becomes a load error in
    // the browser instead of a half-rendered page. Decompressed bodies no
    // longer match the header, so only trust it when nothing was re-encoded.
    const upstreamLength = response.headers.get("content-encoding")
      ? null
      : response.headers.get("content-length");

    const stream = () =>
      response.body!
        .pipeThrough(limitImageStream())
        .pipeThrough(
          guardStreamIdle(STREAM_IDLE_TIMEOUT_MS, () => stall.abort()),
        );

    if (payload.t) {
      const buffer = Buffer.from(await new Response(stream()).arrayBuffer());
      const transformed = await applyImageTransform(buffer, mime, payload.t);
      await this.cache.putBuffer(
        cacheKey,
        {
          sourceId: payload.p,
          kind: payload.k,
          remoteUrl: payload.u,
          mime: transformed.mime,
          width: transformed.width,
          height: transformed.height,
        },
        transformed.buffer,
      );
      return new Response(new Uint8Array(transformed.buffer), {
        headers: {
          "content-type": transformed.mime,
          "content-length": String(transformed.buffer.byteLength),
          "cache-control": cacheControl(payload.k),
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        },
      });
    }

    const [toClient, toCache] = stream().tee();
    this.trackFill(
      cacheKey,
      this.cache
        .putStream(
          cacheKey,
          {
            sourceId: payload.p,
            kind: payload.k,
            remoteUrl: payload.u,
            mime,
          },
          toCache,
        )
        .catch((error) => this.logger.warn("Cache write failed", error)),
    );

    return new Response(toClient, {
      headers: {
        "content-type": mime,
        ...(upstreamLength ? { "content-length": upstreamLength } : {}),
        "cache-control": cacheControl(payload.k),
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  }
}
