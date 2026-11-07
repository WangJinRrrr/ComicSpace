import type { PageDto } from "@comicspace/contracts";

export interface Spread {
  index: number;
  pages: PageDto[];
  /**
   * Array offset of the first page in the chapter's page list. Navigation and
   * progress use offsets, not `PageDto.index`, so sparse page indexes (a
   * downloaded chapter with a failed middle page) cannot shift the target.
   */
  primaryPage: number;
  wide: boolean;
}

export interface SpreadOptions {
  rtl: boolean;
  coverAlone: boolean;
  wideRatio: number;
}

export function pageAspectRatio(page: PageDto): number {
  if (page.width && page.height && page.width > 0 && page.height > 0) {
    return page.width / page.height;
  }
  return 2 / 3;
}

export function isWidePage(page: PageDto, wideRatio = 1.2): boolean {
  return pageAspectRatio(page) >= wideRatio;
}

export function buildSpreads(
  pages: PageDto[],
  options: SpreadOptions,
): Spread[] {
  const spreads: Spread[] = [];
  let index = 0;

  while (index < pages.length) {
    const page = pages[index] as PageDto;
    const wide = isWidePage(page, options.wideRatio);
    const coverAlone = options.coverAlone && index === 0;

    if (wide || coverAlone) {
      spreads.push({
        index: spreads.length,
        pages: [page],
        primaryPage: index,
        wide,
      });
      index += 1;
      continue;
    }

    const next = pages[index + 1];
    if (next && !isWidePage(next, options.wideRatio)) {
      spreads.push({
        index: spreads.length,
        pages: [page, next],
        primaryPage: index,
        wide: false,
      });
      index += 2;
    } else {
      spreads.push({
        index: spreads.length,
        pages: [page],
        primaryPage: index,
        wide: false,
      });
      index += 1;
    }
  }

  return spreads;
}

/**
 * Spread that holds the page at `pageIndex` (an array offset). Offsets past
 * the end resolve to the last spread, so a stale progress value still lands
 * on readable pages instead of jumping back to the cover.
 */
export function spreadIndexForPage(
  spreads: Spread[],
  pageIndex: number,
): number {
  if (spreads.length === 0) return 0;
  let found = -1;
  for (const [index, spread] of spreads.entries()) {
    if (pageIndex < spread.primaryPage) break;
    found = index;
  }
  return found >= 0 ? found : 0;
}
