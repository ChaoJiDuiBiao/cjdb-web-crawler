# 开发指南

抄级对标·数据采集器：基于 WXT、Vue 3 和 TypeScript 的 Manifest V3 浏览器扩展。仓库根目录就是 WXT 项目，所有开发命令均在根目录执行。

## 开发与构建

```bash
npm ci
npm run dev
npm run build
npm run zip
```

- `dev`：启动开发模式，支持热更新。
- `build`：生成生产扩展。输出目录由 `wxt.config.ts` 的 `outDir`、`outDirTemplate` 和 `package.json` 的版本号决定，目前为 `output/抄级对标数据采集器-v2.0.2/`。
- `zip`：构建并在 `output/` 中生成 ZIP，具体文件名以命令输出为准。

安装生产版本：打开 Chrome 扩展管理页，开启开发者模式，选择“加载已解压的扩展程序”，加载上述构建目录。

### 一键发布

先提交待发布的代码，并切换到 `origin` 对应仓库的默认分支。工作区必须干净（包括本机配置修改），本地分支不能落后于远程；需要已登录的 `gh` 和 Git 推送权限。

发布说明直接写在命令行单引号内，可换行，不支持说明文件：

```bash
npm run release -- 2.0.2 --notes '- 新增微信交流入口
- 移除内嵌使用文档'
```

说明写两三项用户能感知的变化即可。单引号可避免 `$`、反引号等被 shell 展开；文本中的英文单引号需要按 shell 规则转义。版本必须同时高于本地版本与 GitHub 所有已发布 Release 的最高版本，允许跳号（例如 2.0.2 → 2.1.0）。按数字比较版本号，遍历全部分页，不依赖 Latest 标记；草稿不计入最高版本。缺少说明、已有同版本标签或 Release 时停止。

脚本会更新版本及安装目录说明，执行 `npm run zip`，提交版本变更，原子推送默认分支和标签，上传安装包到草稿 Release，确认附件后公开。不会自动提交其他代码，也不自动运行测试；请在发布前完成必要验收。仅本地打包使用 `npm run zip`。

构建失败会恢复版本文件。提交后的发布失败会保留提交、标签或草稿并提示失败阶段；先检查远程状态，再继续对应步骤，不强推、不覆盖版本。此时不要直接换版本重复发布。

### 本地浏览器配置

默认开发配置将浏览器数据保存在 `.wxt/chrome-data`。需要自定义浏览器时，复制示例后按本机环境修改：

```bash
cp web-ext.config.example.ts web-ext.config.ts
```

示例使用 macOS Arc 路径；`web-ext.config.ts` 是本机配置，不提交到 Git。移动仓库后，浏览器里已手动加载的扩展需要重新选择新的构建目录。扩展固定身份配置保留在 `wxt.config.ts` 中。

## 项目结构

```text
cjdb-web-crawler/
├── entrypoints/
│   ├── content.ts              # 页面识别、监听、挂载采集面板
│   ├── background.ts           # 后台请求与存储消息处理
│   ├── xiaohongshu-bridge.ts    # 小红书页面上下文桥接
│   ├── options/                # 全局设置、本地记录与任务结果
│   └── popup/                  # 工具栏快捷入口
├── components/                 # 面板、目标选择、预览与全局设置
├── composables/                # 采集 / 保存状态与任务恢复
├── services/                   # 后台连接、Notion 发现与任务服务
├── styles/                     # 共享主题
├── tests/                      # 规则、流程与扩展浏览器回归
├── crawlers/                   # 各平台采集逻辑
├── config/                     # 存储配置及表单定义
├── stores/                     # 存储分发与适配器
├── types/                      # 业务类型与采集类型枚举
├── utils/                      # API、导出、格式转换等工具
├── public/                     # 图标与飞书运行时桥接脚本
├── docs/                       # showcase 展示素材、development 开发文档、user 用户文档
├── wxt.config.ts               # 扩展权限、构建与开发配置
├── package.json
└── package-lock.json
```

采集主流程：页面识别 → Crawler 提取数据 → `ContentPreview` 预览确认 → `DestinationPicker` 选择目标（保存时检查字段） → `useCollectionFlow` 逐项保存 → 后台适配器 → `TaskResult` 展示结果。

## 验证

```bash
npm run typecheck
npm run test:unit
npx playwright install chromium
npm run test:browser
npm run zip
```

浏览器测试加载真实构建的扩展，使用独立 Chromium 用户数据目录和模拟页面 / Notion 接口，不连接真实账号。类型检查覆盖 Vue 和 TypeScript。真实平台登录态、实际授权和外部 API 行为仍需在你的浏览器中验收。

## 文档

- [存储体验四轮审视与决策](STORAGE-REVIEW.md)
- [Notion 数据库与数据源选择](NOTION-SELECTION.md)
- [开发约定](../../AGENTS.md)
- [界面设计说明](DESIGN.md)
- [采集弹窗改版方案](UI-REDESIGN.md)
- [本次升级与验收](UPGRADE.md)
- [接口参考样例](reference/README.md)
