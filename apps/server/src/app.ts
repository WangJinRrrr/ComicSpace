import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppContext } from "./context.js";
import { AppError, normalizeError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerDownloadRoutes } from "./routes/downloads.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerUpdateRoutes } from "./routes/updates.js";

export function createApp(context: AppContext): Hono {
  const app = new Hono();
  const logger = createLogger("http");
  const allowedOrigins = new Set([
    context.env.webOrigin,
    `http://${context.env.host}:${context.env.port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);

  app.use(
    "/api/*",
    cors({
      origin: [...allowedOrigins],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 86400,
    }),
  );

  app.use("/api/*", async (c, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && !allowedOrigins.has(origin)) {
        throw new AppError(
          403,
          "origin_rejected",
          "Request origin is not allowed",
        );
      }
    }
    await next();
  });

  registerSourceRoutes(app, context);
  registerCatalogRoutes(app, context);
  registerLibraryRoutes(app, context);
  registerDownloadRoutes(app, context);
  registerImageRoutes(app, context);
  registerSettingsRoutes(app, context);
  registerUpdateRoutes(app, context);

  app.all("/api/*", (c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "API route not found",
        },
      },
      404,
    ),
  );

  const indexFile = path.join(context.env.webDist, "index.html");
  if (fs.existsSync(indexFile)) {
    app.use("*", serveStatic({ root: context.env.webDist }));
    app.get("*", (c) => {
      if (c.req.path.startsWith("/assets/")) {
        return c.notFound();
      }
      return c.html(fs.readFileSync(indexFile, "utf8"));
    });
  } else {
    app.get("/", (c) =>
      c.text(
        "ComicSpace API is running. Start the Vite dev server for the UI.",
      ),
    );
  }

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json(
        {
          error: {
            code: "not_found",
            message: "Route not found",
          },
        },
        404,
      );
    }
    return c.text("Not found", 404);
  });

  app.onError((error, c) => {
    const normalized = normalizeError(error);
    if (normalized.status >= 500) {
      logger.error(`${c.req.method} ${c.req.path} failed`, error);
    }
    return c.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
          ...(normalized.details !== undefined
            ? { details: normalized.details }
            : {}),
        },
      },
      normalized.status as ContentfulStatusCode,
    );
  });

  return app;
}
