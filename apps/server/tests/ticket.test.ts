import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openTicket,
  sealTicket,
  TicketError,
} from "../src/images/ticket.js";
import { hostMatches, isPrivateAddress } from "../src/images/guard.js";

const secret = randomBytes(32);

describe("image tickets", () => {
  it("round-trips headers and referer", () => {
    const token = sealTicket(
      {
        u: "https://cdn.example.com/page.jpg",
        p: "src",
        k: "page",
        r: "https://example.com/chapter",
        h: { cookie: "session=secret" },
        t: { type: "band-reverse", bands: 10 },
      },
      { secret, now: 1_000_000 },
    );
    const payload = openTicket(token, { secret, now: 1_001_000 });
    expect(payload.u).toBe("https://cdn.example.com/page.jpg");
    expect(payload.h?.cookie).toBe("session=secret");
    expect(payload.r).toBe("https://example.com/chapter");
    expect(payload.t).toEqual({ type: "band-reverse", bands: 10 });
  });

  it("seals the same image to a stable token within one expiry window", () => {
    const input = {
      u: "https://cdn.example.com/stable.jpg",
      p: "src",
      k: "page" as const,
      r: "https://example.com/chapter",
    };
    const first = sealTicket(input, { secret, now: 1_000_000 });
    const later = sealTicket(input, { secret, now: 1_000_500 });
    expect(first).toBe(later);
    // A different payload must not reuse the token.
    const other = sealTicket(
      { ...input, h: { cookie: "a=b" } },
      { secret, now: 1_000_000 },
    );
    expect(other).not.toBe(first);
    expect(openTicket(first, { secret, now: 1_001_000 }).u).toBe(input.u);
  });

  it("rejects tampering and expiry", () => {
    const token = sealTicket(
      { u: "https://cdn.example.com/a.jpg", p: "src", k: "page" },
      { secret, now: 1_000_000, ttlMs: 60_000 },
    );
    expect(() =>
      openTicket(`${token.slice(0, -2)}xx`, { secret, now: 1_000_000 }),
    ).toThrow(TicketError);
    expect(() =>
      openTicket(token, { secret, now: 2_000_000 }),
    ).toThrow(TicketError);
  });

  it("matches host patterns", () => {
    expect(hostMatches("example.com", "example.com")).toBe(true);
    expect(hostMatches("*.example.com", "cdn.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "example.com")).toBe(false);
    expect(hostMatches("127.0.0.1:8787", "127.0.0.1:8787")).toBe(true);
  });

  it("detects private addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.20")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});
