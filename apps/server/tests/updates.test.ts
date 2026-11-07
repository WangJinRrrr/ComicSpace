import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkForUpdate,
  compareSemver,
  downloadPlatformUpdate,
  openDownloadedUpdate,
  type UpdateRuntime,
} from "../src/services/updates.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runtime(overrides: Partial<UpdateRuntime> = {}): UpdateRuntime {
  return {
    currentVersion: "0.1.0",
    platform: "win32",
    arch: "x64",
    runtime: "desktop",
    packaging: "nsis",
    repo: "WangJinRrrr/ComicSpace",
    ...overrides,
  };
}

function release(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const NOTES = "修复阅读历史。";

function latest(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.0",
    name: "ComicSpace v0.2.0",
    body: NOTES,
    html_url: "https://github.com/WangJinRrrr/ComicSpace/releases/tag/v0.2.0",
    published_at: "2026-11-07T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "ComicSpace Setup 0.2.0.exe",
        size: 4,
        browser_download_url:
          "https://github.com/WangJinRrrr/ComicSpace/releases/download/v0.2.0/ComicSpace%20Setup%200.2.0.exe",
      },
      {
        name: "ComicSpace 0.2.0.exe",
        size: 4,
        browser_download_url:
          "https://github.com/WangJinRrrr/ComicSpace/releases/download/v0.2.0/ComicSpace%200.2.0.exe",
      },
    ],
    ...overrides,
  };
}

describe("version comparison", () => {
  it("orders releases, prereleases, and equal build metadata", () => {
    expect(compareSemver("0.1.0", "v0.1.0")).toBe(0);
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("0.1.5", "0.1.0")).toBe(1);
    expect(compareSemver("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareSemver("1.0.0+build.3", "1.0.0")).toBe(0);
    expect(compareSemver("not-a-version", "1.0.0")).toBeNull();
  });
});

describe("GitHub release check", () => {
  it("reports the current release as up to date and does not download", async () => {
    const calls: string[] = [];
    const result = await checkForUpdate(runtime(), {
      fetch: async (input) => {
        calls.push(String(input));
        return release(latest({ tag_name: "v0.1.0", name: "ComicSpace v0.1.0" }));
      },
    });
    expect(result.status).toBe("up_to_date");
    expect(result.canAutoInstall).toBe(false);
    expect(result.canDownload).toBe(false);
    expect(result.message).toContain("最新正式版");
    expect(calls).toEqual([
      "https://api.github.com/repos/WangJinRrrr/ComicSpace/releases/latest",
    ]);
  });

  it("does not offer a downgrade when the local version is newer", async () => {
    const result = await checkForUpdate(runtime({ currentVersion: "0.1.5" }), {
      fetch: async () => release(latest({ tag_name: "v0.1.0" })),
    });
    expect(result.status).toBe("up_to_date");
    expect(result.canDownload).toBe(false);
    expect(result.message).toContain("高于");
    expect(result.message).toContain("0.1.5");
  });

  it("selects the Windows installer and keeps notes", async () => {
    const result = await checkForUpdate(runtime(), {
      fetch: async () => release(latest()),
    });
    expect(result.status).toBe("update_available");
    expect(result.asset).toEqual({
      name: "ComicSpace Setup 0.2.0.exe",
      size: 4,
      kind: "nsis",
    });
    expect(result.canDownload).toBe(true);
    expect(result.canAutoInstall).toBe(false);
    expect(result.installMode).toBe("manual-nsis");
    expect(result.releaseNotes).toBe(NOTES);
    expect(result.message).toContain("不会自动安装");
  });

  it("prefers the portable exe for a portable build", async () => {
    const result = await checkForUpdate(runtime({ packaging: "portable" }), {
      fetch: async () => release(latest()),
    });
    expect(result.asset?.kind).toBe("portable");
    expect(result.installMode).toBe("manual-portable");
    expect(result.message).toContain("便携版");
  });

  it("does not download in development mode", async () => {
    const result = await checkForUpdate(runtime({ packaging: "dev" }), {
      fetch: async () => release(latest()),
    });
    expect(result.canDownload).toBe(false);
    expect(result.installMode).toBe("release-page");
    expect(result.message).toContain("开发模式");
  });

  it("explains a missing asset, a foreign asset, and a non-windows platform", async () => {
    const empty = await checkForUpdate(runtime(), {
      fetch: async () => release(latest({ assets: [] })),
    });
    expect(empty.status).toBe("update_available");
    expect(empty.asset).toBeNull();
    expect(empty.canDownload).toBe(false);
    expect(empty.message).toContain("没有上传");

    const evil = await checkForUpdate(runtime(), {
      fetch: async () =>
        release(
          latest({
            assets: [
              {
                name: "ComicSpace Setup 0.2.0.exe",
                size: 4,
                browser_download_url: "https://evil.example/setup.exe",
              },
            ],
          }),
        ),
    });
    expect(evil.asset).toBeNull();
    expect(evil.canDownload).toBe(false);

    const linux = await checkForUpdate(runtime({ platform: "linux", arch: "x64" }), {
      fetch: async () => release(latest()),
    });
    expect(linux.asset).toBeNull();
    expect(linux.message).toContain("linux x64");
    expect(linux.message).not.toContain("已是最新");
  });

  it("reports network failures and rate limits without claiming the app is current", async () => {
    const offline = await checkForUpdate(runtime(), {
      fetch: async () => {
        throw new Error("token=ghp_secret connect ECONNRESET");
      },
    });
    expect(offline.status).toBe("error");
    expect(offline.errorCode).toBe("network");
    expect(offline.retryable).toBe(true);
    expect(offline.message).toContain("不代表已经是最新");
    expect(offline.message).not.toContain("ghp_secret");

    const limited = await checkForUpdate(runtime(), {
      fetch: async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "content-type": "application/json",
          },
        }),
    });
    expect(limited.errorCode).toBe("rate_limited");
    expect(limited.message).toContain("速率受限");

    const retry = await checkForUpdate(runtime(), {
      fetch: async () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    });
    expect(retry.errorCode).toBe("rate_limited");
    expect(retry.message).toContain("30");
  });

  it("rejects an unusable version instead of treating it as current", async () => {
    const result = await checkForUpdate(runtime(), {
      fetch: async () => release(latest({ tag_name: "nightly" })),
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("unsupported_version");
    expect(result.canDownload).toBe(false);
  });

  it("does not send a token unless one is provided", async () => {
    let authorization: string | null = null;
    await checkForUpdate(runtime(), {
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return release(latest({ tag_name: "v0.1.0" }));
      },
    });
    expect(authorization).toBeNull();

    await checkForUpdate(runtime(), {
      token: "ghp_test_token",
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return release(latest({ tag_name: "v0.1.0" }));
      },
    });
    expect(authorization).toBe("Bearer ghp_test_token");
  });
});

describe("update download", () => {
  it("downloads the installer only after a user-initiated fetch and refuses a bad redirect", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "comicspace-update-"));
    tempDirs.push(root);
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.github.com")) return release(latest());
      if (url.includes("github.com/WangJinRrrr/ComicSpace/releases/download")) {
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return new Response(null, {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/asset" },
        });
      }
      if (url === "https://objects.githubusercontent.com/asset") {
        return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    };

    const saved = await downloadPlatformUpdate({
      runtime: runtime(),
      dataDir: root,
      fetch: fetchImpl,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.fileName).toBe("ComicSpace Setup 0.2.0.exe");
      expect(saved.installMode).toBe("manual-nsis");
      expect(fs.existsSync(path.join(saved.directory, saved.fileName))).toBe(true);
    }
    expect(calls.some((url) => url.includes("releases/download"))).toBe(true);

    const evil = await downloadPlatformUpdate({
      runtime: runtime(),
      dataDir: root,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) return release(latest());
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/setup.exe" },
        });
      },
    });
    expect(evil.ok).toBe(false);
    if (!evil.ok) expect(evil.message).toContain("不受信任");

    const launched: string[] = [];
    const opened = openDownloadedUpdate({
      dataDir: root,
      platform: "win32",
      packaging: "nsis",
      launch: (file) => launched.push(file),
    });
    expect(opened.opened).toBe(true);
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatch(/ComicSpace Setup 0\.2\.0\.exe$/);
    expect(opened.message).toContain("不会静默安装");

    const portable = openDownloadedUpdate({
      dataDir: root,
      platform: "win32",
      packaging: "dev",
      launch: () => {
        throw new Error("should not launch");
      },
    });
    expect(portable.opened).toBe(false);
    expect(portable.message).toContain("开发模式");
  });

  it("does not launch a portable build over itself", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "comicspace-portable-"));
    tempDirs.push(root);
    const saved = await downloadPlatformUpdate({
      runtime: runtime({ packaging: "portable" }),
      dataDir: root,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) return release(latest());
        return new Response(Uint8Array.from([9, 9]), { status: 200 });
      },
    });
    expect(saved.ok).toBe(true);
    const opened = openDownloadedUpdate({
      dataDir: root,
      platform: "win32",
      packaging: "portable",
      launch: () => {
        throw new Error("should not launch");
      },
    });
    expect(opened.opened).toBe(false);
    expect(opened.message).toContain("便携版");
  });
});
