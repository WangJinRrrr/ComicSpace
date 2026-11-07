import { settingsUpdateSchema } from "@comicspace/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { ReadingCache } from "../src/cache/store.js";
import { createDatabase, type Db } from "../src/db/client.js";
import type { AppEnv } from "../src/env.js";
import type { ImageProxy } from "../src/images/proxy.js";
import {
  getGlobalProxyDispatcher,
  resolveProxyDispatcher,
  setGlobalProxyUrl,
} from "../src/lib/network.js";
import { SettingsService } from "../src/services/settings.js";

let db: Db | null = null;

afterEach(() => {
  db?.close();
  db = null;
  setGlobalProxyUrl("");
});

describe("proxy dispatcher", () => {
  it("returns undefined for empty or missing URLs", () => {
    expect(resolveProxyDispatcher("")).toBeUndefined();
    expect(resolveProxyDispatcher("   ")).toBeUndefined();
    expect(resolveProxyDispatcher(undefined)).toBeUndefined();
    expect(resolveProxyDispatcher(null)).toBeUndefined();
  });

  it("returns undefined for invalid or unsupported URLs", () => {
    expect(resolveProxyDispatcher("not a url")).toBeUndefined();
    expect(resolveProxyDispatcher("socks5://127.0.0.1:1080")).toBeUndefined();
    expect(resolveProxyDispatcher("ftp://127.0.0.1:21")).toBeUndefined();
  });

  it("returns a cached dispatcher for http(s) URLs", () => {
    const dispatcher = resolveProxyDispatcher("http://127.0.0.1:7890");
    expect(dispatcher).toBeDefined();
    expect(resolveProxyDispatcher("http://127.0.0.1:7890")).toBe(dispatcher);
    expect(resolveProxyDispatcher("https://proxy.example:8443")).toBeDefined();
  });

  it("uses the global proxy URL", () => {
    expect(getGlobalProxyDispatcher()).toBeUndefined();
    setGlobalProxyUrl("http://127.0.0.1:7890");
    expect(getGlobalProxyDispatcher()).toBeDefined();
    setGlobalProxyUrl("");
    expect(getGlobalProxyDispatcher()).toBeUndefined();
  });
});

describe("settings proxy", () => {
  const imageProxy = {
    setExtraAllowedHosts: () => {},
  } as unknown as ImageProxy;
  const cache = {
    setLimitBytes: () => {},
  } as unknown as ReadingCache;

  function createEnv(proxyUrl = ""): AppEnv {
    return {
      repoRoot: ".",
      host: "127.0.0.1",
      port: 4000,
      webOrigin: "http://127.0.0.1:5173",
      dataDir: ":memory:",
      pluginsDir: "plugins",
      pluginSdkEntry: "packages/plugin-sdk/runtime.mjs",
      webDist: "dist",
      imageExtraAllowedHosts: [],
      cacheLimitMb: 1024,
      proxyUrl,
    };
  }

  it("round-trips proxyUrl through the database", () => {
    db = createDatabase(":memory:");
    const service = new SettingsService(db, createEnv(), imageProxy, cache);
    service.apply();
    expect(service.get().proxyUrl).toBe("");
    expect(getGlobalProxyDispatcher()).toBeUndefined();

    const updated = service.update({ proxyUrl: "  http://127.0.0.1:7890  " });
    expect(updated.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(getGlobalProxyDispatcher()).toBeDefined();

    const reopened = new SettingsService(db, createEnv(), imageProxy, cache);
    expect(reopened.get().proxyUrl).toBe("http://127.0.0.1:7890");
    reopened.apply();
    expect(getGlobalProxyDispatcher()).toBeDefined();

    reopened.update({ proxyUrl: "" });
    expect(reopened.get().proxyUrl).toBe("");
    expect(getGlobalProxyDispatcher()).toBeUndefined();
  });

  it("falls back to the environment default until saved", () => {
    db = createDatabase(":memory:");
    const service = new SettingsService(
      db,
      createEnv("http://127.0.0.1:8888"),
      imageProxy,
      cache,
    );
    service.apply();
    expect(service.get().proxyUrl).toBe("http://127.0.0.1:8888");
    expect(getGlobalProxyDispatcher()).toBeDefined();

    service.update({ proxyUrl: "" });
    expect(service.get().proxyUrl).toBe("");
    expect(getGlobalProxyDispatcher()).toBeUndefined();
  });
});

describe("settingsUpdateSchema proxyUrl", () => {
  it("accepts empty, http, and https values", () => {
    expect(settingsUpdateSchema.parse({ proxyUrl: "" }).proxyUrl).toBe("");
    expect(
      settingsUpdateSchema.parse({ proxyUrl: "http://127.0.0.1:7890" })
        .proxyUrl,
    ).toBe("http://127.0.0.1:7890");
    expect(
      settingsUpdateSchema.parse({ proxyUrl: " https://proxy.example:8443 " })
        .proxyUrl,
    ).toBe("https://proxy.example:8443");
  });

  it("rejects unsupported protocols and malformed URLs", () => {
    expect(() =>
      settingsUpdateSchema.parse({ proxyUrl: "socks5://127.0.0.1:1080" }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ proxyUrl: "not a url" }),
    ).toThrow();
  });
});
