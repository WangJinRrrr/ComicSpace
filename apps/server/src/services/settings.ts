import type { SettingsDto } from "@comicspace/contracts";
import type { AppEnv } from "../env.js";
import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../db/repos/settings.js";
import type { ReadingCache } from "../cache/store.js";
import type { ImageProxy } from "../images/proxy.js";
import { setGlobalProxyUrl } from "../lib/network.js";

const EXTRA_HOSTS_KEY = "image.extraAllowedHosts";
const CACHE_LIMIT_KEY = "cache.limitMb";
const PROXY_URL_KEY = "network.proxyUrl";

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly env: AppEnv,
    private readonly imageProxy: ImageProxy,
    private readonly cache: ReadingCache,
  ) {}

  private readExtraHosts(): string[] {
    const stored = getSetting<string[] | null>(this.db, EXTRA_HOSTS_KEY, null);
    return stored ?? this.env.imageExtraAllowedHosts;
  }

  private readCacheLimitMb(): number {
    return getSetting<number>(this.db, CACHE_LIMIT_KEY, this.env.cacheLimitMb);
  }

  private readProxyUrl(): string {
    return getSetting<string>(this.db, PROXY_URL_KEY, this.env.proxyUrl);
  }

  apply(): void {
    this.imageProxy.setExtraAllowedHosts(this.readExtraHosts());
    this.cache.setLimitBytes(this.readCacheLimitMb() * 1024 * 1024);
    setGlobalProxyUrl(this.readProxyUrl());
  }

  get(): SettingsDto {
    return {
      imageExtraAllowedHosts: this.readExtraHosts(),
      cacheLimitMb: this.readCacheLimitMb(),
      proxyUrl: this.readProxyUrl(),
      dataDir: this.env.dataDir,
      pluginsDir: this.env.pluginsDir,
    };
  }

  update(input: {
    imageExtraAllowedHosts?: string[];
    cacheLimitMb?: number;
    proxyUrl?: string;
  }): SettingsDto {
    if (input.imageExtraAllowedHosts !== undefined) {
      setSetting(
        this.db,
        EXTRA_HOSTS_KEY,
        input.imageExtraAllowedHosts
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean),
      );
    }
    if (input.cacheLimitMb !== undefined) {
      setSetting(this.db, CACHE_LIMIT_KEY, input.cacheLimitMb);
    }
    if (input.proxyUrl !== undefined) {
      setSetting(this.db, PROXY_URL_KEY, input.proxyUrl.trim());
    }
    this.apply();
    return this.get();
  }
}
