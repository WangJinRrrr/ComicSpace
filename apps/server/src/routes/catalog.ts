import type { Hono } from "hono";
import {
  browseRequestSchema,
  chaptersQuerySchema,
  mangaQuerySchema,
  pagesQuerySchema,
  searchRequestSchema,
  sourceIdSchema,
} from "@comicspace/contracts";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { ok, parseJson, parseQuery } from "../lib/http.js";
import {
  browseSource,
  getChapters,
  getFilters,
  getMangaDetail,
  getReaderPayload,
  searchSource,
} from "../services/catalog.js";

function sourceParam(value: string): string {
  const parsed = sourceIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest("Invalid source id");
  return parsed.data;
}

export function registerCatalogRoutes(app: Hono, context: AppContext): void {
  const deps = context.catalog;

  app.post("/api/sources/:id/search", async (c) => {
    const sourceId = sourceParam(c.req.param("id"));
    const body = await parseJson(c, searchRequestSchema);
    return ok(
      c,
      await searchSource(deps, {
        sourceId,
        term: body.term,
        page: body.page,
        filters: body.filters,
        signal: c.req.raw.signal,
      }),
    );
  });

  app.post("/api/sources/:id/browse", async (c) => {
    const sourceId = sourceParam(c.req.param("id"));
    const body = await parseJson(c, browseRequestSchema);
    return ok(
      c,
      await browseSource(deps, {
        sourceId,
        page: body.page,
        filters: body.filters,
        signal: c.req.raw.signal,
      }),
    );
  });

  app.get("/api/sources/:id/filters", async (c) => {
    const sourceId = sourceParam(c.req.param("id"));
    return ok(
      c,
      await getFilters(deps, sourceId, c.req.raw.signal),
    );
  });

  app.get("/api/manga", async (c) => {
    const query = parseQuery(c, mangaQuerySchema);
    return ok(
      c,
      await getMangaDetail(deps, {
        sourceId: query.sourceId,
        mangaId: query.mangaId,
        refresh: query.refresh,
        signal: c.req.raw.signal,
      }),
    );
  });

  app.get("/api/chapters", async (c) => {
    const query = parseQuery(c, chaptersQuerySchema);
    return ok(
      c,
      await getChapters(deps, {
        sourceId: query.sourceId,
        mangaId: query.mangaId,
        refresh: query.refresh,
        signal: c.req.raw.signal,
      }),
    );
  });

  app.get("/api/pages", async (c) => {
    const query = parseQuery(c, pagesQuerySchema);
    return ok(
      c,
      await getReaderPayload(deps, {
        sourceId: query.sourceId,
        mangaId: query.mangaId,
        chapterId: query.chapterId,
        refresh: query.refresh,
        signal: c.req.raw.signal,
      }),
    );
  });
}
