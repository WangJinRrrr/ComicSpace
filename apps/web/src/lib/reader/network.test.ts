import { describe, expect, it } from "vitest";
import { resolvePrefetchPolicy } from "./network";

describe("reader prefetch policy", () => {
  it("keeps the full window when the browser reports nothing", () => {
    expect(resolvePrefetchPolicy()).toEqual({
      enabled: true,
      concurrency: 4,
      windowScale: 1,
      readAhead: true,
      poolLimit: 24,
      reason: "default",
    });
  });

  it("turns prefetch off when offline or saving data", () => {
    const offline = resolvePrefetchPolicy({ online: false });
    expect(offline.enabled).toBe(false);
    expect(offline.windowScale).toBe(0);
    expect(offline.reason).toBe("offline");

    const saver = resolvePrefetchPolicy({ connection: { saveData: true } });
    expect(saver.enabled).toBe(false);
    expect(saver.readAhead).toBe(false);
    expect(saver.reason).toBe("save-data");
  });

  it("shrinks the window on slow and metered links", () => {
    expect(
      resolvePrefetchPolicy({ connection: { effectiveType: "2g" } }),
    ).toMatchObject({
      enabled: true,
      concurrency: 1,
      windowScale: 0.35,
      readAhead: false,
      reason: "slow",
    });

    expect(
      resolvePrefetchPolicy({ connection: { effectiveType: "3g" } }),
    ).toMatchObject({
      enabled: true,
      concurrency: 2,
      windowScale: 0.6,
      readAhead: false,
      reason: "metered",
    });
  });

  it("raises concurrency and enables idle read-ahead on a fast link", () => {
    expect(
      resolvePrefetchPolicy({
        connection: { effectiveType: "4g", downlink: 20 },
      }),
    ).toMatchObject({
      enabled: true,
      concurrency: 6,
      windowScale: 1.25,
      readAhead: true,
      poolLimit: 32,
      reason: "fast",
    });
  });

  it("falls back to downlink when effectiveType is missing", () => {
    expect(
      resolvePrefetchPolicy({ connection: { downlink: 0.2 } }).reason,
    ).toBe("slow");
    expect(
      resolvePrefetchPolicy({ connection: { downlink: 1 } }).reason,
    ).toBe("metered");
    expect(
      resolvePrefetchPolicy({ connection: { downlink: 30 } }).reason,
    ).toBe("fast");
  });
});
