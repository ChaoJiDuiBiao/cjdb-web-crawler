import type { StoreAdapter, StoreConfig, SaveResult, XiaohongshuNote, XiaohongshuAccount, WechatArticle, FeishuDoc } from '@/types'
import { CollectionType } from '@/types'
import { showPanelTip } from '@/utils/tips'
import { parseDateTime } from '@/utils/dateTimeParse'
import { parseNotionDatabaseId } from '@/utils/notion'

const NOTION_VERSION = '2022-06-28'
const NOTION_MARKDOWN_VERSION = '2025-09-03'
const NOTION_FILE_MAX_SIZE = 20 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 20000
const DEFAULT_IMAGE_UPLOAD_CONCURRENCY = 4
const DEFAULT_IMAGE_UPLOAD_RETRY = 1

// 笔记详情页 Schema（完整数据）
const NOTE_SCHEMA = {
  '标题': { type: 'title', notionType: { title: {} } },
  'URL': { type: 'url', notionType: { url: {} }, unique: true },
  '发布时间': { type: 'date', notionType: { date: {} } },
  '发布地点': { type: 'rich_text', notionType: { rich_text: {} } },
  '正文': { type: 'rich_text', notionType: { rich_text: {} } },
  '封面': { type: 'files', notionType: { files: {} } },
  '图片': { type: 'files', notionType: { files: {} } },
  '标签': { type: 'multi_select', notionType: { multi_select: {} } },
  '点赞量': { type: 'number', notionType: { number: { format: 'number' } } },
  '收藏量': { type: 'number', notionType: { number: { format: 'number' } } },
  '评论量': { type: 'number', notionType: { number: { format: 'number' } } },
  '作者粉丝量': { type: 'number', notionType: { number: { format: 'number' } } },
  '作者获赞与收藏数': { type: 'number', notionType: { number: { format: 'number' } } },
  '采集时间': { type: 'date', notionType: { date: {} } }
}

// 搜索任务 Schema（一次搜索一条记录）
const FEED_SCHEMA = {
  '标题': { type: 'title', notionType: { title: {} } },
  '数量': { type: 'number', notionType: { number: { format: 'number' } } },
  '采集时间': { type: 'date', notionType: { date: {} } }
}

// 账号主页 Schema（账号信息）
const ACCOUNT_SCHEMA = {
  '昵称': { type: 'title', notionType: { title: {} } },
  '账号ID': { type: 'rich_text', notionType: { rich_text: {} }, unique: true },
  '主页URL': { type: 'url', notionType: { url: {} } },
  '头像': { type: 'files', notionType: { files: {} } },
  '账号简介': { type: 'rich_text', notionType: { rich_text: {} } },
  '归属地': { type: 'rich_text', notionType: { rich_text: {} } },
  '笔记数': { type: 'number', notionType: { number: { format: 'number' } } },
  '获赞数': { type: 'number', notionType: { number: { format: 'number' } } },
  '粉丝数': { type: 'number', notionType: { number: { format: 'number' } } },
  '关注数': { type: 'number', notionType: { number: { format: 'number' } } },
  '采集时间': { type: 'date', notionType: { date: {} } }
}

// 公众号文章 Schema（内容/数据/历史通用）
// 正文不入库字段，保存到文档正文（blocks）
const WECHAT_ARTICLE_SCHEMA = {
  '标题': { type: 'title', notionType: { title: {} } },
  'URL': { type: 'url', notionType: { url: {} }, unique: true },
  '发布时间': { type: 'rich_text', notionType: { rich_text: {} } },
  '公众号名称': { type: 'select', notionType: { select: {} } },
  '公司名称': { type: 'rich_text', notionType: { rich_text: {} } },
  '地区': { type: 'rich_text', notionType: { rich_text: {} } },
  '主体名称': { type: 'rich_text', notionType: { rich_text: {} } },
  '认证时间': { type: 'date', notionType: { date: {} } },
  'gh_id': { type: 'rich_text', notionType: { rich_text: {} } },
  '认证类型': { type: 'rich_text', notionType: { rich_text: {} } },
  '封面': { type: 'files', notionType: { files: {} } },
  '阅读量': { type: 'number', notionType: { number: { format: 'number' } } },
  '拇指赞': { type: 'number', notionType: { number: { format: 'number' } } },
  '爱心赞': { type: 'number', notionType: { number: { format: 'number' } } },
  '转发量': { type: 'number', notionType: { number: { format: 'number' } } },
  '收藏量': { type: 'number', notionType: { number: { format: 'number' } } },
  '评论数': { type: 'number', notionType: { number: { format: 'number' } } },
  '采集时间': { type: 'date', notionType: { date: {} } }
}

const FEISHU_DOC_SCHEMA = {
  '标题': { type: 'title', notionType: { title: {} } },
  'URL': { type: 'url', notionType: { url: {} }, unique: true },
  '文档类型': { type: 'select', notionType: { select: {} } },
  '知识空间': { type: 'rich_text', notionType: { rich_text: {} } },
  '摘要': { type: 'rich_text', notionType: { rich_text: {} } },
  '采集时间': { type: 'date', notionType: { date: {} } }
}

// 根据数据类型选择对应的 schema
function getSchemaByType(type: string) {
  const schemaMap: Record<string, any> = {
    [CollectionType.XHSNoteDetail]: NOTE_SCHEMA,
    [CollectionType.XHSFeed]: FEED_SCHEMA,
    [CollectionType.XHSAccount]: ACCOUNT_SCHEMA,
    [CollectionType.WechatArticle]: WECHAT_ARTICLE_SCHEMA,
    [CollectionType.FeishuDoc]: FEISHU_DOC_SCHEMA
  }
  return schemaMap[type] || null
}

// 为每个数据类型生成独立的 key
function fieldMapKey(dbId: string, type: string) {
  return `cjdb_notion_field_map_${dbId}_${type}`
}

function initFlagKey(dbId: string, type: string) {
  return `cjdb_notion_initialized_${dbId}_${type}`
}

async function getFieldMap(dbId: string, type: string): Promise<Record<string, string>> {
  const key = fieldMapKey(dbId, type)
  const result = await browser.storage.local.get([key])
  return result[key] || {}
}

async function saveFieldMap(dbId: string, type: string, map: Record<string, string>) {
  await browser.storage.local.set({ [fieldMapKey(dbId, type)]: map })
}

async function isInitialized(dbId: string, type: string): Promise<boolean> {
  const key = initFlagKey(dbId, type)
  const result = await browser.storage.local.get([key])
  return !!result[key]
}

async function markInitialized(dbId: string, type: string) {
  await browser.storage.local.set({ [initFlagKey(dbId, type)]: true })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif'
  }
  return map[String(contentType || '').toLowerCase()] || 'jpg'
}

function toSafeFilename(name: string, fallback: string): string {
  const cleaned = String(name || '')
    .replace(/[?#].*$/, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

function inferFilenameFromUrl(url: string, index: number, contentType = ''): string {
  const fallback = `image-${index + 1}.${extFromContentType(contentType)}`
  try {
    const u = new URL(url)
    const raw = decodeURIComponent(u.pathname.split('/').pop() || '')
    const name = toSafeFilename(raw, fallback)
    if (/\.\w{2,5}$/.test(name)) return name
    return `${name}.${extFromContentType(contentType)}`
  } catch {
    return fallback
  }
}

function normalizeFileUrls(value: unknown): string[] {
  const out: string[] = []
  const append = (v: unknown) => {
    if (typeof v !== 'string') return
    const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
    for (const p of parts) out.push(p)
  }

  if (Array.isArray(value)) {
    value.forEach(append)
  } else {
    append(value)
  }

  return Array.from(new Set(out))
}

function hasFileUploadPayload(value: any): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => hasFileUploadPayload(v))
  if ('file_upload' in value) return true
  return Object.values(value).some((v) => hasFileUploadPayload(v))
}

async function downloadImageBlob(url: string): Promise<{ blob: Blob; contentType: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const fetchWithCacheMode = async (cacheMode: RequestCache) => {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        headers: { Accept: 'image/*,*/*;q=0.8' },
        referrer: 'https://www.xiaohongshu.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        cache: cacheMode,
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`)
      }

      const blob = await response.blob()
      if (!blob || blob.size <= 0) {
        throw new Error('下载为空文件')
      }

      const contentType = response.headers.get('content-type') || blob.type || 'image/jpeg'
      return { blob, contentType }
    }

    // 优先命中浏览器缓存，失败时再走默认网络策略
    try {
      return await fetchWithCacheMode('force-cache')
    } catch (e: any) {
      if (controller.signal.aborted) throw e
      return await fetchWithCacheMode('default')
    }
  } finally {
    clearTimeout(timer)
  }
}

type UploadedImageResult = {
  url: string
  ok: boolean
  error?: string
  file: any
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Array.isArray(items) || items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency || 1, items.length))
  const results: R[] = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = cursor++
      if (current >= items.length) return
      results[current] = await worker(items[current], current)
    }
  })

  await Promise.all(workers)
  return results
}

async function uploadImagesByUrl(
  api: NotionAPI,
  urls: string[],
  opts?: {
    concurrency?: number
    retry?: number
    fromTabId?: number
    progressLabel?: string
  }
): Promise<UploadedImageResult[]> {
  if (!Array.isArray(urls) || urls.length === 0) return []
  const retry = Math.max(0, opts?.retry ?? DEFAULT_IMAGE_UPLOAD_RETRY)

  let completed = 0
  return runWithConcurrency(urls, opts?.concurrency ?? DEFAULT_IMAGE_UPLOAD_CONCURRENCY, async (url, index) => {
    let lastError: any = null
    const fallbackName = inferFilenameFromUrl(url, index)

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const { blob, contentType } = await downloadImageBlob(url)
        if (blob.size > NOTION_FILE_MAX_SIZE) {
          throw new Error(`图片超过 20MB，当前 ${(blob.size / (1024 * 1024)).toFixed(2)}MB`)
        }
        const filename = inferFilenameFromUrl(url, index, contentType)
        const fileUploadId = await api.uploadFileBlobToNotion(blob, filename, contentType)

        completed++
        if (opts?.progressLabel) {
          showPanelTip(`正在上传${opts.progressLabel} ${completed}/${urls.length}...`, opts.fromTabId)
        }

        return {
          url,
          ok: true,
          file: { type: 'file_upload', name: filename, file_upload: { id: fileUploadId } }
        }
      } catch (e: any) {
        lastError = e
        if (attempt < retry) {
          await sleep(300 * (attempt + 1))
        }
      }
    }

    completed++
    if (opts?.progressLabel) {
      showPanelTip(`正在上传${opts.progressLabel} ${completed}/${urls.length}...`, opts.fromTabId)
    }

    console.warn('[Notion] 图片上传失败，回退 external:', url, lastError?.message || lastError)
    return {
      url,
      ok: false,
      error: String(lastError?.message || lastError || '上传失败'),
      file: { type: 'external', name: fallbackName, external: { url } }
    }
  })
}

class NotionAPI {
  apiKey: string
  databaseId: string
  schemaCache: any = null
  fieldNameMap: Record<string, string> = {}

  constructor(apiKey: string, databaseId: string, fieldNameMap: Record<string, string> = {}) {
    this.apiKey = apiKey
    this.databaseId = databaseId
    this.fieldNameMap = fieldNameMap || {}
  }

  private async requestWithOptions(
    method: string,
    endpoint: string,
    data: any = null,
    version: string = NOTION_VERSION,
    extraHeaders: Record<string, string> = {}
  ) {
    const url = `https://api.notion.com/v1${endpoint}`
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': version,
      ...extraHeaders
    }
    const options: RequestInit = {
      method,
      headers
    }

    if (data != null) {
      if (typeof FormData !== 'undefined' && data instanceof FormData) {
        options.body = data
      } else {
        headers['Content-Type'] = 'application/json'
        options.body = JSON.stringify(data)
      }
    }

    const response = await fetch(url, options)
    const raw = await response.text()
    let result: any = {}
    if (raw) {
      try {
        result = JSON.parse(raw)
      } catch {
        result = { message: raw }
      }
    }

    if (!response.ok) {
      throw new Error(result?.message || `Notion API error: ${response.status}`)
    }

    return result
  }

  async request(method: string, endpoint: string, data: any = null) {
    return this.requestWithOptions(method, endpoint, data, NOTION_VERSION)
  }

  async getDatabase() {
    if (this.schemaCache) return this.schemaCache
    this.schemaCache = await this.request('GET', `/databases/${this.databaseId}`)
    return this.schemaCache
  }

  async updateDatabaseSchema(properties: any) {
    try {
      const result = await this.request('PATCH', `/databases/${this.databaseId}`, { properties })
      this.schemaCache = null
      return result
    } catch (e: any) {
      if (e?.message?.includes('title property')) {
        console.warn('[Notion] title 属性创建失败，可能已存在')
        return null
      }
      throw e
    }
  }

  async queryDatabase(filter: any) {
    return this.request('POST', `/databases/${this.databaseId}/query`, { filter })
  }

  async createPage(properties: any, children: any[] | null = null, markdown: string | null = null) {
    const payload: any = { parent: { database_id: this.databaseId }, properties }

    // 优先使用 Markdown（需要 public integration 和 2025-09-03 版本）
    if (markdown && typeof markdown === 'string' && markdown.trim()) {
      try {
        console.log('[Notion] 尝试使用 Markdown API，内容长度:', markdown.length)
        const result = await this.requestWithVersion('POST', '/pages', { ...payload, markdown }, NOTION_MARKDOWN_VERSION)
        console.log('[Notion] Markdown API 成功')
        return result
      } catch (e: any) {
        console.warn('[Notion] Markdown API 失败，回退到 blocks 方式', e?.message)
        // 如果 Markdown API 失败，将 markdown 转为 blocks
        if (!children || children.length === 0) {
          children = markdownToBlocks(markdown)
          console.log('[Notion] 将 Markdown 转为 blocks，共', children.length, '个')
        }
      }
    }

    // 回退到 blocks 方式
    if (children && Array.isArray(children) && children.length > 0) {
      payload.children = children.length > 100 ? children.slice(0, 100) : children
    }
    const requestVersion = hasFileUploadPayload(payload) ? NOTION_MARKDOWN_VERSION : NOTION_VERSION
    const result = await this.requestWithVersion('POST', '/pages', payload, requestVersion)
    if (children && children.length > 100) {
      const rest = children.slice(100)
      for (let i = 0; i < rest.length; i += 100) {
        await this.requestWithVersion(
          'PATCH',
          `/blocks/${result.id}/children`,
          { children: rest.slice(i, i + 100) },
          requestVersion
        )
      }
    }
    return result
  }

  async requestWithVersion(
    method: string,
    endpoint: string,
    data: any = null,
    version: string = NOTION_VERSION,
    extraHeaders: Record<string, string> = {}
  ) {
    return this.requestWithOptions(method, endpoint, data, version, extraHeaders)
  }

  async createFileUpload(filename: string, contentType: string, contentLength: number) {
    return this.requestWithVersion(
      'POST',
      '/file_uploads',
      { mode: 'single_part', filename, content_type: contentType, content_length: contentLength },
      NOTION_MARKDOWN_VERSION
    )
  }

  async sendFileUpload(fileUploadId: string, fileBlob: Blob, filename: string) {
    const form = new FormData()
    form.append('file', fileBlob, filename)
    return this.requestWithVersion('POST', `/file_uploads/${fileUploadId}/send`, form, NOTION_MARKDOWN_VERSION)
  }

  async retrieveFileUpload(fileUploadId: string) {
    return this.requestWithVersion('GET', `/file_uploads/${fileUploadId}`, null, NOTION_MARKDOWN_VERSION)
  }

  async uploadFileBlobToNotion(fileBlob: Blob, filename: string, contentType: string) {
    const created = await this.createFileUpload(filename, contentType, fileBlob.size)
    const fileUploadId = created?.id
    if (!fileUploadId) {
      throw new Error('Notion file_upload 创建失败')
    }

    await this.sendFileUpload(fileUploadId, fileBlob, filename)

    for (let i = 0; i < 12; i++) {
      const result = await this.retrieveFileUpload(fileUploadId)
      const status = String(result?.status || '').toLowerCase()
      if (status === 'uploaded') return fileUploadId
      if (status === 'failed' || status === 'expired') {
        throw new Error(`Notion file_upload 状态异常: ${status}`)
      }
      await sleep(1000)
    }

    throw new Error('Notion file_upload 上传超时')
  }

  async updatePage(pageId: string, properties: any) {
    return this.request('PATCH', `/pages/${pageId}`, { properties })
  }

  async ensureSchema(schema: any, saveFieldMapCallback: ((map: Record<string, string>) => Promise<void>) | null = null) {
    let db: any
    let existing: any
    const missing: any = {}

    try {
      db = await this.getDatabase()
      existing = db.properties || {}
    } catch (e) {
      console.error('[Notion] 获取数据库失败:', e)
      return false
    }

    if (saveFieldMapCallback) {
      // 处理 title 字段：Notion 新建数据库首列默认为「名称」，需重命名为 schema 中的标题名（如「标题」），否则首列必填校验会失败
      const titleFields = Object.entries(schema).filter(([, c]: any) => c.type === 'title')
      if (titleFields.length > 0) {
        const [titleFieldName] = titleFields[0]
        const titleProp = Object.entries(existing).find(([, p]: any) => p.type === 'title')
        if (titleProp) {
          const currentTitleName = titleProp[0]
          this.fieldNameMap[titleFieldName as string] = currentTitleName
          // 若首列名称与 schema 设计不符（如「名称」≠「标题」），则重命名为首列为我们设计的名字
          if (currentTitleName !== titleFieldName) {
            try {
              await this.updateDatabaseSchema({ [currentTitleName]: { name: titleFieldName } })
              this.fieldNameMap[titleFieldName as string] = titleFieldName
              existing[titleFieldName] = existing[currentTitleName]
              delete existing[currentTitleName]
            } catch (e: any) {
              console.warn('[Notion] 重命名首列失败，将使用映射:', currentTitleName, '->', titleFieldName, e?.message)
            }
          }
        } else {
          this.fieldNameMap[titleFieldName as string] = titleFieldName as string
        }
      }

      // 检查其他字段
      for (const [name, config] of Object.entries(schema) as any) {
        if (config.type === 'title') continue
        if (existing[name]) {
          const expectedType = Object.keys(config.notionType || {})[0]
          const actualType = existing[name]?.type
          if (expectedType && actualType && expectedType !== actualType) {
            console.warn(`[Notion] 字段类型不匹配: ${name} 期望 ${expectedType}，实际 ${actualType}，请在 Notion 中调整字段类型或重建字段`)
          }
          this.fieldNameMap[name] = name
        } else {
          missing[name] = config.notionType
        }
      }
    }

    // 创建缺失字段
    if (Object.keys(missing).length > 0) {
      try {
        await this.updateDatabaseSchema(missing)
        for (const k of Object.keys(missing)) {
          this.fieldNameMap[k] = k
        }
      } catch (e: any) {
        if (e?.message?.includes('title property')) return false
        throw e
      }
    }

    if (saveFieldMapCallback && Object.keys(this.fieldNameMap).length > 0) {
      await saveFieldMapCallback(this.fieldNameMap)
    }
    return true
  }

  async findByUniqueField(schema: any, fieldName: string, value: string) {
    const config = schema[fieldName]
    if (!config) throw new Error(`字段 ${fieldName} 不存在`)
    const actualName = this.fieldNameMap[fieldName] || fieldName
    let filterType: string
    let filterValue: any

    if (config.type === 'url') {
      filterType = 'url'
      filterValue = { equals: value }
    } else if (config.type === 'rich_text') {
      filterType = 'rich_text'
      filterValue = { equals: value }
    } else {
      throw new Error(`不支持的唯一字段类型: ${config.type}`)
    }

    const result = await this.queryDatabase({ property: actualName, [filterType]: filterValue })
    return result?.results?.[0] || null
  }
}

async function toNotionProperties(
  raw: any,
  schema: any,
  fieldNameMap: Record<string, string>,
  api: NotionAPI,
  isUpdate = false
) {
  const nowStart = new Date().toISOString()

  // 根据 schema 判断数据类型
  const hasContent = schema.hasOwnProperty('正文')
  const hasAccount = schema.hasOwnProperty('账号ID')
  const hasFeed = schema.hasOwnProperty('搜索词') && schema.hasOwnProperty('笔记链接')

  // 笔记详情页字段映射（完整数据）
  const noteFieldMap: Record<string, string> = {
    title: '标题',
    url: 'URL',
    publishTimeStr: '发布时间',
    location: '发布地点',
    content: '正文',
    coverUrl: '封面',
    imageUrls: '图片',
    tags: '标签',
    likes: '点赞量',
    favorites: '收藏量',
    comments: '评论量',
    authorFansCount: '作者粉丝量',
    authorLikes: '作者获赞与收藏数'
  }

  // 搜索结果字段映射（逐条记录）
  const feedFieldMap: Record<string, string> = {
    title: '笔记标题',
    rank: '排名',
    searchKeyword: '搜索词',
    coverUrl: '封面',
    imageUrls: '封面',
    likes: '点赞量',
    authorNickname: '昵称',
    publishTimeStr: '发布时间',
    url: '笔记链接'
  }

  // 账号数据字段映射（账号主页）
  const accountFieldMap: Record<string, string> = {
    nickname: '昵称',
    userId: '账号ID',
    url: '主页URL',
    avatarUrl: '头像',
    description: '账号简介',
    location: '归属地',
    notesCount: '笔记数',
    likedCount: '获赞数',
    fansCount: '粉丝数',
    followingCount: '关注数'
  }

  // 公众号文章字段映射（正文 content 不入 properties，主体信息来自 principalInfo）
  const wechatArticleFieldMap: Record<string, string> = {
    title: '标题',
    url: 'URL',
    publishTimeStr: '发布时间',
    principalNickname: '公众号名称',
    principalCompanyName: '公司名称',
    principalRegion: '地区',
    principalName: '主体名称',
    principalVerifyDate: '认证时间',
    principalGhId: 'gh_id',
    principalVerifyType: '认证类型',
    coverUrl: '封面',
    read: '阅读量',
    zan: '拇指赞',
    looking: '爱心赞',
    shareNum: '转发量',
    collectNum: '收藏量',
    commentCount: '评论数'
  }

  const feishuDocFieldMap: Record<string, string> = {
    title: '标题',
    url: 'URL',
    docType: '文档类型',
    workspace: '知识空间',
    excerpt: '摘要'
  }

  const hasWechatArticle = schema.hasOwnProperty('阅读量')
  const hasFeishuDoc = schema.hasOwnProperty('文档类型')
  const map = hasWechatArticle
    ? wechatArticleFieldMap
    : hasFeishuDoc
      ? feishuDocFieldMap
    : hasFeed
      ? feedFieldMap
      : hasAccount
      ? accountFieldMap
      : hasContent
        ? noteFieldMap
        : feedFieldMap

  // 公众号文章：将 principalInfo 扁平化到 raw 供映射使用
  if (hasWechatArticle && raw?.principalInfo) {
    const p = raw.principalInfo
    raw.principalNickname = p.nickname
    raw.principalCompanyName = p.companyName
    raw.principalRegion = p.region
    raw.principalName = p.name
    raw.principalVerifyDate = p.verifyDate
    raw.principalGhId = p.ghId
    raw.principalVerifyType = p.verifyType
  }

  const out: any = {}
  for (const [fieldName, config] of Object.entries(schema) as any) {
    const actualName = fieldNameMap[fieldName] || fieldName
    if (isUpdate && (fieldName === 'URL' || fieldName === '主页URL' || fieldName === '账号ID' || fieldName === '笔记链接')) continue
    if (fieldName === '采集时间') {
      const collectedRaw = typeof raw?.crawledAt === 'string' && raw.crawledAt.trim()
        ? raw.crawledAt.trim()
        : nowStart
      out[actualName] = { date: { start: toNotionDateStart(collectedRaw) || nowStart } }
      continue
    }
    const keys = Object.keys(map).filter((k) => map[k] === fieldName)
    let value = raw[fieldName]
    for (const key of keys) {
      const candidate = raw[key]
      if (candidate !== undefined && candidate !== null && String(candidate).trim?.() !== '') {
        value = candidate
        break
      }
    }

    let propValue: any = null
    if (config.type === 'title') {
      propValue = { title: [{ text: { content: String(value || '未知') } }] }
    } else if (config.type === 'url') {
      propValue = { url: value || '' }
    } else if (config.type === 'date') {
      const start = toNotionDateStart(value)
      propValue = start ? { date: { start } } : null
    } else if (config.type === 'rich_text') {
      const text = typeof value === 'string' ? value : (value && typeof value === 'object' ? '' : String(value || ''))
      propValue = { rich_text: [{ text: { content: text.slice(0, 2000) } }] }
    } else if (config.type === 'files') {
      const urls = normalizeFileUrls(value)
      if (urls.length === 0) {
        propValue = null
      } else {
        const shouldDownloadImages = raw?.downloadImages !== false
        if (!shouldDownloadImages) {
          propValue = {
            files: urls.map((url, index) => ({
              type: 'external',
              name: inferFilenameFromUrl(url, index),
              external: { url }
            }))
          }
        } else {
          const uploaded = await uploadImagesByUrl(api, urls, {
            concurrency: DEFAULT_IMAGE_UPLOAD_CONCURRENCY,
            retry: DEFAULT_IMAGE_UPLOAD_RETRY
          })
          propValue = { files: uploaded.map((u) => u.file) }
        }
      }
    } else if (config.type === 'select') {
      const s = typeof value === 'string' ? value.trim() : ''
      propValue = s ? { select: { name: s.slice(0, 100) } } : null
    } else if (config.type === 'multi_select') {
      const arr = Array.isArray(value) ? value : []
      const items = arr.filter(Boolean).map((t) => ({ name: String(t).trim() })).filter((t) => t.name)
      propValue = items.length > 0 ? { multi_select: items } : null
    } else if (config.type === 'number') {
      // 只在有有效数字时设置，避免用 0 覆盖已有数据
      if (value != null) {
        const num = parseInt(String(value), 10)
        if (!isNaN(num)) {
          propValue = { number: num }
        }
      }
    }

    // 不写入 null，避免 Notion 报 body failed validation（如 select 空值、数据库已有同名只读属性等）
    if (propValue != null) {
      out[actualName] = propValue
    }
  }
  return out
}

/** 判断是否为「缺少字段」类错误（数据库不存在某属性） */
function isMissingPropertyError(err: any): boolean {
  const msg = err?.message || String(err)
  return /is not a property that exists/i.test(msg)
}

function parseNotionError(err: any): string {
  const msg = err?.message || String(err)
  if (msg.includes('401') || msg.includes('Unauthorized')) return 'Notion API Token 无效或已过期，请检查配置'
  if (msg.includes('404') || msg.includes('Could not find')) return '数据库不存在或无权访问，请检查 Database ID'
  if (msg.includes('403') || msg.includes('Forbidden')) return '无权限访问该数据库，请确认 Token 已分享给该数据库'
  if (msg.includes('429') || msg.includes('rate')) return '请求过于频繁，请稍后再试'
  if (msg.includes('title property')) return '数据库已有 title 属性，请确保名称与「标题」一致'
  if (msg.includes('Network')) return '网络请求失败，请检查网络连接'
  return msg
}

function toNotionDateStart(value: unknown): string | null {
  if (value == null) return null

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (typeof value === 'number') {
    const dt = new Date(value)
    return isNaN(dt.getTime()) ? null : dt.toISOString()
  }

  const text = String(value).trim()
  if (!text) return null

  // 已是纯日期，直接写入 Notion 日期字段
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  // 常见本地格式：YYYY-MM-DD HH:mm(:ss)
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const normalized = text.replace(' ', 'T')
    const dt = new Date(normalized)
    if (!isNaN(dt.getTime())) return dt.toISOString()
  }

  // 中文相对时间/自然语言
  const parsed = parseDateTime(text)
  if (parsed && !isNaN(parsed.getTime())) return parsed.toISOString()

  // 最后尝试浏览器原生解析（ISO 等）
  const dt = new Date(text)
  return isNaN(dt.getTime()) ? null : dt.toISOString()
}

// ==================== 笔记详情页存储（单条，带重试） ====================
async function saveXhsNoteToNotion(
  data: XiaohongshuNote,
  schema: any,
  api: NotionAPI,
  dbId: string,
  type: string,
  fromTabId?: number
): Promise<SaveResult> {
  showPanelTip('正在连接 Notion...', fromTabId)

  const url = data?.url || (data?.noteId ? `https://www.xiaohongshu.com/explore/${data.noteId}` : '')
  if (!url) return { ok: false, error: '缺少笔记 URL' }

  let lastErr: any
  for (let retry = 0; retry < 2; retry++) {
    try {
      if (retry > 0) {
        showPanelTip('正在重新检查数据库字段...', fromTabId)
        await browser.storage.local.remove([initFlagKey(dbId, type), fieldMapKey(dbId, type)])
        api.schemaCache = null
        const fieldMap = await getFieldMap(dbId, type)
        await api.ensureSchema(schema, async (m) => {
          await saveFieldMap(dbId, type, m)
        })
        await markInitialized(dbId, type)
      }

      showPanelTip('正在查询是否已存在该笔记...', fromTabId)
      const existing = await api.findByUniqueField(schema, 'URL', url)
      const props = await toNotionProperties(data, schema, api.fieldNameMap, api, !!existing)

      // 转换 commentList 为 blocks
      const children = data.commentList ? convertCommentListToBlocks(data.commentList) : null

      if (existing) {
        showPanelTip('正在更新已有笔记...', fromTabId)
        await api.updatePage(existing.id, props)
        // 更新页面内容（评论列表）
        if (children && children.length > 0) {
          try {
            showPanelTip(`正在写入 ${children.length} 条评论...`, fromTabId)
            await replacePageContent(api, existing.id, children)
            console.log('[Notion] 笔记评论列表已更新')
          } catch (e) {
            console.warn('[Notion] 更新评论列表失败:', e)
          }
        }
        return { ok: true, action: 'update', pageId: existing.id }
      } else {
        showPanelTip(children?.length ? '正在创建新笔记并写入评论...' : '正在创建新笔记...', fromTabId)
        const result = await api.createPage(props, children)
        return { ok: true, action: 'create', pageId: result?.id }
      }
    } catch (e: any) {
      lastErr = e
      const msg = e?.message || String(e)
      if (retry === 0 && (msg.includes('validation_error') || msg.includes('is not a property that exists'))) continue
      break
    }
  }
  const errMsg = parseNotionError(lastErr)
  console.error('[Notion]', lastErr)
  return { ok: false, error: errMsg }
}

// ==================== 搜索页存储（一次搜索一条记录） ====================
async function saveXhsFeedToNotion(
  data: XiaohongshuNote[],
  schema: any,
  api: NotionAPI,
  fromTabId?: number
): Promise<SaveResult> {
  const items = Array.isArray(data) ? data : [data]
  if (items.length === 0) return { ok: false, error: '暂无搜索结果可保存' }

  const keyword = (items.find((it) => it?.searchKeyword)?.searchKeyword || '').trim() || '未命名搜索'
  const batchCrawledAt = new Date().toISOString()
  const total = items.length

  showPanelTip(`正在保存搜索「${keyword}」...`, fromTabId)
  console.log(`[Notion] 保存搜索任务: keyword=${keyword}, total=${total}, batchCrawledAt=${batchCrawledAt}`)

  try {
    const props = await toNotionProperties(
      { '标题': keyword, '数量': total, crawledAt: batchCrawledAt },
      schema,
      api.fieldNameMap,
      api,
      false
    )
    const children = convertXhsSearchResultsToBlocks(items, keyword)
    const result = await api.createPage(props, children)
    return { ok: true, action: 'create', pageId: result?.id }
  } catch (e: any) {
    if (isMissingPropertyError(e)) throw e
    console.error('[Notion] 保存搜索任务失败:', e)
    return { ok: false, error: parseNotionError(e) }
  }
}

// ==================== 公众号文章存储（统一入口，内部按需分批） ====================
async function saveWechatArticlesToNotion(
  data: WechatArticle[],
  schema: any,
  api: NotionAPI,
  dbId: string,
  type: string,
  fromTabId?: number
): Promise<SaveResult | SaveResult[]> {
  const items = Array.isArray(data) ? data : []
  if (items.length === 0) return []

  showPanelTip(`正在保存 ${items.length} 篇公众号文章...`, fromTabId)

  const urlMap = new Map<string, { item: WechatArticle; idx: number }>()
  items.forEach((item, idx) => {
    const url = item?.url || ''
    if (url) urlMap.set(url, { item, idx })
  })

  const urls = Array.from(urlMap.keys())
  if (urls.length === 0) {
    return items.map(() => ({ ok: false, error: '缺少 URL' }))
  }

  const existingMap = new Map<string, string>()
  const totalBatches = Math.ceil(urls.length / 10)
  for (let i = 0; i < urls.length; i += 10) {
    const batchNum = Math.floor(i / 10) + 1
    showPanelTip(`正在检查是否已存在 (${batchNum}/${totalBatches})...`, fromTabId)
    const batch = urls.slice(i, i + 10)
    const actualFieldName = api.fieldNameMap['URL'] || 'URL'
    const orFilters = batch.map((url) => ({ property: actualFieldName, url: { equals: url } }))
    try {
      const result = await api.queryDatabase({ or: orFilters })
      ;(result?.results || []).forEach((page: any) => {
        const urlProp = page.properties?.[actualFieldName]
        const url = urlProp?.url
        if (url) existingMap.set(url, page.id)
      })
    } catch (e) {
      console.warn('[Notion] 批量查询失败:', e)
    }
  }

  const results: SaveResult[] = new Array(items.length)
  const toCreate: Array<{ item: WechatArticle; idx: number; url: string }> = []
  const toUpdate: Array<{ item: WechatArticle; idx: number; pageId: string }> = []
  urlMap.forEach(({ item, idx }, url) => {
    const pageId = existingMap.get(url)
    if (pageId) {
      toUpdate.push({ item, idx, pageId })
    } else {
      toCreate.push({ item, idx, url })
    }
  })

  // 已存在则更新
  for (let i = 0; i < toUpdate.length; i += 3) {
    const done = Math.min(i + 3, toUpdate.length)
    showPanelTip(`正在更新第 ${done}/${toUpdate.length} 篇...`, fromTabId)
    const batch = toUpdate.slice(i, i + 3)
    await Promise.all(
      batch.map(async ({ item, idx, pageId }) => {
        try {
          const props = await toNotionProperties(item, schema, api.fieldNameMap, api, true)
          await api.updatePage(pageId, props)
          const markdown = convertRichTextToMarkdown(item)
          if (markdown) {
            // TODO: Notion Markdown API 的更新功能需要特殊的 endpoint
            // 暂时仍使用 replacePageContent（blocks 方式）
            await replacePageContent(api, pageId, markdownToBlocks(markdown))
          }
          results[idx] = { ok: true, action: 'update', pageId }
        } catch (e: any) {
          if (isMissingPropertyError(e)) throw e
          results[idx] = { ok: false, error: parseNotionError(e) }
        }
      })
    )
    if (i + 3 < toUpdate.length) {
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  // 不存在则新建
  for (let i = 0; i < toCreate.length; i += 3) {
    const done = Math.min(i + 3, toCreate.length)
    showPanelTip(`正在新建第 ${done}/${toCreate.length} 篇...`, fromTabId)
    const batch = toCreate.slice(i, i + 3)
    await Promise.all(
      batch.map(async ({ item, idx }) => {
        try {
          const props = await toNotionProperties(item, schema, api.fieldNameMap, api, false)
          const markdown = convertRichTextToMarkdown(item)
          const result = await api.createPage(props, null, markdown || undefined)
          results[idx] = { ok: true, action: 'create', pageId: result?.id }
        } catch (e: any) {
          if (isMissingPropertyError(e)) throw e
          results[idx] = { ok: false, error: parseNotionError(e) }
        }
      })
    )
    if (i + 3 < toCreate.length) {
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  return results.length === 1 ? results[0] : results
}

async function saveFeishuDocsToNotion(
  data: FeishuDoc[],
  schema: any,
  api: NotionAPI,
  _dbId: string,
  _type: string,
  fromTabId?: number
): Promise<SaveResult | SaveResult[]> {
  const items = Array.isArray(data) ? data : []
  if (items.length === 0) return []

  showPanelTip(`正在保存 ${items.length} 篇飞书文档...`, fromTabId)

  const results: SaveResult[] = new Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const url = item?.url?.trim()
    if (!url) {
      results[i] = { ok: false, error: '缺少文档 URL' }
      continue
    }

    try {
      showPanelTip(`正在处理第 ${i + 1}/${items.length} 篇飞书文档...`, fromTabId)
      const existing = await api.findByUniqueField(schema, 'URL', url)
      const props = await toNotionProperties(item, schema, api.fieldNameMap, api, !!existing)
      const markdown = convertRichTextToMarkdown(item)

      if (existing) {
        await api.updatePage(existing.id, props)
        if (markdown) {
          await replacePageContent(api, existing.id, markdownToBlocks(markdown))
        }
        results[i] = { ok: true, action: 'update', pageId: existing.id }
      } else {
        const result = await api.createPage(props, null, markdown || undefined)
        results[i] = { ok: true, action: 'create', pageId: result?.id }
      }
    } catch (e: any) {
      if (isMissingPropertyError(e)) throw e
      results[i] = { ok: false, error: parseNotionError(e) }
    }
  }

  return results.length === 1 ? results[0] : results
}

// ==================== 账号主页存储（单条账号信息，带重试） ====================
async function saveXhsAccountToNotion(
  data: XiaohongshuAccount,
  schema: any,
  api: NotionAPI,
  dbId: string,
  type: string,
  fromTabId?: number
): Promise<SaveResult> {
  showPanelTip('正在连接 Notion 并保存账号信息...', fromTabId)

  const userId = data?.userId
  if (!userId) return { ok: false, error: '缺少账号 ID' }

  let lastErr: any
  for (let retry = 0; retry < 2; retry++) {
    try {
      if (retry > 0) {
        await browser.storage.local.remove([initFlagKey(dbId, type), fieldMapKey(dbId, type)])
        api.schemaCache = null
        const fieldMap = await getFieldMap(dbId, type)
        await api.ensureSchema(schema, async (m) => {
          await saveFieldMap(dbId, type, m)
        })
        await markInitialized(dbId, type)
      }

      showPanelTip('正在查询是否已存在该账号...', fromTabId)
      const existing = await api.findByUniqueField(schema, '账号ID', userId)
      const props = await toNotionProperties(data, schema, api.fieldNameMap, api, !!existing)

      // 转换 noteListText 为 blocks
      const children = data.noteListText ? convertNoteListToBlocks(data.noteListText) : null

      if (existing) {
        showPanelTip('正在更新已有账号信息...', fromTabId)
        await api.updatePage(existing.id, props)
        // 更新页面内容（笔记列表）
        if (children && children.length > 0) {
          try {
            showPanelTip('正在写入笔记列表...', fromTabId)
            await replacePageContent(api, existing.id, children)
            console.log('[Notion] 账号笔记列表已更新')
          } catch (e) {
            console.warn('[Notion] 更新笔记列表失败:', e)
          }
        }
        return { ok: true, action: 'update', pageId: existing.id }
      } else {
        showPanelTip('正在创建新账号页面...', fromTabId)
        const result = await api.createPage(props, children)
        return { ok: true, action: 'create', pageId: result?.id }
      }
    } catch (e: any) {
      lastErr = e
      const msg = e?.message || String(e)
      if (retry === 0 && (msg.includes('validation_error') || msg.includes('is not a property that exists'))) continue
      break
    }
  }
  const errMsg = parseNotionError(lastErr)
  console.error('[Notion]', lastErr)
  return { ok: false, error: errMsg }
}

// ==================== 辅助函数：转换公众号正文为 blocks/markdown（保存到文档正文） ====================
const NOTION_TEXT_MAX = 2000

/**
 * 获取公众号文章的 Markdown 内容
 * 优先使用已转换的 contentMarkdown，其次使用纯文本 content
 */
function convertRichTextToMarkdown(data: { contentMarkdown?: string; content?: string } | undefined): string {
  console.log('[Notion] convertRichTextToMarkdown 被调用')

  if (!data) {
    console.log('[Notion] data 不存在')
    return ''
  }

  console.log('[Notion] data.contentMarkdown 存在:', !!data.contentMarkdown)
  console.log('[Notion] data.contentMarkdown 长度:', data.contentMarkdown?.length || 0)
  console.log('[Notion] data.content 存在:', !!data.content)
  console.log('[Notion] data.content 长度:', data.content?.length || 0)

  // 优先使用已转换的 Markdown（在 content script 中转换）
  if (data.contentMarkdown && typeof data.contentMarkdown === 'string') {
    const markdown = data.contentMarkdown.trim()
    if (markdown) {
      console.log('[Notion] 使用 contentMarkdown，长度:', markdown.length)
      console.log('[Notion] Markdown 预览（前1000字符）:', markdown.substring(0, 1000))
      return markdown
    }
  }

  // 回退到纯文本
  const content = data.content
  if (content && typeof content === 'string') {
    console.log('[Notion] 使用纯文本 content，长度:', content.length)
    return content.trim()
  }

  console.log('[Notion] 没有可用的内容')
  return ''
}

/**
 * 将 Markdown 转换为 Notion blocks（用于更新页面内容或回退时使用）
 * 简单实现：处理段落、标题、列表
 */
function markdownToBlocks(markdown: string): any[] {
  if (!markdown || typeof markdown !== 'string') return []
  const trimmed = markdown.trim()
  if (!trimmed) return []

  const blocks: any[] = []
  const lines = trimmed.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    // 跳过空行
    if (!line) {
      i++
      continue
    }

    // 标题
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.substring(2).slice(0, NOTION_TEXT_MAX) } }]
        }
      })
      i++
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.substring(3).slice(0, NOTION_TEXT_MAX) } }]
        }
      })
      i++
      continue
    }
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.substring(4).slice(0, NOTION_TEXT_MAX) } }]
        }
      })
      i++
      continue
    }

    // 无序列表
    if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.substring(2).slice(0, NOTION_TEXT_MAX) } }]
        }
      })
      i++
      continue
    }

    // 有序列表
    const orderedListMatch = line.match(/^(\d+)\.\s+(.*)/)
    if (orderedListMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: orderedListMatch[2].slice(0, NOTION_TEXT_MAX) } }]
        }
      })
      i++
      continue
    }

    // 代码块
    if (line.startsWith('```')) {
      let codeContent = ''
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeContent += lines[i] + '\n'
        i++
      }
      if (codeContent) {
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: codeContent.slice(0, NOTION_TEXT_MAX) } }],
            language: 'plain text'
          }
        })
      }
      i++ // 跳过结束的 ```
      continue
    }

    // 普通段落（可能很长，需要切分）
    for (let j = 0; j < line.length; j += NOTION_TEXT_MAX) {
      const chunk = line.slice(j, j + NOTION_TEXT_MAX)
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      })
    }
    i++
  }

  return blocks
}

// ==================== 辅助函数：转换 noteList 为 blocks ====================
function convertNoteListToBlocks(noteListText: string) {
  if (!noteListText || noteListText === '暂无笔记') {
    return []
  }

  const blocks: any[] = []

  // 添加标题
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '笔记列表' } }]
    }
  })

  // 将笔记列表文本按行分割
  const lines = noteListText.split('\n').filter(line => line.trim())

  // 每行转换为一个 paragraph
  lines.forEach(line => {
    const richText = parseMarkdownLine(line.trim())
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText }
    })
  })

  console.log(`[Notion] 转换笔记列表为 ${blocks.length} 个 blocks`)
  return blocks
}

// ==================== 辅助函数：转换搜索结果为 blocks ====================
function convertXhsSearchResultsToBlocks(
  items: XiaohongshuNote[],
  keyword: string
) {
  if (!Array.isArray(items) || items.length === 0) {
    return []
  }

  const blocks: any[] = []

  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: {
          content: `格式：#序号|标题(含链接)|赞|昵称|发布时间；关键词=${keyword || '-'}；数量=${items.length}`
            .slice(0, NOTION_TEXT_MAX)
        }
      }]
    }
  })

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    const no = `#${idx + 1}`
    const title = ((item.title || '').trim() || '未知').slice(0, 100)
    const likes = String(item.likes ?? 0)
    const publishTime = (item.publishTimeStr || '-').trim() || '-'
    const author = (item.authorNickname || '-').trim() || '-'
    const noteUrl = item.url || (item.noteId ? `https://www.xiaohongshu.com/explore/${item.noteId}` : '')

    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: `${no}|` } },
          ...(noteUrl
            ? [{ type: 'text', text: { content: title, link: { url: noteUrl } } }]
            : [{ type: 'text', text: { content: title } }]),
          { type: 'text', text: { content: `|${likes}|${author}|${publishTime}` } }
        ]
      }
    })
  }

  console.log(`[Notion] 转换搜索结果为 ${blocks.length} 个 blocks`)
  return blocks
}

// ==================== 辅助函数：转换 commentList 为 blocks ====================
function convertCommentListToBlocks(commentList: any[]) {
  if (!commentList || commentList.length === 0) {
    return []
  }

  const blocks: any[] = []

  // 添加标题
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '评论列表' } }]
    }
  })

  // 统计信息
  const totalComments = commentList.length
  const totalReplies = commentList.reduce((sum, c) => sum + (c.replies?.length || 0), 0)
  const stats = `共 ${totalComments} 条评论，${totalReplies} 条回复\n`

  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: stats } }]
    }
  })

  // 转换每条评论（与 JS 一致：使用 comment、published_at）
  commentList.forEach(comment => {
    const commentText = `#${comment.no} 💬 ${comment.comment} | ⏰ ${comment.published_at} | ❤️ ${comment.likes}`
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: commentText } }]
      }
    })

    // 添加回复
    if (comment.replies && comment.replies.length > 0) {
      comment.replies.forEach((reply: any) => {
        const replyText = `  ↳ R${reply.no} ${reply.comment} | ⏰ ${reply.published_at} | ❤️ ${reply.likes}`
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: replyText } }]
          }
        })
      })
    }
  })

  console.log(`[Notion] 转换评论列表为 ${blocks.length} 个 blocks`)
  return blocks
}

function parseMarkdownLine(line: string) {
  const richText: any[] = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(line)) !== null) {
    // 添加链接前的文本
    if (match.index > lastIndex) {
      const textBefore = line.substring(lastIndex, match.index)
      if (textBefore) {
        richText.push({ type: 'text', text: { content: textBefore } })
      }
    }

    // 添加链接
    richText.push({
      type: 'text',
      text: { content: match[1] },
      href: match[2]
    })

    lastIndex = match.index + match[0].length
  }

  // 添加剩余的文本
  if (lastIndex < line.length) {
    const textAfter = line.substring(lastIndex)
    if (textAfter) {
      richText.push({ type: 'text', text: { content: textAfter } })
    }
  }

  // 如果没有匹配到任何内容，返回整行
  if (richText.length === 0) {
    richText.push({ type: 'text', text: { content: line } })
  }

  return richText
}

async function replacePageContent(api: NotionAPI, pageId: string, children: any[]) {
  // 1. 获取现有的 blocks
  const response = await api.request('GET', `/blocks/${pageId}/children?page_size=100`)
  const existingBlocks = response?.results || []

  // 2. 删除所有现有 blocks
  for (const block of existingBlocks) {
    try {
      await api.request('DELETE', `/blocks/${block.id}`)
    } catch (e) {
      console.warn('[Notion] 删除 block 失败:', e)
    }
  }

  // 3. 添加新 blocks（分批，每次 100 个）
  for (let i = 0; i < children.length; i += 100) {
    const batch = children.slice(i, i + 100)
    await api.request('PATCH', `/blocks/${pageId}/children`, { children: batch })
  }
}

/**
 * Notion 存储适配器
 */
export const notionStore: StoreAdapter = {
  async save(
    type: string,
    data: any,
    store: StoreConfig,
    fromTabId?: number
  ): Promise<SaveResult | SaveResult[]> {
    // 1. 验证配置
    const token = store?.token?.trim()
    const databaseId = parseNotionDatabaseId(store?.databaseId)

    if (!token || !databaseId) {
      return { ok: false, error: '请先配置 Notion：填写 Token 和 Database ID' }
    }

    if (databaseId.length !== 32) {
      return { ok: false, error: 'Database ID 格式不正确（应为 32 位字符）' }
    }

    // 2. 获取 schema
    const schema = getSchemaByType(type)
    if (!schema) {
      return { ok: false, error: `Notion 适配器不支持数据类型: ${type}` }
    }

    // 3. 初始化 API
    const dbId = databaseId
    let fieldMap = await getFieldMap(dbId, type)
    const api = new NotionAPI(token, dbId, { ...fieldMap })

    // 首次或 fieldMap 为空时执行 ensureSchema
    const initialized = await isInitialized(dbId, type)
    if (!initialized || Object.keys(fieldMap).length === 0) {
      showPanelTip('正在检查/初始化数据库字段...', fromTabId)
      await api.ensureSchema(schema, async (m) => {
        fieldMap = m
        await saveFieldMap(dbId, type, m)
      })
      await markInitialized(dbId, type)
      api.fieldNameMap = fieldMap
    }

    // 4. 执行保存，若因缺少字段报错则同步 schema 后重试一次
    const doSave = async () => {
      if (type === CollectionType.XHSNoteDetail) {
        return await saveXhsNoteToNotion(data as XiaohongshuNote, schema, api, dbId, type, fromTabId)
      }
      if (type === CollectionType.XHSAccount) {
        return await saveXhsAccountToNotion(data as XiaohongshuAccount, schema, api, dbId, type, fromTabId)
      }
      if (type === CollectionType.XHSFeed) {
        return await saveXhsFeedToNotion(data as XiaohongshuNote[], schema, api, fromTabId)
      }
      if (type === CollectionType.WechatArticle) {
        const items = Array.isArray(data) ? (data as WechatArticle[]) : [data as WechatArticle]
        return await saveWechatArticlesToNotion(items, schema, api, dbId, type, fromTabId)
      }
      if (type === CollectionType.FeishuDoc) {
        const items = Array.isArray(data) ? (data as FeishuDoc[]) : [data as FeishuDoc]
        return await saveFeishuDocsToNotion(items, schema, api, dbId, type, fromTabId)
      }
      return { ok: false, error: '未实现的数据类型' }
    }

    try {
      return await doSave()
    } catch (e: any) {
      if (isMissingPropertyError(e)) {
        showPanelTip('检测到缺少字段，正在同步数据库...', fromTabId)
        api.schemaCache = null
        await api.ensureSchema(schema, async (m) => {
          await saveFieldMap(dbId, type, m)
        })
        api.fieldNameMap = await getFieldMap(dbId, type)
        return await doSave()
      }
      throw e
    }
  }
}
