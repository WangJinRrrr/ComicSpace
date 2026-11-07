import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../src/db/client.js";
import { ReadingCache } from "../src/cache/store.js";

let db: Db | null = null;
let dir: string | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("reading cache", () => {
  it("stores, hits, and clears image entries", async () => {
    db = createDatabase(":memory:");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comicspace-cache-"));
    const cache = new ReadingCache(db, dir, 1024 * 1024 * 1024);
    await cache.init();

    const entry = await cache.putBuffer(
      "key-1",
      {
        sourceId: "src",
        kind: "page",
        remoteUrl: "https://example.com/a.jpg",
        mime: "image/jpeg",
      },
      Buffer.from("fake image"),
    );
    expect(entry?.bytes).toBe(10);
    expect(fs.existsSync(entry?.filePath ?? "")).toBe(true);

    const hit = await cache.get("key-1");
    expect(hit?.cacheKey).toBe("key-1");
    expect(cache.getStats().hits).toBe(1);

    await cache.clear();
    expect(cache.getStats().entries).toBe(0);
    expect(await cache.get("key-1")).toBeNull();
  });

  it("evicts over the limit", async () => {
    db = createDatabase(":memory:");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comicspace-cache-"));
    const cache = new ReadingCache(db, dir, 1);
    await cache.init();
    await cache.putBuffer(
      "key-1",
      {
        sourceId: "src",
        kind: "page",
        remoteUrl: "https://example.com/a.jpg",
        mime: "image/jpeg",
      },
      Buffer.from("fake image"),
    );
    expect(cache.getStats().entries).toBe(0);
  });
});
