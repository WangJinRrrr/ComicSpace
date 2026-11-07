import { ProxyAgent, type Dispatcher } from "undici";
import { createLogger } from "./logger.js";

const logger = createLogger("network");

/**
 * Proxy agents are kept per URL so repeated fetches reuse the same pool.
 * `null` remembers a URL that failed to parse, keeping the warning to once.
 */
const agents = new Map<string, ProxyAgent | null>();
let globalProxyUrl = "";

/**
 * Returns a dispatcher for an HTTP(S) proxy URL, or undefined for an empty or
 * unsupported URL. Only http:// and https:// proxies are supported.
 */
export function resolveProxyDispatcher(
  url: string | null | undefined,
): Dispatcher | undefined {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return undefined;

  const cached = agents.get(trimmed);
  if (cached !== undefined) return cached ?? undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    logger.warn(`Invalid proxy URL: ${trimmed}`, error);
    agents.set(trimmed, null);
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logger.warn(`Unsupported proxy URL (only http/https): ${trimmed}`);
    agents.set(trimmed, null);
    return undefined;
  }

  try {
    const agent = new ProxyAgent(trimmed);
    agents.set(trimmed, agent);
    return agent;
  } catch (error) {
    logger.warn(`Invalid proxy URL: ${trimmed}`, error);
    agents.set(trimmed, null);
    return undefined;
  }
}

export function setGlobalProxyUrl(url: string | null | undefined): void {
  globalProxyUrl = (url ?? "").trim();
}

export function getGlobalProxyDispatcher(): Dispatcher | undefined {
  return resolveProxyDispatcher(globalProxyUrl);
}
