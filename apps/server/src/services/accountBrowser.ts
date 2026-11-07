import fs from "node:fs";
import path from "node:path";
import type { AccountPageSession, AccountPageView } from "@comicspace/plugin-sdk";

interface BridgeEndpoint {
  url: string;
  token: string;
}

export function accountBrowserEndpoint(dataDir: string): BridgeEndpoint | null {
  const fromEnv = process.env.COMICSPACE_ACCOUNT_BROWSER?.trim();
  const envToken = process.env.COMICSPACE_ACCOUNT_BROWSER_TOKEN?.trim();
  if (fromEnv && envToken) return { url: fromEnv.replace(/\/+$/, ""), token: envToken };
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, "account-browser.json"), "utf8"),
    ) as { url?: unknown; token?: unknown };
    if (typeof raw.url === "string" && typeof raw.token === "string" && raw.token) {
      return { url: raw.url.replace(/\/+$/, ""), token: raw.token };
    }
  } catch {
    // The desktop window has not advertised a browser bridge.
  }
  return null;
}

async function bridgeCall<T>(
  endpoint: BridgeEndpoint,
  op: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${endpoint.url}/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-comicspace-browser-token": endpoint.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(200_000),
    });
  } catch {
    throw new Error("无法连接桌面浏览器窗口");
  }
  const payload = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `浏览器窗口返回 HTTP ${response.status}`);
  }
  return payload;
}

export function openDesktopAccountSession(
  dataDir: string,
): (() => Promise<AccountPageSession>) | undefined {
  const endpoint = accountBrowserEndpoint(dataDir);
  if (!endpoint) return undefined;
  return async () => {
    await bridgeCall(endpoint, "open");
    const session: AccountPageSession = {
      async goto(url: string) {
        await bridgeCall(endpoint, "goto", { url });
      },
      async current() {
        return bridgeCall<AccountPageView>(endpoint, "html");
      },
      async clickNext() {
        const result = await bridgeCall<{ clicked?: boolean }>(endpoint, "next");
        return Boolean(result.clicked);
      },
      async close() {
        await bridgeCall(endpoint, "close").catch(() => undefined);
      },
    };
    return session;
  };
}
