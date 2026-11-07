export const DEFAULT_COPYMANGA_ORIGIN = "https://www.mangacopy.com";

export interface AccountManga {
  id: string;
  title: string;
  coverUrl?: string;
}

export interface AccountHistoryEntry {
  manga: AccountManga;
  chapterId: string;
  chapterTitle?: string;
  pageIndex?: number;
  readAt?: number;
}

export interface AccountSnapshot {
  favorites: {
    available: boolean;
    items: AccountManga[];
    message?: string;
  };
  history: {
    available: boolean;
    items: AccountHistoryEntry[];
    message?: string;
  };
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const TIME_NOTE =
  "网页没有给出阅读时间，按页面从上到下当作从新到旧。这个顺序只用很小的时间值，不会覆盖你在软件里更新的阅读进度；页码网站也没提供，新导入的章节记在第 1 页。";

const EMPTY_MARKERS = [
  "暂无收藏",
  "暫無收藏",
  "没有收藏",
  "沒有收藏",
  "暂无阅读",
  "暫無閱讀",
  "还没有阅读",
  "還沒有閱讀",
  "暂无记录",
  "暫無記錄",
  "空空如也",
];

export interface AccountPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export type AccountFailureCode =
  | "auth_required"
  | "config_required"
  | "network"
  | "unsupported";

export type AccountPullResult =
  | { ok: true; snapshot: AccountSnapshot }
  | { ok: false; code: AccountFailureCode; message: string };

interface ParsedLink {
  id: string;
  title: string;
  coverUrl?: string;
  chapterId?: string;
  chapterTitle?: string;
}

interface PageClass {
  kind:
    | "down"
    | "missing"
    | "private-response"
    | "offsite"
    | "spa-shell"
    | "empty"
    | "no-chapters"
    | "unrecognized"
    | "parsed";
  favorites: AccountManga[];
  history: AccountHistoryEntry[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (all, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    })
    .replace(/&#x([0-9a-f]+);/gi, (all, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    });
}

function visibleText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function redactSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

export function buildAccountRequest(config: {
  cookie?: unknown;
  baseUrl?: unknown;
}):
  | {
      ok: true;
      cookie: string;
      origin: string;
      pages: { favorites: string; history: string };
      headers: Record<string, string>;
    }
  | { ok: false; code: "auth_required" | "config_required"; message: string } {
  const cookie = typeof config.cookie === "string" ? config.cookie.trim() : "";
  if (!cookie) {
    return {
      ok: false,
      code: "auth_required",
      message:
        "尚未登录。请在设置中填写浏览器里拷贝漫画站点的 Cookie。软件不会用账号密码登录，也不会把 Cookie 写进日志。",
    };
  }
  if (cookie.length > 8000) {
    return {
      ok: false,
      code: "config_required",
      message: "Cookie 过长。请只粘贴该站点请求里的 Cookie。",
    };
  }

  const raw =
    typeof config.baseUrl === "string" && config.baseUrl.trim()
      ? config.baseUrl.trim()
      : DEFAULT_COPYMANGA_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "config_required", message: "网站地址不是合法 URL。" };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      code: "config_required",
      message: "网站地址必须是 https，避免把 Cookie 发到明文连接。",
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: "config_required",
      message: "网站地址不能包含账号或密码。",
    };
  }
  const origin = url.origin;
  return {
    ok: true,
    cookie,
    origin,
    pages: {
      favorites: new URL("/web/person/collect", origin).href,
      history: new URL("/web/person/browse", origin).href,
    },
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9",
      cookie,
      referer: `${origin}/`,
      "user-agent": BROWSER_UA,
    },
  };
}

function parseComicHref(href: string): { id: string; chapterId?: string } | null {
  let pathname = href.trim();
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/comic\/([a-z0-9_-]+)(?:\/chapter\/([^/?#]+))?\/?$/i);
  if (!match?.[1]) return null;
  let chapterId: string | undefined;
  if (match[2]) {
    try {
      chapterId = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
    if (chapterId.length > 2048 || chapterId.includes("..")) return null;
  }
  return { id: match[1], chapterId };
}

function findCover(html: string, index: number): string | undefined {
  const window = html.slice(Math.max(0, index - 400), index + 500);
  const matches = [...window.matchAll(/(?:data-src|src)\s*=\s*"(https:\/\/[^"]+)"/gi)];
  const last = matches.at(-1)?.[1];
  if (!last || last.length > 2000) return undefined;
  return last;
}

function parseLinks(html: string): ParsedLink[] {
  const results: ParsedLink[] = [];
  const pattern =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const href = match[1] ?? match[2] ?? "";
    const comic = parseComicHref(href);
    if (!comic) continue;
    const text = visibleText(match[3] ?? "");
    results.push({
      id: comic.id,
      title: (text || comic.id).slice(0, 1000),
      coverUrl: findCover(html, match.index),
      chapterId: comic.chapterId,
      chapterTitle: comic.chapterId ? (text || comic.chapterId).slice(0, 1000) : undefined,
    });
    if (results.length >= 500) break;
  }
  return results;
}

function isLoginPage(page: AccountPage): boolean {
  if (page.status === 401 || page.status === 403) return true;
  try {
    if (/\/web\/login\/?$/i.test(new URL(page.url).pathname)) return true;
  } catch {
    // Fall through to the HTML check.
  }
  return /loginStatic\/js\/app/i.test(page.body) && /id=["']?app\b/i.test(page.body);
}

function isAccountUrl(pageUrl: string, origin: string): boolean {
  try {
    const url = new URL(pageUrl);
    const base = new URL(origin);
    if (url.protocol !== "https:" || url.host !== base.host) return false;
    return /^\/web\/person(\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isSpaShell(html: string): boolean {
  return /id=["']?person\b/i.test(html) && /loginStatic\/js\/person/i.test(html);
}

function toManga(link: ParsedLink, titles: Map<string, string>): AccountManga {
  const manga: AccountManga = {
    id: link.id,
    title: titles.get(link.id) || (!link.chapterId ? link.title : link.id),
  };
  if (link.coverUrl) manga.coverUrl = link.coverUrl;
  return manga;
}

function classify(page: AccountPage, origin: string, role: "favorites" | "history"): PageClass {
  const empty = { favorites: [], history: [] };
  if (page.status >= 500 || page.status === 0) return { kind: "down", ...empty };
  if (page.status === 404) return { kind: "missing", ...empty };
  const trimmed = page.body.trim();
  if (
    /json/i.test(page.contentType) ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    return { kind: "private-response", ...empty };
  }
  if (!isAccountUrl(page.url, origin)) return { kind: "offsite", ...empty };

  const links = parseLinks(page.body);
  if (role === "history" && links.length > 0 && !links.some((link) => link.chapterId)) {
    return { kind: "no-chapters", ...empty };
  }
  if (links.length === 0 && isSpaShell(page.body)) return { kind: "spa-shell", ...empty };
  if (links.length === 0 && EMPTY_MARKERS.some((marker) => page.body.includes(marker))) {
    return { kind: "empty", ...empty };
  }
  if (links.length === 0) return { kind: "unrecognized", ...empty };

  const titles = new Map<string, string>();
  for (const link of links) {
    if (!link.chapterId && link.title && link.title !== link.id && !titles.has(link.id)) {
      titles.set(link.id, link.title);
    }
  }
  const favorites: AccountManga[] = [];
  const seenFavorites = new Set<string>();
  for (const link of links) {
    if (seenFavorites.has(link.id)) continue;
    seenFavorites.add(link.id);
    favorites.push(toManga(link, titles));
  }
  const history: AccountHistoryEntry[] = [];
  const seenChapters = new Set<string>();
  for (const link of links) {
    if (!link.chapterId) continue;
    const key = `${link.id}\0${link.chapterId}`;
    if (seenChapters.has(key)) continue;
    seenChapters.add(key);
    history.push({
      manga: toManga(link, titles),
      chapterId: link.chapterId,
      chapterTitle: link.chapterTitle,
      pageIndex: 0,
    });
  }
  const total = history.length;
  history.forEach((entry, index) => {
    entry.readAt = total - index;
  });
  return { kind: "parsed", favorites, history };
}

function unavailableMessage(kind: PageClass["kind"]): string {
  switch (kind) {
    case "spa-shell":
      return "该页面仍是前端空壳，没有写入。插件不会改走未公开接口。";
    case "no-chapters":
      return "页面只列出了漫画，没有章节，阅读历史没有写入。";
    case "missing":
      return "个人中心页面不存在，没有写入。";
    case "private-response":
      return "站点返回的不是普通网页，没有写入。";
    case "offsite":
      return "打开个人中心时离开了账号页面，没有写入。";
    default:
      return "页面里没有可识别的条目，没有写入。";
  }
}

export function interpretAccountPages(
  favorites: AccountPage,
  history: AccountPage,
  origin: string,
): AccountPullResult {
  if (isLoginPage(favorites) || isLoginPage(history)) {
    return {
      ok: false,
      code: "auth_required",
      message:
        "登录已失效，或 Cookie 不能访问个人中心。请在浏览器重新登录拷贝漫画后更新 Cookie。本地收藏和阅读历史没有改动。",
    };
  }
  const fav = classify(favorites, origin, "favorites");
  const hist = classify(history, origin, "history");
  if (fav.kind === "down" || hist.kind === "down") {
    return {
      ok: false,
      code: "network",
      message: "拷贝漫画页面暂时打不开。本地收藏和阅读历史没有改动。",
    };
  }
  if (fav.kind === "offsite" || hist.kind === "offsite") {
    return {
      ok: false,
      code: "unsupported",
      message:
        "打开个人中心时离开了账号页面。已拒绝导入，避免把公开目录当成你的收藏。本地数据没有改动。",
    };
  }
  if (fav.kind === "private-response" || hist.kind === "private-response") {
    return {
      ok: false,
      code: "unsupported",
      message:
        "站点返回的不是普通网页。插件不会调用未公开接口，因此没有导入。本地收藏和阅读历史没有改动。",
    };
  }

  const favoritesAvailable = fav.kind === "parsed" || fav.kind === "empty";
  let historyAvailable = hist.kind === "parsed" || hist.kind === "empty";
  let historyItems = hist.kind === "parsed" ? hist.history : [];
  if (!historyAvailable && fav.kind === "parsed" && fav.history.length > 0) {
    historyAvailable = true;
    historyItems = fav.history;
  }
  if (!favoritesAvailable && !historyAvailable) {
    const spa = fav.kind === "spa-shell" || hist.kind === "spa-shell";
    return {
      ok: false,
      code: "unsupported",
      message: spa
        ? "拷贝漫画个人中心仍是前端空壳，网页里没有收藏和阅读历史。这些内容由站点脚本向未公开接口获取，插件不会调用。本次没有导入，本地收藏和阅读历史都还在。真实登录后的页面没有用账号验证；填写 Cookie 后如果仍是空壳，同步会停在这里。"
        : "个人中心网页里没有可识别的收藏或阅读历史，本次没有导入。本地数据没有改动。",
    };
  }

  return {
    ok: true,
    snapshot: {
      favorites: favoritesAvailable
        ? { available: true, items: fav.kind === "parsed" ? fav.favorites : [] }
        : { available: false, items: [], message: unavailableMessage(fav.kind) },
      history: historyAvailable
        ? {
            available: true,
            items: historyItems,
            message: historyItems.length > 0 ? TIME_NOTE : undefined,
          }
        : { available: false, items: [], message: unavailableMessage(hist.kind) },
    },
  };
}

export async function pullAccountWith(
  fetchPage: (url: string, headers: Record<string, string>) => Promise<AccountPage>,
  config: { cookie?: unknown; baseUrl?: unknown },
): Promise<AccountPullResult> {
  const built = buildAccountRequest(config);
  if (!built.ok) return built;
  try {
    const favorites = await fetchPage(built.pages.favorites, built.headers);
    const history = await fetchPage(built.pages.history, built.headers);
    const interpreted = interpretAccountPages(favorites, history, built.origin);
    if (!interpreted.ok) {
      return {
        ...interpreted,
        message: redactSecret(interpreted.message, built.cookie),
      };
    }
    return interpreted;
  } catch {
    return {
      ok: false,
      code: "network",
      message: "无法连接拷贝漫画网站。本地收藏和阅读历史没有改动。",
    };
  }
}
