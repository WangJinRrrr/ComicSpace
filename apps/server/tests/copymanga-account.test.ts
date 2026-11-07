import { describe, expect, it } from "vitest";
import {
  buildAccountRequest,
  pullAccountWith,
  type AccountPage,
} from "../../../plugins/copymanga/account.js";

const ORIGIN = "https://www.mangacopy.com";

function page(partial: Partial<AccountPage> & Pick<AccountPage, "body">): AccountPage {
  return {
    url: `${ORIGIN}/web/person/collect`,
    status: 200,
    contentType: "text/html; charset=utf-8",
    ...partial,
  };
}

const SPA = `<!DOCTYPE html><html><head><title>拷貝漫畫</title></head><body><div id=person></div><div class=loading>請耐心等待加載，謝謝</div><script src="https://s3.mangafunb.fun/static/websitefree/loginStatic/js/person.1b8bbe2f18a97f2437e5.js"></script></body></html>`;

const LOGIN = `<!DOCTYPE html><html><body><div id=app></div><script src="https://s3.mangafunb.fun/static/websitefree/loginStatic/js/app.75df92b0c2ef8fdb5b8e.js"></script></body></html>`;

const COLLECT = `
<div class="comicRank-yi">
  <a href="/comic/yiquanchaoren"><img data-src="https://s3.mangafunb.fun/cover/a.jpg" alt=""></a>
  <a href="/comic/yiquanchaoren">一拳超人</a>
  <a href="/comic/yiquanchaoren/chapter/ch-3">第3话</a>
</div>
<div>
  <a href="/comic/haizeiwang">海贼王</a>
</div>
<a href="/comic/yiquanchaoren">一拳超人</a>
`;

const HISTORY = `
<a href="/comic/haizeiwang">海贼王</a>
<a href="/comic/haizeiwang/chapter/ep-9">第9话</a>
<a href="/comic/haizeiwang/chapter/ep-2">第2话</a>
`;

describe("copymanga account pages", () => {
  it("asks for a cookie and refuses insecure site URLs", () => {
    const missing = buildAccountRequest({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("auth_required");
    const http = buildAccountRequest({
      cookie: "fixture-cookie",
      baseUrl: "http://www.mangacopy.com",
    });
    expect(http.ok).toBe(false);
    const built = buildAccountRequest({ cookie: "fixture-cookie" });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.pages.favorites).toBe(`${ORIGIN}/web/person/collect`);
      expect(built.pages.history).toBe(`${ORIGIN}/web/person/browse`);
      expect(built.headers.cookie).toBe("fixture-cookie");
      expect(built.headers["user-agent"]).toContain("Chrome");
      expect(built.headers["user-agent"]).not.toMatch(/comicspace|okhttp|dart/i);
    }
  });

  it("does not report success for the public SPA shell", async () => {
    const result = await pullAccountWith(
      async (url) =>
        page({
          url,
          body: SPA,
        }),
      { cookie: "fixture-cookie" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported");
      expect(result.message).toContain("空壳");
      expect(result.message).toContain("没有导入");
      expect(result.message).not.toContain("fixture-cookie");
    }
  });

  it("treats the login shell and a logged-out redirect as an expired session", async () => {
    const login = await pullAccountWith(
      async (url) => page({ url, body: LOGIN }),
      { cookie: "fixture-cookie" },
    );
    expect(login.ok).toBe(false);
    if (!login.ok) expect(login.code).toBe("auth_required");

    const redirected = await pullAccountWith(
      async () =>
        page({
          url: `${ORIGIN}/web/login/`,
          body: "<html>login</html>",
        }),
      { cookie: "fixture-cookie" },
    );
    expect(redirected.ok).toBe(false);
    if (!redirected.ok) expect(redirected.code).toBe("auth_required");
  });

  it("refuses a public catalog page and a JSON payload", async () => {
    const catalog = await pullAccountWith(
      async () =>
        page({
          url: `${ORIGIN}/`,
          body: COLLECT,
        }),
      { cookie: "fixture-cookie" },
    );
    expect(catalog.ok).toBe(false);
    if (!catalog.ok) {
      expect(catalog.code).toBe("unsupported");
      expect(catalog.message).toContain("公开目录");
    }

    const json = await pullAccountWith(
      async (url) =>
        page({
          url,
          contentType: "application/json",
          body: '{"results":{"list":[]}}',
        }),
      { cookie: "fixture-cookie" },
    );
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.message).toContain("未公开");
  });

  it("parses server-rendered favorites and history without calling other URLs", async () => {
    const seen: string[] = [];
    const result = await pullAccountWith(
      async (url) => {
        seen.push(url);
        if (url.endsWith("/collect")) {
          return page({ url, body: COLLECT });
        }
        return page({ url, body: HISTORY });
      },
      { cookie: "fixture-cookie", baseUrl: ORIGIN },
    );
    expect(seen).toEqual([
      `${ORIGIN}/web/person/collect`,
      `${ORIGIN}/web/person/browse`,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.favorites.items.map((item) => item.title)).toEqual([
        "一拳超人",
        "海贼王",
      ]);
      expect(result.snapshot.favorites.items[0]?.coverUrl).toBe(
        "https://s3.mangafunb.fun/cover/a.jpg",
      );
      expect(result.snapshot.history.items.map((item) => item.chapterId)).toEqual([
        "ep-9",
        "ep-2",
      ]);
      expect(result.snapshot.history.items[0]?.readAt).toBeGreaterThan(
        result.snapshot.history.items[1]?.readAt ?? 0,
      );
      expect(result.snapshot.history.items[0]?.manga.title).toBe("海贼王");
      expect(result.snapshot.history.message).toContain("不会覆盖");
    }
  });

  it("hides thrown network errors instead of echoing them", async () => {
    const result = await pullAccountWith(async () => {
      throw new Error("cookie=fixture-cookie failed");
    }, { cookie: "fixture-cookie" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("network");
      expect(result.message).not.toContain("fixture-cookie");
    }
  });

  it("reports an empty shelf when the page says so", async () => {
    const result = await pullAccountWith(
      async (url) => page({ url, body: "<div id=person>暂无收藏</div><p>暫無閱讀</p>" }),
      { cookie: "fixture-cookie" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.favorites.available).toBe(true);
      expect(result.snapshot.favorites.items).toEqual([]);
      expect(result.snapshot.history.items).toEqual([]);
    }
  });
});
