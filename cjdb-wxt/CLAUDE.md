# CJDB 数据抓取 (WXT 版本) - Claude Code 开发指南

本文档面向使用 Claude Code 开发本项目的开发者。

---

## 🎯 项目概述

这是一个基于 **WXT Framework** 的多平台数据抓取浏览器插件，采用 **Vue 3 响应式架构**。

**核心目标：**
- 识别页面类型 → 标注可采集内容 → 用户勾选 → 批量采集 → 存储到 Notion/飞书

**技术栈：**
- WXT Framework v0.20+ (Vite-based Extension Framework)
- Vue 3 Composition API + TypeScript
- Element Plus (UI 组件库)
- Notion SDK / 飞书 SDK

---

## 🏗️ 架构设计

### 核心模块（对应原 extension 的 Main.js 职责）

| 原 Main.js 职责   | cjdb-wxt 承接位置      |
|------------------|------------------------|
| 监听 URL / 滚动 / DOM | `entrypoints/content.ts` |
| 识别页面、调度 marker | `content.ts` checkAndInit |
| 采集按钮点击、 crawl、存储 | `CollectPanel.vue` handleCollect |
| 进度提示          | `CollectPanel.vue` tipMessage + crawl opts.onProgress |

```
entrypoints/content.ts - 事件监听、Crawler 调度、挂载 CollectPanel
  ├── Crawlers（Note / Feed / Account）- 爬取、标注
  └── CollectPanel.vue - 采集按钮、预览、存储、进度
```

**采集流程（严格顺序）**：点击采集 → 爬取（含 hovercard 等全部逻辑）→ **完成后** 弹出预览 → 确认 → 存储

### 数据流（响应式）

```
URL 变化 → Crawler.canHandle() → Crawler.marker()
                                      ↓
                            标注评论 + 注入勾选框
                                      ↓
                      用户点击勾选框 → dispatchEvent('cjdb-collection-changed')
                                      ↓
                      Vue 监听事件 → checkedCount 自动更新
                                      ↓
                      用户点击采集 → Crawler.crawl() → saveToNotion/Feishu/Local
```

**响应式优势：**
- 无需手动 `render()`，Vue computed 自动更新 UI
- 状态集中在 Crawler，通过 `getCrawlerState()` 导出
- 事件驱动，解耦 Crawler 和 UI

---

## 📋 开发原则

### 1. 职责单一

每个模块只做一件事：
- **XiaohongshuNoteCrawler**：只管爬取、标注、状态管理
- **CollectPanel.vue**：只管 UI 展示 + 存储调度
- **Content Script**：只做初始化和事件监听

### 2. 函数长一点没关系，逻辑清晰最重要

**关键要求**：直接写逻辑，避免嵌套函数调用，避免 `_` 私有方法。

```ts
// ✅ 正确：直接写在一个函数里，逻辑清晰
async crawl(): Promise<XiaohongshuNote> {
  const url = location.href.split('?')[0]
  const ctx = document.querySelector('.note-detail-mask') || document
  const noteId = url.match(/\/explore\/([\w-]+)/)?.[1] || ''

  const title = ctx.querySelector('#detail-title')?.textContent?.trim() ||
                ctx.querySelector('.title')?.textContent?.trim() ||
                '未知标题'

  const contentEl = ctx.querySelector('#detail-desc') as HTMLElement
  let content = ''
  if (contentEl) {
    const clone = contentEl.cloneNode(true) as HTMLElement
    const selectors = ['#note-detail-origin', '.date']
    selectors.forEach(s => clone.querySelectorAll(s).forEach(el => el.remove()))
    content = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
  }

  // ... 更多提取逻辑

  return { url, noteId, title, content, ... }
}

// ❌ 错误：过度拆分
async crawl(): Promise<XiaohongshuNote> {
  const url = this._getUrl()
  const title = this._extractTitle()
  const content = this._extractContent()
  return { url, title, content }
}

_getUrl() { /* ... */ }
_extractTitle() { /* ... */ }
_extractContent() { /* ... */ }
```

### 3. 数据封装

内部状态不对外暴露，通过 `getCrawlerState()` 导出：

```ts
export class XiaohongshuNoteCrawler {
  commentCollection: Map<string, Comment> = new Map()
  commentCounter = 0

  // ✅ 正确：通过方法导出状态
  getCrawlerState() {
    let checkedCount = 0
    this.commentCollection.forEach(comment => {
      if (comment.checked) checkedCount++
    })

    return {
      collectionType: 'comment',
      total: this.commentCollection.size,
      checked: checkedCount
    }
  }

  // ❌ 错误：直接暴露内部状态
  getCommentCollection() {
    return this.commentCollection
  }
}
```

### 4. 接口一致性

所有 Crawler 必须实现以下接口：
- `canHandle(url: string): boolean` - 判断是否处理
- `crawl(): Promise<XiaohongshuNote>` - 爬取业务数据
- `marker(): void` - 标注页面
- `getCrawlerState()` - 返回状态（元数据）

---

## 🔍 数据区分

### `crawl()` vs `getCrawlerState()`

这两个方法**用途不同**，不要混淆：

| 方法 | 返回内容 | 用途 |
|------|---------|------|
| `crawl()` | **业务数据**（要存储的） | 给 Store 存储到 Notion/飞书 |
| `getCrawlerState()` | **元数据**（状态信息） | 给 UI 显示勾选数量、进度 |

**示例：**
```ts
// crawl() - 返回要存储的业务数据
await crawler.crawl()
// 返回：
{
  url: 'https://xiaohongshu.com/explore/123',
  title: '超好看的穿搭',
  content: '这是正文...',
  imageUrls: 'img1.jpg,img2.jpg',
  likes: 1000,
  tags: ['穿搭', '时尚'],
  commentList: [
    { id: 'comment-1', content: '太好看了！', checked: true },
    { id: 'comment-2', content: '不错', checked: true }
  ]
}

// getCrawlerState() - 返回当前状态
crawler.getCrawlerState()
// 返回：
{
  collectionType: 'comment',
  total: 10,        // 总共解析了 10 条评论
  checked: 8        // 勾选了 8 条
}
```

---

## 🚀 常见任务

### 任务 1：新增平台支持

**步骤：**
1. 创建 `crawlers/DouyinVideoCrawler.ts`
2. 实现接口：`canHandle()`, `crawl()`, `marker()`, `getCrawlerState()`
3. 创建 `entrypoints/content/douyin.ts`
4. 在 `wxt.config.ts` 添加 `host_permissions`
5. 在 `types/index.ts` 定义数据类型

**示例：**
```ts
// crawlers/DouyinVideoCrawler.ts
import type { DouyinVideo } from '@/types'

export class DouyinVideoCrawler {
  canHandle(url: string): boolean {
    return /douyin\.com\/video/.test(url)
  }

  async crawl(): Promise<DouyinVideo> {
    const title = document.querySelector('.video-title')?.textContent || ''
    const likes = parseInt(document.querySelector('.like-count')?.textContent || '0')
    return { url: location.href, title, likes }
  }

  marker(): void {
    // 标注逻辑
  }

  getCrawlerState() {
    return { collectionType: 'video', count: 1 }
  }
}
```

### 任务 2：修改 Crawler 逻辑

**注意事项：**
- 只修改 Crawler 内部实现，不要改接口
- 保持 `crawl()` 返回格式一致
- 提取逻辑直接写在函数里，避免过度拆分

**示例：修改提取逻辑**
```ts
// ✅ 直接在 crawl() 里修改
async crawl(): Promise<XiaohongshuNote> {
  // 新增：提取视频 URL
  const videoEl = ctx.querySelector('video') as HTMLVideoElement
  const videoUrl = videoEl?.src || videoEl?.querySelector('source')?.src || ''

  return {
    url,
    title,
    content,
    videoUrl,  // 新增字段
    ...
  }
}
```

### 任务 3：修改存储逻辑

**注意事项：**
- 存储逻辑在 `CollectPanel.vue` 的 `saveToNotion()` / `saveToFeishu()` / `saveToLocal()` 中
- 每个函数独立，互不影响

**示例：修改 Notion 存储字段**
```ts
// components/CollectPanel.vue
async function saveToNotion(data: XiaohongshuNote, store: StoreConfig) {
  const notion = new Client({ auth: store.token })

  await notion.pages.create({
    parent: { database_id: store.databaseId },
    properties: {
      'Title': { title: [{ text: { content: data.title || '未知标题' } }] },
      'URL': { url: data.url || '' },
      'Content': { rich_text: [{ text: { content: data.content || '' } }] },
      'Likes': { number: data.likes || 0 },
      'VideoURL': { url: data.videoUrl || '' },  // 新增字段
      'Tags': { multi_select: (data.tags || []).map(t => ({ name: t })) }
    }
  })
}
```

### 任务 4：修改 UI

**注意事项：**
- 只修改 `components/CollectPanel.vue` 的 `<template>` 和 `<style>`
- 响应式数据自动更新，无需手动刷新

**示例：添加进度提示**
```vue
<template>
  <div class="cjdb-panel">
    <el-button type="primary" @click="handleCollect">
      采集{{ checkedCount > 0 ? ` (${checkedCount})` : '' }}
    </el-button>

    <!-- 新增：进度提示 -->
    <div v-if="tipMessage" class="tip-display">
      {{ tipMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
const tipMessage = ref('')

async function handleCollect() {
  tipMessage.value = '正在采集数据...'
  const data = await crawler.crawl()
  tipMessage.value = '正在保存...'
  await saveToNotion(data, currentStore)
  tipMessage.value = ''
}
</script>
```

---

## 📁 文件位置

| 功能 | 文件路径 |
|------|---------|
| **WXT 配置** | `wxt.config.ts` |
| **类型定义** | `types/index.ts` |
| **小红书笔记爬虫** | `crawlers/XiaohongshuNoteCrawler.ts` |
| **采集面板 UI** | `components/CollectPanel.vue` |
| **小红书内容脚本** | `entrypoints/content/xiaohongshu.ts` |
| **Popup 界面** | `entrypoints/popup/App.vue` |
| **后台脚本** | `entrypoints/background.ts` |
| **依赖配置** | `package.json` |

---

## ❌ 禁止事项

### 1. 不要过度拆分方法

直接写逻辑，避免 `_` 私有方法：
```ts
// ❌ 不要这样做
async crawl(): Promise<XiaohongshuNote> {
  const title = this._extractTitle()
  const content = this._extractContent()
  const likes = this._extractLikes()
  return { title, content, likes }
}

_extractTitle() { /* ... */ }
_extractContent() { /* ... */ }
_extractLikes() { /* ... */ }

// ✅ 应该这样做
async crawl(): Promise<XiaohongshuNote> {
  const title = ctx.querySelector('#detail-title')?.textContent?.trim() || '未知标题'

  const contentEl = ctx.querySelector('#detail-desc') as HTMLElement
  const content = contentEl ? (contentEl.textContent?.trim() || '') : ''

  const likesEl = ctx.querySelector('.like-wrapper .count')
  const likes = parseInt(likesEl?.textContent || '0')

  return { title, content, likes }
}
```

### 2. 不要暴露内部状态

使用 `getCrawlerState()` 导出状态：
```ts
// ❌ 不要这样做
export class XiaohongshuNoteCrawler {
  commentCollection: Map<string, Comment> = new Map()

  getCommentCollection() {
    return this.commentCollection  // 暴露内部状态
  }
}

// ✅ 应该这样做
export class XiaohongshuNoteCrawler {
  commentCollection: Map<string, Comment> = new Map()

  getCrawlerState() {
    return {
      collectionType: 'comment',
      total: this.commentCollection.size,
      checked: Array.from(this.commentCollection.values()).filter(c => c.checked).length
    }
  }
}
```

### 3. 不要在 Crawler 里调用存储

Crawler 只管爬取，存储由 `CollectPanel.vue` 调度：
```ts
// ❌ 不要这样做
export class XiaohongshuNoteCrawler {
  async crawl(): Promise<XiaohongshuNote> {
    const data = { /* ... */ }

    // 不要在 Crawler 里调用存储
    await storage.setItem('local:collected', data)

    return data
  }
}

// ✅ 应该这样做
// crawlers/XiaohongshuNoteCrawler.ts
export class XiaohongshuNoteCrawler {
  async crawl(): Promise<XiaohongshuNote> {
    return { /* ... */ }
  }
}

// components/CollectPanel.vue
async function handleCollect() {
  const data = await crawler.crawl()
  await saveToNotion(data, currentStore)  // 存储由 UI 组件调度
}
```

### 4. 不要过度拆分文件

一个 Crawler 一个文件：
```ts
// ❌ 不要这样拆分
crawlers/xiaohongshu/
├── canHandle.ts
├── crawl.ts
├── marker.ts
└── getCrawlerState.ts

// ✅ 应该这样组织
crawlers/
└── XiaohongshuNoteCrawler.ts
```

---

## 🔧 调试命令

### 开发模式（HMR）

```bash
cd /Users/bin.chen/GitHub/cjdb_crawler/cjdb-wxt
npm run dev
```

浏览器会自动打开，扩展会自动加载。修改代码后 1 秒内热更新。

### 浏览器 Console 调试

访问小红书笔记页，打开 Console：

```js
// 查看 Crawler 实例（从全局挂载）
window.__CJDB_Crawler__

// 手动触发采集
await window.__CJDB_Crawler__.crawl()

// 查看当前状态
window.__CJDB_Crawler__.getCrawlerState()

// 手动运行 marker
window.__CJDB_Crawler__.marker()
```

### 构建和打包

```bash
# 构建生产版本
npm run build

# 打包 ZIP（上传 Chrome Store）
npm run zip
```

---

## 📚 相关文档

- [README.md](../README.md) - 项目概览
- [cjdb-wxt/README.md](README.md) - WXT 版本说明

---

## 💡 提示

当你需要：
- **修改爬取逻辑** → 找 `crawlers/XiaohongshuNoteCrawler.ts`
- **修改存储逻辑** → 找 `components/CollectPanel.vue` 的 `saveToNotion()` / `saveToFeishu()` / `saveToLocal()`
- **修改 UI** → 找 `components/CollectPanel.vue` 的 `<template>` 和 `<style>`
- **添加新平台** → 创建新 Crawler + 新 Content Script
- **修改权限** → 找 `wxt.config.ts` 的 `manifest.host_permissions`

记住：**职责单一、函数长没关系、直接写逻辑、避免过度抽象**。
