import { randomBytes } from "node:crypto";
import { probeImageSize } from "../images/size.js";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Db } from "../db/client.js";
import {
  clearCacheEntries,
  deleteCacheEntry,
  getCacheEntry,
  getCacheStats,
  insertCacheEntry,
  listAllCacheEntries,
  listCacheForEviction,
  touchCacheEntry,
  type CacheEntryRecord,
} from "../db/repos/cache.js";
import { extensionForMime } from "./key.js";
import { createLogger } from "../lib/logger.js";

/**
 * Windows rejects a replace while another handle holds the destination (the
 * reader may still be streaming it, or two fills raced). When the file already
 * exists the contents are equivalent, so dropping our temp copy is enough.
 */
async function renameIntoPlace(
  tempPath: string,
  filePath: string,
): Promise<void> {
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    if (!fs.existsSync(filePath)) throw error;
    await fs.promises.rm(tempPath, { force: true });
  }
}

export interface CacheMetadata {
  sourceId: string;
  kind: "page" | "cover";
  remoteUrl: string;
  mime: string;
  width?: number;
  height?: number;
}

export class ReadingCache {
  private readonly logger = createLogger("cache");
  private hits = 0;
  private misses = 0;
  private limitBytes: number;

  constructor(
    private readonly db: Db,
    private readonly rootDir: string,
    limitBytes: number,
  ) {
    this.limitBytes = limitBytes;
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.rootDir, { recursive: true });
    await this.removePartialFiles();
    for (const entry of listAllCacheEntries(this.db)) {
      if (!fs.existsSync(entry.filePath)) {
        deleteCacheEntry(this.db, entry.cacheKey);
      }
    }
  }

  setLimitBytes(limitBytes: number): void {
    this.limitBytes = Math.max(128 * 1024 * 1024, limitBytes);
    void this.evictIfNeeded();
  }

  async get(key: string): Promise<CacheEntryRecord | null> {
    const entry = getCacheEntry(this.db, key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    try {
      await fs.promises.access(entry.filePath, fs.constants.R_OK);
    } catch {
      deleteCacheEntry(this.db, key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    touchCacheEntry(this.db, key);
    return entry;
  }

  async putStream(
    key: string,
    metadata: CacheMetadata,
    stream: ReadableStream<Uint8Array>,
  ): Promise<CacheEntryRecord | null> {
    const extension = extensionForMime(metadata.mime);
    const shard = key.slice(0, 2);
    const dir = path.join(this.rootDir, shard);
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${key}.${extension}`);
    const tempPath = path.join(dir, `${key}.${randomBytes(6).toString("hex")}.part`);

    try {
      await pipeline(Readable.fromWeb(stream as never), fs.createWriteStream(tempPath));
      const stat = await fs.promises.stat(tempPath);
      await renameIntoPlace(tempPath, filePath);
      const size =
        metadata.width && metadata.height
          ? null
          : await probeImageSize(filePath);
      insertCacheEntry(this.db, {
        cacheKey: key,
        sourceId: metadata.sourceId,
        kind: metadata.kind,
        remoteUrl: metadata.remoteUrl,
        filePath,
        mime: metadata.mime,
        bytes: stat.size,
        width: metadata.width ?? size?.width,
        height: metadata.height ?? size?.height,
      });
      void this.evictIfNeeded();
      return getCacheEntry(this.db, key);
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      this.logger.warn("Could not store image cache entry", error);
      return null;
    }
  }

  async putBuffer(
    key: string,
    metadata: CacheMetadata,
    buffer: Buffer,
  ): Promise<CacheEntryRecord | null> {
    const extension = extensionForMime(metadata.mime);
    const shard = key.slice(0, 2);
    const dir = path.join(this.rootDir, shard);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${key}.${extension}`);
    const tempPath = path.join(dir, `${key}.${randomBytes(6).toString("hex")}.part`);
    try {
      await fs.promises.writeFile(tempPath, buffer);
      await renameIntoPlace(tempPath, filePath);
      insertCacheEntry(this.db, {
        cacheKey: key,
        sourceId: metadata.sourceId,
        kind: metadata.kind,
        remoteUrl: metadata.remoteUrl,
        filePath,
        mime: metadata.mime,
        bytes: buffer.byteLength,
        width: metadata.width,
        height: metadata.height,
      });
      await this.evictIfNeeded();
      return getCacheEntry(this.db, key);
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      this.logger.warn("Could not store image cache entry", error);
      return null;
    }
  }

  getStats() {
    const dbStats = getCacheStats(this.db);
    return {
      ...dbStats,
      limitBytes: this.limitBytes,
      hits: this.hits,
      misses: this.misses,
    };
  }

  async clear(): Promise<void> {
    clearCacheEntries(this.db);
    await fs.promises.rm(this.rootDir, { recursive: true, force: true });
    await fs.promises.mkdir(this.rootDir, { recursive: true });
    this.hits = 0;
    this.misses = 0;
  }

  async evictIfNeeded(): Promise<void> {
    let stats = getCacheStats(this.db);
    if (stats.bytes <= this.limitBytes) return;

    const target = Math.floor(this.limitBytes * 0.9);
    const candidates = listCacheForEviction(this.db, 5000);
    for (const candidate of candidates) {
      if (stats.bytes <= target) break;
      try {
        await fs.promises.unlink(candidate.filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          this.logger.warn(`Could not evict ${candidate.filePath}`, error);
          continue;
        }
      }
      deleteCacheEntry(this.db, candidate.cacheKey);
      stats = getCacheStats(this.db);
    }
  }

  private async removePartialFiles(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.rootDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(this.rootDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await fs.promises
          .readdir(full, { withFileTypes: true })
          .catch(() => []);
        await Promise.all(
          nested
            .filter((item) => item.isFile() && item.name.endsWith(".part"))
            .map((item) => fs.promises.rm(path.join(full, item.name), { force: true })),
        );
      } else if (entry.isFile() && entry.name.endsWith(".part")) {
        await fs.promises.rm(full, { force: true });
      }
    }
  }
}
