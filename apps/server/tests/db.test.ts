import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../src/db/client.js";
import {
  getCachedChapters,
  getCachedManga,
  getCachedPages,
  upsertChapters,
  upsertManga,
  upsertPages,
} from "../src/db/repos/manga.js";
import {
  addToLibrary,
  getUnreadCount,
  isInLibrary,
  listLibrary,
  removeFromLibrary,
} from "../src/db/repos/library.js";
import {
  getLatestProgress,
  listHistory,
  listProgressForManga,
  upsertProgress,
} from "../src/db/repos/progress.js";
import {
  createDownload,
  getDownloadByChapter,
  listDownloadPages,
  markDownloadPageDone,
  updateDownloadProgress,
  updateDownloadStatus,
} from "../src/db/repos/downloads.js";

let db: Db | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("database repositories", () => {
  it("migrates and round-trips manga, chapters, and pages", () => {
    db = createDatabase(":memory:");
    upsertManga(db, "src", {
      id: "m1",
      title: "Manga One",
      authors: ["A"],
      coverUrl: "https://example.com/cover.jpg",
    });
    const manga = getCachedManga(db, "src", "m1");
    expect(manga?.manga.title).toBe("Manga One");

    upsertChapters(db, "src", "m1", [
      { id: "c2", title: "Chapter 2", number: 2 },
      { id: "c1", title: "Chapter 1", number: 1 },
    ]);
    const chapters = getCachedChapters(db, "src", "m1");
    expect(chapters?.chapters.map((chapter) => chapter.id)).toEqual(["c2", "c1"]);

    upsertPages(db, "src", "m1", "c1", [
      {
        url: "https://example.com/1.jpg",
        width: 800,
        height: 1200,
        transform: { type: "band-reverse", bands: 10 },
      },
      { url: "https://example.com/2.jpg" },
    ]);
    const pages = getCachedPages(db, "src", "m1", "c1");
    expect(pages?.pages).toHaveLength(2);
    expect(pages?.pages[0]?.width).toBe(800);
    expect(pages?.pages[0]?.transform).toEqual({
      type: "band-reverse",
      bands: 10,
    });
    expect(pages?.pages[1]?.transform).toBeUndefined();
  });

  it("maintains library, progress, history, and unread counts", () => {
    db = createDatabase(":memory:");
    upsertManga(db, "src", { id: "m1", title: "Manga One" });
    upsertChapters(db, "src", "m1", [
      { id: "c1", title: "Chapter 1", number: 1 },
      { id: "c2", title: "Chapter 2", number: 2 },
    ]);
    addToLibrary(db, "src", "m1");
    expect(isInLibrary(db, "src", "m1")).toBe(true);
    expect(listLibrary(db)).toHaveLength(1);
    expect(getUnreadCount(db, "src", "m1")).toBe(2);

    upsertProgress(db, {
      sourceId: "src",
      mangaId: "m1",
      chapterId: "c1",
      pageIndex: 3,
      mode: "single",
      completed: true,
    });
    expect(getLatestProgress(db, "src", "m1")?.pageIndex).toBe(3);
    expect(getUnreadCount(db, "src", "m1")).toBe(1);
    expect(listProgressForManga(db, "src", "m1")).toHaveLength(1);
    expect(listHistory(db)).toHaveLength(1);
    expect(listHistory(db)[0]?.mangaTitle).toBe("Manga One");

    removeFromLibrary(db, "src", "m1");
    expect(isInLibrary(db, "src", "m1")).toBe(false);
  });

  it("tracks download pages and counters", () => {
    db = createDatabase(":memory:");
    const download = createDownload(db, {
      sourceId: "src",
      mangaId: "m1",
      chapterId: "c1",
      totalPages: 2,
    });
    const pages = listDownloadPages(db, download.id);
    expect(pages).toHaveLength(2);

    markDownloadPageDone(db, pages[0]!.id, "F:/tmp/1.jpg", "image/jpeg", 123);
    updateDownloadProgress(db, download.id);
    expect(getDownloadByChapter(db, "src", "m1", "c1")?.completedPages).toBe(1);
    updateDownloadStatus(db, download.id, "completed");
    expect(getDownloadByChapter(db, "src", "m1", "c1")?.status).toBe("completed");
  });
});
