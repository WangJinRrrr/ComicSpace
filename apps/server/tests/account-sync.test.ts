import { afterEach, describe, expect, it } from "vitest";
import type { RemoteAccountSnapshot } from "@comicspace/plugin-sdk";
import { createDatabase, type Db } from "../src/db/client.js";
import { isInLibrary, listLibrary } from "../src/db/repos/library.js";
import { getCachedManga, upsertManga } from "../src/db/repos/manga.js";
import {
  getLatestProgress,
  getProgressForChapter,
  listHistory,
  listProgressForManga,
  upsertProgress,
} from "../src/db/repos/progress.js";
import { importAccountSnapshot } from "../src/services/accountSync.js";

let db: Db | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function snapshot(
  partial: Partial<RemoteAccountSnapshot> = {},
): RemoteAccountSnapshot {
  return {
    favorites: { available: true, items: [] },
    history: { available: true, items: [] },
    ...partial,
  };
}

describe("account import", () => {
  it("adds site favorites without removing or duplicating local ones", () => {
    db = createDatabase(":memory:");
    upsertManga(db, "copymanga", {
      id: "local-only",
      title: "Local Only",
      description: "keep me",
    });
    const library = db;
    library
      .prepare(
        "INSERT INTO library (source_id, manga_id, added_at) VALUES (?, ?, ?)",
      )
      .run("copymanga", "local-only", 50);

    const result = importAccountSnapshot(
      db,
      "copymanga",
      snapshot({
        favorites: {
          available: true,
          items: [
            { id: "local-only", title: "Overwrite", description: "nope" },
            { id: "site-only", title: "From Site", coverUrl: "https://cdn.example/a.jpg" },
            { id: "site-only", title: "From Site" },
          ],
        },
        history: { available: false, items: [], message: "历史页面没有章节。" },
      }),
    );

    expect(result.favoritesAdded).toBe(1);
    expect(result.favoritesKept).toBe(1);
    expect(isInLibrary(db, "copymanga", "local-only")).toBe(true);
    expect(isInLibrary(db, "copymanga", "site-only")).toBe(true);
    expect(listLibrary(db)).toHaveLength(2);
    expect(getCachedManga(db, "copymanga", "local-only")?.manga.description).toBe(
      "keep me",
    );
    expect(
      db
        .prepare(
          "SELECT added_at FROM library WHERE source_id = ? AND manga_id = ?",
        )
        .get("copymanga", "local-only"),
    ).toEqual({ added_at: 50 });
    expect(result.message).toContain("没有删除");
    expect(result.message).toContain("历史页面没有章节");
    expect(listHistory(db)).toEqual([]);
  });

  it("keeps a newer local read and still records an older remote chapter", () => {
    db = createDatabase(":memory:");
    upsertManga(db, "copymanga", { id: "m1", title: "Local Title" });
    upsertProgress(
      db,
      {
        sourceId: "copymanga",
        mangaId: "m1",
        chapterId: "c5",
        pageIndex: 10,
        mode: "double",
        completed: true,
      },
      5_000,
    );

    const result = importAccountSnapshot(
      db,
      "copymanga",
      snapshot({
        favorites: { available: false, items: [], message: "收藏页没有读到。" },
        history: {
          available: true,
          items: [
            {
              manga: { id: "m1", title: "Site Title" },
              chapterId: "c5",
              chapterTitle: "第五话",
              pageIndex: 2,
              readAt: 1_000,
            },
            {
              manga: { id: "m1", title: "Site Title" },
              chapterId: "c2",
              chapterTitle: "第二话",
              pageIndex: 1,
              readAt: 8_000,
            },
          ],
        },
      }),
    );

    expect(result.historyKeptLocal).toBe(1);
    expect(result.historyAdded).toBe(1);
    expect(getProgressForChapter(db, "copymanga", "m1", "c5")).toMatchObject({
      pageIndex: 10,
      mode: "double",
      completed: true,
      updatedAt: 5_000,
    });
    expect(getLatestProgress(db, "copymanga", "m1")?.chapterId).toBe("c2");
    expect(listHistory(db)[0]).toMatchObject({
      chapterId: "c2",
      chapterTitle: "第二话",
      pageIndex: 1,
    });
    expect(listProgressForManga(db, "copymanga", "m1")).toHaveLength(2);
    expect(getCachedManga(db, "copymanga", "m1")?.manga.title).toBe("Local Title");
    expect(isInLibrary(db, "copymanga", "m1")).toBe(false);
  });

  it("adopts a newer remote page and keeps the further page when times match", () => {
    db = createDatabase(":memory:");
    upsertProgress(
      db,
      {
        sourceId: "copymanga",
        mangaId: "m1",
        chapterId: "c1",
        pageIndex: 2,
        mode: "single",
        completed: false,
      },
      1_000,
    );

    importAccountSnapshot(
      db,
      "copymanga",
      snapshot({
        history: {
          available: true,
          items: [
            {
              manga: { id: "m1", title: "M" },
              chapterId: "c1",
              pageIndex: 4,
              readAt: 2_000,
            },
          ],
        },
      }),
    );
    expect(getProgressForChapter(db, "copymanga", "m1", "c1")?.pageIndex).toBe(4);

    const second = importAccountSnapshot(
      db,
      "copymanga",
      snapshot({
        history: {
          available: true,
          items: [
            {
              manga: { id: "m1", title: "M" },
              chapterId: "c1",
              pageIndex: 1,
              readAt: 2_000,
            },
          ],
        },
      }),
    );
    expect(second.historyKeptLocal).toBe(1);
    expect(getProgressForChapter(db, "copymanga", "m1", "c1")?.pageIndex).toBe(4);
  });

  it("does not write when neither side is available", () => {
    const database = createDatabase(":memory:");
    db = database;
    expect(() =>
      importAccountSnapshot(
        database,
        "copymanga",
        snapshot({
          favorites: { available: false, items: [], message: "空壳" },
          history: { available: false, items: [], message: "空壳" },
        }),
      ),
    ).toThrow(/空壳/);
    expect(listLibrary(db)).toEqual([]);
    expect(listHistory(db)).toEqual([]);
  });
});
