import { describe, expect, it } from "vitest";
import { hostMatches } from "../src/images/guard.js";

describe("image host patterns", () => {
  it("matches exact hosts only", () => {
    expect(hostMatches("sc.example.com", "sc.example.com")).toBe(true);
    expect(hostMatches("sc.example.com", "sm.example.com")).toBe(false);
    expect(hostMatches("sc.example.com", "sc.example.com.evil.net")).toBe(
      false,
    );
  });

  it("matches a leading wildcard and nested subdomains", () => {
    expect(hostMatches("*.example.com", "cdn.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "a.b.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "example.com")).toBe(false);
  });

  it("matches wildcards in the middle of a label", () => {
    expect(hostMatches("*.mangafun*.fun", "sc.mangafunb.fun")).toBe(true);
    expect(hostMatches("*.mangafun*.fun", "sm.mangafunb.fun")).toBe(true);
    expect(hostMatches("*.mangafun*.xyz", "sc.mangafunb.xyz")).toBe(true);
    expect(hostMatches("*.mangafun*.fun", "sc.mangafunb.xyz")).toBe(false);
    expect(hostMatches("*.mangafun*.fun", "mangafunb.fun")).toBe(false);
  });

  it("does not treat dots as wildcards", () => {
    expect(hostMatches("api.example.com", "apiXexample.com")).toBe(false);
  });
});
