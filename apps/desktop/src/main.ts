import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from "electron";
import { startAccountBrowser } from "./accountBrowser.js";

// Must run before any app.getPath("userData") call, otherwise the scoped
// package name (@comicspace/desktop) leaks into %APPDATA%.
app.setName("ComicSpace");

const DEV_SERVER =
  process.env.COMICSPACE_DEV_SERVER?.trim() || "http://127.0.0.1:5173";
const IS_DEV = process.argv.includes("--dev");

let serverProcess: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let appOrigin = "";
let accountBrowser: { close: () => Promise<void> } | null = null;

function resourcesPath(...parts: string[]): string {
  return path.join(process.resourcesPath, ...parts);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error("Failed to pick a free port"));
      });
    });
  });
}

function seedPlugins(pluginsDir: string): void {
  const source = resourcesPath("default-plugins");
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(pluginsDir, { recursive: true });
  if (fs.readdirSync(pluginsDir).length > 0) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.cpSync(path.join(source, entry.name), path.join(pluginsDir, entry.name), {
      recursive: true,
    });
  }
}

function packagingKind(): "dev" | "nsis" | "portable" {
  if (IS_DEV || !app.isPackaged) return "dev";
  if (process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) {
    return "portable";
  }
  return "nsis";
}

function collectEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

async function startServer(): Promise<{ origin: string; pluginsDir: string; dataDir: string }> {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const pluginsDir = path.join(userData, "plugins");
  const logsDir = path.join(userData, "logs");
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  seedPlugins(pluginsDir);

  const entry = resourcesPath("server", "dist", "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`服务端入口不存在：${entry}`);
  }

  const logFile = path.join(logsDir, "server.log");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n=== ${new Date().toISOString()} starting ===\n`);

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await startAccountBrowser({
    advertiseFiles: [path.join(dataDir, "account-browser.json")],
  }).catch(() => null);
  accountBrowser = browser;

  const child = utilityProcess.fork(entry, [], {
    serviceName: "comicspace-server",
    stdio: "pipe",
    env: collectEnv({
      HOST: "127.0.0.1",
      PORT: String(port),
      WEB_ORIGIN: origin,
      COMICSPACE_DATA_DIR: dataDir,
      COMICSPACE_PLUGINS_DIR: pluginsDir,
      COMICSPACE_WEB_DIST: resourcesPath("web"),
      COMICSPACE_SDK_ENTRY: resourcesPath("plugin-sdk", "runtime.mjs"),
      COMICSPACE_RUNTIME: "desktop",
      COMICSPACE_APP_VERSION: app.getVersion(),
      COMICSPACE_PACKAGING: packagingKind(),
      ...(browser
        ? {
            COMICSPACE_ACCOUNT_BROWSER: browser.url,
            COMICSPACE_ACCOUNT_BROWSER_TOKEN: browser.token,
          }
        : {}),
    }),
  });

  child.stdout?.on("data", (chunk: Buffer) => logStream.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => logStream.write(chunk));
  child.on("exit", (code) => {
    logStream.write(`[server exited with code ${code}]\n`);
    serverProcess = null;
  });

  serverProcess = child;
  return { origin, pluginsDir, dataDir };
}

async function waitForServer(origin: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`服务启动超时：${lastError}`);
}

function isInternal(target: string): boolean {
  try {
    return new URL(target).origin === appOrigin;
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0d10",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  void mainWindow.loadURL(appOrigin);
}

function buildMenu(pluginsDir: string, dataDir: string): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "打开数据目录", click: () => void shell.openPath(dataDir) },
        { label: "打开插件目录", click: () => void shell.openPath(pluginsDir) },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 ComicSpace",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: "关于 ComicSpace",
              message: `ComicSpace ${app.getVersion()}`,
              detail: `Electron ${process.versions.electron}\nNode ${process.versions.node}\n\n数据目录：${dataDir}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function ensureSqlite(): void {
  try {
    const sqlite = (process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }).getBuiltinModule?.("node:sqlite");
    if (!sqlite) throw new Error("node:sqlite is unavailable");
  } catch (error) {
    throw new Error(
      `当前 Electron 运行时不包含 node:sqlite（Node ${process.versions.node}）。请使用 Electron 37.2.3 及以上版本。`,
      { cause: error },
    );
  }
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId("app.comicspace.desktop");

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    void accountBrowser?.close();
    accountBrowser = null;
  });

  app
    .whenReady()
    .then(async () => {
      ensureSqlite();

      if (IS_DEV) {
        appOrigin = new URL(DEV_SERVER).origin;
        const repoRoot = path.resolve(__dirname, "../../..");
        accountBrowser = await startAccountBrowser({
          advertiseFiles: [path.join(repoRoot, "data", "account-browser.json")],
        }).catch(() => null);
        buildMenu(path.join(repoRoot, "plugins"), path.join(repoRoot, "data"));
        createWindow();
        return;
      }

      const { origin, pluginsDir, dataDir } = await startServer();
      appOrigin = origin;
      await waitForServer(origin);
      buildMenu(pluginsDir, dataDir);
      createWindow();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        "ComicSpace 启动失败",
        `${message}\n\n日志：${path.join(app.getPath("userData"), "logs", "server.log")}`,
      );
      app.quit();
    });
}
