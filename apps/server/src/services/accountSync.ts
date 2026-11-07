import type { AccountSyncResultDto } from "@comicspace/contracts";
import {
  PluginError,
  type Manga,
  type RemoteAccountSnapshot,
  type RemoteHistoryEntry,
} from "@comicspace/plugin-sdk";
import type { Db } from "../db/client.js";
import { withTransaction } from "../db/client.js";
import { addToLibrary, isInLibrary } from "../db/repos/library.js";
import { getCachedManga, upsertManga } from "../db/repos/manga.js";
import { mergeRemoteRead } from "../db/repos/progress.js";
import { validateAccountSnapshot, validateManga } from "../plugins/validate.js";
import { invokePlugin } from "../plugins/invoke.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { getCallableSource } from "./sources.js";

export interface AccountSyncDeps {
  db: Db;
  registry: PluginRegistry;
}

function rememberManga(db: Db, sourceId: string, manga: Manga): void {
  if (getCachedManga(db, sourceId, manga.id)) return;
  upsertManga(db, sourceId, manga);
}

function importFavorites(
  db: Db,
  sourceId: string,
  items: Manga[],
): { added: number; kept: number; skipped: number } {
  let added = 0;
  let kept = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of items) {
    let manga: Manga;
    try {
      const candidate = { ...raw };
      if (candidate.coverUrl && !/^https:\/\//i.test(candidate.coverUrl)) {
        delete candidate.coverUrl;
      }
      manga = validateManga(candidate);
    } catch {
      skipped += 1;
      continue;
    }
    if (seen.has(manga.id)) continue;
    seen.add(manga.id);
    rememberManga(db, sourceId, manga);
    const existed = isInLibrary(db, sourceId, manga.id);
    addToLibrary(db, sourceId, manga.id);
    if (existed) kept += 1;
    else added += 1;
  }
  return { added, kept, skipped };
}

function importHistory(
  db: Db,
  sourceId: string,
  items: RemoteHistoryEntry[],
): { added: number; updated: number; kept: number; skipped: number } {
  let added = 0;
  let updated = 0;
  let kept = 0;
  let skipped = 0;
  const byChapter = new Map<string, RemoteHistoryEntry>();
  for (const item of items) {
    if (!item?.chapterId || !item.manga?.id) {
      skipped += 1;
      continue;
    }
    const key = `${item.manga.id}\0${item.chapterId}`;
    const previous = byChapter.get(key);
    if (!previous || (item.readAt ?? 0) >= (previous.readAt ?? 0)) {
      byChapter.set(key, item);
    }
  }
  const ordered = [...byChapter.values()].sort(
    (a, b) => (a.readAt ?? 0) - (b.readAt ?? 0),
  );
  for (const item of ordered) {
    let manga: Manga;
    try {
      const candidate = { ...item.manga };
      if (candidate.coverUrl && !/^https:\/\//i.test(candidate.coverUrl)) {
        delete candidate.coverUrl;
      }
      manga = validateManga(candidate);
    } catch {
      skipped += 1;
      continue;
    }
    rememberManga(db, sourceId, manga);
    const outcome = mergeRemoteRead(db, {
      sourceId,
      mangaId: manga.id,
      chapterId: item.chapterId,
      chapterTitle: item.chapterTitle,
      pageIndex: item.pageIndex ?? 0,
      readAt: item.readAt ?? null,
    });
    if (outcome === "added") added += 1;
    else if (outcome === "updated") updated += 1;
    else kept += 1;
  }
  return { added, updated, kept, skipped };
}

function describeResult(
  snapshot: RemoteAccountSnapshot,
  favorites: { added: number; kept: number; skipped: number },
  history: { added: number; updated: number; kept: number; skipped: number },
): string {
  const lines: string[] = [];
  if (!snapshot.favorites.available) {
    lines.push(`收藏：未写入。${snapshot.favorites.message ?? ""}`.trim());
  } else {
    lines.push(
      `收藏：新增 ${favorites.added} 本，${favorites.kept} 本本来就在书架（原记录保留）。`,
    );
    if (snapshot.favorites.message) lines.push(snapshot.favorites.message);
  }
  if (!snapshot.history.available) {
    lines.push(`阅读历史：未写入。${snapshot.history.message ?? ""}`.trim());
  } else {
    lines.push(
      `阅读历史：新增 ${history.added} 条，更新 ${history.updated} 条，保留较新的本地进度 ${history.kept} 条。`,
    );
    if (snapshot.history.message) lines.push(snapshot.history.message);
  }
  const skipped = favorites.skipped + history.skipped;
  if (skipped > 0) lines.push(`有 ${skipped} 条无法识别，已跳过。`);
  lines.push("没有删除只存在于本地的收藏、历史或阅读进度，也没有向网站写入。");
  return lines.join("\n");
}

export function importAccountSnapshot(
  db: Db,
  sourceId: string,
  snapshot: RemoteAccountSnapshot,
): AccountSyncResultDto {
  if (!snapshot.favorites.available && !snapshot.history.available) {
    const message = [snapshot.favorites.message, snapshot.history.message]
      .filter(Boolean)
      .join("\n");
    throw new PluginError(
      "unsupported",
      message || "网站没有返回可导入的收藏或阅读历史。本地数据没有改动。",
    );
  }

  return withTransaction(db, () => {
    const favorites = snapshot.favorites.available
      ? importFavorites(db, sourceId, snapshot.favorites.items)
      : { added: 0, kept: 0, skipped: 0 };
    const history = snapshot.history.available
      ? importHistory(db, sourceId, snapshot.history.items)
      : { added: 0, updated: 0, kept: 0, skipped: 0 };
    return {
      sourceId,
      favoritesAdded: favorites.added,
      favoritesKept: favorites.kept,
      historyAdded: history.added,
      historyUpdated: history.updated,
      historyKeptLocal: history.kept,
      message: describeResult(snapshot, favorites, history),
    };
  });
}

export async function syncSourceAccount(
  deps: AccountSyncDeps,
  sourceId: string,
): Promise<AccountSyncResultDto> {
  const callable = await getCallableSource(deps.registry, deps.db, sourceId);
  if (!callable.plugin.capabilities.accountSync) {
    throw new PluginError(
      "unsupported",
      `${callable.plugin.manifest.name} 不支持从网站同步收藏和阅读历史`,
    );
  }
  const raw = await invokePlugin<unknown>(
    callable.plugin,
    "pullAccount",
    [],
    {
      config: callable.config,
      timeoutMs: 30_000,
      limiter: deps.registry.limiterFor(callable.plugin),
    },
  );
  const snapshot = validateAccountSnapshot(raw);
  return importAccountSnapshot(deps.db, sourceId, snapshot);
}
