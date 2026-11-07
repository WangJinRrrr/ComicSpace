/**
 * Reads the bookshelf and history that the copy-manga website renders after
 * login. The host browser loads those pages; this module only interprets the
 * visible document and does not call account APIs.
 */

export interface RenderedSession {
  goto(url: string): Promise<void>;
  current(): Promise<{ url: string; html: string }>;
  clickNext(): Promise<boolean>;
  close(): Promise<void>;
}

export const COPY_SITE = "https://www.mangacopy.com";

export const COPY_ACCOUNT_PAGES = {
  login: `${COPY_SITE}/web/login/`,
  favorites: `${COPY_SITE}/web/person/shujia`,
  history: `${COPY_SITE}/web/person/liulan`,
};

const MAX_PAGES = 40;
const LOGIN_WAIT_MS = 180_000;

export interface VisibleCard {
  pathWord: string;
  title: string;
  coverUrl?: string;
  /** Chapter title shown as 最後閱讀. Not the 最後更新 link. */
  lastReadChapterName?: string;
}

export interface AccountMangaRef {
  id: string;
  title: string;
  coverUrl?: string;
}

export interface AccountHistoryRef {
  manga: AccountMangaRef;
  chapterId: string;
  chapterTitle?: string;
  pageIndex?: number;
  readAt?: number;
}

export interface AccountSnapshot {
  favorites: {
    available: boolean;
    items: AccountMangaRef[];
    message?: string;
  };
  history: {
    available: boolean;
    items: AccountHistoryRef[];
    message?: string;
  };
}

export type AccountFlowCode = "auth_required" | "parse_error" | "unsupported";

export class AccountFlowError extends Error {
  readonly code: AccountFlowCode;

  constructor(code: AccountFlowCode, message: string) {
    super(message);
    this.name = "AccountFlowError";
    this.code = code;
  }
}

export type PageKind = "login" | "loading" | "ready" | "empty" | "unrecognized";

interface ChapterRef {
  id: string;
  title: string;
}

interface ReadOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  loginTimeoutMs?: number;
  pageTimeoutMs?: number;
}

function visibleText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function extractCards(html: string): VisibleCard[] {
  const parts = html.split(/<section\b/i);
  const chunks = parts.length > 1 ? parts.slice(1) : [html];
  const cards: VisibleCard[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const pathWord = /href="(?:https?:\/\/[^"]+)?\/comic\/([a-z0-9_-]+)\/?"/i.exec(
      chunk,
    )?.[1];
    if (!pathWord || seen.has(pathWord)) continue;
    const title = visibleText(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk)?.[1] ?? "");
    const readMatch =
      /最後閱讀：([^<]+)/.exec(chunk) ?? /最后阅读：([^<]+)/.exec(chunk);
    const lastReadChapterName = readMatch
      ? visibleText(readMatch[1] ?? "")
      : "";
    const cover = /<img\b[^>]*(?:src|data-src)="(https:\/\/[^"]+)"/i.exec(
      chunk,
    )?.[1];
    seen.add(pathWord);
    cards.push({
      pathWord,
      title: title || pathWord,
      ...(cover ? { coverUrl: cover } : {}),
      ...(lastReadChapterName ? { lastReadChapterName } : {}),
    });
  }
  return cards;
}

export function classifyAccountHtml(html: string, url: string): PageKind {
  if (extractCards(html).length > 0) return "ready";
  const path = pathnameOf(url);
  if (
    /\/web\/login/i.test(path) ||
    /type=["']password["']/i.test(html) ||
    /loginByAccount/.test(html)
  ) {
    return "login";
  }
  if (
    /請耐心等待加載|请耐心等待加载/.test(html) &&
    !/我收藏的漫畫|我最近瀏覽過的漫畫|共收藏|共瀏覽/.test(html)
  ) {
    return "loading";
  }
  if (/我收藏的漫畫|我最近瀏覽過的漫畫|共收藏|共瀏覽|最後閱讀|最后阅读/.test(html)) {
    return "empty";
  }
  return "unrecognized";
}

function pageSignature(html: string): string {
  const active =
    /class="[^"]*\bnumber\b[^"]*\bactive\b[^"]*"[^>]*>(\s*\d+\s*)</i.exec(html)?.[1] ??
    /class="[^"]*\bactive\b[^"]*\bnumber\b[^"]*"[^>]*>(\s*\d+\s*)</i.exec(html)?.[1] ??
    "";
  return `${extractCards(html)
    .map((card) => `${card.pathWord}:${card.lastReadChapterName ?? ""}`)
    .join("|")}#${active.trim()}`;
}

async function settle(
  session: RenderedSession,
  sleep: (ms: number) => Promise<void>,
): Promise<{ url: string; html: string; kind: PageKind }> {
  let view = await session.current();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const kind = classifyAccountHtml(view.html, view.url);
    if (kind !== "loading") return { ...view, kind };
    await sleep(250);
    view = await session.current();
  }
  return { ...view, kind: classifyAccountHtml(view.html, view.url) };
}

function rejectKind(kind: PageKind, role: "收藏" | "浏览记录"): void {
  if (kind === "login") {
    throw new AccountFlowError(
      "auth_required",
      "登录已失效，或还没有在弹出的网页里登录拷贝漫画。本地收藏和阅读历史没有改动。",
    );
  }
  if (kind === "loading") {
    throw new AccountFlowError(
      "parse_error",
      `${role}页面一直停在加载中，没有导入。本地数据没有改动。`,
    );
  }
  if (kind === "unrecognized") {
    throw new AccountFlowError(
      "parse_error",
      `${role}页面的结构和预期不一致，没有导入，以免把别的内容当成收藏或历史。本地数据没有改动。`,
    );
  }
}

async function readList(
  session: RenderedSession,
  url: string,
  role: "收藏" | "浏览记录",
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  pageTimeoutMs: number,
): Promise<VisibleCard[]> {
  await session.goto(url);
  const cards: VisibleCard[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const view = await settle(session, sleep);
    rejectKind(view.kind, role);
    if (view.kind === "empty") break;
    for (const card of extractCards(view.html)) {
      if (seen.has(card.pathWord)) continue;
      seen.add(card.pathWord);
      cards.push(card);
    }
    const before = pageSignature(view.html);
    let clicked: boolean;
    try {
      clicked = await session.clickNext();
    } catch {
      throw new AccountFlowError(
        "parse_error",
        `${role}翻到第 ${page + 1} 页失败，已停止，没有写入。`,
      );
    }
    if (!clicked) break;
    if (page === MAX_PAGES) {
      throw new AccountFlowError(
        "parse_error",
        `${role}超过 ${MAX_PAGES} 页，已停止，没有写入。`,
      );
    }
    const deadline = now() + pageTimeoutMs;
    let next = await session.current();
    let changed = pageSignature(next.html) !== before;
    while (!changed && now() < deadline) {
      await sleep(200);
      next = await session.current();
      changed = pageSignature(next.html) !== before;
    }
    if (!changed) {
      throw new AccountFlowError(
        "parse_error",
        `${role}翻页后页面没有变化，已停止，没有写入。`,
      );
    }
  }
  return cards;
}

/**
 * Opens the bookshelf and the recent-browse page in a real browser session.
 * Throws instead of returning an empty success when login or paging fails.
 */
export async function readRenderedAccount(
  session: RenderedSession,
  options: ReadOptions = {},
): Promise<{ favorites: VisibleCard[]; history: VisibleCard[] }> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_WAIT_MS;

  await session.goto(COPY_ACCOUNT_PAGES.favorites);
  const deadline = now() + loginTimeoutMs;
  let view = await settle(session, sleep);
  while (
    (view.kind === "login" || view.kind === "loading") &&
    now() < deadline
  ) {
    await sleep(view.kind === "login" ? 400 : 200);
    view = await settle(session, sleep);
  }
  if (view.kind === "login" || view.kind === "loading") {
    throw new AccountFlowError(
      "auth_required",
      "请在弹出的拷贝漫画网页里完成登录后再同步。软件不会索取密码或 Cookie。本地数据没有改动。",
    );
  }

  const pageTimeoutMs = options.pageTimeoutMs ?? 8_000;
  const favorites = await readList(
    session,
    COPY_ACCOUNT_PAGES.favorites,
    "收藏",
    sleep,
    now,
    pageTimeoutMs,
  );
  const history = await readList(
    session,
    COPY_ACCOUNT_PAGES.history,
    "浏览记录",
    sleep,
    now,
    pageTimeoutMs,
  );
  return { favorites, history };
}

export async function cardsToSnapshot(
  favorites: VisibleCard[],
  history: VisibleCard[],
  listChapters: (pathWord: string) => Promise<ChapterRef[]>,
): Promise<AccountSnapshot> {
  const favoriteItems: AccountMangaRef[] = favorites.map((card) => ({
    id: card.pathWord,
    title: card.title,
    ...(card.coverUrl ? { coverUrl: card.coverUrl } : {}),
  }));

  const named = history.filter((card) => card.lastReadChapterName);
  const chapterCache = new Map<string, ChapterRef[] | "error">();
  const historyItems: AccountHistoryRef[] = [];
  let unresolved = 0;
  let ambiguous = 0;
  let lookupFailed = 0;

  for (const card of named) {
    let chapters = chapterCache.get(card.pathWord);
    if (!chapters) {
      try {
        chapters = await listChapters(card.pathWord);
      } catch {
        chapters = "error";
      }
      chapterCache.set(card.pathWord, chapters);
    }
    if (chapters === "error") {
      lookupFailed += 1;
      continue;
    }
    const title = card.lastReadChapterName ?? "";
    const matches = chapters.filter((chapter) => chapter.title.trim() === title);
    if (matches.length !== 1 || !matches[0]) {
      if (matches.length > 1) ambiguous += 1;
      else unresolved += 1;
      continue;
    }
    historyItems.push({
      manga: {
        id: card.pathWord,
        title: card.title,
        ...(card.coverUrl ? { coverUrl: card.coverUrl } : {}),
      },
      chapterId: matches[0].id,
      chapterTitle: title,
      pageIndex: 0,
    });
  }

  const total = historyItems.length;
  historyItems.forEach((item, index) => {
    item.readAt = total - index;
  });

  const historyNotes = [
    "网页只显示「最後閱讀」的章节名，不显示页码。章节 uuid 用阅读器已经使用的章节列表按标题精确对应；对不上或有重名的不写入。",
    "页面从上到下当作从新到旧，只用很小的时间值，不会覆盖软件里更新的阅读进度。",
  ];
  if (history.length > 0 && named.length === 0) {
    return {
      favorites: { available: true, items: favoriteItems },
      history: {
        available: false,
        items: [],
        message:
          "浏览记录页没有显示「最後閱讀」章节名，阅读历史没有写入。没有把「最後更新」链接当成阅读进度。",
      },
    };
  }
  if (unresolved || ambiguous || lookupFailed) {
    historyNotes.push(
      `有 ${unresolved} 条找不到同名章节，${ambiguous} 条章节名重复，${lookupFailed} 条章节列表读取失败，这些没有写入。`,
    );
  }

  return {
    favorites: { available: true, items: favoriteItems },
    history: {
      available: true,
      items: historyItems,
      message: historyNotes.join(""),
    },
  };
}
