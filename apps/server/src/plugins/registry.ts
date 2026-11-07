import type { PluginLoader, PluginScan, LoadedPlugin } from "./loader.js";
import { PluginLimiter } from "./limiter.js";

const SCAN_TTL_MS = 1500;

export class PluginRegistry {
  private cached: PluginScan | null = null;
  private cachedAt = 0;
  private readonly limiters = new Map<string, PluginLimiter>();

  constructor(private readonly loader: PluginLoader) {}

  async scan(force = false): Promise<PluginScan> {
    const fresh =
      this.cached !== null && Date.now() - this.cachedAt < SCAN_TTL_MS;
    if (!force && fresh) return this.cached as PluginScan;

    const scan = await this.loader.scan({ forceReload: force });
    this.cached = scan;
    this.cachedAt = Date.now();
    if (force) this.limiters.clear();
    return scan;
  }

  async reload(): Promise<PluginScan> {
    return this.scan(true);
  }

  async getPlugin(id: string): Promise<LoadedPlugin | null> {
    const scan = await this.scan();
    return scan.plugins.find((plugin) => plugin.id === id) ?? null;
  }

  limiterFor(plugin: LoadedPlugin): PluginLimiter {
    const existing = this.limiters.get(plugin.id);
    if (existing) return existing;
    const configured = plugin.manifest.rateLimit?.maxConcurrency ?? 3;
    const maxConcurrency = Math.max(1, Math.min(16, configured));
    const minIntervalMs = Math.max(
      0,
      Math.min(60000, plugin.manifest.rateLimit?.minIntervalMs ?? 0),
    );
    const limiter = new PluginLimiter(maxConcurrency, minIntervalMs);
    this.limiters.set(plugin.id, limiter);
    return limiter;
  }
}
