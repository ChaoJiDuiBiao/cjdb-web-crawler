import type { StoreAdapter, StoreConfig, SaveResult, CollectionType, XiaohongshuNote, XiaohongshuAccount } from '@/types'
import { showPanelTip } from '@/utils/tips'

// FeishuStore 运行在 background context，直接使用原生 fetch（无 CORS 限制）
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

// ─── token 缓存（tenant_access_token 有效期 2 小时） ───
let _tokenCache: { token: string; expiresAt: number } | null = null

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const now = Date.now()
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) {
    return _tokenCache.token
  }

  const resp = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  })
  const data = await resp.json()
  if (data.code !== 0) {
    throw new Error(`飞书 Auth 失败: ${data.msg || JSON.stringify(data)}`)
  }

  // expire 单位为秒（通常 7200s），保留 30s 余量
  const expiresAt = now + (data.expire ?? 7200) * 1000 - 30_000
  _tokenCache = { token: data.tenant_access_token, expiresAt }
  return _tokenCache.token
}

// ─── wiki URL 解析 ───
// 支持格式：https://{host}/wiki/{wikiToken}?table={tableId}&view={viewId}
function parseWikiUrl(wikiUrl: string): { wikiToken: string; tableId: string } {
  let url: URL
  try {
    url = new URL(wikiUrl)
  } catch {
    throw new Error(`飞书 Wiki 链接格式错误: ${wikiUrl}`)
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  // pathname 形如 "wiki/UbbfwaFjCire2bkXNEsczqvEncd"
  const wikiIdx = parts.indexOf('wiki')
  if (wikiIdx === -1 || !parts[wikiIdx + 1]) {
    throw new Error(`无法从链接中提取 Wiki Token: ${wikiUrl}`)
  }
  const wikiToken = parts[wikiIdx + 1]
  const tableId = url.searchParams.get('table') || ''

  return { wikiToken, tableId }
}

// wiki token → bitable app_token（obj_token）
async function getAppTokenFromWiki(accessToken: string, wikiToken: string): Promise<string> {
  const resp = await fetch(
    `${FEISHU_API_BASE}/wiki/v2/spaces/get_node?token=${wikiToken}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await resp.json()
  if (data.code !== 0) {
    throw new Error(`飞书 Wiki 节点解析失败: ${data.msg || JSON.stringify(data)}`)
  }

  const node = data.data?.node
  if (!node || node.obj_type !== 'bitable') {
    throw new Error(`飞书 Wiki 页面不是多维表格（当前类型: ${node?.obj_type}）`)
  }

  return node.obj_token as string
}

// ─── 解析配置（兼容旧逻辑）：从 wikiUrl 解析出 appToken + 默认 tableId ───
const resolvedCache = new Map<string, { appToken: string; tableId: string }>()

async function resolveConfig(store: StoreConfig): Promise<{ appToken: string; tableId: string }> {
  // 优先使用直接配置的 appToken + tableId
  if (store.appToken && store.tableId) {
    return { appToken: store.appToken, tableId: store.tableId }
  }

  if (!store.wikiUrl) {
    throw new Error('飞书配置缺少多维表格链接（wikiUrl）')
  }

  // 缓存：同一 wikiUrl 只解析一次（session 内）
  const cacheKey = store.wikiUrl
  if (resolvedCache.has(cacheKey)) {
    return resolvedCache.get(cacheKey)!
  }

  const { wikiToken, tableId } = parseWikiUrl(store.wikiUrl)
  if (!tableId) {
    throw new Error(`飞书 Wiki 链接缺少目标数据表参数（请在飞书中切换到目标数据表后重新复制链接，链接中应包含 ?table=xxx）`)
  }
  const accessToken = await getTenantAccessToken(store.appId!, store.appSecret!)
  const appToken = await getAppTokenFromWiki(accessToken, wikiToken)

  const result = { appToken, tableId }
  resolvedCache.set(cacheKey, result)
  return result
}

// ─── 附件上传常量 ───
const FEISHU_FILE_MAX_SIZE = 20 * 1024 * 1024  // 20 MB
const IMAGE_FETCH_TIMEOUT_MS = 20_000
const DEFAULT_IMAGE_UPLOAD_CONCURRENCY = 4
const DEFAULT_IMAGE_UPLOAD_RETRY = 1

// ─── 附件上传辅助 ───

// 将逗号分隔字符串或数组转为去重 URL 数组
function normalizeFileUrls(value: unknown): string[] {
  const out: string[] = []
  const append = (v: unknown) => {
    if (typeof v !== 'string') return
    for (const p of v.split(',').map((s) => s.trim()).filter(Boolean)) out.push(p)
  }
  if (Array.isArray(value)) value.forEach(append)
  else append(value)
  return Array.from(new Set(out))
}

// 从 content-type 推断扩展名
function extFromContentType(ct: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('gif'))  return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('heic')) return 'heic'
  return 'jpg'
}

// 从 URL 推断文件名，格式 image-1.jpg
function inferFilenameFromUrl(url: string, index: number, contentType = ''): string {
  const fallback = `image-${index + 1}.${extFromContentType(contentType)}`
  try {
    const u = new URL(url)
    const raw = decodeURIComponent(u.pathname.split('/').pop() || '')
    if (!raw) return fallback
    // 去掉非安全字符
    const safe = raw.replace(/[^\w.\-]/g, '_').replace(/_{2,}/g, '_')
    if (/\.\w{2,5}$/.test(safe)) return safe
    return `${safe}.${extFromContentType(contentType)}`
  } catch {
    return fallback
  }
}

// 下载图片为 Blob（与 NotionStore 逻辑相同：优先 force-cache，超时 20s）
async function downloadImageBlob(url: string): Promise<{ blob: Blob; contentType: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)

  const fetchWith = async (cacheMode: RequestCache) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'image/*,*/*;q=0.8' },
      referrer: 'https://www.xiaohongshu.com/',
      referrerPolicy: 'strict-origin-when-cross-origin',
      cache: cacheMode,
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const blob = await response.blob()
    if (!blob || blob.size <= 0) throw new Error('下载为空文件')
    const contentType = response.headers.get('content-type') || blob.type || 'image/jpeg'
    return { blob, contentType }
  }

  try {
    try {
      return await fetchWith('force-cache')
    } catch (e: any) {
      if (controller.signal.aborted) throw e
      return await fetchWith('default')
    }
  } finally {
    clearTimeout(timer)
  }
}

// 并发控制：限制同时执行的任务数
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Array.isArray(items) || items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency || 1, items.length))
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// 上传单张图片到飞书云文档，返回 file_token
async function uploadImageToFeishu(
  accessToken: string,
  appToken: string,
  blob: Blob,
  filename: string
): Promise<string> {
  const form = new FormData()
  form.append('file_name', filename)
  form.append('parent_type', 'bitable_file')
  form.append('parent_node', appToken)
  form.append('size', String(blob.size))
  form.append('file', blob, filename)

  const resp = await fetch(`${FEISHU_API_BASE}/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  })
  const data = await resp.json()
  if (data.code !== 0) {
    throw new Error(`飞书文件上传失败(code=${data.code}): ${data.msg || JSON.stringify(data)}`)
  }
  const token = data.data?.file_token as string | undefined
  if (!token) throw new Error('飞书文件上传响应缺少 file_token')
  return token
}

// 批量下载并上传图片，返回成功的 file_token[]（失败的跳过，不降级）
async function uploadImagesByUrlToFeishu(
  accessToken: string,
  appToken: string,
  urls: string[],
  opts?: {
    concurrency?: number
    retry?: number
    fromTabId?: number
    progressLabel?: string
  }
): Promise<string[]> {
  if (urls.length === 0) return []
  const retry = Math.max(0, opts?.retry ?? DEFAULT_IMAGE_UPLOAD_RETRY)
  let completed = 0

  const results = await runWithConcurrency(
    urls,
    opts?.concurrency ?? DEFAULT_IMAGE_UPLOAD_CONCURRENCY,
    async (url, index) => {
      let lastError: any = null
      for (let attempt = 0; attempt <= retry; attempt++) {
        try {
          const { blob, contentType } = await downloadImageBlob(url)
          if (blob.size > FEISHU_FILE_MAX_SIZE) {
            throw new Error(`图片超过 20MB，当前 ${(blob.size / 1024 / 1024).toFixed(2)}MB`)
          }
          const filename = inferFilenameFromUrl(url, index, contentType)
          const token = await uploadImageToFeishu(accessToken, appToken, blob, filename)
          completed++
          if (opts?.progressLabel) {
            showPanelTip(`飞书：正在上传${opts.progressLabel} ${completed}/${urls.length}...`, opts.fromTabId)
          }
          return token
        } catch (e: any) {
          lastError = e
          if (attempt < retry) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        }
      }
      completed++
      if (opts?.progressLabel) {
        showPanelTip(`飞书：正在上传${opts.progressLabel} ${completed}/${urls.length}...`, opts.fromTabId)
      }
      console.warn('[FeishuStore] 图片上传失败，跳过:', url, lastError?.message || lastError)
      return null
    }
  )

  return results.filter((t): t is string => t !== null)
}

// 处理 rawFields 中所有附件字段：下载 + 上传，返回 fieldName → file_token[] 映射
async function resolveAttachments(
  accessToken: string,
  appToken: string,
  rawFields: Record<string, any>,
  schema: Record<string, number>,
  downloadImages: boolean,
  fromTabId?: number
): Promise<Record<string, string[]>> {
  const attachmentMap: Record<string, string[]> = {}

  for (const [fieldName, value] of Object.entries(rawFields)) {
    if (schema[fieldName] !== FIELD_TYPE.ATTACHMENT) continue
    if (!downloadImages) {
      attachmentMap[fieldName] = []
      continue
    }
    const urls = normalizeFileUrls(value)
    if (urls.length === 0) {
      attachmentMap[fieldName] = []
      continue
    }
    console.log(`[FeishuStore] 上传附件字段 "${fieldName}"，共 ${urls.length} 张`)
    attachmentMap[fieldName] = await uploadImagesByUrlToFeishu(accessToken, appToken, urls, {
      fromTabId,
      progressLabel: `「${fieldName}」附件`
    })
  }

  return attachmentMap
}

// ─── 飞书多维表格 API ───
async function getTableFields(
  accessToken: string,
  appToken: string,
  tableId: string
): Promise<Array<{ field_id: string; field_name: string; type: number }>> {
  const resp = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await resp.json()
  if (data.code !== 0) {
    throw new Error(`获取飞书表格字段失败(code=${data.code}): ${data.msg || JSON.stringify(data)}`)
  }
  return data.data?.items ?? []
}

// 字段类型常量（飞书多维表格 field type）
const FIELD_TYPE = {
  TEXT: 1,        // 多行文本
  NUMBER: 2,      // 数字
  SELECT: 3,      // 单选
  MULTI_SELECT: 4, // 多选
  DATE: 5,        // 日期
  CHECKBOX: 7,    // 复选框
  URL: 15,        // 超链接
  ATTACHMENT: 17  // 附件
} as const

// 每个字段名对应的飞书字段类型（用于自动建列）
// 注意：飞书每个表格都有一个不可删除的"标题"列（type=1），无需创建
const NOTE_FIELD_SCHEMA: Record<string, number> = {
  '标题': FIELD_TYPE.TEXT,
  'URL': FIELD_TYPE.URL,
  '正文': FIELD_TYPE.TEXT,
  '发布时间': FIELD_TYPE.DATE,
  '发布时间文字': FIELD_TYPE.TEXT,
  '发布地点': FIELD_TYPE.TEXT,
  '点赞量': FIELD_TYPE.NUMBER,
  '收藏量': FIELD_TYPE.NUMBER,
  '评论量': FIELD_TYPE.NUMBER,
  '分享量': FIELD_TYPE.NUMBER,
  '作者ID': FIELD_TYPE.TEXT,
  '作者昵称': FIELD_TYPE.TEXT,
  '作者粉丝量': FIELD_TYPE.NUMBER,
  '作者获赞量': FIELD_TYPE.NUMBER,
  '封面': FIELD_TYPE.ATTACHMENT,
  '图片': FIELD_TYPE.ATTACHMENT,
  '视频': FIELD_TYPE.ATTACHMENT,
  '标签': FIELD_TYPE.MULTI_SELECT,
  '搜索关键词': FIELD_TYPE.SELECT,
  '搜索排名': FIELD_TYPE.NUMBER,
  '采集时间': FIELD_TYPE.TEXT,
  '评论列表': FIELD_TYPE.TEXT,
}

const ACCOUNT_FIELD_SCHEMA: Record<string, number> = {
  '昵称': FIELD_TYPE.TEXT,
  '账号ID': FIELD_TYPE.TEXT,
  '主页URL': FIELD_TYPE.URL,
  '账号简介': FIELD_TYPE.TEXT,
  '归属地': FIELD_TYPE.TEXT,
  '粉丝数': FIELD_TYPE.NUMBER,
  '关注数': FIELD_TYPE.NUMBER,
  '获赞数': FIELD_TYPE.NUMBER,
  '笔记数': FIELD_TYPE.NUMBER,
  '采集时间': FIELD_TYPE.TEXT,
  '笔记列表': FIELD_TYPE.TEXT,
  '头像': FIELD_TYPE.ATTACHMENT,
}

// 创建单个字段
async function createTableField(
  accessToken: string,
  appToken: string,
  tableId: string,
  fieldName: string,
  fieldType: number,
  selectOptionNames?: string[]
): Promise<void> {
  const body: Record<string, unknown> = { field_name: fieldName, type: fieldType }
  if (fieldType === FIELD_TYPE.SELECT) {
    const raw = (selectOptionNames ?? [])
      .map((n) => String(n ?? '').trim().slice(0, 100))
      .filter(Boolean)
    const seen = new Set<string>()
    const options: { name: string }[] = []
    for (const name of raw) {
      if (seen.has(name)) continue
      seen.add(name)
      options.push({ name })
    }
    body.property = { options }
  }

  const resp = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  )
  const data = await resp.json()
  if (data.code !== 0) {
    // 1254040：字段已存在，忽略
    if (data.code === 1254040) return
    // 91403：app 缺少表结构编辑权限，跳过并警告（后续写入已有列）
    if (data.code === 91403) {
      console.warn(`[FeishuStore] 无权创建字段 "${fieldName}"，将跳过（请在飞书手动建列，或在开发者后台开启"编辑多维表格"权限）`)
      return
    }
    throw new Error(`创建字段 "${fieldName}" 失败(code=${data.code}): ${data.msg || JSON.stringify(data)}`)
  }
}

// 确保表格中存在所需字段，缺失的自动创建
async function ensureFields(
  accessToken: string,
  appToken: string,
  tableId: string,
  rawFields: Record<string, any>,
  schema: Record<string, number>,
  fromTabId?: number,
  /** 新建「单选」列时预置的选项文案（如搜索结果写入前的关键词列表） */
  selectSeedByField?: Record<string, string[]>
): Promise<Array<{ field_id: string; field_name: string; type: number }>> {
  const cacheKey = `${appToken}:${tableId}`
  showPanelTip('飞书：正在检查表格字段...', fromTabId)
  let tableFields = await getCachedTableFields(accessToken, appToken, tableId)
  const existingNames = new Set(tableFields.map((f) => f.field_name))

  const missing = Object.keys(rawFields).filter(
    // '标题' 是飞书每张表的内置主键列，已自动存在，不通过 API 创建（会 91403）
    (name) => name !== '标题' && !existingNames.has(name) && schema[name] !== undefined
  )

  if (missing.length > 0) {
    console.log(`[FeishuStore] 自动创建缺失字段: ${missing.join(', ')}`)
    for (let i = 0; i < missing.length; i++) {
      const name = missing[i]
      showPanelTip(`飞书：正在创建字段「${name}」(${i + 1}/${missing.length})...`, fromTabId)
      const seeds = schema[name] === FIELD_TYPE.SELECT ? selectSeedByField?.[name] : undefined
      await createTableField(accessToken, appToken, tableId, name, schema[name], seeds)
    }
    // 刷新字段缓存
    fieldCache.delete(cacheKey)
    tableFields = await getCachedTableFields(accessToken, appToken, tableId)
  }

  return tableFields
}

// 根据字段类型构建写入值
function buildFieldValue(fieldType: number, value: any): any {
  if (value === undefined || value === null || value === '') return undefined

  switch (fieldType) {
    case FIELD_TYPE.TEXT:
      return String(value)
    case FIELD_TYPE.NUMBER:
      return typeof value === 'number' ? value : Number(value) || 0
    case FIELD_TYPE.URL:
      return { text: String(value), link: String(value) }
    case FIELD_TYPE.DATE:
      // 支持时间戳（ms）和字符串
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const ts = Date.parse(value)
        return isNaN(ts) ? undefined : ts
      }
      return undefined
    case FIELD_TYPE.SELECT:
      return String(value)
    case FIELD_TYPE.MULTI_SELECT:
      return Array.isArray(value) ? value.map((v: any) => String(v)) : [String(value)]
    case FIELD_TYPE.CHECKBOX:
      return Boolean(value)
    case FIELD_TYPE.ATTACHMENT:
      // ATTACHMENT 字段的值由 resolveAttachments 预处理为 file_token[]，此处直接格式化
      if (!Array.isArray(value) || value.length === 0) return undefined
      return (value as string[]).map((token) => ({ file_token: token }))
    default:
      // 未知类型：尝试纯文本
      return String(value)
  }
}

// 批量写入记录
async function batchCreateRecords(
  accessToken: string,
  appToken: string,
  tableId: string,
  records: Array<Record<string, any>>
): Promise<any> {
  const payload = {
    records: records.map((fields) => ({ fields }))
  }
  const resp = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  )
  const data = await resp.json()
  if (data.code !== 0) {
    throw new Error(`飞书写入失败(code=${data.code}): ${data.msg || JSON.stringify(data)}`)
  }
  return data
}

// ─── 数据映射：XHS Note → 飞书字段 ───
// key 为中文字段名（与多维表格列名对应），value 为原始值
function noteToRawFields(note: XiaohongshuNote): Record<string, any> {
  const fields: Record<string, any> = {}

  if (note.title)            fields['标题'] = note.title
  if (note.url)              fields['URL'] = note.url
  if (note.content)          fields['正文'] = note.content
  if (note.publishTime)      fields['发布时间'] = note.publishTime   // ms 时间戳
  if (note.publishTimeStr)   fields['发布时间文字'] = note.publishTimeStr
  if (note.location)         fields['发布地点'] = note.location
  if (note.likes != null)    fields['点赞量'] = note.likes
  if (note.favorites != null) fields['收藏量'] = note.favorites
  if (note.comments != null) fields['评论量'] = note.comments
  if (note.shares != null)   fields['分享量'] = note.shares
  if (note.authorUserId)     fields['作者ID'] = note.authorUserId
  if (note.authorNickname)   fields['作者昵称'] = note.authorNickname
  if (note.authorFansCount != null) fields['作者粉丝量'] = note.authorFansCount
  if (note.authorLikes != null) fields['作者获赞量'] = note.authorLikes
  if (note.coverUrl)          fields['封面'] = note.coverUrl
  if (note.imageUrls)         fields['图片'] = note.imageUrls
  if (note.videoUrl)          fields['视频'] = note.videoUrl
  if (note.tags?.length)     fields['标签'] = note.tags
  if (note.searchKeyword)    fields['搜索关键词'] = note.searchKeyword
  if (note.rank != null)     fields['搜索排名'] = note.rank
  if (note.crawledAt)        fields['采集时间'] = note.crawledAt

  // 评论列表转文本
  if (note.commentList?.length) {
    const commentText = note.commentList
      .filter((c) => c.checked !== false)
      .map((c) => `#${c.no} ${c.comment}`)
      .join('\n')
    if (commentText) fields['评论列表'] = commentText
  }

  return fields
}

// XHS Account → 飞书字段
function accountToRawFields(account: XiaohongshuAccount): Record<string, any> {
  const fields: Record<string, any> = {}

  if (account.nickname)         fields['昵称'] = account.nickname
  if (account.userId)           fields['账号ID'] = account.userId
  if (account.url)              fields['主页URL'] = account.url
  if (account.description)      fields['账号简介'] = account.description
  if (account.location)         fields['归属地'] = account.location
  if (account.fansCount != null)    fields['粉丝数'] = account.fansCount
  if (account.followingCount != null) fields['关注数'] = account.followingCount
  if (account.likedCount != null)   fields['获赞数'] = account.likedCount
  if (account.notesCount != null)   fields['笔记数'] = account.notesCount
  if (account.crawledAt)        fields['采集时间'] = account.crawledAt

  // 笔记列表：用换行符分割的纯文本，存入单个字段
  if (account.noteListText)     fields['笔记列表'] = account.noteListText

  // 头像：URL 字符串，后续由 resolveAttachments 上传为附件
  if (account.avatarUrl)        fields['头像'] = account.avatarUrl

  return fields
}

// ─── 核心：将原始字段映射到飞书字段格式 ───
// tableFields: 从 API 获取的字段列表，用于匹配类型
// attachmentMap: 已预先上传完毕的附件字段 → file_token[] 映射
function buildFeishuRecord(
  rawFields: Record<string, any>,
  tableFields: Array<{ field_id: string; field_name: string; type: number }>,
  attachmentMap: Record<string, string[]> = {}
): Record<string, any> {
  const fieldByName = new Map(tableFields.map((f) => [f.field_name, f]))
  const record: Record<string, any> = {}

  for (const [name, value] of Object.entries(rawFields)) {
    const fieldDef = fieldByName.get(name)
    if (!fieldDef) {
      // 字段不存在于表格，跳过（避免 API 报错）
      console.warn(`[FeishuStore] 字段 "${name}" 在表格中不存在，已跳过`)
      continue
    }
    // ATTACHMENT 字段从 attachmentMap 取已上传的 token 列表
    const inputValue = fieldDef.type === FIELD_TYPE.ATTACHMENT ? (attachmentMap[name] ?? []) : value
    const built = buildFieldValue(fieldDef.type, inputValue)
    if (built !== undefined) {
      record[name] = built
    }
  }

  return record
}

// ─── 字段缓存（避免每次请求都查询表格结构） ───
const fieldCache = new Map<string, Array<{ field_id: string; field_name: string; type: number }>>()

async function getCachedTableFields(
  accessToken: string,
  appToken: string,
  tableId: string
) {
  const key = `${appToken}:${tableId}`
  if (fieldCache.has(key)) return fieldCache.get(key)!
  const fields = await getTableFields(accessToken, appToken, tableId)
  fieldCache.set(key, fields)
  return fields
}

/** 飞书写入前：是否拉取远程二进制并上传附件列（仅本 Store 使用） */
function feishuShouldDownloadAttachments(saveType: CollectionType, row: any): boolean {
  if (
    saveType === 'xhs-note-detail' ||
    saveType === 'xhs-feed' ||
    saveType === 'xhs-account'
  ) {
    const m = row?._metaData
    if (m && typeof m === 'object') {
      if (typeof m.downloadImagesAndVideo === 'boolean') return m.downloadImagesAndVideo
      if (typeof m.downloadImages === 'boolean') return m.downloadImages
    }
    if (saveType === 'xhs-feed') return false
    return true
  }
  return row?.downloadImages !== false
}

// ─── 存储适配器入口 ───
export const feishuStore: StoreAdapter = {
  async save(
    type: CollectionType,
    data: any,
    store: StoreConfig,
    fromTabId?: number
  ): Promise<SaveResult | SaveResult[]> {
    if (!store.appId || !store.appSecret) {
      return { ok: false, error: '飞书配置缺少 App ID 或 App Secret' }
    }

    showPanelTip('飞书：正在鉴权并连接开放平台...', fromTabId)
    const accessToken = await getTenantAccessToken(store.appId, store.appSecret)
    const schema = type === 'xhs-account' ? ACCOUNT_FIELD_SCHEMA : NOTE_FIELD_SCHEMA

    // 支持批量（数组）和单条数据
    const items: any[] = Array.isArray(data) ? data : [data]

    showPanelTip('飞书：正在解析多维表格与目标数据表...', fromTabId)
    const { appToken, tableId } = await resolveConfig(store)

    const toRawFields = type === 'xhs-account'
      ? (item: any) => accountToRawFields(item as XiaohongshuAccount)
      : (item: any) => noteToRawFields(item as XiaohongshuNote)

    const mergeRawFieldsForEnsure = (itemsArr: any[]): Record<string, any> => {
      const merged: Record<string, any> = {}
      for (const it of itemsArr) {
        const rf = toRawFields(it)
        for (const [k, v] of Object.entries(rf)) {
          if (merged[k] === undefined && v !== '' && v != null) merged[k] = v
        }
      }
      return Object.keys(merged).length ? merged : toRawFields(itemsArr[0])
    }

    const firstRawFields =
      type === 'xhs-feed' ? mergeRawFieldsForEnsure(items) : toRawFields(items[0])

    const selectSeedByField =
      type === 'xhs-feed'
        ? {
            搜索关键词: [
              ...new Set(
                (items as XiaohongshuNote[])
                  .map((n) => n.searchKeyword?.trim())
                  .filter((k): k is string => !!k)
              )
            ]
          }
        : undefined

    const tableFields = await ensureFields(
      accessToken,
      appToken,
      tableId,
      firstRawFields,
      schema,
      fromTabId,
      selectSeedByField
    )

    const records: Array<Record<string, any>> = []
    for (let r = 0; r < items.length; r++) {
      const item = items[r]
      showPanelTip(`飞书：处理附件与字段（${r + 1}/${items.length}）...`, fromTabId)
      const rawFields = toRawFields(item)
      const doDownload = feishuShouldDownloadAttachments(type, item)
      const attachmentMap = await resolveAttachments(
        accessToken,
        appToken,
        rawFields,
        schema,
        doDownload,
        fromTabId
      )
      const record = buildFeishuRecord(rawFields, tableFields, attachmentMap)
      if (Object.keys(record).length > 0) records.push(record)
    }

    if (records.length === 0) {
      return { ok: false, error: '没有可写入的字段（飞书表格中未找到匹配的列名，请手动在表格中创建对应列，或在飞书开发者后台开启"编辑多维表格"权限）' }
    }

    const BATCH_SIZE = 500
    const results: SaveResult[] = []
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE)
      const end = Math.min(i + batch.length, records.length)
      showPanelTip(`飞书：正在写入数据 ${end}/${records.length}...`, fromTabId)
      await batchCreateRecords(accessToken, appToken, tableId, batch)
      for (const _ of batch) {
        results.push({ ok: true, action: 'create' })
      }
    }

    return results.length === 1 ? results[0] : results
  }
}
