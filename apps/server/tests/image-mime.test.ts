import { describe, expect, it } from "vitest";
import { resolveImageMime } from "../src/images/fetch.js";

describe("image mime resolution", () => {
  it("keeps real image content types", () => {
    expect(resolveImageMime("image/jpeg", "https://x/a.jpg")).toBe(
      "image/jpeg",
    );
    expect(resolveImageMime("image/webp; charset=binary", "https://x/a")).toBe(
      "image/webp",
    );
  });

  it("maps generic octet-stream responses from mangafun shards", () => {
    const cover =
      "https://sx.mangafunb.fun/x/xsjzmwls/cover/1716519355.png.328x422.jpg";
    expect(resolveImageMime("binary/octet-stream", cover)).toBe("image/jpeg");
    expect(resolveImageMime(null, "https://x/pages/00001.webp")).toBe(
      "image/webp",
    );
    expect(resolveImageMime("application/octet-stream", "https://x/a.png")).toBe(
      "image/png",
    );
  });

  it("rejects non-image responses", () => {
    expect(resolveImageMime("text/html", "https://x/a.jpg")).toBeNull();
  });
});
