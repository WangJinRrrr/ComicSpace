import type { ReaderMode } from "@comicspace/contracts";
import { spreadIndexForPage, type Spread } from "./spreads";

/**
 * Page offset to open when moving `delta` spreads from the spread that holds
 * `pageIndex`. Returns null when the move would leave the chapter, so callers
 * can fall through to the next chapter instead of clamping silently.
 */
export function stepSpread(
  spreads: Spread[],
  pageIndex: number,
  delta: number,
): number | null {
  if (spreads.length === 0) return null;
  const target = spreadIndexForPage(spreads, pageIndex) + delta;
  if (target < 0 || target >= spreads.length) return null;
  return spreads[target]?.primaryPage ?? null;
}

/** True when the page (double mode: its spread) is the last one to read. */
export function isLastSpread(
  spreads: Spread[],
  pageIndex: number,
): boolean {
  if (spreads.length === 0) return false;
  return spreadIndexForPage(spreads, pageIndex) === spreads.length - 1;
}

export interface PrefetchWindow {
  /** Page offsets to load ahead of the current one. */
  ahead: number[];
  /** Page offsets to load behind it, for flipping back. */
  behind: number[];
}

const WINDOW: Record<ReaderMode, { ahead: number; behind: number }> = {
  single: { ahead: 7, behind: 2 },
  double: { ahead: 8, behind: 2 },
  webtoon: { ahead: 9, behind: 3 },
};

/**
 * Page offsets worth prefetching around `pageIndex`, in reading order.
 *
 * `scale` shrinks the forward window on slow or metered connections. The
 * backward window stays fixed: flipping back is usually one page and should
 * never be the thing that stalls.
 */
export function prefetchWindow(
  pageIndex: number,
  total: number,
  mode: ReaderMode,
  scale = 1,
): PrefetchWindow {
  const radius = WINDOW[mode];
  const last = Math.max(0, total - 1);
  const start = Math.max(0, pageIndex);
  const aheadCount =
    scale <= 0 ? 0 : Math.max(1, Math.ceil(radius.ahead * scale));
  const ahead: number[] = [];
  const aheadEnd = Math.min(last, start + aheadCount);
  for (let index = start + 1; index <= aheadEnd; index += 1) {
    ahead.push(index);
  }
  const behind: number[] = [];
  for (let index = Math.max(0, start - radius.behind); index < start; index += 1) {
    behind.push(index);
  }
  return { ahead, behind };
}

/**
 * Pages just past the normal prefetch window, loaded only after the reader has
 * been idle for a while. This is the "read ahead while nothing is happening"
 * pass: it turns a fast flick through the next few spreads into cache hits
 * without competing with the pages the reader is actually looking at.
 */
export function readAheadWindow(
  pageIndex: number,
  total: number,
  mode: ReaderMode,
  scale = 1,
  extra = 8,
): number[] {
  const last = Math.max(0, total - 1);
  const normal = prefetchWindow(pageIndex, total, mode, scale);
  const start = pageIndex + 1 + normal.ahead.length;
  const end = Math.min(last, start + Math.max(0, extra) - 1);
  const offsets: number[] = [];
  for (let index = start; index <= end; index += 1) {
    offsets.push(index);
  }
  return offsets;
}
