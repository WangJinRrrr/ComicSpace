// Assembles the runtime folder that electron-builder ships under resources/.
// Run `pnpm build` first: this script only copies, it does not compile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(repoRoot, "apps", "server");
const webDist = path.join(repoRoot, "apps", "web", "dist");
const outDir = path.join(repoRoot, ".build", "desktop");
const outServer = path.join(outDir, "server");

const REQUIRED = [
  "dist/index.js",
  "node_modules/hono",
  "node_modules/@hono/node-server",
  "node_modules/jiti",
  "node_modules/sharp",
  "node_modules/@img/sharp-win32-x64",
];

function fail(message) {
  console.error(`\n[desktop-stage] ${message}`);
  process.exit(1);
}

function copy(source, target) {
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function verifyServer(target) {
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(target, rel)));
  if (missing.length > 0) {
    console.warn(`[desktop-stage] 缺少运行时文件：${missing.join(", ")}`);
    return false;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  if (pkg.type !== "module") {
    console.warn("[desktop-stage] server/package.json 缺少 \"type\": \"module\"");
    return false;
  }
  return true;
}

// pnpm's virtual store keeps a package and all of its dependencies as siblings,
// e.g. .pnpm/sharp@x/node_modules/{sharp,@img,semver,detect-libc}. Copying that
// sibling set yields a self-contained tree; copying just the package directory
// would drop sharp's native binaries.
function stageManually() {
  console.log("[desktop-stage] 物化服务端运行时依赖");
  fs.rmSync(outServer, { recursive: true, force: true });
  const outModules = path.join(outServer, "node_modules");
  fs.mkdirSync(outModules, { recursive: true });

  copy(path.join(serverDir, "dist"), path.join(outServer, "dist"));
  copy(path.join(serverDir, "package.json"), path.join(outServer, "package.json"));

  const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {}).filter(
    (name) => !name.startsWith("@comicspace/"),
  );

  for (const name of deps) {
    const source = path.join(serverDir, "node_modules", name);
    if (!fs.existsSync(source)) {
      fail(`依赖未安装：${name}`);
    }
    const packageDir = fs.realpathSync(source);
    // Scoped packages live one level deeper: node_modules/@scope/name.
    const virtualModules = path.dirname(
      name.startsWith("@") ? path.dirname(packageDir) : packageDir,
    );
    for (const entry of fs.readdirSync(virtualModules, { withFileTypes: true })) {
      if (entry.name === ".bin" || entry.name === "@types") continue;
      const target = path.join(outModules, entry.name);
      if (fs.existsSync(target)) continue;
      copy(path.join(virtualModules, entry.name), target);
    }
  }

  return verifyServer(outServer);
}

function main() {
  if (!fs.existsSync(path.join(serverDir, "dist", "index.js"))) {
    fail("apps/server/dist/index.js 不存在，请先运行 pnpm build");
  }
  if (!fs.existsSync(path.join(webDist, "index.html"))) {
    fail("apps/web/dist/index.html 不存在，请先运行 pnpm build");
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (!stageManually()) {
    fail("服务端运行时组装失败");
  }

  console.log("[desktop-stage] 复制前端构建产物");
  copy(webDist, path.join(outDir, "web"));

  console.log("[desktop-stage] 复制插件 SDK 运行时");
  const sdkDir = path.join(outDir, "plugin-sdk");
  fs.mkdirSync(sdkDir, { recursive: true });
  copy(
    path.join(repoRoot, "packages", "plugin-sdk", "runtime.mjs"),
    path.join(sdkDir, "runtime.mjs"),
  );

  const defaultPlugins = path.join(outDir, "default-plugins");
  fs.mkdirSync(defaultPlugins, { recursive: true });
  if (process.env.COMICSPACE_BUNDLE_PLUGINS !== "0") {
    const pluginsDir = path.join(repoRoot, "plugins");
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      copy(path.join(pluginsDir, entry.name), path.join(defaultPlugins, entry.name));
    }
  }

  console.log(`[desktop-stage] 完成 → ${outDir}`);
}

main();
