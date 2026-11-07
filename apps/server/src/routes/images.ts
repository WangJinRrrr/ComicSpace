import type { Hono } from "hono";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { ok } from "../lib/http.js";

export function registerImageRoutes(app: Hono, context: AppContext): void {
  app.get("/api/image/:token", async (c) => {
    const token = c.req.param("token");
    if (!token) throw badRequest("Missing image ticket");
    return context.imageProxy.serve(token, c.req.raw.signal);
  });

  app.get("/api/cache", (c) => ok(c, context.cache.getStats()));

  app.delete("/api/cache", async (c) => {
    await context.cache.clear();
    return ok(c, context.cache.getStats());
  });
}
