import {
  AccountFlowError,
  cardsToSnapshot,
  readRenderedAccount,
} from "./account.js";
import {
  PluginError,
  type BrowseQuery,
  type Chapter,
  type FilterDef,
  type FilterValues,
  type Manga,
  type MangaPlugin,
  type MangaStatus,
  type Page,
  type PagedResult,
  type PluginContext,
  type SearchQuery,
} from "@comicspace/plugin-sdk";

/**
 * CopyManga (mangacopy.com) source adapter.
 *
 * Two request profiles share the same endpoints:
 *
 * - "web"  (platform=1): the free-site channel. It needs no request signature
 *   today and can read comic detail, chapter groups and image lists.
 * - "app"  (platform=3): the official app channel. It sends the app header set
 *   (source / Referer / COPY User-Agent). The service now also expects an
 *   `X-Auth-Signature` on detail and chapter reads and silently answers
 *   `results: null` without one, so this mode only works on servers that do
 *   not enforce the signature.
 *
 * Chapter groups and chapter reads are paced because the source limits them
 * to 30 and 20 requests per 61 seconds respectively.
 */

const WEB_BASE = "https://www.mangacopy.com";

/** Version header used by the free-site channel (verified against the API). */
const FREE_API_VERSION = "2025.08.15";
/** User-Agent used by the free-site channel. */
const FREE_USER_AGENT = "COPY/3.0.0";
/** Fallback app version for the app channel. */
const DEFAULT_APP_VERSION = "3.0.0";
const DEFAULT_IMAGE_USER_AGENT = "Dart/2.16(dart:io)";

const DEFAULT_API_HOSTS = [
  "api.mangacopy.com",
  "api.copymanga.tv",
  "api.copymanga.site",
];

/**
 * Kira (caolib/kira) talks to this host set with platform=3 and the
 * `X-Requested-With: com.manga2020.app` header. These hosts currently serve
 * detail, chapter lists and chapter pages without the code 210 gate that
 * api.mangacopy.com applies to the platform=1 web channel.
 */
const HOT_API_HOSTS = [
  // IPv4-capable routes first; the server resolver prefers IPv4.
  "mapi.fgjfghkkcenter.club",
  "mapi.elfgjfghkk.club",
  "mapi.hotmangasd.com",
  "mapi.hotmangasg.com",
  "mapi.hotmangasf.com",
];
const HOT_API_VERSION = "2024.04.28";
const HOT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15; 23113RKC6C Build/AQ3A.240812.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36";

const PAGE_SIZE = 20;
const GROUP_PAGE_LIMIT = 100;
const MAX_CHAPTERS = 10_000;
const MAX_PAGES = 5_000;

const REQUEST_TIMEOUT_MS = 15_000;
const DETAIL_TTL = 5 * 60 * 1000;
const PAGES_TTL = 10 * 60 * 1000;
const HOST_TTL = 10 * 60 * 1000;
const CACHE_LIMIT = 100;

/** 61s / 30 requests, rounded up. */
const GROUP_INTERVAL_MS = 2_100;
/** 61s / 20 requests, rounded up. */
const CHAPTER_INTERVAL_MS = 3_100;

const SORT_VALUES = ["-popular", "-datetime_updated"];
const STATUS_VALUES = ["all", "finish"];

const FILTERS: FilterDef[] = [
  {
    key: "sort",
    label: "排序",
    type: "sort",
    options: [
      { label: "最热", value: "-popular" },
      { label: "最近更新", value: "-datetime_updated" },
    ],
    default: "-popular",
  },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: [
      { label: "全部", value: "all" },
      { label: "已完结", value: "finish" },
    ],
    default: "all",
  },
];

interface CopyMeta {
  value?: string | number;
  display?: string;
}

interface CopyAuthor {
  name?: string;
  path_word?: string;
}

interface CopyComic {
  uuid?: string;
  name?: string;
  alias?: string;
  path_word?: string;
  b_404?: boolean;
  b_hidden?: boolean;
  ban?: number | string;
  cover?: string;
  brief?: string;
  author?: CopyAuthor[];
  theme?: CopyAuthor[];
  parodies?: CopyAuthor[];
  status?: CopyMeta;
  region?: CopyMeta;
  free_type?: CopyMeta;
  datetime_updated?: string;
  last_chapter?: { uuid?: string; name?: string };
}

interface CopyGroup {
  path_word?: string;
  count?: number | string;
  name?: string;
}

interface CopyDetailResults {
  is_banned?: boolean;
  is_lock?: boolean;
  is_login?: boolean;
  is_vip?: boolean;
  comic?: CopyComic;
  popular?: number | string;
  groups?: Record<string, CopyGroup>;
}

interface CopyListResults {
  list?: CopyComic[];
  total?: number | string;
  limit?: number | string;
  offset?: number | string;
}

interface CopyChapterItem {
  uuid?: string;
  name?: string;
  index?: number | string;
  ordered?: number | string;
  size?: number | string;
  count?: number | string;
  datetime_created?: string;
}

interface CopyContent {
  url?: string;
}

interface CopyChapter extends CopyChapterItem {
  contents?: Array<CopyContent | string>;
  words?: Array<number | string>;
  is_long?: boolean;
}

interface CopyChapterResults {
  show_app?: boolean;
  is_banned?: boolean;
  is_lock?: boolean;
  is_login?: boolean;
  is_vip?: boolean;
  comic?: CopyComic;
  chapter?: CopyChapter;
}

interface CopyEnvelope {
  code?: number | string;
  message?: string;
  detail?: string;
  results?: unknown;
}

interface GroupInfo {
  pathWord: string;
  name: string;
  count: number;
}

interface Detail {
  manga: Manga;
  groups: GroupInfo[];
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

let activeHost: string | null = null;
let activeHostAt = 0;

/**
 * A host that times out or answers non-JSON is parked for a while instead of
 * costing every request a 15-second timeout. Mirrors the JMComic plugin and
 * jmcomic-crawler's "rank failing domains last" behaviour.
 */
interface HostHealth {
  failures: number;
  cooldownUntil: number;
}

const hostHealth = new Map<string, HostHealth>();
const HOST_COOLDOWN_BASE_MS = 20_000;
const HOST_COOLDOWN_MAX_MS = 5 * 60_000;

function healthOf(host: string): HostHealth {
  return hostHealth.get(host) ?? { failures: 0, cooldownUntil: 0 };
}

function isCoolingDown(host: string, now = Date.now()): boolean {
  return healthOf(host).cooldownUntil > now;
}

function markHostSuccess(host: string): void {
  hostHealth.set(host, { failures: 0, cooldownUntil: 0 });
}

function markHostFailure(host: string): void {
  const previous = healthOf(host);
  const failures = previous.failures + 1;
  const cooldown = Math.min(
    HOST_COOLDOWN_MAX_MS,
    HOST_COOLDOWN_BASE_MS * 2 ** (failures - 1),
  );
  hostHealth.set(host, {
    failures,
    cooldownUntil: Date.now() + cooldown,
  });
}

const detailCache = new Map<string, CacheEntry<Detail>>();
const detailInflight = new Map<string, Promise<Detail>>();
const pagesCache = new Map<string, CacheEntry<Page[]>>();
const pagesInflight = new Map<string, Promise<Page[]>>();

const paceGroup = createPacer(GROUP_INTERVAL_MS);
const paceChapter = createPacer(CHAPTER_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes request starts so a source's per-window limit is never exceeded.
 * A minimum interval is stricter than the equivalent sliding window for the
 * limits used here.
 */
function createPacer(intervalMs: number): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  let lastAt = 0;
  return () => {
    const run = tail.then(async () => {
      const wait = lastAt + intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
    });
    tail = run.catch(() => undefined);
    return run;
  };
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toInt(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.length > 0))];
}

function namesOf(value: unknown): string[] {
  return listOf<CopyAuthor>(value)
    .map((item) =>
      item && typeof item === "object" ? text(item.name) : "",
    )
    .filter(Boolean);
}

function normalizeHost(value: unknown): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    return url.host;
  } catch {
    return null;
  }
}

function absoluteUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  let candidate = raw;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (candidate.startsWith("/")) {
    candidate = `${WEB_BASE}${candidate}`;
  }
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  try {
    return new URL(candidate).href;
  } catch {
    return undefined;
  }
}

function toIsoDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function statusOf(meta: CopyMeta | undefined): MangaStatus {
  const display = text(meta?.display);
  if (/完(結|结)/.test(display)) return "completed";
  if (/連載|连载/.test(display)) return "ongoing";
  if (/休/.test(display)) return "hiatus";
  if (/腰斬|腰斩|中斷|中断/.test(display)) return "cancelled";
  switch (toInt(meta?.value)) {
    case 0:
      return "ongoing";
    case 1:
      return "completed";
    default:
      return "unknown";
  }
}

type Channel = "hot" | "1" | "3";

function channelOf(ctx: PluginContext): Channel {
  const value = text(ctx.config.channel);
  return value === "1" || value === "3" ? value : "hot";
}

function platformOf(ctx: PluginContext): string {
  return channelOf(ctx) === "hot" ? "3" : channelOf(ctx);
}

function versionOf(ctx: PluginContext): string {
  const configured = text(ctx.config.appVersion).replace(/^COPY\//i, "");
  if (configured) return configured;
  const channel = channelOf(ctx);
  if (channel === "hot") return HOT_API_VERSION;
  return channel === "3" ? DEFAULT_APP_VERSION : FREE_API_VERSION;
}

function tokenOf(ctx: PluginContext): string {
  return text(ctx.config.token)
    .replace(/^token\s+/i, "")
    .trim();
}

function regionOf(ctx: PluginContext): string {
  return text(ctx.config.region) === "0" ? "0" : "1";
}

function imageUserAgent(ctx: PluginContext): string {
  return text(ctx.config.imageUserAgent) || DEFAULT_IMAGE_USER_AGENT;
}

function requestHeaders(ctx: PluginContext): Record<string, string> {
  const channel = channelOf(ctx);
  const version = versionOf(ctx);
  const token = tokenOf(ctx);

  if (channel === "hot") {
    const headers: Record<string, string> = {
      "user-agent": HOT_USER_AGENT,
      accept: "application/json",
      platform: "3",
      version,
      "x-requested-with": "com.manga2020.app",
      webp: "1",
    };
    if (token) headers.authorization = `Token ${token}`;
    return headers;
  }

  const headers: Record<string, string> = {
    "user-agent": channel === "3" ? `COPY/${version}` : FREE_USER_AGENT,
    accept: "application/json",
    version,
    platform: channel,
    region: regionOf(ctx),
    webp: "1",
  };

  if (channel === "3") {
    headers.source = "copyApp";
    headers.referer = `com.copymanga.app-${version}`;
    headers.authorization = `Token ${token}`;
  } else if (token) {
    headers.authorization = `Token ${token}`;
  }

  return headers;
}

function candidateHosts(ctx: PluginContext): string[] {
  const configured = normalizeHost(ctx.config.apiDomain);
  if (configured) return [configured];

  const defaults = channelOf(ctx) === "hot" ? HOT_API_HOSTS : DEFAULT_API_HOSTS;
  const now = Date.now();
  const ranked = [...defaults].sort((a, b) => {
    const coolingA = isCoolingDown(a, now) ? 1 : 0;
    const coolingB = isCoolingDown(b, now) ? 1 : 0;
    if (coolingA !== coolingB) return coolingA - coolingB;
    return healthOf(a).failures - healthOf(b).failures;
  });

  const hosts: string[] = [];
  if (
    activeHost &&
    defaults.includes(activeHost) &&
    now - activeHostAt < HOST_TTL &&
    !isCoolingDown(activeHost, now)
  ) {
    hosts.push(activeHost);
  }
  for (const host of ranked) {
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttl: number,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
): void {
  cache.set(key, { value, at: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function request(
  ctx: PluginContext,
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    return await ctx.fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (ctx.signal.aborted) {
      throw new PluginError("cancelled", "请求已取消", { cause: error });
    }
    const name = (error as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new PluginError("timeout", "请求拷贝漫画超时", { cause: error });
    }
    throw new PluginError("network", "无法连接拷贝漫画", { cause: error });
  }
}

function emptyResultsMessage(ctx: PluginContext, host: string): PluginError {
  const hint =
    channelOf(ctx) === "3"
      ? "App 通道通常需要官方 App 签名；请在插件设置里改用网页通道。"
      : "可能触发了风控，或该内容不可用；稍后重试或更换 API 域名。";
  return new PluginError(
    "unsupported",
    `拷贝漫画返回了空数据（${host}，platform=${platformOf(ctx)}）。${hint}`,
  );
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    const envelope = JSON.parse(body) as CopyEnvelope;
    const results = envelope.results;
    const detail =
      results && typeof results === "object"
        ? text((results as { detail?: unknown }).detail)
        : "";
    return (
      text(envelope.message) ||
      detail ||
      text(envelope.detail) ||
      `HTTP ${response.status}`
    );
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function rawGet(
  host: string,
  path: string,
  ctx: PluginContext,
): Promise<unknown> {
  const response = await request(
    ctx,
    `https://${host}${path}`,
    requestHeaders(ctx),
  );

  if (response.status === 401 || response.status === 403) {
    throw new PluginError(
      "auth_required",
      "拷贝漫画要求登录，请在插件设置中填写登录 Token",
    );
  }
  if (response.status === 429) {
    throw new PluginError("rate_limited", "拷贝漫画请求过于频繁");
  }
  if (response.status === 404) {
    throw new PluginError("not_found", "拷贝漫画未找到该资源");
  }
  // The service uses a non-standard HTTP 210 for its anti-abuse / version gate.
  if (response.status === 210) {
    const message = await responseMessage(response);
    throw new PluginError(
      "rate_limited",
      `拷贝漫画限制了本次访问（HTTP 210）：${message}` +
        " 通常等待约 1 小时后自动解除，也可以更换网络或 API 域名。",
    );
  }
  if (!response.ok) {
    throw new PluginError(
      "network",
      `拷贝漫画 ${host} 返回 HTTP ${response.status}`,
    );
  }

  const body = await response.text();
  let envelope: CopyEnvelope;
  try {
    envelope = JSON.parse(body) as CopyEnvelope;
  } catch (error) {
    throw new PluginError(
      "network",
      `拷贝漫画 ${host} 返回了非 JSON 响应，域名可能失效或正在维护`,
      { cause: error },
    );
  }

  const code = Number(envelope.code ?? 200);
  if (code !== 200) {
    const message =
      text(envelope.message) ||
      text(envelope.detail) ||
      `错误码 ${code}`;
    if (code === 401 || code === 403) {
      throw new PluginError("auth_required", message);
    }
    if (code === 404) {
      throw new PluginError("not_found", message);
    }
    if (code === 210) {
      throw new PluginError(
        "rate_limited",
        `拷贝漫画拒绝了请求（code 210）：${message}` +
          " 通常等待约 1 小时后自动解除，也可以更换网络或 API 域名。",
      );
    }
    if (code >= 500) {
      throw new PluginError("network", `拷贝漫画返回错误码 ${code}：${message}`);
    }
    throw new PluginError("unknown", message);
  }

  if (envelope.results === null || envelope.results === undefined) {
    throw emptyResultsMessage(ctx, host);
  }
  return envelope.results;
}

async function apiGet<T>(path: string, ctx: PluginContext): Promise<T> {
  const hosts = candidateHosts(ctx);
  let lastError: unknown;

  for (const host of hosts) {
    try {
      const results = await rawGet(host, path, ctx);
      markHostSuccess(host);
      if (!normalizeHost(ctx.config.apiDomain)) {
        activeHost = host;
        activeHostAt = Date.now();
      }
      return results as T;
    } catch (error) {
      if (
        error instanceof PluginError &&
        (error.code === "network" || error.code === "timeout")
      ) {
        markHostFailure(host);
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof PluginError
    ? lastError
    : new PluginError("network", "无法连接拷贝漫画 API");
}

function mapManga(comic: CopyComic | undefined, chapterCount?: number): Manga | null {
  if (!comic) return null;
  const id = text(comic.path_word);
  const title = text(comic.name);
  if (!id || !title) return null;

  const altTitles = dedupe([text(comic.alias)]).filter(
    (item) => item !== title,
  );
  const coverUrl = absoluteUrl(comic.cover);
  const description = text(comic.brief);
  const authors = dedupe(namesOf(comic.author));
  const genres = dedupe([
    ...namesOf(comic.theme),
    ...namesOf(comic.parodies),
  ])
    .filter((item) => item.length <= 200)
    .slice(0, 200);
  const status = statusOf(comic.status);
  const updatedAt = toIsoDate(comic.datetime_updated);

  return {
    id,
    title,
    ...(altTitles.length > 0 ? { altTitles } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(description ? { description } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(genres.length > 0 ? { genres } : {}),
    ...(status !== "unknown" ? { status } : {}),
    ...(chapterCount !== undefined && chapterCount > 0
      ? { chapterCount }
      : {}),
    ...(updatedAt ? { updatedAt } : {}),
    url: `${WEB_BASE}/comic/${encodeURIComponent(id)}`,
  };
}

function mapGroups(value: unknown): GroupInfo[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const groups: GroupInfo[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const group = raw as CopyGroup;
    const pathWord = text(group.path_word) || key;
    if (!pathWord) continue;
    groups.push({
      pathWord,
      name: text(group.name) || pathWord,
      count: Math.max(0, toInt(group.count)),
    });
  }
  return groups;
}

function mapListResult(
  result: CopyListResults,
  page: number,
): PagedResult<Manga> {
  const raw = listOf<CopyComic>(result.list);
  const items = raw
    .map((item) => mapManga(item))
    .filter((item): item is Manga => item !== null)
    .slice(0, 100);
  const total = toInt(result.total);
  const offset = (page - 1) * PAGE_SIZE;

  return {
    items,
    page,
    hasNextPage:
      total > 0 ? offset + raw.length < total : raw.length >= PAGE_SIZE,
    ...(total > 0 ? { total } : {}),
  };
}

function pickFilter(
  filters: FilterValues | undefined,
  key: string,
  allowed: string[],
  fallback: string,
): string {
  const value = filters?.[key];
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}

const WEB_HTML_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

/**
 * The web channel's detail endpoint can answer `code 210` (anti-abuse gate),
 * while the server-rendered comic page still has title, cover, synopsis,
 * authors and tags. Use it as a read-only fallback so the detail page is not
 * empty while the API block is in effect. Chapters still come from the API.
 */
async function fetchWebMeta(
  mangaId: string,
  ctx: PluginContext,
): Promise<Manga | null> {
  const response = await request(
    ctx,
    `${WEB_BASE}/comic/${encodeURIComponent(mangaId)}`,
    {
      "user-agent": WEB_HTML_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  );
  if (!response.ok) return null;

  const html = await response.text();
  const pick = (pattern: RegExp): string => pattern.exec(html)?.[1] ?? "";
  const title = decodeHtml(pick(/<h6[^>]*title="([^"]*)"/));
  if (!title) return null;

  const cover = absoluteUrl(pick(/<img[^>]+data-src="([^"]+)"/));
  const description = decodeHtml(
    pick(/<p class="intro"[^>]*>([\s\S]*?)<\/p>/),
  );
  const aliasText = decodeHtml(
    pick(/別名：<\/span>\s*<p[^>]*>([\s\S]*?)<\/p>/),
  );
  const authorBlock = pick(
    /作者：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/,
  );
  const statusText = decodeHtml(
    pick(/狀態：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/),
  );
  const themeBlock = pick(
    /題材：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/,
  );
  const updated = pick(/最後更新：<\/span>\s*<span[^>]*>([^<]+)<\/span>/);

  const altTitles = dedupe(
    aliasText
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ).filter((item) => item !== title);
  const authors = dedupe(
    [...authorBlock.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((match) =>
      decodeHtml(match[1] ?? ""),
    ),
  );
  const genres = dedupe(
    [...themeBlock.matchAll(/#([^<]+)/g)].map((match) =>
      decodeHtml(match[1] ?? ""),
    ),
  ).filter((item) => item.length <= 200);
  const status = statusOf({ display: statusText });
  const updatedAt = toIsoDate(updated);

  return {
    id: mangaId,
    title,
    ...(altTitles.length > 0 ? { altTitles } : {}),
    ...(cover ? { coverUrl: cover } : {}),
    ...(description ? { description } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(genres.length > 0 ? { genres } : {}),
    ...(status !== "unknown" ? { status } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    url: `${WEB_BASE}/comic/${encodeURIComponent(mangaId)}`,
  };
}

async function loadDetail(
  mangaId: string,
  ctx: PluginContext,
): Promise<Detail> {
  const results = await apiGet<CopyDetailResults>(
    `/api/v3/comic2/${encodeURIComponent(mangaId)}?platform=${platformOf(ctx)}`,
    ctx,
  );

  if (results.is_banned) {
    throw new PluginError("not_found", `漫画 ${mangaId} 已下架`);
  }
  const comic = results.comic;
  if (!comic || comic.b_404 || comic.b_hidden) {
    throw new PluginError("not_found", `未找到漫画 ${mangaId}`);
  }

  const groups = mapGroups(results.groups);
  const chapterCount = groups.reduce(
    (sum, group) => sum + group.count,
    0,
  );
  const manga = mapManga(comic, chapterCount);
  if (!manga) {
    throw new PluginError("not_found", `未找到漫画 ${mangaId}`);
  }
  return { manga, groups };
}

function fetchDetail(
  mangaId: string,
  ctx: PluginContext,
): Promise<Detail> {
  const key = `${channelOf(ctx)}:${mangaId}`;
  const cached = readCache(detailCache, key, DETAIL_TTL);
  if (cached) return Promise.resolve(cached);

  const pending = detailInflight.get(key);
  if (pending) return pending;

  const promise = loadDetail(mangaId, ctx)
    .then((detail) => {
      writeCache(detailCache, key, detail);
      return detail;
    })
    .finally(() => {
      detailInflight.delete(key);
    });
  detailInflight.set(key, promise);
  return promise;
}

async function fetchGroupChapters(
  mangaId: string,
  group: GroupInfo,
  ctx: PluginContext,
): Promise<CopyChapterItem[]> {
  const chapters: CopyChapterItem[] = [];
  let offset = 0;
  const fetchPage = (pageOffset: number) =>
    apiGet<CopyListResults>(
      `/api/v3/comic/${encodeURIComponent(mangaId)}/group/` +
        `${encodeURIComponent(group.pathWord)}/chapters` +
        `?limit=${GROUP_PAGE_LIMIT}&offset=${pageOffset}` +
        `&platform=${platformOf(ctx)}`,
      ctx,
    );

  // HotManga/Kira has no per-window chapter limit. Fetch the first page to
  // learn `total`, then load the remaining pages in parallel.
  if (channelOf(ctx) === "hot") {
    const first = await fetchPage(0);
    const firstItems = listOf<CopyChapterItem>(first.list);
    const total = toInt(first.total);
    if (total > GROUP_PAGE_LIMIT) {
      const pageCount = Math.min(
        Math.ceil(total / GROUP_PAGE_LIMIT),
        20,
      );
      const rest = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) =>
          fetchPage((index + 1) * GROUP_PAGE_LIMIT),
        ),
      );
      return [
        ...firstItems,
        ...rest.flatMap((result) => listOf<CopyChapterItem>(result.list)),
      ].slice(0, MAX_CHAPTERS);
    }
    if (total > 0 || firstItems.length < GROUP_PAGE_LIMIT) {
      return firstItems.slice(0, MAX_CHAPTERS);
    }
    // Total is unknown and the first page was full: continue with the
    // sequential fallback below.
    chapters.push(...firstItems);
    offset = firstItems.length;
  }

  for (let round = 0; round < 20; round += 1) {
    if (channelOf(ctx) !== "hot") await paceGroup();
    const result = await fetchPage(offset);
    const items = listOf<CopyChapterItem>(result.list);
    chapters.push(...items);
    offset += items.length;

    if (items.length === 0) break;
    if (chapters.length >= MAX_CHAPTERS) break;
    const total = toInt(result.total);
    if (total > 0) {
      if (offset >= total) break;
    } else if (items.length < GROUP_PAGE_LIMIT) {
      break;
    }
  }

  return chapters.slice(0, MAX_CHAPTERS);
}

function sortContents(chapter: CopyChapter): string[] {
  const raw = listOf<CopyContent | string>(chapter.contents);
  const words = listOf<number | string>(chapter.words).map((value) =>
    Number(value),
  );
  const pairs: Array<{ url: string; order: number | undefined }> = [];

  for (const [index, item] of raw.entries()) {
    const url = absoluteUrl(
      typeof item === "string" ? item : item?.url,
    );
    if (!url) continue;
    const order = words[index];
    pairs.push({
      url,
      order: Number.isFinite(order) ? order : undefined,
    });
  }

  const canSort =
    pairs.length === raw.length &&
    pairs.length > 0 &&
    pairs.every((pair) => pair.order !== undefined);
  if (canSort) {
    const orders = pairs.map((pair) => pair.order as number);
    const sorted = [...orders].sort((a, b) => a - b);
    if (sorted.every((value, index) => value === index)) {
      pairs.sort((a, b) => (a.order as number) - (b.order as number));
    }
  }

  return pairs.map((pair) => pair.url);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
};

function mimeTypeOf(url: string): string | undefined {
  try {
    const match = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname);
    return match ? MIME_BY_EXTENSION[match[1]!.toLowerCase()] : undefined;
  } catch {
    return undefined;
  }
}

async function loadPages(
  mangaId: string,
  chapterId: string,
  ctx: PluginContext,
): Promise<Page[]> {
  if (channelOf(ctx) !== "hot") await paceChapter();
  // Kira reads chapters through /chapter/ on the HotManga host; the legacy
  // CopyManga host uses /chapter2/.
  const chapterPath = channelOf(ctx) === "hot" ? "chapter" : "chapter2";
  const results = await apiGet<CopyChapterResults>(
    `/api/v3/comic/${encodeURIComponent(mangaId)}/${chapterPath}/` +
      `${encodeURIComponent(chapterId)}?platform=${platformOf(ctx)}`,
    ctx,
  );

  if (results.show_app) {
    throw new PluginError(
      "unsupported",
      "该章节只能在拷贝漫画 App 内阅读，插件无法获取图片。",
    );
  }
  if (results.is_banned) {
    throw new PluginError("not_found", "该章节已下架");
  }

  const chapter = results.chapter;
  if (!chapter) {
    throw new PluginError("not_found", `未找到章节 ${chapterId}`);
  }

  const urls = sortContents(chapter);
  if (urls.length === 0) {
    if (results.is_lock || results.is_vip || results.is_login) {
      throw new PluginError(
        "auth_required",
        "该章节需要登录、解锁或付费后才能阅读",
      );
    }
    throw new PluginError("not_found", `章节 ${chapterId} 没有可用图片`);
  }

  const userAgent = imageUserAgent(ctx);
  const isLong = Boolean(chapter.is_long);
  return urls.slice(0, MAX_PAGES).map(
    (url): Page => ({
      url,
      mimeType: mimeTypeOf(url),
      headers: { "user-agent": userAgent },
      ...(isLong ? { transform: { type: "band-reverse", bands: 10 } } : {}),
    }),
  );
}

function fetchPages(
  mangaId: string,
  chapterId: string,
  ctx: PluginContext,
): Promise<Page[]> {
  const key = `${channelOf(ctx)}:${mangaId}/${chapterId}`;
  const cached = readCache(pagesCache, key, PAGES_TTL);
  if (cached) return Promise.resolve(cached);

  const pending = pagesInflight.get(key);
  if (pending) return pending;

  const promise = loadPages(mangaId, chapterId, ctx)
    .then((pages) => {
      writeCache(pagesCache, key, pages);
      return pages;
    })
    .finally(() => {
      pagesInflight.delete(key);
    });
  pagesInflight.set(key, promise);
  return promise;
}

async function browseImpl(
  query: BrowseQuery,
  ctx: PluginContext,
): Promise<PagedResult<Manga>> {
  const page = Math.max(1, Math.trunc(query.page));
  const sort = pickFilter(
    query.filters,
    "sort",
    SORT_VALUES,
    "-popular",
  );
  const status = pickFilter(
    query.filters,
    "status",
    STATUS_VALUES,
    "all",
  );
  const offset = (page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    free_type: "1",
    ordering: sort,
    platform: platformOf(ctx),
  });
  if (status === "finish") params.set("top", "finish");

  const result = await apiGet<CopyListResults>(
    `/api/v3/comics?${params.toString()}`,
    ctx,
  );
  return mapListResult(result, page);
}

async function searchImpl(
  query: SearchQuery,
  ctx: PluginContext,
): Promise<PagedResult<Manga>> {
  const page = Math.max(1, Math.trunc(query.page));
  const term = query.term.trim();
  if (!term) {
    return browseImpl({ page, filters: query.filters }, ctx);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    q: term,
    q_type: "",
    platform: platformOf(ctx),
  });
  if (channelOf(ctx) === "hot") {
    params.set("free_type", "1");
    params.set("_update", "true");
  }
  const result = await apiGet<CopyListResults>(
    `/api/v3/search/comic?${params.toString()}`,
    ctx,
  );
  return mapListResult(result, page);
}

const plugin: MangaPlugin = {
  search: searchImpl,

  browse: browseImpl,

  async getFilters() {
    return FILTERS;
  },

  async getManga(mangaId, ctx) {
    try {
      const detail = await fetchDetail(mangaId, ctx);
      return detail.manga;
    } catch (error) {
      if (
        error instanceof PluginError &&
        (error.code === "rate_limited" || error.code === "unsupported")
      ) {
        const fallback = await fetchWebMeta(mangaId, ctx).catch(() => null);
        if (fallback) return fallback;
      }
      throw error;
    }
  },

  async getChapters(mangaId, ctx) {
    const detail = await fetchDetail(mangaId, ctx);
    const groups =
      detail.groups.length > 0
        ? detail.groups
        : [{ pathWord: "default", name: "默认", count: 0 }];
    const includeGroup = groups.length > 1;
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const activeGroups = groups.filter((group) => group.count > 0);

    // The HotManga route has no per-window chapter limit, so fetch groups in
    // parallel (Kira does the same). The legacy CopyManga route keeps its
    // paced sequential path.
    const groupItems: CopyChapterItem[][] = [];
    if (channelOf(ctx) === "hot") {
      groupItems.push(
        ...(await Promise.all(
          activeGroups.map((group) =>
            fetchGroupChapters(mangaId, group, ctx),
          ),
        )),
      );
    } else {
      for (const group of activeGroups) {
        groupItems.push(await fetchGroupChapters(mangaId, group, ctx));
      }
    }

    for (const [groupIndex, group] of activeGroups.entries()) {
      const items = groupItems[groupIndex] ?? [];
      // `index` is the source's 0-based chapter order; keep it stable even if
      // the API ever returns a page newest-first.
      items.sort((a, b) => {
        const aIndex = Number(a.index);
        const bIndex = Number(b.index);
        return Number.isFinite(aIndex) && Number.isFinite(bIndex)
          ? aIndex - bIndex
          : 0;
      });

      for (const [index, item] of items.entries()) {
        const id = text(item.uuid);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const pageCount = toInt(item.size);
        const publishedAt = toIsoDate(item.datetime_created);
        chapters.push({
          id,
          title: text(item.name) || `第 ${index + 1} 话`,
          // The reader sorts by number. Group indexes restart at 0, so use the
          // combined position to keep multi-group lists in source order.
          number: chapters.length + 1,
          ...(includeGroup ? { group: group.name } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          ...(pageCount > 0 ? { pageCount } : {}),
        });

        if (chapters.length >= MAX_CHAPTERS) break;
      }
      if (chapters.length >= MAX_CHAPTERS) break;
    }

    if (chapters.length === 0) {
      throw new PluginError(
        "not_found",
        `《${detail.manga.title}》没有可读章节`,
      );
    }
    return chapters;
  },

  async getPages(mangaId, chapterId, ctx) {
    return fetchPages(mangaId, chapterId, ctx);
  },

  async pullAccount(ctx) {
    if (!ctx.openAccountSession) {
      throw new PluginError(
        "unsupported",
        "当前环境不能打开网站窗口。请用 ComicSpace 桌面版点击同步，在弹出的网页里登录拷贝漫画。软件不会读取密码，也不会写回网站。",
      );
    }
    const session = await ctx.openAccountSession();
    try {
      let rendered: Awaited<ReturnType<typeof readRenderedAccount>>;
      try {
        rendered = await readRenderedAccount(session);
      } catch (error) {
        if (error instanceof AccountFlowError) {
          throw new PluginError(
            error.code === "auth_required" ? "auth_required" : "parse_error",
            error.message,
          );
        }
        throw error;
      }
      return cardsToSnapshot(rendered.favorites, rendered.history, async (pathWord) => {
        const chapters = await this.getChapters(pathWord, ctx);
        return chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
        }));
      });
    } finally {
      await session.close();
    }
  },
};

export default plugin;
