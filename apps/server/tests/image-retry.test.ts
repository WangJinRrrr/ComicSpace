import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { parseRetryAfter, retryDelayMs } from "../src/images/fetch.js";

describe("image retry policy", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("2", now)).toBe(2000);
    expect(
      parseRetryAfter(
        new Date(now + 3000).toUTCString(),
        now,
      ),
    ).toBe(3000);
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("later", now)).toBeNull();
  });

  it("caps Retry-After so a header cannot stall the reader", () => {
    expect(parseRetryAfter("600")).toBe(4000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("backs off exponentially with jitter", () => {
    const first = retryDelayMs(0);
    expect(first).toBeGreaterThanOrEqual(300);
    expect(first).toBeLessThanOrEqual(405);

    const second = retryDelayMs(1);
    expect(second).toBeGreaterThanOrEqual(600);
    expect(second).toBeLessThanOrEqual(810);
  });

  it("honours a Retry-After carried by the error", () => {
    const error = new AppError(429, "rate_limited", "slow down", {
      retryable: true,
      details: { retryAfterMs: 2000 },
    });
    expect(retryDelayMs(0, error)).toBeGreaterThanOrEqual(2000);
  });
});
