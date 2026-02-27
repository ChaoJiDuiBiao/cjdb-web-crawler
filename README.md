# CJDB 数据抓取 - 浏览器插件

基于 Chrome Manifest V3 的多平台数据抓取插件，采用**面向对象架构**设计，支持小红书、公众号等平台，可对接 Notion、飞书等存储。

---

## 一、核心特性

### ✨ 面向对象架构
- **Crawler 类**：每个平台独立封装，职责清晰
- **Store 类**：统一存储入口，适配多种存储源
- **Main 调度**：监听事件，协调 Crawler、Renderer、Store
- **易于扩展**：新增平台只需 3 步（创建 Crawler → 注册 → 更新配置）

### 🎯 智能标注
- **自动识别**：URL 变化时自动识别页面类型
- **可视化标注**：笔记/评论自动编号 #1, #2，勾选框 ✓
- **批量采集**：发现页、账号主页支持批量勾选采集

### 💾 多存储适配
- **Notion**：自动创建字段、去重更新
- **飞书**：待实现
- **本地**：Chrome Storage

---

## 二、项目结构

```
cjdb_crawler/
├── extension/              # 浏览器插件
│   ├── manifest.json       # Manifest V3 配置
│   │
│   ├── core/               # 核心业务逻辑（面向对象）
│   │   ├── crawlers/       # 爬虫类
│   │   │   ├── BaseCrawler.js              # 基类：定义统一接口
│   │   │   ├── XiaohongshuNoteCrawler.js   # 小红书笔记详情
│   │   │   ├── XiaohongshuFeedCrawler.js   # 小红书发现页
│   │   │   └── XiaohongshuAccountCrawler.js# 小红书账号主页
│   │   ├── stores/         # 存储类
│   │   │   ├── Store.js                    # 统一存储入口
│   │   │   ├── NotionStore.js              # Notion 适配器
│   │   │   ├── FeishuStore.js              # 飞书适配器（待实现）
│   │   │   └── LocalStore.js               # 本地存储
│   │   ├── Main.js         # 主调度：监听、调度
│   │   └── Renderer.js     # UI 渲染：面板、按钮、配置
│   │
│   ├── content/            # Chrome Extension 注入脚本
│   │   ├── boot.js         # 启动入口：注入面板、初始化 Main
│   │   ├── panel.css       # 面板样式
│   │   └── spa-listener.js # SPA 路由监听
│   │
│   ├── utils/              # 工具函数
│   │   ├── validators.js   # 数据校验
│   │   ├── StorageConfig.js# 存储配置管理
│   │   └── api.js          # 第三方 API 封装
│   │
│   ├── schemas/            # 数据结构定义
│   │   ├── xiaohongshu-note.js
│   │   └── xiaohongshu-account.js
│   │
│   ├── popup/              # 工具栏弹窗
│   └── background/         # 后台 Service Worker
│
├── docs/                   # 设计文档
│   └── Web采集模式.md      # Web 采集统一模式
├── .cursorrules            # Cursor IDE 开发规则
├── CLAUDE.md               # Claude Code 开发规则
└── README.md
```

---

## 三、架构设计

### 🏗️ 核心类图

```
┌─────────────┐
│    Main     │  主调度：监听事件、协调各模块
└──────┬──────┘
       │
       ├──────────────┬──────────────┬──────────────┐
       ▼              ▼              ▼              ▼
  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
  │ Crawler │   │Renderer │   │  Store  │   │  Event  │
  └─────────┘   └─────────┘   └─────────┘   └─────────┘
       │              │              │
       ▼              ▼              ▼
  识别、爬取      渲染 UI        存储数据
  标注页面        更新计数        适配器分发
```

### 🔄 工作流程

```
1. URL 变化
   ↓
2. Main 识别页面类型
   ↓
3. 激活对应的 Crawler
   ↓
4. Crawler.marker() 标注页面
   ↓
5. Renderer.render() 更新 UI
   ↓
6. 用户点击采集按钮
   ↓
7. Crawler.crawl() 爬取数据
   ↓
8. Store.save() 存储数据
   ↓
9. 显示结果
```

---

## 四、核心 API

### BaseCrawler（基类）

```js
class BaseCrawler {
  // 判断是否能处理该 URL
  canHandle(url): boolean

  // 获取数据类型
  getDataType(): string

  // 爬取数据（返回要存储的业务数据）
  async crawl(opts): Object | Array

  // 页面标注（注入编号和勾选框）
  marker(): void

  // 获取采集数量
  getCollectionCount(): number

  // 获取采集目标（批量采集时返回列表）
  getCollectionTargets(): Array

  // 获取爬虫状态（元数据，非爬取结果）
  getCrawlerState(): Object
}
```

### Store（存储）

```js
class Store {
  // 注册存储适配器
  register(name, adapter): void

  // 存储数据（Main 原封不动传递，不做遍历）
  async save(dataType, data): Array<{ ok, action?, error? }>
}
```

---

## 五、扩展新平台

只需 3 步：

### 1. 创建 Crawler

```js
// core/crawlers/DouyinCrawler.js
class DouyinCrawler extends BaseCrawler {
  canHandle(url) {
    return /douyin\.com/.test(url)
  }

  getDataType() {
    return 'douyin-video'
  }

  async crawl(opts) {
    // 爬取逻辑
    return { url, title, ... }
  }

  marker() {
    // 标注逻辑
  }

  getCrawlerState() {
    // 返回状态
    return { collectionType: 'video', count: 10, ... }
  }
}
```

### 2. 注册到 Main

```js
// content/boot.js
const crawlers = [
  new XiaohongshuNoteCrawler(),
  new DouyinCrawler()  // 新增
];
```

### 3. 更新配置

```js
// core/Renderer.js
this.COLLECT_TARGET = {
  'douyin-video': { btnText: '采集抖音视频', label: '抖音' }
};
```

---

## 六、开发规范

### 📋 核心原则

1. **职责单一**：每个类只做一件事
2. **面向接口**：Crawler 必须实现 BaseCrawler 定义的接口
3. **依赖注入**：Main 通过构造函数注入依赖
4. **数据封装**：内部状态私有，通过 `getCrawlerState()` 导出
5. **Main 只传递**：不做遍历、不做业务逻辑处理

### 🔍 数据区分

| 方法 | 返回内容 | 用途 |
|------|---------|------|
| `crawl()` | 业务数据（要存储的） | 给 Store 存储 |
| `getCrawlerState()` | 元数据（状态信息） | 调试、报告、监控 |

---

## 七、安装与使用

### 7.1 安装

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension` 文件夹

### 7.2 使用

1. 访问小红书笔记详情页
2. 右下角出现悬浮面板，显示「当前: 小红书笔记」
3. 页面自动标注编号 #1, #2，勾选框 ✓
4. 点击「采集小红书笔记」按钮
5. 选择存储源（本地/Notion/飞书）
6. 查看采集结果

---

## 八、开发状态

### ✅ 已完成

- [x] 面向对象架构重构
- [x] 小红书笔记详情页采集
- [x] 小红书发现页批量采集
- [x] 小红书账号主页批量采集
- [x] Notion 存储适配器
- [x] 本地存储适配器
- [x] 智能标注（编号 + 勾选框）
- [x] SPA 路由监听
- [x] 存储配置管理

### 🚧 进行中

- [ ] 飞书存储适配器
- [ ] 公众号采集

### 📅 计划中

- [ ] 抖音采集
- [ ] 评论批量采集
- [ ] 数据导出（JSON/CSV）
- [ ] 采集历史记录
- [ ] 采集任务队列

---

## 九、技术栈

- **Chrome Extension**: Manifest V3
- **架构**: 面向对象（OO）
- **语言**: JavaScript（原生，无打包工具）
- **存储**: Chrome Storage API
- **第三方 API**: Notion API、飞书 API

---

## 十、参考文档

- [Web 采集模式](docs/Web采集模式.md)
- [开发规则](.cursorrules / CLAUDE.md)
- [Chrome Extension 官方文档](https://developer.chrome.com/docs/extensions/mv3/)
- [Notion API](https://developers.notion.com/)
