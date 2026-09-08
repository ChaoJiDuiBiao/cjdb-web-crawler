# AGENTS.md

## Scope
- These instructions apply to the entire repository rooted at this directory.

## File Reading Policy
- Unless explicitly requested by the user, do not read or scan the following paths:
  - `**/node_modules/**`
  - `**/dist/**`
  - `**/build/**`
  - `**/coverage/**`
  - `**/.next/**`
  - `**/.nuxt/**`
  - `**/.cache/**`
  - `**/.output/**`
  - `**/tmp/**`
  - `**/temp/**`
  - `**/*.min.js`
  - `**/*.map`
  - `**/output/**`

## Search Guidance
- Prefer `rg` for searching.
- When searching, exclude the paths above unless the user explicitly asks to inspect them.

## Project

- 项目名称：`cjdb-web-crawler`。根目录即 WXT 项目。
- 技术栈：WXT（Vite 构建）、Vue 3 Composition API、TypeScript、共享 CSS 主题。
- 从根目录执行 `npm ci`、`npm run dev`、`npm run build`、`npm run zip`。
- 项目概览与安装步骤以 `README.md` 为准；设计说明在 `docs/development/DESIGN.md`。

## Architecture

- `entrypoints/content.ts`：页面与路由识别、事件监听、Crawler 调度、Shadow DOM 内挂载 Vue 面板。
- `crawlers/`：识别 URL、采集、页面标注、状态查询；采集结果与状态信息分开。
- `components/CollectPanel.vue`：墨镜入口、先识别后打开的单一采集弹窗、预览确认和保存调度。
- `components/ContentPreview.vue`：结构化预览。
- `components/DestinationPicker.vue`：选择保存位置、按连接与作品 / 账号隔离的最近使用、用途提醒。
- `composables/useCollectionFlow.ts`：采集与保存状态、重试、停止和任务恢复。
- `services/`：后台全局配置、Notion 发现、目标检查与持久化任务。
- `stores/Store.ts`：`storeCrawlData()` 消息中转、Store 适配器分发。
- `entrypoints/background.ts`：接收消息，在后台执行存储与请求。
- `stores/NotionStore.ts`、`FeishuStore.ts`、`LocalFileStore.ts`：具体存储实现。
- `services/settings.ts`：全局连接配置及旧配置迁移；`config/StoreConfig.ts` 保留旧存储入口兼容。
- `types/collection.ts`：`CollectionType`；其他业务类型在 `types/index.ts`。
- `utils/exportFile.ts`：浏览器侧文件导出。

## Development

- 保持“采集完成 → 预览 → 用户确认 → 保存”的流程。
- Crawler 返回业务数据，避免将存储操作放入 Crawler；适配器的返回值遵循 `SaveResult`。
- 优先按功能职责拆分组件和逻辑，避免无用途的抽象；不要为了禁止短函数而扩大组件职责。
- 新增平台时检查 Crawler 注册、`content.ts` 的 `matches`、`wxt.config.ts` 的权限、采集类型、预览和适配器支持。
- 修改弹窗和下拉菜单时检查 Shadow DOM、样式加载、弹层挂载位置和层级。
- 保留扩展固定身份配置以及已有存储键的兼容性；本地浏览器配置和签名私钥保持忽略。
- 目录调整后运行 `npm run build`；涉及打包时运行 `npm run zip`。运行 `npm run typecheck` 与 `npm run test:unit`；界面与存储流程变化运行 `npm run test:browser`（模拟外部接口）。
- 页面采集、预览、保存等行为变化需要对应的浏览器功能验证。
