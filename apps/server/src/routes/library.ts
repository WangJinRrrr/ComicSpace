import type { Hono } from "hono";
import {
  libraryAddSchema,
  libraryRemoveQuerySchema,
  progressUpdateSchema,
} from "@comicspace/contracts";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { ok, parseJson, parseQuery } from "../lib/http.js";
import {
  clearHistory,
  getProgressForChapter,
  upsertProgress,
} from "../db/repos/progress.js";
import {
  addLibraryItem,
  listHistoryItems,
  listLibraryItems,
  removeLibraryItem,
} from "../services/library.js";

export function registerLibraryRoutes(app: Hono, context: AppContext): void {
  app.get("/api/library", async (c) => {
    return ok(c, await listLibraryItems(context.catalog));
  });

  app.post("/api/library", async (c) => {
    const body = await parseJson(c, libraryAddSchema);
    return ok(
      c,
      await addLibraryItem(context.catalog, body.sourceId, body.mangaId),
      201,
    );
  });

  app.delete("/api/library", async (c) => {
    const query = parseQuery(c, libraryRemoveQuerySchema);
    const removed = removeLibraryItem(
      context.db,
      query.sourceId,
      query.mangaId,
    );
    if (!removed) throw notFound("Manga is not in the library");
    return ok(c, { removed: true });
  });

  app.put("/api/progress", async (c) => {
    const body = await parseJson(c, progressUpdateSchema);
    upsertProgress(context.db, {
      sourceId: body.sourceId,
      mangaId: body.mangaId,
      chapterId: body.chapterId,
      pageIndex: body.pageIndex,
      mode: body.mode,
      completed: body.completed ?? false,
    });
    return ok(
      c,
      getProgressForChapter(
        context.db,
        body.sourceId,
        body.mangaId,
        body.chapterId,
      ),
    );
  });

  app.get("/api/history", async (c) => {
    return ok(c, await listHistoryItems(context.catalog));
  });

  app.delete("/api/history", async (c) => {
    clearHistory(context.db);
    return ok(c, { cleared: true });
  });
}
