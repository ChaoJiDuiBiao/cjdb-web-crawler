# CJDB 数据抓取 - Claude Code 开发指南

本文档面向使用 Claude Code 开发本项目的开发者。

---

## 🎯 项目概述

这是一个基于 **Chrome Extension Manifest V3** 的多平台数据抓取插件，采用**面向对象架构**设计。

**核心目标：**
- 识别页面类型 → 标注可采集内容 → 用户勾选 → 批量采集 → 存储到 Notion/飞书

**技术栈：**
- 原生 JavaScript（无打包工具）
- Chrome Extension API
- 面向对象设计

---

## 🏗️ 架构设计

### 核心模块

```
Main (主调度)
  ├── Crawler (爬虫类) - 识别、爬取、标注
  ├── Renderer (渲染器) - UI 更新
  └── Store (存储) - 适配器分发
```

### 数据流

```
URL 变化 → Main 识别 → Crawler 标注 → Renderer 更新 UI
  ↓
用户点击采集按钮
  ↓
Crawler.crawl() → Store.save() → 显示结果
```

---

## 📋 开发原则

### 1. 职责单一
每个类只做一件事，职责清晰：
- **Crawler**：只管爬取相关逻辑
- **Store**：只管存储相关逻辑
- **Main**：只做调度，不做业务逻辑

### 2. Main 只传递
**关键要求**：Main 不做遍历、不做业务处理，只做数据传递。

```js
// ✅ 正确
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  const results = await this.store.save(this.currentDataType, data)
}

// ❌ 错误
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  for (const item of data) {  // 不要在 Main 里遍历
    await this.store.save(this.currentDataType, item)
  }
}
```

### 3. 数据封装
内部状态不对外暴露，通过 `getCrawlerState()` 导出：

```js
class XhsNoteCrawler {
  constructor() {
    this.commentCollection = {} // 私有状态
  }

  // ✅ 正确：通过方法导出状态
  getCrawlerState() {
    return {
      collectionType: 'comment',
      count: Object.keys(this.commentCollection).length,
      items: [...]
    }
  }

  // ❌ 错误：直接暴露内部状态
  getCommentCollection() {
    return this.commentCollection
  }
}
```

### 4. 接口一致性
所有 Crawler 必须实现 `BaseCrawler` 定义的接口：
- `canHandle(url)` - 判断是否处理
- `getDataType()` - 返回数据类型
- `crawl(opts)` - 爬取业务数据
- `marker()` - 标注页面
- `getCollectionCount()` - 返回勾选数量
- `getCollectionTargets()` - 返回采集目标
- `getCrawlerState()` - 返回状态（元数据）

---

## 🔍 数据区分

### `crawl()` vs `getCrawlerState()`

这两个方法**用途不同**，不要混淆：

| 方法 | 返回内容 | 用途 |
|------|---------|------|
| `crawl()` | **业务数据**（要存储的） | 给 Store 存储到 Notion/飞书 |
| `getCrawlerState()` | **元数据**（状态信息） | 调试、报告、监控 |

**示例：**
```js
// crawl() - 返回要存储的业务数据
await crawler.crawl()
// 返回：
{
  url: 'https://xiaohongshu.com/explore/123',
  title: '超好看的穿搭',
  content: '这是正文...',
  images: ['img1.jpg'],
  likes: 1000,
  tags: ['穿搭', '时尚']
}

// getCrawlerState() - 返回当前状态
crawler.getCrawlerState()
// 返回：
{
  collectionType: 'comment',
  count: 10,        // 总共解析了 10 条评论
  checked: 8,       // 勾选了 8 条
  items: [
    { id: 'comment-123', checked: true, content: '太好看了！' },
    { id: 'comment-456', checked: false, content: '不错' }
  ]
}
```

---

## 🚀 常见任务

### 任务 1：新增平台支持

**步骤：**
1. 创建 `core/crawlers/DouyinCrawler.js`
2. 继承 `BaseCrawler`，实现所有接口
3. 在 `content/boot.js` 注册
4. 在 `core/Renderer.js` 更新 `COLLECT_TARGET`
5. 在 `manifest.json` 添加 `matches`

**示例：**
```js
// core/crawlers/DouyinCrawler.js
class DouyinCrawler extends BaseCrawler {
  canHandle(url) { return /douyin\.com/.test(url) }
  getDataType() { return 'douyin-video' }
  async crawl(opts) { return { url, title, views } }
  marker() { /* 标注逻辑 */ }
  getCrawlerState() { return { collectionType: 'video', ... } }
}
```

### 任务 2：修改 Crawler 逻辑

**注意事项：**
- 只修改 Crawler 内部实现，不要改接口
- 保持 `crawl()` 返回格式一致
- 新增字段在 `getCrawlerState()` 里处理

### 任务 3：修改存储逻辑

**注意事项：**
- 适配器独立，不影响其他适配器
- 保持返回格式 `{ ok, action?, error? }`
- 在 `core/stores/NotionStore.js` 修改

### 任务 4：修改 UI

**注意事项：**
- 只修改 `core/Renderer.js`
- 不要在 `Main.js` 里写 UI 逻辑

---

## 📁 文件位置

| 功能 | 文件路径 |
|------|---------|
| 爬虫基类 | `core/crawlers/BaseCrawler.js` |
| 小红书笔记 | `core/crawlers/XiaohongshuNoteCrawler.js` |
| 小红书发现页 | `core/crawlers/XiaohongshuFeedCrawler.js` |
| 小红书账号 | `core/crawlers/XiaohongshuAccountCrawler.js` |
| 存储入口 | `core/stores/Store.js` |
| Notion 适配器 | `core/stores/NotionStore.js` |
| 飞书适配器 | `core/stores/FeishuStore.js` |
| 本地存储 | `core/stores/LocalStore.js` |
| 主调度 | `core/Main.js` |
| UI 渲染 | `core/Renderer.js` |
| 启动入口 | `content/boot.js` |
| 数据校验 | `utils/validators.js` |
| 存储配置 | `utils/StorageConfig.js` |

---

## ❌ 禁止事项

### 1. 不要在 Main 里做业务逻辑
Main 只做调度和传递，不做遍历、过滤、转换：
```js
// ❌ 不要这样做
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  for (const item of data) {
    if (item.likes > 100) {
      await this.store.save(this.currentDataType, item)
    }
  }
}

// ✅ 应该这样做
async _onClickCollect() {
  const data = await this.currentCrawler.crawl()
  const results = await this.store.save(this.currentDataType, data)
}
```

### 2. 不要暴露内部状态
使用 `getCrawlerState()` 导出状态，不直接返回内部变量：
```js
// ❌ 不要这样做
getCommentCollection() {
  return this.commentCollection
}

// ✅ 应该这样做
getCrawlerState() {
  return {
    collectionType: 'comment',
    count: Object.keys(this.commentCollection).length,
    items: [...]
  }
}
```

### 3. 不要在 Crawler 里调用 Store
Crawler 只管爬取，存储由 Main 调度：
```js
// ❌ 不要这样做
async crawl() {
  const data = this._extractData()
  await window.CJDB_Store.save('xiaohongshu-note', data)
  return data
}

// ✅ 应该这样做
async crawl() {
  const data = this._extractData()
  return data
}
```

### 4. 不要过度拆分文件
一个 Crawler 一个文件，不要把每个方法拆成单独的文件：
```js
// ❌ 不要这样拆分
core/crawlers/xiaohongshu/
├── canHandle.js
├── getDataType.js
├── crawl.js
└── marker.js

// ✅ 应该这样组织
core/crawlers/
└── XiaohongshuNoteCrawler.js
```

---

## 🔧 调试命令

在浏览器 Console 执行：

```js
// 查看当前爬虫状态
window.CJDB_Main.currentCrawler.getCrawlerState()

// 手动触发采集
await window.CJDB_Main.currentCrawler.crawl()

// 查看存储结果
await window.CJDB_Store.save('xiaohongshu-note', data)

// 查看所有 Crawlers
window.CJDB_Main.crawlers
```

---

## 📚 相关文档

- [README.md](README.md) - 项目概览
- [.cursorrules](.cursorrules) - Cursor IDE 开发规则
- [Web采集模式.md](docs/Web采集模式.md) - 采集模式说明

---

## 💡 提示

当你需要：
- **修改爬取逻辑** → 找对应的 `Crawler.js`
- **修改存储逻辑** → 找对应的 `Store.js`
- **修改 UI** → 找 `Renderer.js`
- **修改调度逻辑** → 找 `Main.js`（但要遵守"只传递"原则）

记住：**职责单一、边界清晰、Main 只传递**。
