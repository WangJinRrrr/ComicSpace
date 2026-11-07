import dns from "node:dns/promises";
import { AppError } from "../lib/errors.js";

export interface ImageHostPolicy {
  allowedHosts?: string[];
  extraAllowedHosts: string[];
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function hostMatches(pattern: string, host: string): boolean {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (!normalizedPattern || !normalizedHost) return false;
  if (normalizedPattern === normalizedHost) return true;
  if (!normalizedPattern.includes("*")) return false;

  // `*` matches any run of characters, so `*.example.com` keeps matching
  // nested subdomains and `*.mangafun*.fun` can describe rotating CDN labels.
  const source = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${source}$`).test(normalizedHost);
}

function hostMatchesAny(patterns: string[] | undefined, url: URL): boolean {
  const candidates = [url.host, url.hostname];
  return (patterns ?? []).some((pattern) =>
    candidates.some((candidate) => hostMatches(pattern, candidate)),
  );
}

export function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, "validation_error", "Invalid image URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(403, "forbidden", "Only http(s) image URLs are allowed");
  }
  if (url.username || url.password) {
    throw new AppError(403, "forbidden", "Image URLs may not contain credentials");
  }
  return url;
}

export function assertStaticImageHostAllowed(
  value: string,
  policy: ImageHostPolicy,
): URL {
  const url = parseHttpUrl(value);
  const extraAllowed = hostMatchesAny(policy.extraAllowedHosts, url);
  if (
    policy.allowedHosts &&
    policy.allowedHosts.length > 0 &&
    !hostMatchesAny(policy.allowedHosts, url) &&
    !extraAllowed
  ) {
    throw new AppError(
      403,
      "forbidden",
      `Image host is not allowed for this source: ${url.host}`,
    );
  }
  return url;
}

export async function assertImageUrlAllowed(
  value: string,
  policy: ImageHostPolicy,
): Promise<URL> {
  const url = assertStaticImageHostAllowed(value, policy);
  const extraAllowed = hostMatchesAny(policy.extraAllowedHosts, url);
  if (extraAllowed) return url;

  const hostname = stripBrackets(url.hostname);
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    // DNS can fail transiently; let the fetch retry policy have a go.
    throw new AppError(
      502,
      "network_error",
      `Could not resolve image host: ${url.host}`,
      { retryable: true },
    );
  }
  if (addresses.length === 0) {
    throw new AppError(502, "network_error", `Image host has no address: ${url.host}`, {
      retryable: true,
    });
  }
  for (const item of addresses) {
    if (isPrivateAddress(item.address)) {
      throw new AppError(
        403,
        "forbidden",
        `Private image host is not allowed: ${url.host}`,
      );
    }
  }
  return url;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice(7));
  }
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = stripBrackets(address.trim().toLowerCase());
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return isPrivateIpv4(normalized);
}
