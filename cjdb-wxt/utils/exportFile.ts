/**
 * exportFile - 本地文件导出工具（仅在 content script / page 上下文使用）
 * 支持 CSV 和 Obsidian Markdown（YAML Frontmatter 格式）
 */

// ─── 中文 label 映射（key → 显示名）────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  // 小红书笔记
  noteId: '笔记ID',
  rank: '排名',
  searchKeyword: '搜索关键词',
  title: '标题',
  content: '正文',
  publishTime: '发布时间戳',
  publishTimeStr: '发布时间',
  location: '地区',
  likes: '点赞',
  favorites: '收藏',
  comments: '评论数',
  shares: '分享数',
  authorUserId: '作者ID',
  authorNickname: '作者昵称',
  authorFansCount: '粉丝数',
  authorLikes: '作者获赞',
  authorFollowing: '作者关注数',
  imageUrls: '图片列表',
  videoUrl: '视频链接',
  mediaType: '媒体类型',
  tags: '标签',
  url: '链接',
  crawledAt: '采集时间',
  // 小红书账号
  userId: '用户ID',
  nickname: '昵称',
  description: '简介',
  fansCount: '粉丝数',
  followingCount: '关注数',
  likedCount: '获赞数',
  notesCount: '笔记数',
  noteListText: '笔记列表',
  // 公众号文章
  author: '作者',
  account: '公众号',
  digest: '摘要',
  contentMarkdown: '正文（Markdown）',
  publishTimeStr_wechat: '发布时间',
  ipLocation: 'IP归属地',
  read: '阅读量',
  zan: '点赞数',
  looking: '爱心赞',
  shareNum: '转发量',
  collectNum: '收藏量',
  commentCount: '评论数',
  // 飞书文档
  docType: '文档类型',
  workspace: '空间',
  excerpt: '摘要',
}

// 完全跳过的字段（内部控制用，或数据太复杂不适合导出）
const SKIP_KEYS = new Set([
  'downloadImages',   // 内部控制
  'coverUrl',         // 封面图 URL 太长且无实际用途
  'authorAvatarUrl',  // 头像 URL
  'avatarUrl',        // 头像 URL
  'source',           // 采集来源（dom/api）内部字段
  'provider',         // 内部字段
  'commentList',      // 嵌套对象数组，单独处理
  'contentHtml',      // HTML 原文，太长
  'principalInfo',    // 嵌套对象
  'fetchData',        // 内部控制
  'collected',        // 内部状态
])

// 正文字段：放到 YAML 之外作为 Markdown body
const BODY_KEYS = new Set(['content', 'noteListText', 'contentMarkdown', 'excerpt'])

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function stringify(val: any): string {
  if (val == null) return ''
  if (Array.isArray(val)) return val.join('|')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function toRows(data: any): any[] {
  return Array.isArray(data) ? data : [data]
}

function collectKeys(rows: any[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const k of Object.keys(row)) {
      if (seen.has(k) || SKIP_KEYS.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
  }
  return keys
}

// ─── CSV ──────────────────────────────────────────────────────────────────

function csvCell(val: any): string {
  const s = stringify(val)
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function toCsv(data: any): string {
  const rows = toRows(data)
  const keys = collectKeys(rows)
  const header = keys.map((k) => csvCell(LABEL_MAP[k] ?? k)).join(',')
  const dataRows = rows.map((row) => keys.map((k) => csvCell(row?.[k])).join(','))
  return '\uFEFF' + [header, ...dataRows].join('\n') // BOM 保证 Excel 正确识别 UTF-8
}

// ─── Obsidian Markdown ────────────────────────────────────────────────────

function escapeYaml(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/** 单条数据 → 一个完整的 Obsidian Markdown 文件字符串 */
function itemToMarkdown(row: any): string {
  const yamlLines = ['---']
  let bodyContent = ''

  for (const k of Object.keys(row)) {
    if (SKIP_KEYS.has(k)) continue

    const val = row[k]
    if (val == null || val === '') continue

    const label = LABEL_MAP[k] ?? k

    // 正文字段：不放 YAML，留到 body
    if (BODY_KEYS.has(k)) {
      if (!bodyContent) bodyContent = String(val) // 取第一个非空的正文字段
      continue
    }

    if (Array.isArray(val)) {
      // 数组 → Obsidian 多值 list
      yamlLines.push(`${label}:`)
      val.forEach((v) => yamlLines.push(`  - "${escapeYaml(String(v))}"`))
    } else if (typeof val === 'object') {
      // 嵌套对象（未被 SKIP_KEYS 过滤的）→ 序列化为字符串
      yamlLines.push(`${label}: "${escapeYaml(JSON.stringify(val))}"`)
    } else {
      yamlLines.push(`${label}: "${escapeYaml(String(val))}"`)
    }
  }

  yamlLines.push('---')

  const title = row.title || row.nickname || row.account || row.docTitle || '采集记录'
  const parts: string[] = [yamlLines.join('\n'), '', `# ${title}`]
  if (bodyContent) {
    parts.push('', bodyContent)
  }

  return parts.join('\n')
}

// ─── 触发下载 ─────────────────────────────────────────────────────────────

function safeFilename(data: any, ext: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const count = Array.isArray(data) ? data.length : 1
  const suffix = count > 1 ? `共${count}条` : ''
  return suffix ? `${ts}_${suffix}.${ext}` : `${ts}.${ext}`
}

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 200)
}

// ─── 公开 API ─────────────────────────────────────────────────────────────

/**
 * 按 format 导出并触发浏览器下载
 * @param type    CollectionType 字符串（暂未使用，保留供后续扩展）
 * @param data    单条对象 或 对象数组
 * @param format  'csv' | 'markdown'
 */
export function exportFile(type: string, data: any, format: string): void {
  if (!data) return

  if (format === 'csv') {
    triggerDownload(safeFilename(data, 'csv'), toCsv(data), 'text/csv')
  } else if (format === 'markdown') {
    const rows = toRows(data)
    if (rows.length === 1) {
      // 单条：直接生成一个文件
      triggerDownload(safeFilename(data, 'md'), itemToMarkdown(rows[0]), 'text/markdown')
    } else {
      // 多条：每条之间用空行 + 水平线分隔（不用 ---，避免被解析为 YAML 分隔符）
      const content = rows.map(itemToMarkdown).join('\n\n---\n\n')
      triggerDownload(safeFilename(data, 'md'), content, 'text/markdown')
    }
  }
}
