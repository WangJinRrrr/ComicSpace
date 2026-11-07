import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../src/db/client.js";
import {
  getLatestProgress,
  getProgressForChapter,
  listHistory,
  upsertProgress,
} from "../src/db/repos/progress.js";
import { importAccountSnapshot } from "../src/services/accountSync.js";
import {
  AccountFlowError,
  cardsToSnapshot,
  classifyAccountHtml,
  extractCards,
  readRenderedAccount,
  COPY_ACCOUNT_PAGES,
  type RenderedSession,
} from "../../../plugins/mangacopy/account.js";

let db: Db | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function card(pathWord: string, title: string, lastRead: string, updateUuid: string): string {
  return `<section>
    <a href="/comic/${pathWord}"><img src="https://s3.mangafunb.fun/${pathWord}.jpg" alt=""></a>
    <a href="/comic/${pathWord}"><h3>${title}</h3></a>
    <h4>最後閱讀：${lastRead}</h4>
    <span>最後更新：</span>
    <a href="/comic/${pathWord}/chapter/${updateUuid}">最新话</a>
  </section>`;
}

function page(body: string, active = "1"): string {
  return `<div class="man_">${body}</div>
    <div class="el-pagination"><li class="number active">${active}</li></div>`;
}

class ScriptedSession implements RenderedSession {
  url = COPY_ACCOUNT_PAGES.favorites;
  index = 0;
  failNext = false;
  stick = false;
  readonly pages = new Map<string, string[]>();

  set(url: string, htmls: string[]): void {
    this.pages.set(url, htmls);
  }

  async goto(url: string): Promise<void> {
    this.url = url;
    this.index = 0;
  }

  async current(): Promise<{ url: string; html: string }> {
    const list = this.pages.get(this.url) ?? ["<html></html>"];
    return { url: this.url, html: list[Math.min(this.index, list.length - 1)] ?? "" };
  }

  async clickNext(): Promise<boolean> {
    if (this.failNext) throw new Error("pager broke");
    if (this.stick) return true;
    const list = this.pages.get(this.url) ?? [];
    if (this.index + 1 >= list.length) return false;
    this.index += 1;
    return true;
  }

  async close(): Promise<void> {}
}

const fast = {
  sleep: async () => undefined,
  now: () => 1_000,
  loginTimeoutMs: 0,
  pageTimeoutMs: 0,
};

describe("rendered copy-manga account pages", () => {
  it("reads the visible comic and last-read title, not the update link", () => {
    const html = page(card("yiquanchaoren", "一拳超人", "第3话", "latest-uuid"));
    expect(classifyAccountHtml(html, COPY_ACCOUNT_PAGES.favorites)).toBe("ready");
    expect(extractCards(html)).toEqual([
      {
        pathWord: "yiquanchaoren",
        title: "一拳超人",
        coverUrl: "https://s3.mangafunb.fun/yiquanchaoren.jpg",
        lastReadChapterName: "第3话",
      },
    ]);
    expect(JSON.stringify(extractCards(html))).not.toContain("latest-uuid");
  });

  it("treats the login screen as logged out and an unfamiliar page as a structure change", () => {
    expect(
      classifyAccountHtml(
        `<form><input type="password" name="password"></form>`,
        COPY_ACCOUNT_PAGES.login,
      ),
    ).toBe("login");
    expect(classifyAccountHtml("<html><body>广告</body></html>", COPY_ACCOUNT_PAGES.favorites)).toBe(
      "unrecognized",
    );
    expect(
      classifyAccountHtml(
        `<div>我收藏的漫畫</div><span>共收藏0漫畫</span>`,
        COPY_ACCOUNT_PAGES.favorites,
      ),
    ).toBe("empty");
  });

  it("pages through both lists and stops when the pager fails", async () => {
    const session = new ScriptedSession();
    session.set(COPY_ACCOUNT_PAGES.favorites, [
      page(card("one", "一", "第1话", "u1"), "1") + `<li class="number">2</li>`,
      page(card("two", "二", "第2话", "u2"), "2"),
    ]);
    session.set(COPY_ACCOUNT_PAGES.history, [
      page(card("one", "一", "第1话", "u1")),
    ]);
    const read = await readRenderedAccount(session, fast);
    expect(read.favorites.map((card) => card.pathWord)).toEqual(["one", "two"]);
    expect(read.history.map((card) => card.lastReadChapterName)).toEqual(["第1话"]);

    session.failNext = true;
    session.index = 0;
    await expect(readRenderedAccount(session, fast)).rejects.toThrow(/翻到第 2 页失败/);
  });

  it("does not report success when the next page never changes", async () => {
    const session = new ScriptedSession();
    session.stick = true;
    session.set(COPY_ACCOUNT_PAGES.favorites, [
      page(card("one", "一", "第1话", "u1"), "1"),
      page(card("two", "二", "第2话", "u2"), "2"),
    ]);
    session.set(COPY_ACCOUNT_PAGES.history, [page(card("one", "一", "第1话", "u1"))]);
    await expect(readRenderedAccount(session, fast)).rejects.toBeInstanceOf(AccountFlowError);
    await expect(readRenderedAccount(session, fast)).rejects.toThrow(/没有变化/);
  });

  it("stops on an expired session before returning a snapshot", async () => {
    const session = new ScriptedSession();
    session.set(COPY_ACCOUNT_PAGES.favorites, [page(card("one", "一", "第1话", "u1"))]);
    session.set(COPY_ACCOUNT_PAGES.history, [
      `<form action="/web/login/"><input type="password"></form>`,
    ]);
    await expect(readRenderedAccount(session, fast)).rejects.toThrow(/登录已失效/);
  });

  it("maps one visible chapter title to its uuid and skips ambiguous names", async () => {
    const snapshot = await cardsToSnapshot(
      [{ pathWord: "one", title: "一", lastReadChapterName: "第1话" }],
      [
        { pathWord: "one", title: "一", lastReadChapterName: "第1话" },
        { pathWord: "two", title: "二", lastReadChapterName: "第2话" },
        { pathWord: "three", title: "三", lastReadChapterName: "第3话" },
      ],
      async (pathWord) => {
        if (pathWord === "one") return [{ id: "uuid-1", title: "第1话" }];
        if (pathWord === "two") {
          return [
            { id: "a", title: "第2话" },
            { id: "b", title: "第2话" },
          ];
        }
        return [{ id: "uuid-9", title: "别的话" }];
      },
    );
    expect(snapshot.favorites.items.map((item) => item.id)).toEqual(["one"]);
    expect(snapshot.history.items).toEqual([
      expect.objectContaining({
        chapterId: "uuid-1",
        chapterTitle: "第1话",
        readAt: 1,
        manga: expect.objectContaining({ id: "one" }),
      }),
    ]);
    expect(snapshot.history.message).toContain("1 条找不到同名章节");
    expect(snapshot.history.message).toContain("1 条章节名重复");
  });

  it("keeps a newer local chapter when the site order points at an older one", async () => {
    db = createDatabase(":memory:");
    upsertProgress(
      db,
      {
        sourceId: "mangacopy",
        mangaId: "one",
        chapterId: "uuid-9",
        pageIndex: 10,
        mode: "single",
        completed: true,
      },
      5_000,
    );
    const snapshot = await cardsToSnapshot(
      [],
      [
        { pathWord: "one", title: "一", lastReadChapterName: "第1话" },
        { pathWord: "one", title: "一", lastReadChapterName: "第9话" },
      ],
      async () => [
        { id: "uuid-1", title: "第1话" },
        { id: "uuid-9", title: "第9话" },
      ],
    );
    const result = importAccountSnapshot(db, "mangacopy", {
      ...snapshot,
      favorites: { available: false, items: [], message: "这次只核对历史。" },
    });
    expect(result.historyKeptLocal).toBe(1);
    expect(getProgressForChapter(db, "mangacopy", "one", "uuid-9")?.pageIndex).toBe(10);
    expect(getLatestProgress(db, "mangacopy", "one")?.chapterId).toBe("uuid-9");
    expect(listHistory(db)[0]?.chapterId).toBe("uuid-9");
    expect(getProgressForChapter(db, "mangacopy", "one", "uuid-1")?.chapterId).toBe(
      "uuid-1",
    );
  });
});
