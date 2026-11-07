import fs from "node:fs";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import {
  downloadCreateSchema,
  downloadIdParamSchema,
  downloadPageIdParamSchema,
} from "@comicspace/contracts";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../lib/errors.js";
import { ok, parseJson } from "../lib/http.js";

export function registerDownloadRoutes(app: Hono, context: AppContext): void {
  app.get("/api/downloads", (c) => ok(c, context.downloads.list()));

  app.post("/api/downloads", async (c) => {
    const body = await parseJson(c, downloadCreateSchema);
    return ok(
      c,
      await context.downloads.start({
        sourceId: body.sourceId,
        mangaId: body.mangaId,
        chapterIds: body.chapterIds,
        signal: c.req.raw.signal,
      }),
      202,
    );
  });

  app.post("/api/downloads/:id/cancel", async (c) => {
    const parsed = downloadIdParamSchema.safeParse(c.req.param("id"));
    if (!parsed.success) throw badRequest("Invalid download id");
    const result = await context.downloads.cancel(parsed.data);
    if (!result) throw notFound("Download not found");
    return ok(c, result);
  });

  app.post("/api/downloads/:id/retry", async (c) => {
    const parsed = downloadIdParamSchema.safeParse(c.req.param("id"));
    if (!parsed.success) throw badRequest("Invalid download id");
    const result = await context.downloads.retry(parsed.data);
    if (!result) throw notFound("Download not found");
    return ok(c, result);
  });

  app.delete("/api/downloads/:id", async (c) => {
    const parsed = downloadIdParamSchema.safeParse(c.req.param("id"));
    if (!parsed.success) throw badRequest("Invalid download id");
    const removed = await context.downloads.remove(parsed.data);
    if (!removed) throw notFound("Download not found");
    return ok(c, { removed: true });
  });

  app.get("/api/downloads/pages/:pageId", async (c) => {
    const parsed = downloadPageIdParamSchema.safeParse(c.req.param("pageId"));
    if (!parsed.success) throw badRequest("Invalid page id");
    const page = context.downloads.getPageFile(parsed.data);
    if (!page) throw notFound("Downloaded page not found");
    const body = Readable.toWeb(
      fs.createReadStream(page.filePath),
    ) as unknown as ReadableStream;
    return new Response(body, {
      headers: {
        "content-type": page.mime,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
