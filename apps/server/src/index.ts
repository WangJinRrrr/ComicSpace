import { setDefaultResultOrder } from "node:dns";
import path from "node:path";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { openDatabase } from "./db/client.js";
import { PluginLoader } from "./plugins/loader.js";
import { PluginRegistry } from "./plugins/registry.js";
import { ReadingCache } from "./cache/store.js";
import { loadOrCreateSecret } from "./images/ticket.js";
import { ImageProxy } from "./images/proxy.js";
import { SettingsService } from "./services/settings.js";
import { DownloadWorker } from "./downloads/worker.js";
import { DownloadService } from "./services/downloads.js";
import { createApp } from "./app.js";
import { serverLogger } from "./lib/logger.js";

// Prefer IPv4 for the manga CDNs used by the built-in sources. On networks
// with a broken IPv6 route, Node's default "verbatim" order spends several
// seconds on IPv6 before falling back, which makes covers and pages feel stuck.
setDefaultResultOrder("ipv4first");

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDatabase(env.dataDir);
  const loader = new PluginLoader({
    pluginsDir: env.pluginsDir,
    sdkEntry: env.pluginSdkEntry,
  });
  const registry = new PluginRegistry(loader);
  const cache = new ReadingCache(
    db,
    path.join(env.dataDir, "cache", "images"),
    env.cacheLimitMb * 1024 * 1024,
  );
  await cache.init();

  const secret = loadOrCreateSecret(env.dataDir);
  const imageProxy = new ImageProxy(registry, cache, secret, {
    extraAllowedHosts: env.imageExtraAllowedHosts,
  });
  const settings = new SettingsService(db, env, imageProxy, cache);
  settings.apply();

  const worker = new DownloadWorker(
    db,
    registry,
    imageProxy,
    path.join(env.dataDir, "downloads"),
  );
  const downloads = new DownloadService(db, registry, worker);
  worker.start();

  const app = createApp({
    env,
    db,
    registry,
    imageProxy,
    cache,
    settings,
    downloads,
    catalog: { db, registry, imageProxy },
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: env.port,
      hostname: env.host,
    },
    (info) => {
      serverLogger.info(
        `ComicSpace API listening on http://${info.address}:${info.port}`,
      );
    },
  );

  const shutdown = () => {
    serverLogger.info("Shutting down");
    worker.stop();
    server.close();
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  serverLogger.error("Failed to start ComicSpace", error);
  process.exit(1);
});
