import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";

/**
 * Visible site window used to read the copy-manga bookshelf after the user
 * logs in. It only loads the public website and clicks the on-screen pager.
 */

const ALLOWED_SUFFIXES = [
  "mangacopy.com",
  "copymanga.tv",
  "copymanga.site",
  "copymanga.org",
  "copymanga.net",
  "copy-manga.com",
  "copy20.com",
  "copy2000.site",
  "2025copy.com",
  "2026copy.com",
  "copy3000.com",
  "copy4000.com",
  "copy5000.com",
  "copy6000.com",
];

const NEXT_PAGE_SCRIPT = `(() => {
  const pager = document.querySelector(".el-pagination");
  if (!pager) return false;
  const active = pager.querySelector(".number.active, .active.number");
  const current = Number((active && active.textContent ? active.textContent : "").trim());
  if (!Number.isFinite(current)) return false;
  const next = Array.from(pager.querySelectorAll(".number")).find((element) => {
    return Number((element.textContent || "").trim()) === current + 1;
  });
  if (!next) return false;
  next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
})()`;

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function urlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hostAllowed(url.hostname);
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 64_000) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export async function startAccountBrowser(options: {
  advertiseFiles: string[];
}): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(24).toString("hex");
  let windowRef: BrowserWindow | null = null;

  const windowOf = (): BrowserWindow => {
    if (windowRef && !windowRef.isDestroyed()) return windowRef;
    windowRef = new BrowserWindow({
      width: 1100,
      height: 800,
      show: true,
      title: "登录拷贝漫画以同步收藏和历史",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:mangacopy-account",
      },
    });
    windowRef.webContents.setWindowOpenHandler(({ url }) => {
      if (urlAllowed(url)) return { action: "allow" };
      return { action: "deny" };
    });
    windowRef.webContents.on("will-navigate", (event, url) => {
      if (!urlAllowed(url)) event.preventDefault();
    });
    return windowRef;
  };

  const server = createServer((request, response) => {
    void (async () => {
      const header = request.headers["x-comicspace-browser-token"];
      if (header !== token) {
        send(response, 403, { ok: false, error: "浏览器桥接被拒绝" });
        return;
      }
      const op = (request.url ?? "/").replace(/^\//, "").split("?")[0];
      let payload: { url?: string };
      try {
        const text = await readBody(request);
        payload = text ? (JSON.parse(text) as { url?: string }) : {};
      } catch {
        send(response, 400, { ok: false, error: "请求无法解析" });
        return;
      }
      try {
        if (op === "open") {
          windowOf().show();
          send(response, 200, { ok: true });
          return;
        }
        if (op === "goto") {
          if (!payload.url || !urlAllowed(payload.url)) {
            send(response, 400, { ok: false, error: "只打开拷贝漫画的 https 页面" });
            return;
          }
          const win = windowOf();
          win.show();
          await win.loadURL(payload.url);
          send(response, 200, { ok: true });
          return;
        }
        if (op === "html") {
          const win = windowOf();
          const html = await win.webContents.executeJavaScript(
            "document.documentElement ? document.documentElement.outerHTML : ''",
            true,
          );
          send(response, 200, {
            ok: true,
            url: win.webContents.getURL(),
            html: typeof html === "string" ? html.slice(0, 2_000_000) : "",
          });
          return;
        }
        if (op === "next") {
          const win = windowOf();
          const clicked = await win.webContents.executeJavaScript(NEXT_PAGE_SCRIPT, true);
          send(response, 200, { ok: true, clicked: Boolean(clicked) });
          return;
        }
        if (op === "close") {
          if (windowRef && !windowRef.isDestroyed()) windowRef.close();
          windowRef = null;
          send(response, 200, { ok: true });
          return;
        }
        send(response, 404, { ok: false, error: "未知操作" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "浏览器窗口操作失败";
        send(response, 500, { ok: false, error: message });
      }
    })().catch(() => {
      if (!response.headersSent) {
        send(response, 500, { ok: false, error: "浏览器窗口操作失败" });
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("没有拿到浏览器桥接端口"));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({ url, token });
  for (const file of options.advertiseFiles) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o600 });
  }

  return {
    url,
    token,
    close: async () => {
      if (windowRef && !windowRef.isDestroyed()) windowRef.close();
      windowRef = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const file of options.advertiseFiles) {
        fs.rmSync(file, { force: true });
      }
    },
  };
}
