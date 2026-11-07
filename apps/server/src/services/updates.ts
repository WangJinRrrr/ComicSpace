import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  UpdateAssetDto,
  UpdateCheckDto,
  UpdateFetchDto,
  UpdateInstallMode,
  UpdateOpenDto,
} from "@comicspace/contracts";
import type { ApiErrorCode } from "@comicspace/contracts";

export const DEFAULT_GITHUB_REPO = "WangJinRrrr/ComicSpace";

const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const NOTES_LIMIT = 4000;

const ASSET_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export type UpdatePackaging = "dev" | "nsis" | "portable" | "unknown";

export interface UpdateRuntime {
  currentVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtime: "desktop" | "server";
  packaging: UpdatePackaging;
  repo: string;
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

interface SelectedAsset extends UpdateAssetDto {
  url: string;
}

interface Failure {
  ok: false;
  status: number;
  code: ApiErrorCode;
  message: string;
}

export function readBundledVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../package.json"),
    path.resolve(here, "../package.json"),
    path.resolve(here, "../../../package.json"),
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Try the next location. Packaged and source layouts differ.
    }
  }
  return "0.0.0";
}

export function currentUpdateRuntime(
  version = readBundledVersion(),
): UpdateRuntime {
  const packaging = process.env.COMICSPACE_PACKAGING;
  const repo = process.env.COMICSPACE_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO;
  return {
    currentVersion: process.env.COMICSPACE_APP_VERSION?.trim() || version,
    platform: process.platform,
    arch: process.arch,
    runtime: process.env.COMICSPACE_RUNTIME === "desktop" ? "desktop" : "server",
    packaging:
      packaging === "dev" || packaging === "nsis" || packaging === "portable"
        ? packaging
        : "unknown",
    repo,
  };
}

export function parseSemver(input: string): SemVer | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i.exec(
      input.trim(),
    );
  if (!match) return null;
  const pre = match[4] ? match[4].split(".").filter(Boolean) : [];
  if (match[4] && pre.length === 0) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre,
  };
}

/** Positive when `left` is newer than `right`. */
export function compareSemver(left: string, right: string): number | null {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (xNumeric && !yNumeric) return -1;
    if (!xNumeric && yNumeric) return 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

const APP_TAG = /^v\d+\.\d+\.\d+(?:[-+].*)?$/;

function selectAppRelease(listed: unknown[]): {
  tag_name: string;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
} | null {
  let best: {
    tag_name: string;
    name?: unknown;
    body?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  } | null = null;
  for (const item of listed) {
    if (!item || typeof item !== "object") continue;
    const release = item as {
      tag_name?: unknown;
      name?: unknown;
      body?: unknown;
      html_url?: unknown;
      published_at?: unknown;
      draft?: unknown;
      prerelease?: unknown;
      assets?: unknown;
    };
    if (release.draft === true || release.prerelease === true) continue;
    if (typeof release.tag_name !== "string" || !APP_TAG.test(release.tag_name)) {
      continue;
    }
    if (!parseSemver(release.tag_name)) continue;
    if (
      !best ||
      (compareSemver(release.tag_name, best.tag_name) ?? -1) > 0
    ) {
      best = { ...release, tag_name: release.tag_name };
    }
  }
  return best;
}

function errorResult(
  runtime: UpdateRuntime,
  errorCode: NonNullable<UpdateCheckDto["errorCode"]>,
  message: string,
  retryable = false,
): UpdateCheckDto {
  return {
    status: "error",
    currentVersion: runtime.currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseUrl: null,
    publishedAt: null,
    asset: null,
    platform: runtime.platform,
    arch: runtime.arch,
    runtime: runtime.runtime,
    packaging: runtime.packaging,
    canAutoInstall: false,
    canDownload: false,
    installMode: "none",
    message,
    errorCode,
    retryable,
  };
}

function safeExeName(name: string): boolean {
  if (!name || name !== path.basename(name)) return false;
  if (name.includes("..") || /[\\/]/.test(name)) return false;
  // GitHub replaces spaces in asset names with dots.
  return /^ComicSpace(?:[ .]Setup)?[ .].+\.exe$/i.test(name);
}

function classifyAssetName(name: string): "nsis" | "portable" | null {
  if (!safeExeName(name)) return null;
  if (/arm64|ia32|win32/i.test(name)) return null;
  if (/^ComicSpace[ .]Setup[ .].+\.exe$/i.test(name)) return "nsis";
  if (/^ComicSpace[ .].+\.exe$/i.test(name)) return "portable";
  return null;
}

function isTrustedReleaseUrl(url: string, repo: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return false;
    }
    if (parsed.hostname !== "github.com") return false;
    const [owner, name] = repo.split("/");
    const pathname = decodeURIComponent(parsed.pathname);
    return pathname.startsWith(`/${owner}/${name}/releases/download/`);
  } catch {
    return false;
  }
}

function selectAsset(
  assets: unknown,
  runtime: UpdateRuntime,
  repo: string,
): SelectedAsset | null {
  if (runtime.platform !== "win32" || runtime.arch !== "x64") return null;
  if (!Array.isArray(assets)) return null;
  const found: SelectedAsset[] = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const record = asset as {
      name?: unknown;
      size?: unknown;
      browser_download_url?: unknown;
    };
    if (typeof record.name !== "string" || typeof record.browser_download_url !== "string") {
      continue;
    }
    const kind = classifyAssetName(record.name);
    if (!kind || !isTrustedReleaseUrl(record.browser_download_url, repo)) continue;
    const size = typeof record.size === "number" && record.size >= 0 ? record.size : 0;
    found.push({
      name: record.name,
      size,
      kind,
      url: record.browser_download_url,
    });
  }
  const preferPortable = runtime.packaging === "portable";
  if (preferPortable) {
    return found.find((item) => item.kind === "portable") ?? found.find((item) => item.kind === "nsis") ?? null;
  }
  return found.find((item) => item.kind === "nsis") ?? found.find((item) => item.kind === "portable") ?? null;
}

function installModeFor(
  runtime: UpdateRuntime,
  asset: SelectedAsset | null,
  updateAvailable: boolean,
): UpdateInstallMode {
  if (!updateAvailable) return "none";
  if (!asset || runtime.packaging === "dev") return "release-page";
  return asset.kind === "portable" ? "manual-portable" : "manual-nsis";
}

function platformLabel(runtime: UpdateRuntime): string {
  return `${runtime.platform} ${runtime.arch}`;
}

function describeAvailable(
  runtime: UpdateRuntime,
  latest: string,
  asset: SelectedAsset | null,
): string {
  if (runtime.packaging === "dev") {
    return `发现新版本 ${latest}。当前是开发模式，不会下载或启动安装包。请到发布页面查看。`;
  }
  if (!asset) {
    if (runtime.platform !== "win32" || runtime.arch !== "x64") {
      return `发现新版本 ${latest}，但没有适合 ${platformLabel(runtime)} 的安装包。本仓库的桌面发行物只有 Windows x64 安装版（ComicSpace Setup <版本>.exe）和便携版（ComicSpace <版本>.exe）。请到发布页面查看。本次没有下载。`;
    }
    return `发现新版本 ${latest}，但这个 Release 没有上传匹配的 Windows 安装包。请到发布页面确认。本次没有下载。`;
  }
  const lines = [
    `发现新版本 ${latest}。点击“获取更新”才会下载 ${asset.name}。不会自动安装，也不会自动重启。`,
  ];
  if (runtime.packaging === "portable" && asset.kind === "nsis") {
    lines.push("没有找到便携版 exe，因此提供的是安装程序。它会另装一份桌面版，不会在运行中替换便携版文件。");
  } else if (asset.kind === "portable") {
    lines.push("便携版无法在运行中替换自身。下载完成后请退出程序，再用新的 exe 替换当前文件。");
  } else if (runtime.runtime !== "desktop") {
    lines.push("当前是本地服务，不是已安装的桌面版。安装程序只覆盖 Windows 桌面版，不会替换这个 Node 进程。");
  }
  lines.push("安装包未签名时，Windows 可能显示 SmartScreen。安装界面需要你确认。");
  return lines.join("");
}

function truncate(value: string): string {
  if (value.length <= NOTES_LIMIT) return value;
  return `${value.slice(0, NOTES_LIMIT)}…`;
}

function isRateLimited(response: Response, body: string): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get("x-ratelimit-remaining") === "0") return true;
  return /rate limit/i.test(body);
}

function rateLimitMessage(response: Response): string {
  const retryAfter = Number(response.headers.get("retry-after"));
  const wait =
    Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter < 3600
      ? `请在 ${Math.ceil(retryAfter)} 秒后再试。`
      : "请稍后再试。";
  return `GitHub API 速率受限，无法确认是否有更新。${wait}这不代表已经是最新版本。`;
}

interface Inspection {
  check: UpdateCheckDto;
  assetUrl: string | null;
}

async function inspectRelease(
  runtime: UpdateRuntime,
  options: {
    fetch?: typeof fetch;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Inspection> {
  const fail = (
    errorCode: NonNullable<UpdateCheckDto["errorCode"]>,
    message: string,
    retryable = false,
  ): Inspection => ({
    check: errorResult(runtime, errorCode, message, retryable),
    assetUrl: null,
  });

  if (!/^[\w.-]+\/[\w.-]+$/.test(runtime.repo)) {
    return fail("bad_response", "更新源配置无效，已停止检查，没有下载任何文件。");
  }
  if (!parseSemver(runtime.currentVersion)) {
    return fail(
      "unsupported_version",
      `当前版本号“${runtime.currentVersion}”无法比较，已停止检查，没有下载任何文件。`,
    );
  }

  const fetchImpl = options.fetch ?? fetch;
  const endpoint = `https://api.github.com/repos/${runtime.repo}/releases?per_page=100`;
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "user-agent": `ComicSpace/${runtime.currentVersion}`,
    "x-github-api-version": "2022-11-28",
  });
  const token = options.token?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    return fail(
      "network",
      "无法连接 GitHub，不能判断是否有更新。这不代表已经是最新版本。",
      true,
    );
  }

  const body = await response.text();
  if (isRateLimited(response, body)) {
    return fail("rate_limited", rateLimitMessage(response), true);
  }
  if (response.status === 404) {
    return fail(
      "no_release",
      "GitHub 上没有可用的正式版本。这不代表已经是最新版本。",
    );
  }
  if (response.status === 401 || response.status === 403) {
    return fail(
      "forbidden",
      "GitHub 拒绝了这次检查。软件没有内置访问令牌。这不代表已经是最新版本。",
    );
  }
  if (!response.ok) {
    return fail(
      "bad_response",
      `GitHub 返回 HTTP ${response.status}，无法确认更新。这不代表已经是最新版本。`,
      response.status >= 500,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return fail(
      "bad_response",
      "GitHub 返回的内容无法解析，已停止检查，没有下载任何文件。",
    );
  }
  if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) {
    return fail(
      "bad_response",
      "GitHub 返回的版本信息不完整，已停止检查，没有下载任何文件。",
    );
  }
  const listed = Array.isArray(payload) ? payload : [payload];
  const release = selectAppRelease(listed);
  if (!release) {
    return fail(
      "no_release",
      "GitHub 上没有可用的应用正式版本。插件发布不会当作软件更新。这不代表已经是最新版本。",
    );
  }

  const cmp = compareSemver(runtime.currentVersion, release.tag_name);
  if (cmp == null) {
    return fail("unsupported_version", "版本号无法比较，已停止检查，没有下载任何文件。");
  }
  const latest = parseSemver(release.tag_name);
  const latestVersion = latest
    ? `${latest.major}.${latest.minor}.${latest.patch}${latest.pre.length ? `-${latest.pre.join(".")}` : ""}`
    : release.tag_name.replace(/^v/i, "");
  const asset = selectAsset(release.assets, runtime, runtime.repo);
  const updateAvailable = cmp < 0;
  const mode = installModeFor(runtime, asset, updateAvailable);
  let message: string;
  if (cmp === 0) {
    message = `当前已是最新正式版 ${latestVersion}。`;
  } else if (cmp > 0) {
    message = `当前版本 ${runtime.currentVersion} 高于已发布的 ${latestVersion}，不会降级安装。`;
  } else {
    message = describeAvailable(runtime, latestVersion, asset);
  }

  const releaseUrl =
    typeof release.html_url === "string" && release.html_url.startsWith("https://")
      ? release.html_url
      : `https://github.com/${runtime.repo}/releases/latest`;

  return {
    assetUrl: asset?.url ?? null,
    check: {
      status: updateAvailable ? "update_available" : "up_to_date",
      currentVersion: runtime.currentVersion,
      latestVersion,
      releaseName: typeof release.name === "string" ? release.name : latestVersion,
      releaseNotes:
        typeof release.body === "string" && release.body.trim()
          ? truncate(release.body.trim())
          : null,
      releaseUrl,
      publishedAt: typeof release.published_at === "string" ? release.published_at : null,
      asset: asset ? { name: asset.name, size: asset.size, kind: asset.kind } : null,
      platform: runtime.platform,
      arch: runtime.arch,
      runtime: runtime.runtime,
      packaging: runtime.packaging,
      canAutoInstall: false,
      canDownload: updateAvailable && asset !== null && runtime.packaging !== "dev",
      installMode: mode,
      message,
    },
  };
}

export async function checkForUpdate(
  runtime: UpdateRuntime,
  options: {
    fetch?: typeof fetch;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<UpdateCheckDto> {
  return (await inspectRelease(runtime, options)).check;
}

function updatesDir(dataDir: string): string {
  return path.resolve(dataDir, "updates");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function allowedHop(url: string, first: boolean, repo: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return false;
    }
    if (!ASSET_HOSTS.has(parsed.hostname)) return false;
    if (first) return isTrustedReleaseUrl(url, repo);
    return true;
  } catch {
    return false;
  }
}

async function readBody(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error("too-large");
  }
  if (!response.body) throw new Error("empty-body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function downloadReleaseAsset(options: {
  url: string;
  repo: string;
  fileName: string;
  directory: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ filePath: string; bytes: number; sha256: string }> {
  const fetchImpl = options.fetch ?? fetch;
  let current = options.url;
  let response: Response | null = null;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!allowedHop(current, hop === 0, options.repo)) {
      throw new Error("untrusted-url");
    }
    response = await fetchImpl(current, {
      redirect: "manual",
      signal: options.signal ?? AbortSignal.timeout(120_000),
      headers: {
        accept: "application/octet-stream",
        "user-agent": "ComicSpace",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("bad-redirect");
      current = new URL(location, current).href;
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    throw new Error(`http-${response?.status ?? 0}`);
  }
  const bytes = await readBody(response, MAX_ASSET_BYTES);
  fs.mkdirSync(options.directory, { recursive: true });
  const finalPath = path.resolve(options.directory, options.fileName);
  if (!isInside(path.resolve(options.directory), finalPath)) {
    throw new Error("bad-path");
  }
  const part = `${finalPath}.part`;
  try {
    fs.writeFileSync(part, bytes);
    fs.renameSync(part, finalPath);
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }
  return {
    filePath: finalPath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

interface DownloadManifest {
  fileName: string;
  bytes: number;
  kind: "nsis" | "portable";
  version: string;
  sha256: string;
}

let downloadBusy = false;

export async function downloadPlatformUpdate(options: {
  runtime: UpdateRuntime;
  dataDir: string;
  fetch?: typeof fetch;
  token?: string;
}): Promise<({ ok: true } & UpdateFetchDto) | Failure> {
  if (options.runtime.packaging === "dev") {
    return {
      ok: false,
      status: 409,
      code: "unsupported",
      message: "开发模式只检查版本，不会下载或启动安装包。",
    };
  }
  if (downloadBusy) {
    return {
      ok: false,
      status: 409,
      code: "conflict",
      message: "已有一个更新下载在进行。",
    };
  }
  downloadBusy = true;
  try {
    const inspected = await inspectRelease(options.runtime, {
      fetch: options.fetch,
      token: options.token,
    });
    const check = inspected.check;
    if (check.status === "error") {
      const status = check.errorCode === "rate_limited"
        ? 429
        : check.errorCode === "network"
          ? 502
          : check.errorCode === "forbidden"
            ? 403
            : check.errorCode === "no_release"
              ? 404
              : 502;
      const code: ApiErrorCode = check.errorCode === "rate_limited"
        ? "rate_limited"
        : check.errorCode === "network"
          ? "network_error"
          : check.errorCode === "forbidden"
            ? "forbidden"
            : check.errorCode === "no_release"
              ? "not_found"
              : "parse_error";
      return { ok: false, status, code, message: check.message };
    }
    if (!check.canDownload || !check.asset || !check.latestVersion || !inspected.assetUrl) {
      return {
        ok: false,
        status: 409,
        code: "conflict",
        message: check.message,
      };
    }
    if (!isTrustedReleaseUrl(inspected.assetUrl, options.runtime.repo)) {
      return {
        ok: false,
        status: 409,
        code: "conflict",
        message: "安装包地址不在 GitHub Releases 上，已拒绝下载。",
      };
    }

    const directory = updatesDir(options.dataDir);
    let saved: { filePath: string; bytes: number; sha256: string };
    try {
      saved = await downloadReleaseAsset({
        url: inspected.assetUrl,
        repo: options.runtime.repo,
        fileName: check.asset.name,
        directory,
        fetch: options.fetch,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const message = reason === "too-large"
        ? "安装包超过 512MB，已停止下载并删除未完成的文件。"
        : reason === "untrusted-url"
          ? "下载地址跳转到了不受信任的站点，已拒绝保存。"
          : "下载安装包失败，没有保存完整文件。请稍后再试或打开发布页面。";
      return {
        ok: false,
        status: reason === "untrusted-url" ? 409 : 502,
        code: reason === "untrusted-url" ? "conflict" : "network_error",
        message,
      };
    }

    const manifest: DownloadManifest = {
      fileName: check.asset.name,
      bytes: saved.bytes,
      kind: check.asset.kind,
      version: check.latestVersion,
      sha256: saved.sha256,
    };
    fs.writeFileSync(
      path.join(directory, "download.json"),
      JSON.stringify(manifest),
    );
    const mode = check.installMode;
    const message = mode === "manual-portable"
      ? `已下载 ${check.asset.name} 到 ${directory}。便携版不会自动替换或重启，请退出后手动替换 exe。`
      : `已下载 ${check.asset.name} 到 ${directory}。可以打开安装程序；安装需要你确认，不会静默安装，也不会自动重启。`;
    return {
      ok: true,
      fileName: check.asset.name,
      bytes: saved.bytes,
      directory,
      message,
      installMode: mode,
    };
  } finally {
    downloadBusy = false;
  }
}

function readManifest(directory: string): DownloadManifest | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(directory, "download.json"), "utf8"),
    ) as Partial<DownloadManifest>;
    if (!raw || typeof raw.fileName !== "string" || !safeExeName(raw.fileName)) {
      return null;
    }
    if (raw.kind !== "nsis" && raw.kind !== "portable") return null;
    if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sha256)) {
      return null;
    }
    if (typeof raw.bytes !== "number" || typeof raw.version !== "string") return null;
    return {
      fileName: raw.fileName,
      bytes: raw.bytes,
      kind: raw.kind,
      version: raw.version,
      sha256: raw.sha256,
    };
  } catch {
    return null;
  }
}

export function launchInstaller(file: string): void {
  const child = spawn(file, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

export function openDownloadedUpdate(options: {
  dataDir: string;
  platform: NodeJS.Platform;
  packaging: UpdatePackaging;
  launch?: (file: string) => void;
}): UpdateOpenDto {
  if (options.packaging === "dev") {
    return {
      opened: false,
      message: "开发模式不会启动安装程序。",
    };
  }
  const directory = updatesDir(options.dataDir);
  const manifest = readManifest(directory);
  if (!manifest) {
    return { opened: false, message: "还没有可打开的更新文件。请先获取更新。" };
  }
  const filePath = path.resolve(directory, manifest.fileName);
  if (!isInside(path.resolve(directory), filePath) || !fs.existsSync(filePath)) {
    return { opened: false, message: "下载文件不在更新目录中，已拒绝打开。" };
  }
  const realDirectory = fs.realpathSync(directory);
  const realFile = fs.realpathSync(filePath);
  if (!isInside(realDirectory, realFile)) {
    return { opened: false, message: "下载文件不在更新目录中，已拒绝打开。" };
  }
  const digest = createHash("sha256").update(fs.readFileSync(realFile)).digest("hex");
  if (digest !== manifest.sha256) {
    return { opened: false, message: "下载文件和记录不一致，已拒绝打开。" };
  }
  if (manifest.kind === "portable") {
    return {
      opened: false,
      message: `便携版无法在运行中替换自身，也不会自动重启。请退出后用 ${realFile} 替换当前的 exe。`,
    };
  }
  if (options.platform !== "win32") {
    return {
      opened: false,
      message: `当前系统不能运行 Windows 安装包。文件保留在 ${realFile}。`,
    };
  }
  try {
    (options.launch ?? launchInstaller)(realFile);
  } catch {
    return { opened: false, message: "无法启动安装程序。你可以到更新目录手动打开它。" };
  }
  return {
    opened: true,
    message:
      "已打开安装程序。请在安装界面确认；不会静默安装，也不会自动重启。安装包未签名时，Windows 可能显示 SmartScreen。",
  };
}
