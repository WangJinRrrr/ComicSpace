# 拷贝漫画 (MangaCopy) 插件

通过拷贝漫画 API 浏览、搜索与阅读中文漫画。默认复用 Kira（caolib/kira）的 HotManga 请求方式。

## 特性

- 🔍 支持搜索和浏览
- 📚 多分组章节支持
- 🚀 自动处理图片防盗技术(band-reverse 条带反转)
- 🌐 支持 HTTP/HTTPS 代理加速
- 🔐 支持登录 Token 访问付费/会员内容

## 配置项

### 接口通道
- **Kira / HotManga**（推荐）: 使用 `mapi.hotmangas*.com` 线路,稳定性好
- **拷贝网页通道**: 使用 `api.mangacopy.com`,可能遇到 code 210 风控
- **拷贝 App 通道**: 需要额外签名,一般用不上

### API 域名
留空时自动使用 Kira 的 HotManga 线路。也可以手动指定域名。

### 版本号
留空时根据通道自动选择版本。过旧的版本可能触发服务端校验。

### 登录 Token
用于访问需要登录的内容。只填 Token 本身,不要带 `Token ` 前缀。

获取方式:
1. 在浏览器打开拷贝漫画网站并登录
2. 打开开发者工具 → Network 标签
3. 刷新页面,找到任意 API 请求
4. 在请求头中复制 `Authorization: Token xxx` 的 `xxx` 部分

### 线路区域
- **默认 (region=1)**: 国内 CDN
- **海外 CDN (region=0)**: 图片加载慢时可以尝试

### 图片 User-Agent
默认 `Dart/2.16(dart:io)`,图片 CDN 会校验,一般不需要修改。

### 代理服务器 🆕
HTTP/HTTPS 代理地址,用于加速访问。格式示例:
- `http://127.0.0.1:7890`
- `https://proxy.example.com:8080`

留空表示不使用代理。

常见代理软件的默认地址:
- Clash: `http://127.0.0.1:7890`
- V2rayN: `http://127.0.0.1:10809`
- Shadowsocks: `http://127.0.0.1:1080`

## 已知问题

### 图片加载慢
- 尝试配置系统代理
- 切换到海外 CDN (region=0)
- 更换 API 域名

### Code 210 风控
拷贝漫画的反爬机制,通常需要等待约 1 小时后自动解除。

解决方法:
1. 切换到 Kira / HotManga 通道(推荐)
2. 更换网络环境
3. 更换 API 域名

### 部分图片显示不完整
已修复。如果仍有问题,请清除缓存后重试。

## 更新日志

查看 [CHANGELOG.md](./CHANGELOG.md)

## 法律声明

本插件仅供学习交流使用,请勿用于商业用途。请遵守相关网站的服务条款和当地法律法规。

ComicSpace 不提供任何内容源或爬虫,也不提供付费墙/DRM 绕过功能。
