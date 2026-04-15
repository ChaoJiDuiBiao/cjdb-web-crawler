/**
 * exportFile - 本地文件导出工具（仅在 content script / page 上下文使用）
 *
 * 每个 CollectionType 对应一个导出函数：
 *   exportXHSFeed        - 小红书搜索结果（CSV / Bin MD）
 *   exportXHSAccount     - 小红书账号（CSV / Obsidian MD）
 *   exportWechatArticle  - 公众号文章（CSV / Obsidian MD）
 *   exportFeishuDoc      - 飞书文档（CSV / Obsidian MD）
 *   exportXHSNoteDetail  - 小红书笔记详情（async，ZIP 含图片）
 */

import type { XiaohongshuNote } from '@/types'
import { MessageTypes } from '@/types'
import { browser } from 'wxt/browser'

// ─── 中文 label 映射（key → 显示名）────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  // 小红书笔记
  noteId: '笔记ID',
  rank: '排名',
  searchKeyword: '搜索关键词',
  title: '标题',
  coverUrl: '封面链接',
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
  'authorAvatarUrl',  // 头像 URL
  'avatarUrl',        // 头像 URL
  'source',           // 采集来源（dom/api）内部字段
  'provider',         // 内部字段
  'commentList',      // 嵌套对象数组，NoteDetail 单独处理
  'contentHtml',      // HTML 原文，太长
  'principalInfo',    // 嵌套对象
  'fetchData',        // 内部控制
  'collected',        // 内部状态
])

// 正文字段：放到 YAML body 而非 frontmatter
const BODY_KEYS = new Set(['content', 'noteListText', 'contentMarkdown', 'excerpt'])

// ─── 通用工具函数 ──────────────────────────────────────────────────────────

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

function safeFilename(data: any, ext: string): string {
  // 搜索结果：用关键词作为文件名
  const rows = toRows(data)
  const keyword = rows[0]?.searchKeyword?.trim()
  if (keyword) {
    const safe = keyword.replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 50)
    return `${safe}.${ext}`
  }

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const count = Array.isArray(data) ? data.length : 1
  const suffix = count > 1 ? `共${count}条` : ''
  return suffix ? `${ts}_${suffix}.${ext}` : `${ts}.${ext}`
}

function triggerDownload(filename: string, content: string | Uint8Array, mime: string): void {
  const blob = content instanceof Uint8Array
    ? new Blob([content.buffer as ArrayBuffer], { type: mime })
    : new Blob([content], { type: `${mime};charset=utf-8` })
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
  return '\uFEFF' + [header, ...dataRows].join('\n')
}

// ─── Obsidian Markdown（单条，用于账号 / 公众号 / 飞书文档）────────────────

function escapeYaml(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function toObsidianMarkdown(row: any): string {
  const yamlLines = ['---']
  let bodyContent = ''

  for (const k of Object.keys(row)) {
    if (SKIP_KEYS.has(k)) continue
    const val = row[k]
    if (val == null || val === '') continue
    const label = LABEL_MAP[k] ?? k

    if (BODY_KEYS.has(k)) {
      if (!bodyContent) bodyContent = String(val)
      continue
    }

    if (Array.isArray(val)) {
      yamlLines.push(`${label}:`)
      val.forEach((v) => yamlLines.push(`  - "${escapeYaml(String(v))}"`))
    } else if (typeof val === 'object') {
      yamlLines.push(`${label}: "${escapeYaml(JSON.stringify(val))}"`)
    } else {
      yamlLines.push(`${label}: "${escapeYaml(String(val))}"`)
    }
  }

  yamlLines.push('---')
  const title = row.title || row.nickname || row.account || row.docTitle || '采集记录'
  const parts: string[] = [yamlLines.join('\n'), '', `# ${title}`]
  if (bodyContent) parts.push('', bodyContent)
  return parts.join('\n')
}

// ─── Bin Markdown（批量列表，用于搜索结果）───────────────────────────────────

const FEED_ORDERED_KEYS = ['title', 'coverUrl', 'likes', 'authorNickname', 'publishTimeStr', 'url', 'searchKeyword', 'noteId']

function toBinMarkdown(rows: any[]): string {
  return rows.map((row, idx) => {
    if (!row || typeof row !== 'object') return `序号：${idx + 1}`
    const lines: string[] = [`序号：${idx + 1}`]
    const seen = new Set<string>()

    for (const k of FEED_ORDERED_KEYS) {
      if (SKIP_KEYS.has(k)) continue
      seen.add(k)
      const val = row[k]
      if (val == null || val === '' || val === 0) continue
      lines.push(`${LABEL_MAP[k] ?? k}：${stringify(val)}`)
    }

    for (const k of Object.keys(row)) {
      if (seen.has(k) || SKIP_KEYS.has(k) || BODY_KEYS.has(k)) continue
      const val = row[k]
      if (val == null || val === '') continue
      lines.push(`${LABEL_MAP[k] ?? k}：${stringify(val)}`)
    }

    return lines.join('\n')
  }).join('\n\n---\n\n')
}

// ─── NoteDetail Markdown（2.2 格式，含图片引用和评论）─────────────────────

function toNoteDetailMarkdown(note: XiaohongshuNote): string {
  // 推导图片文件名（与 exportXHSNoteDetail 下载时的命名规则一致）
  const imageUrls: string[] = []
  if (note.coverUrl) imageUrls.push(note.coverUrl)
  if (note.imageUrls) {
    const extras = note.imageUrls.split(',').map((u) => u.trim()).filter(Boolean)
    for (const u of extras) {
      if (!imageUrls.includes(u)) imageUrls.push(u)
    }
  }
  const imageFilenames = imageUrls.map((url, i) => {
    const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg'
    return i === 0 ? `cover.${ext}` : `image_${i}.${ext}`
  })

  // 推导视频文件名
  const videoFilename = note.videoUrl
    ? `video.${note.videoUrl.match(/\.(mp4|mov|m4v|webm)/i)?.[1] || 'mp4'}`
    : null

  const imageRefs = imageFilenames.map((f, i) => `![图${i + 1}](${f})`).join('\n')

  const frontmatter = [
    '---',
    `标题：${note.title || ''}`,
    `点赞：${note.likes ?? ''}`,
    `标签：${Array.isArray(note.tags) ? note.tags.join(' ') : ''}`,
    '---',
  ].join('\n')

  const bodyParts: string[] = []

  if (imageRefs) {
    // 每行最多 5 列的 Markdown table
    const cols = Math.min(imageFilenames.length, 5)
    const headerRow = '| ' + Array(cols).fill('').join(' | ') + ' |'
    const separatorRow = '| ' + Array(cols).fill('---').join(' | ') + ' |'
    const cellRows: string[] = []
    for (let i = 0; i < imageFilenames.length; i += cols) {
      const chunk = imageFilenames.slice(i, i + cols)
      while (chunk.length < cols) chunk.push('')
      cellRows.push('| ' + chunk.map((f, j) => f ? `![图${i + j + 1}](${f})` : '').join(' | ') + ' |')
    }
    bodyParts.push('## 配图', '', headerRow, separatorRow, ...cellRows, '')
  }

  if (videoFilename) {
    bodyParts.push('## 视频', '', `![视频](${videoFilename})`, '')
  }

  bodyParts.push('## 正文', '', note.content || '')

  const commentLines: string[] = []
  if (note.commentList && note.commentList.length > 0) {
    commentLines.push('')
    for (const c of note.commentList) {
      commentLines.push(`评论${c.no}：${c.comment}`)
      if (c.replies && c.replies.length > 0) {
        for (const r of c.replies) {
          commentLines.push(`    回复${r.no}：${r.comment}`)
        }
      }
      commentLines.push('')
    }
  }

  return [frontmatter, '', ...bodyParts, ...commentLines].join('\n')
}

// ─── 公开 API ─────────────────────────────────────────────────────────────

/** 小红书搜索结果 */
export function exportXHSFeed(data: any, format: string): void {
  if (!data) return
  if (format === 'csv') {
    triggerDownload(safeFilename(data, 'csv'), toCsv(data), 'text/csv')
  } else if (format === 'markdown') {
    const rows = toRows(data)
    triggerDownload(safeFilename(data, 'md'), toBinMarkdown(rows), 'text/markdown')
  }
}

/** 小红书账号 */
export function exportXHSAccount(data: any, format: string): void {
  if (!data) return
  const account = toRows(data)[0]
  const nickname = (account?.nickname || account?.userId || '账号').replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 40)

  // 解析 noteListText → 结构化列表
  // 格式：#N [title](url) | 点赞 N
  const noteList: { no: number; title: string; url: string; likes: number | '' }[] = []
  const noteListText: string = account?.noteListText || ''
  for (const line of noteListText.split('\n')) {
    const m = line.match(/^#(\d+)\s+\[(.+?)\]\((.+?)\)(?:\s*\|\s*点赞\s*(\d+))?/)
    if (m) noteList.push({ no: Number(m[1]), title: m[2], url: m[3], likes: m[4] ? Number(m[4]) : '' })
  }

  if (format === 'csv') {
    // 文件1：账号基础信息
    const accountRow = { ...account }
    delete accountRow.noteListText
    triggerDownload(`${nickname}.csv`, toCsv(accountRow), 'text/csv')

    // 文件2：笔记列表
    if (noteList.length > 0) {
      const header = '编号,标题,点赞,链接'
      const rows = noteList.map(n => [n.no, csvCell(n.title), n.likes, n.url].join(','))
      const csv = '\uFEFF' + [header, ...rows].join('\n')
      triggerDownload(`${nickname}-发布笔记列表.csv`, csv, 'text/csv')
    }
  } else if (format === 'markdown') {
    // Obsidian frontmatter（跳过 noteListText，单独输出笔记列表）
    const accountWithoutNotes = { ...account, noteListText: undefined }
    const frontmatter = toObsidianMarkdown(accountWithoutNotes)

    const noteLines = noteList.length > 0
      ? ['\n## 笔记列表\n', ...noteList.map(n => `${n.no}. [${n.title}](${n.url})${n.likes !== '' ? ' | 点赞 ' + n.likes : ''}`)]
      : ['\n## 笔记列表\n', '暂无笔记']

    triggerDownload(`${nickname}.md`, [frontmatter, ...noteLines].join('\n'), 'text/markdown')
  }
}

/** 公众号文章 */
export function exportWechatArticle(data: any, format: string): void {
  if (!data) return
  if (format === 'csv') {
    triggerDownload(safeFilename(data, 'csv'), toCsv(data), 'text/csv')
  } else if (format === 'markdown') {
    const rows = toRows(data)
    const content = rows.length === 1 ? toObsidianMarkdown(rows[0]) : rows.map(toObsidianMarkdown).join('\n\n---\n\n')
    triggerDownload(safeFilename(data, 'md'), content, 'text/markdown')
  }
}

/** 飞书文档 */
export function exportFeishuDoc(data: any, format: string): void {
  if (!data) return
  if (format === 'csv') {
    triggerDownload(safeFilename(data, 'csv'), toCsv(data), 'text/csv')
  } else if (format === 'markdown') {
    const rows = toRows(data)
    const content = rows.length === 1 ? toObsidianMarkdown(rows[0]) : rows.map(toObsidianMarkdown).join('\n\n---\n\n')
    triggerDownload(safeFilename(data, 'md'), content, 'text/markdown')
  }
}

/** 小红书笔记详情（CSV / Markdown 都打包成 ZIP，含图片） */
export async function exportXHSNoteDetail(note: XiaohongshuNote, format: string): Promise<void> {
  if (!note) return

  const datePrefix = (note.publishTimeStr || '').replace(/\s.+/, '').replace(/[^\d-]/g, '-') || new Date().toISOString().slice(0, 10)
  const titleSafe = (note.title || '笔记').replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 40)

  // 解析图片 URL 列表（imageUrls 是逗号分隔的字符串）
  const imageUrls: string[] = []
  if (note.coverUrl) imageUrls.push(note.coverUrl)
  if (note.imageUrls) {
    const extras = note.imageUrls.split(',').map((u) => u.trim()).filter(Boolean)
    for (const u of extras) {
      if (!imageUrls.includes(u)) imageUrls.push(u)
    }
  }

  // 下载图片，失败则跳过
  const imageFiles: { filename: string; data: Uint8Array }[] = []
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg'
    const filename = i === 0 ? `cover.${ext}` : `image_${i}.${ext}`
    try {
      const res = await browser.runtime.sendMessage({
        type: MessageTypes.HTTPRequest,
        payload: {
          url: imageUrls[i],
          init: {
            method: 'GET',
            credentials: 'omit',
            headers: { Accept: 'image/*,*/*;q=0.8' },
            referrer: 'https://www.xiaohongshu.com/',
            referrerPolicy: 'strict-origin-when-cross-origin'
          }
        }
      })
      if (res?.ok && res.body) {
        const bytes = new Uint8Array(res.body as number[])
        console.log(`[CJDB] 图片 ${filename} 大小: ${bytes.byteLength} bytes`)
        imageFiles.push({ filename, data: bytes })
      }
    } catch {
      // 图片抓取失败则跳过，不影响 ZIP 生成
    }
  }

  // 下载视频，失败则跳过（直接 fetch，不走 background 代理，避免大文件走 sendMessage 超限）
  let videoFile: { filename: string; data: Uint8Array } | null = null
  if (note.videoUrl) {
    const ext = note.videoUrl.match(/\.(mp4|mov|m4v|webm)/i)?.[1] || 'mp4'
    const filename = `video.${ext}`
    try {
      const res = await fetch(note.videoUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: { Accept: 'video/*,*/*;q=0.8' },
        referrer: 'https://www.xiaohongshu.com/',
        referrerPolicy: 'strict-origin-when-cross-origin'
      })
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        console.log(`[CJDB] 视频 ${filename} 大小: ${bytes.byteLength} bytes`)
        videoFile = { filename, data: bytes }
      } else {
        console.warn(`[CJDB] 视频下载失败: ${res.status} ${res.statusText}`)
      }
    } catch (e) {
      console.warn(`[CJDB] 视频下载失败，跳过:`, e)
      // 视频抓取失败则跳过，不影响 ZIP 生成
    }
  }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  if (format === 'csv') {
    zip.file(`${titleSafe}.csv`, toCsv(note))
  } else {
    const mdFilename = `${datePrefix}-${titleSafe}.md`
    zip.file(mdFilename, toNoteDetailMarkdown(note))
  }

  for (const { filename, data } of imageFiles) {
    zip.file(filename, data)
  }
  if (videoFile) {
    zip.file(videoFile.filename, videoFile.data)
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  triggerDownload(`${datePrefix}-${titleSafe}.zip`, zipBytes, 'application/zip')
}
