import type { Hono } from "hono";
import { settingsUpdateSchema } from "@comicspace/contracts";
import type { AppContext } from "../context.js";
import { ok, parseJson } from "../lib/http.js";

export function registerSettingsRoutes(app: Hono, context: AppContext): void {
  app.get("/api/settings", (c) => ok(c, context.settings.get()));

  app.put("/api/settings", async (c) => {
    const body = await parseJson(c, settingsUpdateSchema);
    return ok(c, context.settings.update(body));
  });

  app.get("/api/health", (c) =>
    ok(c, {
      ok: true,
      dataDir: context.env.dataDir,
      pluginsDir: context.env.pluginsDir,
      now: Date.now(),
    }),
  );
}
