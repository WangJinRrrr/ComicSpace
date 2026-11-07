import type { Hono } from "hono";
import type { AppContext } from "../context.js";
import { AppError } from "../lib/errors.js";
import { ok } from "../lib/http.js";
import {
  checkForUpdate,
  currentUpdateRuntime,
  downloadPlatformUpdate,
  openDownloadedUpdate,
  readBundledVersion,
} from "../services/updates.js";

function githubToken(): string | undefined {
  const token = process.env.COMICSPACE_GITHUB_TOKEN?.trim();
  return token || undefined;
}

export function registerUpdateRoutes(app: Hono, context: AppContext): void {
  app.get("/api/updates", async (c) => {
    const result = await checkForUpdate(currentUpdateRuntime(readBundledVersion()), {
      token: githubToken(),
      signal: c.req.raw.signal,
    });
    return ok(c, result);
  });

  app.post("/api/updates/fetch", async (c) => {
    const result = await downloadPlatformUpdate({
      runtime: currentUpdateRuntime(readBundledVersion()),
      dataDir: context.env.dataDir,
      token: githubToken(),
    });
    if (!result.ok) {
      throw new AppError(result.status, result.code, result.message, {
        retryable: result.code === "rate_limited" || result.code === "network_error",
      });
    }
    return ok(c, {
      fileName: result.fileName,
      bytes: result.bytes,
      directory: result.directory,
      message: result.message,
      installMode: result.installMode,
    });
  });

  app.post("/api/updates/open", (c) => {
    const runtime = currentUpdateRuntime(readBundledVersion());
    return ok(
      c,
      openDownloadedUpdate({
        dataDir: context.env.dataDir,
        platform: runtime.platform,
        packaging: runtime.packaging,
      }),
    );
  });
}
