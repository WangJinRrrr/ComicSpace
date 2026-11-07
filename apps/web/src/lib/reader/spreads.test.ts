import { describe, expect, it } from "vitest";
import type { PageDto } from "@comicspace/contracts";
import { buildSpreads, spreadIndexForPage } from "./spreads";

function page(index: number, width = 800, height = 1200): PageDto {
  return { index, src: `/p/${index}`, width, height, local: false };
}

describe("reader spreads", () => {
  it("keeps the cover alone and pairs the rest", () => {
    const pages = [page(0), page(1), page(2), page(3)];
    const spreads = buildSpreads(pages, {
      rtl: true,
      coverAlone: true,
      wideRatio: 1.2,
    });
    expect(spreads.map((spread) => spread.pages.map((item) => item.index))).toEqual([
      [0],
      [1, 2],
      [3],
    ]);
  });

  it("puts wide pages on their own", () => {
    const pages = [page(0, 1600, 1000), page(1), page(2)];
    const spreads = buildSpreads(pages, {
      rtl: false,
      coverAlone: false,
      wideRatio: 1.2,
    });
    expect(spreads.map((spread) => spread.pages.length)).toEqual([1, 2]);
    expect(spreads[0]?.wide).toBe(true);
  });

  it("finds the spread containing a page", () => {
    const pages = [page(0), page(1), page(2), page(3)];
    const spreads = buildSpreads(pages, {
      rtl: false,
      coverAlone: true,
      wideRatio: 1.2,
    });
    expect(spreadIndexForPage(spreads, 2)).toBe(1);
    expect(spreadIndexForPage(spreads, 3)).toBe(2);
  });
});
