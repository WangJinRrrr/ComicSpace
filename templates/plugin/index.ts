import type {
  MangaPlugin,
  PluginContext,
} from "@comicspace/plugin-sdk";

/**
 * A source plugin template.
 *
 * This file is executed as trusted local code by the ComicSpace server.
 * Replace the EXAMPLE API calls below with endpoints you are allowed to use,
 * and follow the source's terms of service.
 */

function baseUrl(ctx: PluginContext): string {
  return String(ctx.config.baseUrl ?? "https://api.example.com").replace(
    /\/+$/,
    "",
  );
}

async function getJson<T>(
  path: string,
  ctx: PluginContext,
): Promise<T> {
  const response = await ctx.fetch(`${baseUrl(ctx)}${path}`, {
    signal: ctx.signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const plugin: MangaPlugin = {
  async search(query, ctx) {
    // TODO: call your search endpoint and map results to Manga objects.
    const data = await getJson<{ items: unknown[] }>(
      `/search?q=${encodeURIComponent(query.term)}&page=${query.page}`,
      ctx,
    );
    return {
      items: [],
      page: query.page,
      hasNextPage: data.items.length > 0,
    };
  },

  async browse(query, ctx) {
    // TODO: optional. Remove this method if the source only supports search.
    void ctx;
    return { items: [], page: query.page, hasNextPage: false };
  },

  async getManga(mangaId, ctx) {
    // TODO: fetch and map one manga's details.
    void mangaId;
    void ctx;
    throw new Error("getManga() is not implemented yet");
  },

  async getChapters(mangaId, ctx) {
    // TODO: fetch chapter list and return Chapter objects.
    void mangaId;
    void ctx;
    return [];
  },

  async getPages(mangaId, chapterId, ctx) {
    // TODO: return absolute http(s) image URLs. Include width/height when
    // available so the double-page reader can lay pages out correctly.
    void mangaId;
    void chapterId;
    void ctx;
    return [];
  },
};

export default plugin;
