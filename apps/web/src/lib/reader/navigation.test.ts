import { describe, expect, it } from "vitest";
import type { PageDto } from "@comicspace/contracts";
import { buildSpreads } from "./spreads";
import {
  isLastSpread,
  prefetchWindow,
  readAheadWindow,
  stepSpread,
} from "./navigation";

function page(index: number, width = 800, height = 1200): PageDto {
  return { index, src: `/p/${index}`, width, height, local: false };
}

// Eight pages with the cover alone leaves the last page on its own, which is
// the shape that used to be skipped in double mode.
const pages = Array.from({ length: 8 }, (_, index) => page(index));
const spreads = buildSpreads(pages, {
  rtl: true,
  coverAlone: true,
  wideRatio: 1.2,
});

describe("reader navigation", () => {
  it("steps into the lone trailing spread", () => {
    expect(spreads.map((spread) => spread.pages.map((item) => item.index))).toEqual([
      [0],
      [1, 2],
      [3, 4],
      [5, 6],
      [7],
    ]);
    expect(stepSpread(spreads, 5, 1)).toBe(7);
    expect(isLastSpread(spreads, 7)).toBe(true);
    expect(isLastSpread(spreads, 5)).toBe(false);
  });

  it("reports the chapter boundary instead of clamping", () => {
    expect(stepSpread(spreads, 7, 1)).toBeNull();
    expect(stepSpread(spreads, 0, -1)).toBeNull();
    expect(stepSpread(spreads, 7, -1)).toBe(5);
  });

  it("keeps a sparse source page index from shifting the target", () => {
    // A downloaded chapter can miss a middle page: PageDto.index is no longer
    // the array offset, so navigation must use offsets.
    const sparse = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10].map((index) => page(index));
    const sparseSpreads = buildSpreads(sparse, {
      rtl: true,
      coverAlone: true,
      wideRatio: 1.2,
    });
    expect(
      sparseSpreads.map((spread) => spread.pages.map((item) => item.index)),
    ).toEqual([[0], [1, 2], [3, 5], [6, 7], [8, 9], [10]]);
    expect(stepSpread(sparseSpreads, 7, 1)).toBe(9);
    expect(stepSpread(sparseSpreads, 9, 1)).toBeNull();
  });

  it("clamps an out-of-range offset to the last spread", () => {
    expect(stepSpread(spreads, 99, 0)).toBe(7);
    expect(stepSpread(spreads, -3, 0)).toBe(0);
  });

  it("visits every spread in order for any page count", () => {
    for (let count = 1; count <= 12; count += 1) {
      for (const coverAlone of [true, false]) {
        const list = Array.from({ length: count }, (_, index) => page(index));
        const listSpreads = buildSpreads(list, {
          rtl: true,
          coverAlone,
          wideRatio: 1.2,
        });
        const visited: number[] = [];
        let offset = 0;
        visited.push(offset);
        for (;;) {
          const target = stepSpread(listSpreads, offset, 1);
          if (target === null) break;
          visited.push(target);
          offset = target;
        }
        expect(visited).toEqual(
          listSpreads.map((spread) => spread.primaryPage),
        );
        expect(isLastSpread(listSpreads, offset)).toBe(true);
      }
    }
  });
});

describe("prefetch window", () => {
  it("looks further ahead than behind", () => {
    expect(prefetchWindow(10, 30, "single")).toEqual({
      ahead: [11, 12, 13, 14, 15, 16, 17],
      behind: [8, 9],
    });
  });

  it("clamps at both ends", () => {
    expect(prefetchWindow(0, 5, "single")).toEqual({
      ahead: [1, 2, 3, 4],
      behind: [],
    });
    expect(prefetchWindow(4, 5, "single")).toEqual({
      ahead: [],
      behind: [2, 3],
    });
  });

  it("prefetches more in webtoon mode", () => {
    const window = prefetchWindow(0, 40, "webtoon");
    expect(window.ahead).toHaveLength(9);
    expect(prefetchWindow(0, 40, "double").ahead).toHaveLength(8);
  });

  it("shrinks the ahead window on slow connections", () => {
    expect(prefetchWindow(10, 40, "single", 0.5)).toEqual({
      ahead: [11, 12, 13, 14],
      behind: [8, 9],
    });
    expect(prefetchWindow(10, 40, "single", 0)).toEqual({
      ahead: [],
      behind: [8, 9],
    });
  });

  it("fills the pages past the active window for idle read-ahead", () => {
    expect(readAheadWindow(10, 40, "single", 1, 5)).toEqual([
      18, 19, 20, 21, 22,
    ]);
    expect(readAheadWindow(36, 40, "single", 1, 5)).toEqual([]);
  });
});
