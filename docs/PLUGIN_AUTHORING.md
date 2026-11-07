# 编写 ComicSpace 插件

## 最小结构

```
plugins/my-source/
  plugin.json
  index.ts
```

```bash
pnpm plugin:new my-source "My Source"
```

## plugin.json

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "my-source",
  "name": "My Source",
  "version": "0.1.0",
  "entry": "index.ts",
  "description": "…",
  "languages": ["zh"],
  "readingDirection": "ltr",
  "allowedImageHosts": ["cdn.example.com"],
  "config": [
    {
      "key": "baseUrl",
      "label": "API base URL",
      "type": "url",
      "required": true,
      "default": "https://api.example.com"
    }
  ]
}
```

- `id` 必须等于文件夹名，格式 `^[a-z0-9][a-z0-9_-]{1,63}$`。
- `entry` 必须在插件目录内，支持 TS/JS/ESM。
- `allowedImageHosts` 支持精确 host，或带 `*` 通配符的模式（如 `*.example.com`、`*.mangafun*.fun`）；图片代理只允许这些主机（未声明时只允许公网地址）。
- `imageHeaders` 可作为封面默认请求头；页面级 headers 优先。
- `config` 会生成设置表单；`password` 字段在 API 中返回 `null` + `secretKeys`，留空表示保持。

## 契约

```ts
import type { MangaPlugin } from "@comicspace/plugin-sdk";

const plugin: MangaPlugin = {
  search?(query, ctx),
  browse?(query, ctx),
  getFilters?(ctx),
  getManga?(mangaId, ctx),
  getChapters(mangaId, ctx),
  getPages(mangaId, chapterId, ctx),
};

export default plugin;
```

- 目录源至少实现 `search` / `browse` 之一，并实现 `getChapters` / `getPages`。
- 可选 `pullAccount(ctx)`：只读导入登录站点的收藏和阅读历史，不能写回网站。返回 `{ favorites, history }`，某一侧读不到时把 `available` 设为 `false`，不要用空列表假装同步成功。只做账号同步的插件可以不实现搜索。
- `search`/`browse` 返回 `{ items, page, hasNextPage, total? }`，items 最多 100。
- `getPages` 返回数组，顺序即页码；最多 5000。
- 图片 URL 必须是绝对 http(s)。建议提供 `width`/`height`，双页排版会用它判断宽图。
- 页面需要 Referer/Cookie 时放进 `Page.headers`，服务端会加密进 ticket，不会出现在浏览器 URL 里。
- 源站把整页图片切成条带乱序存放时，可用 `Page.transform` 让服务端在缓存与离线下载前还原：

  ```ts
  {
    type: "band-reverse",
    bands: 10, // 图片高度等分成 10 条，底部条带包含余数行
  }
  ```

  目前支持 `band-reverse`：把等高的横向条带上下反转。图片按 JPEG/PNG/WebP 解码后重新编码，GIF 保持原样。

## 数据模型

见 `packages/plugin-sdk/src/models.ts`。关键点：

- `Manga.id`、`Chapter.id` 在源内稳定。
- `readingDirection`: `rtl`（日漫右到左）、`ltr`、`ttb`（条漫）。
- `status`: `ongoing` / `completed` / `hiatus` / `cancelled` / `unknown`。
- `updatedAt` / `publishedAt` 使用 ISO 字符串。

## Context

```ts
ctx.config   // manifest.config 解析后的值
ctx.signal   // 请求取消/超时；请传给 fetch
ctx.fetch    // 带默认 UA/Accept 的 fetch
ctx.logger   // debug/info/warn/error
```

错误可抛普通 Error，也可使用：

```ts
import { PluginError } from "@comicspace/plugin-sdk";

throw new PluginError("auth_required", "请先在设置中填写 Cookie");
```

## 筛选器

`getFilters()` 返回：

- `text`
- `select`
- `multi-select`
- `boolean`
- `number`
- `sort`

前端会自动生成控件，并把值放进 `query.filters`。

## 调试

```bash
pnpm plugin:check
```

或在设置页点击“重载插件”。修改插件代码后需要重载；深度依赖变化建议重启服务。
