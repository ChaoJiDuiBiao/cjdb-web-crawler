/**
 * exportFile - 本地文件导出工具（仅在 content script / page 上下文使用）
 * 支持 CSV 和 Obsidian Markdown（YAML Frontmatter 格式）
 *
 * CSV 规则：
 *   - data 是数组 → 每个元素一行，列 = 所有元素 key 的并集
 *   - data 是对象 → 一行，列 = 该对象所有 key
 *   - 列头优先使用 LABEL_MAP 中的中文名，没有则直接用 key
 */

// ─── 中文 label 映射（key → 显示名）────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  title: '标题',
  content: '正文',
  authorName: '作者',
  authorNickname: '作者昵称',
  authorUserId: '作者ID',
  authorFansCount: '粉丝数',
  authorLikes: '作者获赞',
  authorFollowing: '作者关注数',
  authorAvatarUrl: '作者头像',
  likes: '点赞',
  collects: '收藏',
  favorites: '收藏',
  comments: '评论数',
  shares: '分享数',
  tags: '标签',
  url: '链接',
  noteId: '笔记ID',
  imageUrls: '图片列表',
  imageUrl: '封面图',
  videoUrl: '视频链接',
  mediaType: '媒体类型',
  publishTime: '发布时间戳',
  publishTimeStr: '发布时间',
  location: '地区',
  crawledAt: '采集时间',
  source: '数据来源',
  rank: '排名',
  searchKeyword: '搜索关键词',
  // account
  nickname: '昵称',
  userId: '用户ID',
  description: '简介',
  fansCount: '粉丝数',
  followingCount: '关注数',
  likeCount: '获赞数',
  noteCount: '笔记数',
  noteListText: '笔记列表',
  // wechat
  author: '作者',
  account: '公众号',
  digest: '摘要',
  // feishu
  docTitle: '文档标题',
  docUrl: '文档链接',
  spaceId: '空间ID',
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 把任意值扁平化为可读字符串 */
function stringify(val: any): string {
  if (val == null) return ''
  if (Array.isArray(val)) return val.join('|')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

/** 统一 data 为数组 */
function toRows(data: any): any[] {
  return Array.isArray(data) ? data : [data]
}

/**
 * 收集所有行中出现过的 key，保持首次出现顺序
 * 跳过值为对象/数组且非叶子节点的深层嵌套字段（commentList 等）
 */
function collectKeys(rows: any[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const k of Object.keys(row)) {
      if (seen.has(k)) continue
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
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 单条数据 → Markdown 文件内容 */
function itemToMarkdown(row: any): string {
  const keys = Object.keys(row)
  const bodyKeys = new Set(['content', 'noteListText'])

  const yamlLines = ['---']
  for (const k of keys) {
    if (bodyKeys.has(k)) continue
    const val = row[k]
    if (val == null || val === '') continue
    const label = LABEL_MAP[k] ?? k
    if (Array.isArray(val)) {
      yamlLines.push(`${label}:`)
      val.forEach((v) => yamlLines.push(`  - "${escapeYaml(String(v))}"`))
    } else {
      yamlLines.push(`${label}: "${escapeYaml(stringify(val))}"`)
    }
  }
  yamlLines.push('---')
  yamlLines.push('')

  const title = row.title || row.nickname || row.account || '采集记录'
  const lines = [yamlLines.join('\n'), `# ${title}`, '']
  const body = row.content || row.noteListText || ''
  if (body) lines.push(body, '')

  return lines.join('\n')
}

// ─── 触发下载 ─────────────────────────────────────────────────────────────

function safeFilename(data: any, ext: string): string {
  const first = Array.isArray(data) ? data[0] : data
  const raw = first?.title || first?.nickname || first?.account || 'export'
  const safe = raw.replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60).trim()
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Array.isArray(data) && data.length > 1 ? `共${data.length}条` : ''
  return `${ts}_${suffix}.${ext}`
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
 * @param data    单条对象 或 对象数组
 * @param format  'csv' | 'markdown'
 */
export function exportFile(type: string, data: any, format: string): void {
  if (!data) return

  if (format === 'csv') {
    triggerDownload(safeFilename(data, 'csv'), toCsv(data), 'text/csv')
  } else if (format === 'markdown') {
    // Markdown 每条单独一个文件，多条时合并成一个文件（用分割线）
    const rows = toRows(data)
    const content = rows.map(itemToMarkdown).join('\n---\n\n')
    triggerDownload(safeFilename(data, 'md'), content, 'text/markdown')
  }
}
