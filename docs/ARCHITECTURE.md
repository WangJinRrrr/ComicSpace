# Architecture

## 边界

```
apps/web (Vite + React)
   │  HTTP /api + @comicspace/contracts
   ▼
apps/server (Hono)
   ├── plugins/ (jiti, trusted local code)
   ├── data/comicspace.db (node:sqlite)
   ├── data/cache/images (automatic reading cache)
   └── data/downloads (explicit offline downloads)
```

- `apps/web` 不依赖 server 包、Node 内置模块、jiti 或 SQLite。ESLint 的 `no-restricted-imports` 会拦截越界导入。
- `apps/server` 不导入 Web 代码。
- `packages/contracts` 是唯一共享代码：DTO、zod 请求 schema、错误类型。
- `packages/plugin-sdk` 只给插件作者使用；Web 不依赖它。
- 后端通过 `createApp(context)` 注入 DB、插件注册表、图片代理、缓存、下载 worker，便于 route 测试。

## 请求路径

- 开发：浏览器 → Vite 5173 → `/api` 代理 → Hono 4000。
- 生产：Hono 4000 同时提供 `apps/web/dist` 静态文件与 `/api`，SPA 路由 fallback 到 `index.html`。
- 图片：API 返回 `/api/image/<AES-GCM ticket>` 或 `/api/downloads/pages/<id>`，浏览器不接触远程 URL、Cookie 或 headers。

## 插件运行时

`PluginLoader` 扫描 `plugins/<id>/plugin.json`，用 jiti 加载 TS/ESM 入口：

- manifest 校验：`apiVersion`、id 与目录一致、entry 不越界、realpath 不逃逸、body limit。
- 能力由方法推导：`search`、`browse`、`filters`；`getChapters`/`getPages` 必需。
- 输出用 zod 归一化：URL 仅 http(s)、章节去重、页数上限、条目上限。
- 调用有 AbortSignal 超时（搜索 20s、章节/页面 30s）、每插件 FIFO 并发限制、可选最小请求间隔。
- 单个插件加载失败只进入 `failures`，不影响其他插件。
- SDK 运行时别名指向 `packages/plugin-sdk/runtime.mjs`，避免生产环境让 Node 直接加载 TS 源码；类型仍由 `src/index.ts` 提供。

## 存储

SQLite（WAL、busy_timeout、foreign_keys）：

- `manga_cache` / `chapter_cache` / `chapter_pages`：插件结果的快照与降级缓存。
- `library`：书架成员。
- `chapter_progress`：断点续读与已读状态。
- `history`：最近阅读；清空历史不会删进度。
- `downloads` / `download_pages`：持久下载任务与本地页。
- `page_cache`：自动阅读缓存元数据。
- `plugin_configs`：插件键值配置（明文，见 LEGAL）。
- `settings`：图片额外主机、缓存上限等。

缓存策略：详情 1h、章节 15m、页面元数据 24h。源失败时返回缓存并标记 `stale`；已下载章节优先本地。

## 阅读缓存

- 键：`sha256(sourceId + kind + normalize(url) + stableHeadersHash)`。
- 文件：`data/cache/images/<前两位>/<key>.<ext>`；元数据 `page_cache`。
- 图片代理未命中时 `body.tee()`：一路立即返回浏览器，一路写 `.part` 后原子 rename。
- 上游 CDN 偶发断连（`ECONNRESET`）：先读首个分片，把早期断连纳入「重试一次」；传输中 15s 无新数据视为断流并终止。响应转发上游 `content-length`，截断会变成明确的加载失败，而不是半张图。
- LRU 默认 1GB（设置项 128MB–10GB），超过后淘汰到 90%；下载目录不参与淘汰。
- ticket 用确定性 nonce 封装，同一张图在同一有效期内始终得到同一个 URL，浏览器 HTTP 缓存因此能跨 payload 重建复用。
- 打开章节走缓存优先：章节列表（15 分钟）与页面列表（24 小时）过期时先返回缓存，再在后台刷新；`refresh=1` 仍同步刷新，供图片失败后恢复。
- 前端按 `navigator.connection` 自适应（`saveData` / `effectiveType` / `downlink`）：离线或省流量关闭预取；2G/3G 缩小前向窗口与并发；高带宽提高并发与池上限。`online`/`change` 事件会实时重算。
- 预取调度是优先级队列（urgent → ahead → behind → idle）：翻页会重排队列，下一张/下一跨页先跑；切章清空旧队列；失败图片指数退避重试一次，仍失败则等它真正成为 urgent 时再试。
- 前端预取当前页前/后（单页 7/2、双页 8/2、条漫 9/3 页，默认并发 4、池上限 24），章末预取下一章前 6 张、回翻预取上一章后 4 张（idle 优先级），并对预取图调用 `img.decode()`。停在同一页约 1.5 秒后会继续加载窗口之后的 8 页（可在阅读设置关闭）。
- 详情页悬停/聚焦章节 160ms 后预取该章页面列表；页面空闲 800ms 后预取「继续阅读」章节。页面列表会触发服务端预热，因此悬停一次就同时拿到元数据与首批图片。
- 服务端打开章节时预热当前进度前 5 页、后 2 页；所有预热请求走一个全局 3 并发、最多 96 项的共享队列，避免多标签页同时打开时把 CDN 打满。
- 图片上游请求对瞬时失败（连接重置、429、5xx、DNS）最多尝试 3 次，指数退避 + 抖动，并尊重 `Retry-After`（上限 4 秒）；403/404/解析失败首轮即失败，不做无意义重试。

## 下载队列

- 进程内单例，DB 为事实来源；启动时 `running → queued` 恢复。
- 全局 2 章并发，但同一源同时只跑 1 章（源站通常按 IP/窗口限流，同源并行只会互相拖慢）；每章 3 张图并发；`.part` 写入后 rename。
- 单页重试只针对可重试错误（连接重置、超时、429、5xx），指数退避 + 抖动；403/404/解析失败立即计入失败页。
- 取消保留已完成页供重试；删除才清理目录与 DB。
- 下载页 URL 使用 `download_pages.id`，服务端做路径 containment 校验。

## 安全

- 服务只绑定 127.0.0.1，无鉴权；写请求做 Origin 校验。
- 图片 ticket AES-256-GCM 加密，headers 不出浏览器；同一有效期内同一图片的 URL 稳定（确定性 nonce），便于缓存复用。
- SSRF guard：协议、主机白名单、DNS 私有地址拒绝、手动重定向校验、跨域丢弃 Cookie/Authorization、64MB 上限。
- 私有地址只能由用户在设置中显式加入 `image.extraAllowedHosts`，不能由插件单方面开启。
- 插件是可信本地代码，不做沙箱；只安装可信插件。超时不能终止同步死循环。
