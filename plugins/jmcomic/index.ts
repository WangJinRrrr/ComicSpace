import { createDecipheriv, createHash } from "node:crypto";
import {
  PluginError,
  type BrowseQuery,
  type Chapter,
  type FilterDef,
  type FilterValues,
  type ImageTransform,
  type Manga,
  type MangaPlugin,
  type Page,
  type PagedResult,
  type PluginContext,
  type SearchQuery,
} from "@comicspace/plugin-sdk";

/**
 * JMComic source adapter.
 *
 * JMComic's mobile API signs every request with an MD5 token and encrypts the
 * response body with AES-ECB. This file reimplements the protocol used by
 * JUKOMU/JMComic-Api-Java; no Java runtime or companion service is needed.
 *
 * Chapter images are stored as vertically reordered bands. `getPages()` tells
 * the ComicSpace image proxy how to restore them through `Page.transform`.
 */

const APP_TOKEN_SECRET = "18comicAPP";
const APP_TOKEN_SECRET_2 = "18comicAPPContent";
const APP_DATA_SECRET = "185Hcomic3PAPP7R";
const DOMAIN_SECRET = "diosfjckwpqpdfjkvnqQjsik";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36";

const DEFAULT_API_DOMAINS = [
  // Current routes used by jmcomic-next's Android fallback list. They answer
  // quickly with an IPv4-first resolver; the older cdnaspa hosts often time out.
  "www.cdngwc.net",
  "www.cdngwc.club",
  "www.cdnhjk.net",
  "www.cdngwc.cc",
  "www.cdnaspa.vip",
  "www.cdnaspa.club",
  "www.cdnplaystation6.org",
  "www.cdnplaystation6.vip",
  "www.cdnplaystation6.cc",
];

const DEFAULT_IMAGE_DOMAINS = [
  // /setting currently advertises cdn-msp.jmapiproxy3.cc; the HTML chapter
  // template advertises cdn-msp3.jmapiproxy3.cc. The older jmapiproxy1/2 hosts
  // are kept as fallbacks.
  "cdn-msp.jmapiproxy3.cc",
  "cdn-msp3.jmapiproxy3.cc",
  "cdn-msp.jmapiproxy1.cc",
  "cdn-msp.jmapiproxy2.cc",
  "cdn-msp2.jmapiproxy2.cc",
  "cdn-msp3.jmapiproxy2.cc",
  "cdn-msp.jmapinodeudzn.net",
  "cdn-msp3.jmapinodeudzn.net",
];

const DOMAIN_SERVERS = [
  "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
  "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
];

const IMAGE_HOST_SUFFIXES = [
  ".jmapiproxy1.cc",
  ".jmapiproxy2.cc",
  ".jmapiproxy3.cc",
  ".jmapinodeudzn.net",
];

const PAGE_SIZE = 80;
const SESSION_TTL = 10 * 60 * 1000;
const ALBUM_TTL = 2 * 60 * 1000;
const DEFAULT_SCRAMBLE_ID = 220980;

const SORT_VALUES = ["mr", "mv", "mp", "tf"];
const TIME_VALUES = ["a", "t", "w", "m"];
const CATEGORY_VALUES = [
  "0",
  "doujin",
  "single",
  "short",
  "another",
  "hanman",
  "meiman",
  "doujin_cosplay",
  "3D",
];

const FILTERS: FilterDef[] = [
  {
    key: "category",
    label: "分类",
    type: "select",
    options: [
      { label: "全部", value: "0" },
      { label: "同人", value: "doujin" },
      { label: "单本", value: "single" },
      { label: "短篇", value: "short" },
      { label: "其他", value: "another" },
      { label: "韩漫", value: "hanman" },
      { label: "美漫", value: "meiman" },
      { label: "cosplay", value: "doujin_cosplay" },
      { label: "3D", value: "3D" },
    ],
    default: "0",
  },
  {
    key: "sort",
    label: "排序",
    type: "sort",
    options: [
      { label: "最新", value: "mr" },
      { label: "最多观看", value: "mv" },
      { label: "图片最多", value: "mp" },
      { label: "最多喜欢", value: "tf" },
    ],
    default: "mr",
  },
  {
    key: "time",
    label: "时间",
    type: "select",
    options: [
      { label: "全部时间", value: "a" },
      { label: "今日", value: "t" },
      { label: "本周", value: "w" },
      { label: "本月", value: "m" },
    ],
    default: "a",
  },
];

interface JmCategoryMeta {
  id?: string;
  title?: string;
}

interface JmAlbumMeta {
  id?: string | number;
  name?: string;
  title?: string;
  author?: string | string[];
  image?: string;
  description?: string;
  tags?: string[];
  category?: JmCategoryMeta;
  category_sub?: JmCategoryMeta;
}

interface JmSeriesItem {
  id?: string | number;
  name?: string;
  sort?: number | string;
}

interface JmAlbum extends JmAlbumMeta {
  addtime?: string | number;
  series?: JmSeriesItem[];
  series_id?: string | number;
}

interface JmPhoto {
  id?: string | number;
  name?: string;
  images?: unknown[];
  error?: string;
}

interface JmSearchResult {
  total?: number | string;
  content?: JmAlbumMeta[];
  redirect_aid?: string | number;
}

let sessionDomain: string | null = null;
let sessionImageHost: string | null = null;
let sessionAt = 0;
let settingAt = 0;
let discovery: Promise<string> | null = null;
const albumCache = new Map<string, { album: JmAlbum; at: number }>();

/**
 * Domain health. A host that timed out once should not keep being the first
 * candidate for every request: put it in exponential cooldown and prefer hosts
 * that answered recently. This mirrors jmcomic-crawler's "retry the same
 * domain, then rotate, and rank failing domains last" strategy.
 */
interface HostHealth {
  failures: number;
  cooldownUntil: number;
  latencyMs: number | null;
}

const hostHealth = new Map<string, HostHealth>();
const HOST_COOLDOWN_BASE_MS = 20_000;
const HOST_COOLDOWN_MAX_MS = 5 * 60_000;

function healthOf(host: string): HostHealth {
  return (
    hostHealth.get(host) ?? { failures: 0, cooldownUntil: 0, latencyMs: null }
  );
}

function markHostSuccess(host: string, latencyMs?: number): void {
  const previous = healthOf(host);
  hostHealth.set(host, {
    failures: 0,
    cooldownUntil: 0,
    latencyMs: latencyMs ?? previous.latencyMs,
  });
}

function markHostFailure(host: string): void {
  const previous = healthOf(host);
  const failures = previous.failures + 1;
  const cooldown = Math.min(
    HOST_COOLDOWN_MAX_MS,
    HOST_COOLDOWN_BASE_MS * 2 ** (failures - 1),
  );
  hostHealth.set(host, {
    ...previous,
    failures,
    cooldownUntil: Date.now() + cooldown,
  });
}

function isCoolingDown(host: string, now = Date.now()): boolean {
  return healthOf(host).cooldownUntil > now;
}

/** Healthy hosts first, then fewer failures, then lower latency. */
function rankHosts(hosts: string[]): string[] {
  const order = new Map(hosts.map((host, index) => [host, index]));
  const now = Date.now();
  return [...hosts].sort((a, b) => {
    const healthA = healthOf(a);
    const healthB = healthOf(b);
    const coolingA = healthA.cooldownUntil > now ? 1 : 0;
    const coolingB = healthB.cooldownUntil > now ? 1 : 0;
    if (coolingA !== coolingB) return coolingA - coolingB;
    if (healthA.failures !== healthB.failures) {
      return healthA.failures - healthB.failures;
    }
    const latencyA = healthA.latencyMs ?? Number.POSITIVE_INFINITY;
    const latencyB = healthB.latencyMs ?? Number.POSITIVE_INFINITY;
    if (latencyA !== latencyB) return latencyA - latencyB;
    return (order.get(a) ?? 0) - (order.get(b) ?? 0);
  });
}

/**
 * Image CDNs are independent mirrors. The first open of a chapter trusts the
 * host advertised by the chapter template; when the reader asks for the page
 * list again (its recovery path after image failures) rotate to another
 * mirror instead of handing back the same dead URLs.
 */
const chapterImageCursor = new Map<string, number>();
const MAX_CHAPTER_CURSORS = 200;

function imageHostFor(
  ctx: PluginContext,
  chapterId: string,
): { host: string; preferTemplateHost: boolean } {
  const configured = normalizeHost(ctx.config.imageDomain);
  if (configured) return { host: configured, preferTemplateHost: true };
  if (sessionImageHost) {
    return { host: sessionImageHost, preferTemplateHost: true };
  }

  const attempt = chapterImageCursor.get(chapterId) ?? 0;
  chapterImageCursor.set(chapterId, attempt + 1);
  if (chapterImageCursor.size > MAX_CHAPTER_CURSORS) {
    const oldest = chapterImageCursor.keys().next().value;
    if (oldest !== undefined) chapterImageCursor.delete(oldest);
  }
  const host =
    DEFAULT_IMAGE_DOMAINS[attempt % DEFAULT_IMAGE_DOMAINS.length] ??
    DEFAULT_IMAGE_DOMAINS[0] ??
    "";
  return { host, preferTemplateHost: attempt === 0 };
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function decrypt(
  encoded: string,
  timestamp: string,
  secret: string,
): string | null {
  if (!encoded || encoded === "[]") return null;
  const key = Buffer.from(md5(timestamp + secret), "utf8");
  try {
    const decipher = createDecipheriv("aes-256-ecb", key, null);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encoded, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch (error) {
    throw new PluginError("parse_error", "无法解密 JMComic 的响应", {
      cause: error,
    });
  }
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** JMComic prefixes some payloads with non-ASCII noise. */
function stripLeadingNonAscii(value: string): string {
  let index = 0;
  while (index < value.length && value.charCodeAt(index) > 127) index += 1;
  return value.slice(index).trim();
}

function strings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toInt(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
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

function isKnownImageHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return IMAGE_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function cookieHeader(ctx: PluginContext): Record<string, string> {
  const cookie = text(ctx.config.cookie);
  return cookie ? { cookie } : {};
}

function photoBase(ctx: PluginContext): string {
  const configured = normalizeHost(ctx.config.imageDomain);
  const host = configured ?? sessionImageHost ?? DEFAULT_IMAGE_DOMAINS[0];
  return `https://${host}`;
}

/**
 * Covers live on the photo CDN. Skip the dynamic `img_host` here: it changes
 * often and some hosts serve photos but not album covers.
 */
function coverBase(ctx: PluginContext): string {
  return photoBase(ctx);
}

async function request(
  ctx: PluginContext,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await ctx.fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(timeoutMs),
      ]),
    });
  } catch (error) {
    if (ctx.signal.aborted) {
      throw new PluginError("cancelled", "请求已取消", { cause: error });
    }
    const name = (error as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new PluginError("timeout", "请求 JMComic 超时", { cause: error });
    }
    throw new PluginError("network", "无法连接 JMComic", { cause: error });
  }
}

async function rawApiGet<T>(
  domain: string,
  path: string,
  secret: string,
  ctx: PluginContext,
  timeoutMs = 15_000,
): Promise<T> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = md5(timestamp + secret);
  const url = `https://${domain}/${path.replace(/^\/+/, "")}`;
  const response = await request(
    ctx,
    url,
    {
      token,
      tokenparam: `${timestamp},`,
      "user-agent": MOBILE_UA,
      accept: "application/json, text/plain, */*",
      ...cookieHeader(ctx),
    },
    timeoutMs,
  );

  if (response.status === 401 || response.status === 403) {
    throw new PluginError(
      "auth_required",
      "JMComic 要求登录，请在插件设置中填写登录 Cookie",
    );
  }
  if (response.status === 429) {
    throw new PluginError("rate_limited", "JMComic 请求过于频繁");
  }
  if (!response.ok) {
    throw new PluginError("network", `JMComic 返回 HTTP ${response.status}`);
  }

  const body = await response.text();
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(body) as Record<string, unknown>;
  } catch (error) {
    throw new PluginError(
      "parse_error",
      "JMComic 返回了非 JSON 响应，域名可能已失效或触发了验证",
      { cause: error },
    );
  }

  const code = Number(envelope.code ?? 200);
  if (code !== 200) {
    const message =
      text(envelope.message) ||
      text(envelope.msg) ||
      text(envelope.error) ||
      `错误码 ${code}`;
    throw new PluginError(
      code === 401 || code === 403 ? "auth_required" : "unknown",
      message,
    );
  }
  if (text(envelope.error)) {
    throw new PluginError("unsupported", text(envelope.error));
  }

  const encoded = typeof envelope.data === "string" ? envelope.data : "";
  const decoded = decrypt(encoded, timestamp, APP_DATA_SECRET);
  if (decoded === null) return { id: -1 } as T;
  try {
    return JSON.parse(decoded) as T;
  } catch (error) {
    throw new PluginError("parse_error", "无法解析 JMComic 的响应数据", {
      cause: error,
    });
  }
}

async function loadSetting(
  domain: string,
  ctx: PluginContext,
): Promise<void> {
  settingAt = Date.now();
  const startedAt = Date.now();
  let setting: Record<string, unknown>;
  try {
    setting = await rawApiGet<Record<string, unknown>>(
      domain,
      "setting",
      APP_TOKEN_SECRET,
      ctx,
      3_000,
    );
  } catch (error) {
    markHostFailure(domain);
    throw error;
  }
  markHostSuccess(domain, Date.now() - startedAt);
  const host = normalizeHost(setting.img_host);
  if (host && isKnownImageHost(host)) {
    sessionImageHost = host;
  }
  sessionAt = Date.now();
}

async function discoverFromDomainServers(
  ctx: PluginContext,
): Promise<string[]> {
  const results = await Promise.allSettled(
    DOMAIN_SERVERS.map(async (url) => {
      const response = await request(
        ctx,
        url,
        { "user-agent": MOBILE_UA },
        2_000,
      );
      if (!response.ok) return [];
      const raw = stripLeadingNonAscii(await response.text());
      const decoded = decrypt(raw, "", DOMAIN_SECRET);
      if (!decoded) return [];
      const parsed = JSON.parse(decoded) as { Server?: unknown };
      return Array.isArray(parsed.Server)
        ? parsed.Server
            .map((item) => normalizeHost(item))
            .filter((item): item is string => item !== null)
        : [];
    }),
  );
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      return result.value;
    }
  }
  return [];
}

function healthyFirst(hosts: string[]): string[] {
  const ranked = rankHosts(hosts);
  const healthy = ranked.filter((host) => !isCoolingDown(host));
  // If every host is cooling down we still have to try something; ranked order
  // means the least-recently-failed one goes first.
  return healthy.length > 0 ? healthy : ranked;
}

async function discoverDomain(ctx: PluginContext): Promise<string> {
  // Race the known-good defaults against the name-server list instead of
  // waiting for the (often slow) name server first. The first healthy host
  // that answers /setting wins.
  const defaults = healthyFirst(DEFAULT_API_DOMAINS.slice(0, 8));
  const attempts: Array<Promise<string>> = defaults.map(
    async (candidate) => {
      await loadSetting(candidate, ctx);
      return candidate;
    },
  );
  attempts.push(
    discoverFromDomainServers(ctx).then((listed) => {
      if (listed.length === 0) throw new Error("no domains");
      const candidates = healthyFirst(listed.slice(0, 8));
      return Promise.any(
        candidates.map(async (candidate) => {
          await loadSetting(candidate, ctx);
          return candidate;
        }),
      );
    }),
  );

  try {
    const domain = await Promise.any(attempts);
    sessionDomain = domain;
    sessionAt = Date.now();
    return domain;
  } catch {
    if (ctx.signal.aborted) {
      throw new PluginError("cancelled", "请求已取消");
    }
    throw new PluginError(
      "network",
      "无法连接 JMComic API。请在插件设置中填写一个可用的 API 域名。",
    );
  }
}

async function ensureDomain(ctx: PluginContext): Promise<string> {
  const configured = normalizeHost(ctx.config.apiDomain);
  if (configured) {
    if (Date.now() - settingAt > SESSION_TTL) {
      await loadSetting(configured, ctx).catch(() => undefined);
    }
    return configured;
  }
  if (
    sessionDomain &&
    Date.now() - sessionAt < SESSION_TTL &&
    !isCoolingDown(sessionDomain)
  ) {
    return sessionDomain;
  }
  if (sessionDomain && isCoolingDown(sessionDomain)) {
    // Fail over promptly instead of waiting out the 10-minute session TTL.
    sessionDomain = null;
    sessionAt = 0;
  }
  if (!discovery) {
    discovery = discoverDomain(ctx).finally(() => {
      discovery = null;
    });
  }
  return discovery;
}

async function apiGet<T>(path: string, ctx: PluginContext): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const domain = await ensureDomain(ctx);
    const startedAt = Date.now();
    try {
      const result = await rawApiGet<T>(domain, path, APP_TOKEN_SECRET, ctx);
      markHostSuccess(domain, Date.now() - startedAt);
      return result;
    } catch (error) {
      if (
        error instanceof PluginError &&
        (error.code === "network" ||
          error.code === "timeout" ||
          error.code === "parse_error")
      ) {
        // A host that resets, times out or hands back HTML is useless for a
        // while. Cool it down so the next attempt picks a different host.
        markHostFailure(domain);
        if (sessionDomain === domain) {
          sessionDomain = null;
          sessionAt = 0;
        }
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof PluginError
    ? lastError
    : new PluginError("network", "请求 JMComic 失败");
}

async function fetchAlbum(
  mangaId: string,
  ctx: PluginContext,
): Promise<JmAlbum> {
  const cached = albumCache.get(mangaId);
  if (cached && Date.now() - cached.at < ALBUM_TTL) return cached.album;

  const album = await apiGet<JmAlbum>(
    `album?id=${encodeURIComponent(mangaId)}`,
    ctx,
  );
  if (!album || toInt(album.id) === -1 || !text(album.name)) {
    throw new PluginError("not_found", `未找到本子 ${mangaId}`);
  }
  albumCache.set(mangaId, { album, at: Date.now() });
  return album;
}

function coverUrl(
  image: unknown,
  id: string,
  size: "" | "_3x4",
  ctx: PluginContext,
): string {
  const base = coverBase(ctx);
  const raw = text(image);
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("//")) return `https:${raw}`;
    if (raw.startsWith("/")) return `${base}${raw}`;
    if (raw.includes("/")) return `${base}/${raw.replace(/^\/+/, "")}`;
    return `${base}/media/albums/${encodeURIComponent(raw)}`;
  }
  return `${base}/media/albums/${encodeURIComponent(id)}${size}.jpg`;
}

function genresOf(meta: JmAlbumMeta): string[] | undefined {
  const genres = [
    ...strings(meta.tags),
    text(meta.category?.title),
    text(meta.category_sub?.title),
  ].filter((item) => item.length > 0 && item.length <= 200);
  if (genres.length === 0) return undefined;
  return [...new Set(genres)];
}

function unixToIso(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds > 1e12 ? seconds : seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mapMeta(
  meta: JmAlbumMeta,
  ctx: PluginContext,
  size: "" | "_3x4",
): Manga | null {
  const id = text(meta.id);
  const title = text(meta.name) || text(meta.title);
  if (!id || !title) return null;

  const authors = strings(meta.author);
  return {
    id,
    title,
    coverUrl: coverUrl(meta.image, id, size, ctx),
    description: text(meta.description) || undefined,
    authors: authors.length > 0 ? authors : undefined,
    genres: genresOf(meta),
    readingDirection: "rtl",
  };
}

function mapAlbum(album: JmAlbum, ctx: PluginContext): Manga | null {
  const meta = mapMeta(album, ctx, "");
  if (!meta) return null;
  const series = Array.isArray(album.series) ? album.series : [];
  return {
    ...meta,
    chapterCount: series.length > 0 ? series.length : 1,
    updatedAt: unixToIso(album.addtime),
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

function mapSearchResult(
  result: JmSearchResult,
  page: number,
  ctx: PluginContext,
): PagedResult<Manga> {
  const content = Array.isArray(result.content) ? result.content : [];
  const total = toInt(result.total);
  const items = content
    .map((meta) => mapMeta(meta, ctx, "_3x4"))
    .filter((item): item is Manga => item !== null)
    .slice(0, 100);

  return {
    items,
    page,
    hasNextPage: total > 0 ? page * PAGE_SIZE < total : content.length >= PAGE_SIZE,
    ...(total > 0 ? { total } : {}),
  };
}

function imageFilename(entry: unknown): string | null {
  if (typeof entry === "string") return text(entry) || null;
  if (entry && typeof entry === "object") {
    const value = text((entry as { image?: unknown }).image);
    return value || null;
  }
  return null;
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? (match[1] as string).toLowerCase() : "";
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

/** Formats the server-side band transform can decode and re-encode. */
const TRANSFORMABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function calculateBands(
  scrambleId: number,
  photoId: number,
  filenameWithoutSuffix: string,
): number {
  if (!Number.isFinite(scrambleId) || !Number.isFinite(photoId)) return 0;
  if (photoId < scrambleId) return 0;
  if (photoId < 268850) return 10;

  const modulus = photoId < 421926 ? 10 : 8;
  const hash = md5(`${photoId}${filenameWithoutSuffix}`);
  const last = hash.charCodeAt(hash.length - 1);
  return (last % modulus) * 2 + 2;
}

interface ChapterTemplate {
  scrambleId: number;
  imageUrls: string[];
}

function imageBaseFrom(raw: string, fallbackHost: string): string {
  const fallback = `https://${fallbackHost}`;
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return fallback;
  const candidate = value.startsWith("//")
    ? `https:${value}`
    : /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (isKnownImageHost(url.host)) return `${url.protocol}//${url.host}`;
  } catch {
    // Fall back to the configured/default photo host.
  }
  return fallback;
}

function filenameFromUrl(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.split("/").pop() ?? "");
  } catch {
    return decodeURIComponent(value.split("?")[0]?.split("/").pop() ?? "");
  }
}

/**
 * The chapter template response contains the page list and `scramble_id` in one
 * request, plus the image host the web client currently prefers. jmcomic-next
 * uses the same HTML endpoint as a compatibility path. Parsing it here avoids
 * the separate `/chapter` API call and the slower default image host.
 */
async function fetchChapterTemplate(
  photoId: string,
  ctx: PluginContext,
  route: { host: string; preferTemplateHost: boolean },
): Promise<ChapterTemplate> {
  const domain = await ensureDomain(ctx);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = md5(timestamp + APP_TOKEN_SECRET_2);
  const path =
    `chapter_view_template?id=${encodeURIComponent(photoId)}` +
    `&mode=vertical&page=0&app_img_shunt=1&express=off&v=${timestamp}`;
  const response = await request(
    ctx,
    `https://${domain}/${path}`,
    {
      token,
      tokenparam: `${timestamp},`,
      "user-agent": MOBILE_UA,
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      ...cookieHeader(ctx),
    },
    10_000,
  );
  if (!response.ok) {
    throw new PluginError(
      "network",
      `JMComic 返回 HTTP ${response.status} 获取章节图片参数失败`,
    );
  }
  const raw = stripLeadingNonAscii(await response.text());
  const scrambleMatch = /var\s+scramble_id\s*=\s*(\d+)/.exec(raw);
  const scrambleId = scrambleMatch
    ? Number(scrambleMatch[1])
    : DEFAULT_SCRAMBLE_ID;

  const resultBlock =
    /const\s+result\s*=\s*(\{[\s\S]*?\});/.exec(raw)?.[1] ?? raw;
  const configBlock =
    /const\s+config\s*=\s*(\{[\s\S]*?\});/.exec(raw)?.[1] ?? raw;
  const imageBlock =
    /images\s*:\s*\[([\s\S]*?)\]/.exec(resultBlock)?.[1] ?? "";
  const names = imageBlock
    ? [...imageBlock.matchAll(/['"]([^'"]+)['"]/g)]
        .map((match) => match[1] as string)
        .filter(Boolean)
    : [];
  const imgHost =
    /imghost\s*:\s*['"]([^'"]+)['"]/.exec(configBlock)?.[1] ?? "";
  const jmId =
    /jmid\s*:\s*['"]?([A-Za-z0-9_-]+)['"]?/.exec(configBlock)?.[1] ?? photoId;
  const cache = /cache\s*:\s*['"]([^'"]*)['"]/.exec(configBlock)?.[1] ?? "";
  const base = route.preferTemplateHost
    ? imageBaseFrom(imgHost, route.host)
    : `https://${route.host}`;

  const imageUrls = names.map((name) => {
    if (/^https?:\/\//i.test(name)) return name;
    const filename = name.replace(/^\/+/, "");
    return (
      `${base}/media/photos/${encodeURIComponent(jmId)}/` +
      `${encodeURIComponent(filename)}${cache}`
    );
  });

  return { scrambleId, imageUrls };
}

function buildPage(
  url: string,
  photoId: string,
  scrambleId: number,
  ctx: PluginContext,
): Page {
  const filename = filenameFromUrl(url);
  const extension = extensionOf(filename);
  const bands = TRANSFORMABLE_EXTENSIONS.has(extension)
    ? calculateBands(
        scrambleId,
        Number(photoId),
        filename.replace(/\.[^.]+$/, ""),
      )
    : 0;
  const transform: ImageTransform | undefined =
    bands >= 2 ? { type: "band-reverse", bands } : undefined;
  return {
    url,
    mimeType: MIME_BY_EXT[extension],
    headers: pageHeaders(ctx),
    ...(transform ? { transform } : {}),
  };
}

function pageHeaders(ctx: PluginContext): Record<string, string> {
  return {
    "user-agent": MOBILE_UA,
    ...cookieHeader(ctx),
  };
}

async function getAlbumForSearch(
  result: JmSearchResult,
  ctx: PluginContext,
  page: number,
): Promise<PagedResult<Manga>> {
  if (result.redirect_aid) {
    const album = await fetchAlbum(String(result.redirect_aid), ctx);
    const mapped = mapAlbum(album, ctx);
    return {
      items: mapped ? [mapped] : [],
      page,
      hasNextPage: false,
      total: mapped ? 1 : 0,
    };
  }
  return mapSearchResult(result, page, ctx);
}

async function browseImpl(
  query: BrowseQuery,
  ctx: PluginContext,
): Promise<PagedResult<Manga>> {
  const page = Math.max(1, Math.trunc(query.page));
  const category = pickFilter(
    query.filters,
    "category",
    CATEGORY_VALUES,
    "0",
  );
  const sort = pickFilter(query.filters, "sort", SORT_VALUES, "mr");
  const time = pickFilter(query.filters, "time", TIME_VALUES, "a");
  const order = time === "a" ? sort : `${sort}_${time}`;
  const result = await apiGet<JmSearchResult>(
    `categories/filter?page=${page}&order=` +
      `&c=${encodeURIComponent(category)}&o=${encodeURIComponent(order)}`,
    ctx,
  );
  return mapSearchResult(result, page, ctx);
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

  const sort = pickFilter(query.filters, "sort", SORT_VALUES, "mr");
  const time = pickFilter(query.filters, "time", TIME_VALUES, "a");
  const result = await apiGet<JmSearchResult>(
    `search?main_tag=0&search_query=${encodeURIComponent(term)}` +
      `&page=${page}&o=${sort}&t=${time}`,
    ctx,
  );
  return getAlbumForSearch(result, ctx, page);
}

const plugin: MangaPlugin = {
  search: searchImpl,

  browse: browseImpl,

  async getFilters() {
    return FILTERS;
  },

  async getManga(mangaId, ctx) {
    const album = await fetchAlbum(mangaId, ctx);
    const mapped = mapAlbum(album, ctx);
    if (!mapped) {
      throw new PluginError("not_found", `未找到本子 ${mangaId}`);
    }
    return mapped;
  },

  async getChapters(mangaId, ctx) {
    const album = await fetchAlbum(mangaId, ctx);
    const series = Array.isArray(album.series) ? album.series : [];
    if (series.length === 0) {
      return [
        {
          id: mangaId,
          title: text(album.name) || "正篇",
          number: 1,
        },
      ];
    }

    return series.map((item, index): Chapter => {
      const id = text(item.id) || `${mangaId}-${index + 1}`;
      const sort = Number(item.sort);
      return {
        id,
        title: text(item.name) || `第 ${index + 1} 话`,
        number: Number.isFinite(sort) && sort > 0 ? sort : index + 1,
      };
    });
  },

  async getPages(_mangaId, chapterId, ctx) {
    // One call per page-list open. The cursor advances so the reader's
    // refresh-after-image-failure path lands on a different image mirror.
    const route = imageHostFor(ctx, chapterId);
    const template = await fetchChapterTemplate(chapterId, ctx, route).catch(
      (error) => {
        ctx.logger.warn(
          "JMComic chapter template unavailable; falling back to /chapter",
          error,
        );
        return null;
      },
    );
    if (template && template.imageUrls.length > 0) {
      return template.imageUrls.map((url) =>
        buildPage(url, chapterId, template.scrambleId, ctx),
      );
    }

    const photo = await apiGet<JmPhoto>(
      `chapter?id=${encodeURIComponent(chapterId)}`,
      ctx,
    );
    if (!photo || toInt(photo.id) === -1) {
      throw new PluginError("not_found", `未找到章节 ${chapterId}`);
    }
    if (text(photo.error)) {
      throw new PluginError("unsupported", text(photo.error));
    }

    const filenames = (Array.isArray(photo.images) ? photo.images : [])
      .map(imageFilename)
      .filter((item): item is string => item !== null);
    if (filenames.length === 0) {
      throw new PluginError("not_found", `章节 ${chapterId} 没有可用图片`);
    }

    const photoId = text(photo.id) || chapterId;
    const scrambleId = template?.scrambleId ?? DEFAULT_SCRAMBLE_ID;
    const base = `https://${route.host}`;

    return filenames.map((filename) =>
      buildPage(
        `${base}/media/photos/${encodeURIComponent(photoId)}/` +
          encodeURIComponent(filename),
        photoId,
        scrambleId,
        ctx,
      ),
    );
  },
};

export default plugin;
