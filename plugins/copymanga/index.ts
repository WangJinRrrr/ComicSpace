import { PluginError, definePlugin, type MangaPlugin } from "@comicspace/plugin-sdk";
import { pullAccountWith, type AccountPage } from "./account.js";

const CATALOG_MESSAGE =
  "拷贝漫画插件不能在这里打开目录或章节。请到设置页同步收藏和阅读历史。若同步提示个人中心是空壳，说明网站没有把账号数据放在普通网页里，插件不会改走未公开接口。";

function unsupportedCatalog(): never {
  throw new PluginError("unsupported", CATALOG_MESSAGE);
}

async function fetchHtml(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<AccountPage> {
  const response = await fetchImpl(url, {
    headers,
    signal,
    redirect: "follow",
  });
  const body = (await response.text()).slice(0, 1_500_000);
  return {
    url: response.url || url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
  };
}

const plugin: MangaPlugin = definePlugin({
  async getChapters() {
    unsupportedCatalog();
  },
  async getPages() {
    unsupportedCatalog();
  },
  async getManga() {
    unsupportedCatalog();
  },
  async pullAccount(ctx) {
    const result = await pullAccountWith(
      (url, headers) => fetchHtml(ctx.fetch, url, headers, ctx.signal),
      { cookie: ctx.config.cookie, baseUrl: ctx.config.baseUrl },
    );
    if (!result.ok) {
      throw new PluginError(result.code, result.message, {
        retryable: result.code === "network",
      });
    }
    return result.snapshot;
  },
});

export default plugin;
