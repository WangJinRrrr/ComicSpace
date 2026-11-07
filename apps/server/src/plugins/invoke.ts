import {
  PluginError,
  isPluginError,
  type AccountPageSession,
  type ConfigValues,
  type MangaPlugin,
  type PluginContext,
} from "@comicspace/plugin-sdk";
import { ProxyAgent, type Dispatcher } from "undici";
import { createLogger } from "../lib/logger.js";
import { getGlobalProxyDispatcher } from "../lib/network.js";
import type { LoadedPlugin } from "./loader.js";
import type { PluginLimiter } from "./limiter.js";

type PluginMethod = keyof Pick<
  MangaPlugin,
  | "search"
  | "browse"
  | "getFilters"
  | "getManga"
  | "getChapters"
  | "getPages"
  | "pullAccount"
>;

export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  limiter?: PluginLimiter;
  config: ConfigValues;
  openAccountSession?: () => Promise<AccountPageSession>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function invokePlugin<T>(
  plugin: LoadedPlugin,
  method: PluginMethod,
  args: unknown[],
  options: InvokeOptions,
): Promise<T> {
  const release = options.limiter ? await options.limiter.acquire() : () => {};
  const controller = new AbortController();
  let timedOut = false;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  }

  const logger = createLogger(`plugin:${plugin.id}`);

  // A plugin-level proxy wins; otherwise fall back to the global proxy.
  let dispatcher: Dispatcher | undefined;
  const proxyUrl = options.config.proxyUrl;
  if (typeof proxyUrl === "string" && proxyUrl.trim()) {
    try {
      dispatcher = new ProxyAgent(proxyUrl.trim());
    } catch (error) {
      logger.warn(`Invalid proxy URL: ${proxyUrl}`, error);
    }
  } else {
    dispatcher = getGlobalProxyDispatcher();
  }

  const context: PluginContext = {
    config: Object.freeze({ ...options.config }),
    signal: controller.signal,
    logger,
    ...(options.openAccountSession
      ? { openAccountSession: options.openAccountSession }
      : {}),
    fetch: (input, init = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has("user-agent")) {
        headers.set("user-agent", "ComicSpace/0.1 (local)");
      }
      if (!headers.has("accept")) {
        headers.set(
          "accept",
          "text/html,application/json,application/xhtml+xml,image/*,*/*;q=0.8",
        );
      }
      const signals = [controller.signal];
      if (init.signal) signals.push(init.signal);
      return fetch(input, {
        ...init,
        headers,
        signal: AbortSignal.any(signals),
        ...(dispatcher ? { dispatcher } : {}),
      });
    },
  };

  try {
    const fn = plugin.impl[method] as
      | ((...args: unknown[]) => Promise<T> | T)
      | undefined;
    if (typeof fn !== "function") {
      throw new PluginError(
        "unsupported",
        `${plugin.manifest.name} does not implement ${method}()`,
      );
    }

    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(
            new PluginError(
              timedOut ? "timeout" : "cancelled",
              timedOut
                ? `Plugin ${plugin.id} timed out after ${timeoutMs}ms`
                : `Plugin ${plugin.id} request was cancelled`,
            ),
          );
        },
        { once: true },
      );
    });

    return await Promise.race([
      Promise.resolve(fn.apply(plugin.impl, [...args, context])),
      abortPromise,
    ]);
  } catch (error) {
    // Plugins load a separate SDK runtime, so instanceof is not reliable.
    if (isPluginError(error)) throw error;
    if (controller.signal.aborted) {
      throw new PluginError(
        timedOut ? "timeout" : "cancelled",
        timedOut
          ? `Plugin ${plugin.id} timed out after ${timeoutMs}ms`
          : `Plugin ${plugin.id} request was cancelled`,
        { cause: error },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unhandled error in ${method}()`, error);
    throw new PluginError("unknown", message, { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
    release();
  }
}
