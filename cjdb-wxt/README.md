# CJDB 数据抓取 - WXT 版本

基于 WXT 框架的小红书、公众号、飞书文档采集浏览器插件。

## 技术栈

- **框架**: WXT (Next-gen Web Extension Framework)
- **UI**: Vue 3 + TypeScript + Element Plus
- **存储**: Notion SDK / 飞书 SDK / 本地存储

## 项目结构

```
cjdb-wxt/
├── entrypoints/
│   ├── popup/                  # Popup 页面
│   ├── content/                # Content Scripts
│   │   └── xiaohongshu.ts      # 小红书页面注入
│   └── background.ts           # Service Worker
├── components/
│   └── CollectPanel.vue        # 采集面板（主 UI）
├── crawlers/
│   └── XiaohongshuNoteCrawler.ts  # 小红书笔记爬虫
├── types/
│   └── index.ts                # TypeScript 类型定义
├── wxt.config.ts               # WXT 配置
└── package.json
```

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式（HMR）

```bash
npm run dev
```

浏览器会自动打开，加载临时扩展。

### 使用 Arc / 其他浏览器 & 保留登录状态

默认每次 `npm run dev` 会打开全新的类无痕浏览器，登录状态不会保留。可通过配置解决：

1. **持久化用户数据**（已配置）：`wxt.config.ts` 的 `chromiumArgs` 会将会话数据保存在 `.wxt/chrome-data`，下次 dev 会复用。

2. **使用 Arc 开发**：复制配置并启用 Arc：
   ```bash
   cp web-ext.config.example.ts web-ext.config.ts
   ```
   `web-ext.config.ts` 已配置 Arc 路径。Arc 单实例限制建议配合 `disabled: true`，在已打开的 Arc 中手动加载 `output/chrome-mv3-dev`。

### 构建

```bash
npm run build
```

构建产物在 `output/` 目录。

### 打包 ZIP

```bash
npm run zip
```

生成 `output/cjdb-wxt-1.0.0-chrome.zip`，可直接上传 Chrome Store。

## 使用

1. **打开小红书笔记页**
   - 页面加载后，右下角出现采集面板

2. **勾选评论**
   - 评论旁边会出现 `#1`, `#2` 编号和勾选框 ✓
   - 点击勾选框切换选中状态

3. **配置存储源**
   - 点击齿轮图标 ⚙️
   - 选择「添加存储源」
   - 填写 Notion Token 和 Database ID

4. **采集数据**
   - 点击「采集」按钮
   - 数据自动保存到 Notion/飞书/本地

## 核心功能

### XiaohongshuNoteCrawler

- ✅ 识别笔记详情页（包括弹窗）
- ✅ 提取标题、正文、图片、标签
- ✅ 提取互动数据（点赞、收藏、评论数）
- ✅ 标注评论（编号 + 勾选框）
- ✅ 管理评论采集状态

### CollectPanel

- ✅ 存储源管理（本地/Notion/飞书）
- ✅ 实时显示勾选数量
- ✅ 进度提示（正在采集...）
- ✅ Notion SDK 集成

## 代码原则

遵循简洁原则：
- ✅ 函数长一点没关系，逻辑清晰最重要
- ✅ 避免过度拆分方法（不要一堆 `_` 私有方法）
- ✅ 代码直接写，无需过度抽象
- ✅ 边界清晰，职责单一

## 对比旧版本

| 维度 | 旧版本（原生） | 新版本（WXT） |
|------|--------------|-------------|
| **代码量** | 3480 行 | ~800 行 |
| **UI 代码** | 430 行 (Render 函数) | 180 行 (Vue SFC) |
| **开发体验** | 手动刷新扩展 | HMR 热更新 |
| **类型安全** | 无 | TypeScript 完整支持 |
| **Notion 集成** | 手动 fetch | 官方 SDK |

## 待办

- [ ] 飞书 SDK 集成
- [ ] 公众号文章爬虫
- [ ] 批量采集功能
- [ ] 导出 CSV/Excel

## License

MIT
