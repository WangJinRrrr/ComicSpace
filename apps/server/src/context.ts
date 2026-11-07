import type { AppEnv } from "./env.js";
import type { Db } from "./db/client.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { ImageProxy } from "./images/proxy.js";
import type { ReadingCache } from "./cache/store.js";
import type { SettingsService } from "./services/settings.js";
import type { DownloadService } from "./services/downloads.js";

export interface AppContext {
  env: AppEnv;
  db: Db;
  registry: PluginRegistry;
  imageProxy: ImageProxy;
  cache: ReadingCache;
  settings: SettingsService;
  downloads: DownloadService;
  catalog: {
    db: Db;
    registry: PluginRegistry;
    imageProxy: ImageProxy;
  };
}
