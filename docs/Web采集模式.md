# Web 采集模式

本文档定义 CJDB 中所有 Web 端数据采集的统一操作模式。**所有平台的 Web 采集均遵循此方法**。

---

## 一、模式概述

Web 采集采用「识别 → 预采集 → 编号展示/回显 → 纳入采集」四步流程，在用户点击「采集」前完成可采集内容的发现与标记，提升体验并支持批量选择。

**触发链路**：`滚动` 或 `DOM 变化` → `解析` → `数据预采集处理` → `页面标注`

```
┌─────────┐    ┌─────────┐    ┌─────────────────┐    ┌─────────┐
│  识别   │ →  │ 预采集  │ →  │ 编号展示/回显   │ →  │ 纳入采集 │
└─────────┘    └─────────┘    └─────────────────┘    └─────────┘
     ↑               ↑                  ↑
     └───────────────┴──────────────────┘
           解析 → 预采集处理 → 标注（每次滚动/DOM 变化时执行）
```

---

## 二、四步详解

### 2.1 识别（Identify）

**目标**：在页面 DOM 中定位可采集的数据单元。

**操作**：
- 根据页面类型（URL、路由）确定采集目标（`COLLECT_TARGET`）
- 使用 DOM 选择器或链接反查，找到对应元素
- 支持多选择器兜底、链接反查等策略，确保首屏/首排内容被识别

**输出**：元素列表 `Element[]`

**示例**：
- 发现页笔记：`.note-item`、`[class*="feed-item"]`、`a[href*="/explore/"]` 反查
- 账号主页笔记：同上
- 笔记详情评论：`.parent-comment` → `.comment-item`

---

### 2.2 预采集（Pre-collect）

**目标**：解析 → 笔记列表 → **添加进集合**（累积过程，不重置）。

**操作**：
- 以 **url 为 key** 的集合（对象），提升收集效率
- 用 **int 类型 counter** 记录编号，新笔记加入时 counter++
- 若 url 已存在则复用，不重复添加
- 默认 `checked: true`，表示纳入采集

**输出**：集合条目（累积）

**数据结构**：
```js
// noteCollection: url -> { no, title, checked }
noteCollection[url] = {
  no: 1,        // int 编号，counter 自增
  title: '...',
  checked: true // 是否纳入采集
};
let noteCounter = 0;  // 新加入时 noteCounter++
```

---

### 2.3 编号展示/回显（Display / Echo）

**目标**：在页面上注入可视化标记，让用户看到「哪些内容可被采集」及「当前勾选状态」。

**操作**：
- 为每个识别项注入编号（如 `#1`、`#2`）
- 注入可点击的 ✓/○ 标记，用于切换 `checked` 状态
- ✓（绿色）：已勾选，纳入采集
- ○（灰色）：未勾选，不纳入采集

**触发时机**：
- 页面初次加载
- 滚动（防抖）
- DOM 变化（MutationObserver）
- 弹框/模态框出现

**样式约定**：
- 编号：红底白字，`pointer-events: none`
- 勾选：绿/灰底，`cursor: pointer`，可点击

---

### 2.4 纳入采集（Include in Collection）

**目标**：用户点击「采集」时，仅对 `checked === true` 的缓存项执行实际存储。

**操作**：
- 从缓存中筛选 `checked === true` 的条目
- 按数据类型调用 `DataStore.storeXxxWithConfig(data)`
- 支持单条采集（笔记详情）或批量采集（发现页、账号主页）

**数据流**：
```
用户点击「采集」
  → 读取 noteCollection（url 为 key）
  → 筛选 checked === true
  → 遍历调用 DataStore
  → 提示「已采集 N 条」
```

---

## 三、技术实现要点

### 3.1 页面类型与 Marker 映射

| 页面类型（dataType） | Marker 函数 | 识别对象 |
|---------------------|-------------|----------|
| xiaohongshu-note    | noteDetailMarker | 评论 |
| xiaohongshu-account | accountMarker    | 笔记卡片 |
| xiaohongshu-feed    | feedMarker       | 笔记卡片 |

### 3.2 滚动与 DOM 监听

- **流程**：`滚动` / `DOM 变化` → 防抖 → `解析`（识别元素）→ `预采集`（提取并缓存）→ `标注`（注入编号与 ✓/○）
- **滚动**：监听 `window` 及弹框内可滚动容器，防抖（如 300ms）后执行
- **DOM 变化**：MutationObserver 监听 `childList`、`subtree`，防抖后执行（feed 虚拟列表会动态增删 DOM）
- **弹框**：弹框出现时绑定其内部滚动容器，并立即执行一次

### 3.3 Feed 虚拟列表与首屏识别

- **Feed 优先用链接反查**：`a[href*="/explore/"]` 反查卡片，不依赖标准选择器（虚拟列表 DOM 结构多变）
- **不依赖 rect 过滤**：虚拟列表项可能暂未渲染尺寸，避免因 `width/height === 0` 漏识别
- **账号主页**：选择器 + 链接反查合并，保证首排被识别

### 3.4 缓存与生命周期

- 缓存为内存 `Map`，页面刷新后清空
- 跨页面切换时，可按需清理对应类型的缓存

---

## 四、扩展至其他平台

新增平台时，按以下步骤实现：

1. **定义 PAGE_RULES**：URL 模式 → dataType
2. **定义 COLLECT_TARGET**：dataType → 按钮文案、行为
3. **实现 Marker 函数**：识别、预采集、注入编号与 ✓/○
4. **注册到 runMarker**：根据 dataType 调用对应 marker
5. **采集逻辑**：在 panel 的采集按钮中，根据 dataType 从缓存读取并调用 DataStore

---

## 五、参考实现

| 文件 | 说明 |
|------|------|
| `extension/content/xiaohongshu-markers.js` | 小红书 Web 采集 marker 实现 |
| `extension/content/panel.js` | 采集按钮、COLLECT_TARGET、PAGE_RULES |
| `extension/scripts/DataStore.js` | 存储入口 |
| `extension/scripts/StorageConfig.js` | 存储源配置 |
