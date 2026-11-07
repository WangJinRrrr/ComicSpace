# ComicSpace

本地漫画阅读 Web 应用。前端是 Vite + React SPA，后端是独立的 Hono 服务；内容源通过 `plugins/<id>/` 下的 JS/TS 插件接入，核心不附带任何漫画站点。

## 功能

- 浏览、搜索、标签/排序筛选、漫画详情
- 书架、阅读进度、历史、继续阅读
- 单页 / 双页 / 条漫阅读器，支持右→左、宽图独占、缩放/平移、键盘与触屏
- 阅读时自动磁盘缓存页面图片；回看和源站抖动时优先读本地
- 按网络状态自适应预取，翻页优先、空闲时预读本章；详情页悬停章节即开始预热
- 图片请求自动重试与退避；插件可做域名健康探测与图片 CDN 线路轮换
- 章节离线下载，断开源站后仍可阅读
- 插件级配置（API Key、Cookie、镜像地址等），JSON 表单自动生成
- 前后端只通过 HTTP API 与 `packages/contracts` 通信；Web 端禁止导入服务端代码

## 快速开始

要求：Node.js 24+、pnpm 11+。

```bash
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5173。

首次启动没有内容源，首页会显示安装指引。把插件文件夹放进 `plugins/`，在设置页点击“重载插件”，然后配置必填项。

生产模式（单端口，Hono 同时托管前端与 API）：

```bash
pnpm build
pnpm start
```

打开 http://127.0.0.1:4000。服务默认只监听 `127.0.0.1`，没有账号体系，不要直接暴露到公网。

## Windows 桌面版

```bash
pnpm desktop:build
```

产物在 `release/`：

- `ComicSpace Setup <version>.exe` —— 安装版（NSIS）
- `ComicSpace <version>.exe` —— 便携版

桌面版是 Electron 外壳 + 原样的 Hono 服务端：主进程拉起打包后的服务，窗口加载 `http://127.0.0.1:<随机端口>`，前端与 API 同源，因此不需要任何前端改动。

首次启动创建 `%APPDATA%\ComicSpace`：

```
data/       # SQLite、图片缓存、下载
plugins/    # 插件目录，首次为空时从构建时的 plugins/ 播种
logs/       # 服务端日志
```

应用内「文件 → 打开插件目录 / 打开数据目录」可直接定位。

注意：

- 只构建 Windows x64
- 安装包未签名，首次运行会触发 SmartScreen 提示
- 桌面版数据与仓库根目录的 `data/` 不互通，需要迁移时手动复制
- 构建时可用 `COMICSPACE_BUNDLE_PLUGINS=0` 跳过插件播种
- 图标源文件是 `apps/desktop/build/icon.svg`，改完执行 `pnpm desktop:icon` 重新生成 `icon.ico` / `icon.png`

## 插件

```bash
pnpm plugin:new my-source "My Source"
```

会从 `templates/plugin` 创建 `plugins/my-source/`。修改 `plugin.json` 与 `index.ts`，然后重载插件。

- 插件目录不参与 pnpm workspace；复制文件夹即可安装，不需要 `pnpm install`。
- 插件是本地可信 Node 代码，拥有完整进程权限；只安装你信任的插件。
- 插件文档：[docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md)
- 校验插件：

```bash
pnpm plugin:check
```

## 数据目录

默认都在仓库根目录，已被 gitignore：

```
data/
  comicspace.db          # SQLite（node:sqlite）
  downloads/<id>/        # 用户主动下载的章节
  cache/images/          # 自动阅读缓存，可 LRU 清理
  .image-secret          # 图片 ticket 加密密钥
plugins/                 # 你的内容源插件
```

可用环境变量覆盖：

- `COMICSPACE_DATA_DIR`
- `COMICSPACE_PLUGINS_DIR`
- `COMICSPACE_IMAGE_ALLOW_HOSTS`（局域网镜像等私有地址白名单）
- `COMICSPACE_CACHE_LIMIT_MB`
- `COMICSPACE_PROXY_URL`（全局 HTTP/HTTPS 代理，用于插件请求、章节图片和下载；留空直连）
- `HOST` / `PORT` / `WEB_ORIGIN`

参考 `.env.example`。

## 开发命令

```bash
pnpm dev          # API 4000 + Vite 5173
pnpm dev:fixture  # 同上，并启动 tests/fixtures 的本地图片源
pnpm build        # 构建前端与后端
pnpm start        # 生产模式，单端口 4000
pnpm desktop:dev  # Electron 窗口加载 Vite 开发服务器（需先 pnpm dev）
pnpm desktop:build # 打包 Windows 安装版与便携版到 release/
pnpm test         # Vitest
pnpm typecheck    # workspace + plugins/templates
pnpm lint         # ESLint，包含前后端边界规则
pnpm plugin:check # 校验已安装插件
```

## 测试 fixture

`tests/fixtures/` 下有一个仅用于开发/测试的 `mock-source`，不会进入 `plugins/`。手动验证完整流程：

```bash
pnpm dev:fixture
```

这个命令会同时启动本地图片 fixture 服务，并把插件目录指向 `tests/fixtures/plugins`。在设置页确认 Mock Source 就绪，即可体验搜索、双页、条漫、缓存和下载。

## 视觉方向

第一版只做功能性的设计 token 与可访问组件，不投入复杂动效。后续视觉可独立接入：

- Motion：UI 与路由转场
- GSAP：时间线与复杂编排
- Three.js / React Three Fiber：3D 书架、空间转场
- PixiJS / Canvas：高性能翻页、纸张/景深效果
- View Transitions API：原生路由过渡

阅读器已把 `ReaderStage`、分页/条漫视图与数据/进度逻辑分开，后续替换渲染层不需要动后端或缓存
