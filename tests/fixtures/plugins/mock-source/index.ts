import type {
  BrowseQuery,
  Chapter,
  Manga,
  MangaPlugin,
  Page,
  PluginContext,
  SearchQuery,
} from "@comicspace/plugin-sdk";

const MANGA: Manga[] = [
  {
    id: "moonlit",
    title: "月下的邮差",
    altTitles: ["Moonlit Courier"],
    coverUrl: "/covers/moonlit.svg",
    description:
      "一部用于验证阅读器、双页排版和书架流程的本地示例漫画。所有图片都由本地 fixture 服务生成，不包含真实作品。",
    authors: ["Fixture Author"],
    genres: ["幻想", "日常"],
    status: "ongoing",
    year: 2026,
    readingDirection: "ltr",
    chapterCount: 3,
  },
  {
    id: "paper-city",
    title: "纸城档案",
    altTitles: ["Paper City Files"],
    coverUrl: "/covers/paper-city.svg",
    description:
      "用于测试宽图、双页、缓存和离线下载。图片是本地生成的占位图。",
    authors: ["Fixture Author"],
    genres: ["悬疑"],
    status: "completed",
    year: 2025,
    readingDirection: "rtl",
    chapterCount: 2,
  },
  {
    id: "long-scroll",
    title: "长街灯火",
    altTitles: ["Long Street Lights"],
    coverUrl: "/covers/long-scroll.svg",
    description: "用于测试条漫模式和纵向滚动进度。",
    authors: ["Fixture Author"],
    genres: ["生活"],
    status: "ongoing",
    year: 2026,
    readingDirection: "ttb",
    chapterCount: 2,
  },
];

const CHAPTERS: Record<string, Chapter[]> = {
  moonlit: [
    { id: "ch-1", title: "第 1 话 · 雨夜", number: 1, language: "zh", pageCount: 8 },
    { id: "ch-2", title: "第 2 话 · 白昼", number: 2, language: "zh", pageCount: 8 },
    { id: "ch-3", title: "第 3 话 · 回信", number: 3, language: "zh", pageCount: 8 },
  ],
  "paper-city": [
    { id: "ch-1", title: "档案一", number: 1, language: "zh", pageCount: 8 },
    { id: "ch-2", title: "档案二", number: 2, language: "zh", pageCount: 8 },
  ],
  "long-scroll": [
    { id: "ch-1", title: "上篇", number: 1, language: "zh", pageCount: 10 },
    { id: "ch-2", title: "下篇", number: 2, language: "zh", pageCount: 10 },
  ],
};

function baseUrl(ctx: PluginContext): string {
  const value = String(ctx.config.baseUrl ?? "http://127.0.0.1:8787");
  return value.replace(/\/+$/, "");
}

function withCover(manga: Manga, ctx: PluginContext): Manga {
  return {
    ...manga,
    coverUrl: `${baseUrl(ctx)}${manga.coverUrl ?? ""}`,
  };
}

function allManga(ctx: PluginContext): Manga[] {
  return MANGA.map((manga) => withCover(manga, ctx));
}

const plugin: MangaPlugin = {
  async browse(query: BrowseQuery, ctx) {
    const items = allManga(ctx);
    return { items, page: query.page, hasNextPage: false, total: items.length };
  },

  async search(query: SearchQuery, ctx) {
    const term = query.term.trim().toLowerCase();
    const items = allManga(ctx).filter(
      (manga) =>
        !term ||
        manga.title.toLowerCase().includes(term) ||
        manga.altTitles?.some((title) => title.toLowerCase().includes(term)) ||
        manga.genres?.some((genre) => genre.toLowerCase().includes(term)),
    );
    return { items, page: query.page, hasNextPage: false, total: items.length };
  },

  async getFilters() {
    return [
      {
        key: "sort",
        label: "排序",
        type: "sort",
        options: [
          { label: "默认", value: "default" },
          { label: "标题", value: "title" },
        ],
        default: "default",
      },
      {
        key: "keyword",
        label: "标题包含",
        type: "text",
        placeholder: "例如：月下",
      },
    ];
  },

  async getManga(mangaId, ctx) {
    const manga = MANGA.find((item) => item.id === mangaId);
    if (!manga) throw new Error(`Unknown manga: ${mangaId}`);
    return withCover(manga, ctx);
  },

  async getChapters(mangaId) {
    return CHAPTERS[mangaId] ?? [];
  },

  async getPages(mangaId, chapterId, ctx) {
    const chapters = CHAPTERS[mangaId] ?? [];
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`);
    const count = chapter.pageCount ?? 8;
    const pages: Page[] = [];
    for (let index = 0; index < count; index += 1) {
      pages.push({
        url: `${baseUrl(ctx)}/pages/${mangaId}/${chapterId}/${index + 1}.svg`,
        width: 800,
        height: 1200,
        mimeType: "image/svg+xml",
      });
    }
    return pages;
  },
};

export default plugin;
