# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

基于 **Chrome Extension Manifest V3** 的多平台数据抓取插件，采用面向对象架构，支持小红书、公众号、飞书等平台，可对接 Notion、飞书、本地存储。

本仓库有**两个实现**：

| 目录 | 技术栈 | 状态 |
|------|--------|------|
| `extension/` | 原生 JavaScript，无构建工具 | 稳定 |
| `cjdb-wxt/` | WXT + Vue 3 + TypeScript | 现代重写版（更多平台支持） |

---

## 开发命令

### extension/（原生 JS）
无构建步骤。直接在 Chrome `chrome://extensions/` 加载 `extension/` 文件夹，修改后手动点击「重新加载」。

### cjdb-wxt/（WXT 版本）
```bash
cd cjdb-wxt
npm install

npm run dev      # 开发模式（HMR 热重载，持久化数据在 .wxt/chrome-data）
npm run build    # 生产构建（输出到 output/）
npm run zip      # 打包为 Chrome Store 上传格式
```

---

## 架构

### 核心模块职责

```
Main（主调度）
  ├── Crawlers[] — 识别页面 / 爬取数据 / 标注页面 / 管理采集状态
  ├── Renderer   — 渲染 UI 面板、按钮、配置弹窗
  └── Store      — 统一存储入口，适配器分发
```

### 数据流

```
URL 变化
  → Main 找到匹配的 Crawler（canHandle）
  → Crawler.marker()  标注页面（注入 #1/#2 编号和勾选框）
  → Renderer.render() 更新 UI

用户点击采集
  → Crawler.crawl()   提取业务数据
  → Store.save()      分发到适配器（Notion / 飞书 / 本地）
  → 显示结果
```

### 全局调试入口（extension/ 版本）

```js
window.CJDB_Main.currentCrawler.getCrawlerState()   // 查看爬虫状态
await window.CJDB_Main.currentCrawler.crawl()        // 手动触发采集
await window.CJDB_Store.save('xiaohongshu-note', data) // 手动存储
window.CJDB_Main.crawlers                            // 所有已注册爬虫
```

---

## 文件位置速查

### extension/ 版本

| 功能 | 路径 |
|------|------|
| 爬虫基类 | `extension/core/crawlers/BaseCrawler.js` |
| 主调度 | `extension/core/Main.js` |
| UI 渲染 | `extension/core/Renderer.js` |
| 存储入口 | `extension/core/stores/Store.js` |
| Notion 适配器 | `extension/core/stores/NotionStore.js` |
| 启动入口 | `extension/content/boot.js` |
| 扩展配置 | `extension/manifest.json` |

### cjdb-wxt/ 版本

| 功能 | 路径 |
|------|------|
| 启动入口 / 主调度 | `cjdb-wxt/entrypoints/content.ts` |
| 主 UI 组件 | `cjdb-wxt/components/CollectPanel.vue` |
| 存储配置（响应式） | `cjdb-wxt/config/StoreConfig.ts` |
| TypeScript 类型定义 | `cjdb-wxt/types/index.ts` |
| WXT 配置 | `cjdb-wxt/wxt.config.ts` |

---

## 开发原则

### 1. Main 只传递，不做业务逻辑

```js
// ✅ 正确
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  const results = await this.store.save(this.currentDataType, data)
}

// ❌ 错误 — 不要在 Main 里遍历、过滤、转换
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  for (const item of data) { ... }
}
```

### 2. 数据封装，内部状态通过 getCrawlerState() 导出

```js
// ✅ 正确
getCrawlerState() {
  return { collectionType: 'comment', count: Object.keys(this.commentCollection).length }
}

// ❌ 错误 — 不直接暴露内部变量
getCommentCollection() { return this.commentCollection }
```

### 3. Crawler 不调用 Store

```js
// ✅ 正确：crawl() 只返回数据
async crawl() { return this._extractData() }

// ❌ 错误
async crawl() { await window.CJDB_Store.save(...); return data }
```

### 4. 依赖注入，Main 通过构造函数接收依赖

```js
// ✅ 正确
class Main {
  constructor(crawlers, renderer, store) { ... }
}

// ❌ 错误 — 不在内部 new 依赖
class Main {
  constructor() { this.crawlers = [new XhsNoteCrawler()] }
}
```

### 5. crawl() vs getCrawlerState() 用途不同

| 方法 | 返回内容 | 用途 |
|------|---------|------|
| `crawl()` | 业务数据（要存储的） | 传给 Store |
| `getCrawlerState()` | 元数据（状态信息） | 调试、UI 显示 |

---

## BaseCrawler 接口（所有 Crawler 必须实现）

```js
canHandle(url)           // → boolean：是否处理该 URL
getDataType()            // → string：数据类型标识
async crawl(opts)        // → Object|Array：业务数据（用于存储）
marker()                 // → void：标注页面（注入编号和勾选框）
getCollectionCount()     // → number：当前勾选数量
getCollectionTargets()   // → Array：批量采集目标列表
getCrawlerState()        // → Object：爬虫元数据
```

Store 适配器返回格式：`{ ok: boolean, action?: string, error?: string }`

---

## 新增平台支持

### extension/ 版本（4 步）

1. 创建 `extension/core/crawlers/DouyinCrawler.js`，继承 `BaseCrawler`，实现全部接口，末尾 `window.DouyinCrawler = DouyinCrawler`
2. 在 `extension/content/boot.js` 的 crawlers 数组中注册 `new DouyinCrawler()`
3. 在 `extension/core/Renderer.js` 的 `COLLECT_TARGET` 中添加按钮文案和标签
4. 在 `extension/manifest.json` 的 `content_scripts` 中添加 `matches` 和 JS 文件路径

### cjdb-wxt/ 版本（3 步）

1. 创建 `cjdb-wxt/crawlers/DouyinCrawler.ts`，实现同样的接口
2. 在 `cjdb-wxt/entrypoints/content.ts` 中注册到 crawlers 数组
3. 在 `cjdb-wxt/wxt.config.ts` 的 `host_permissions` 中添加域名

---

## 支持平台现状

| 平台 | extension/ | cjdb-wxt/ |
|------|-----------|-----------|
| 小红书笔记 | ✅ | ✅ |
| 小红书发现页 | ✅ | ✅ |
| 小红书账号 | ✅ | ✅ |
| 公众号文章 | ❌ | ✅ |
| 公众号历史 | ❌ | ✅ |
| 飞书文档 | ❌ | ✅ |

存储支持：Notion（完整）、飞书（部分）、本地 Chrome Storage。
