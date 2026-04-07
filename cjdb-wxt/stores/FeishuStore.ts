import type { StoreAdapter, StoreConfig, SaveResult, CollectionType, XiaohongshuNote, XiaohongshuAccount } from '@/types'

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
  if (!tableId) {
    throw new Error(`飞书 Wiki 链接缺少 table 参数: ${wikiUrl}`)
  }

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

// ─── 解析配置：从 wikiUrl 解析出 appToken + tableId ───
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
  const accessToken = await getTenantAccessToken(store.appId!, store.appSecret!)
  const appToken = await getAppTokenFromWiki(accessToken, wikiToken)

  const result = { appToken, tableId }
  resolvedCache.set(cacheKey, result)
  return result
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
  '封面URL': FIELD_TYPE.URL,
  '图片URLs': FIELD_TYPE.TEXT,
  '标签': FIELD_TYPE.MULTI_SELECT,
  '搜索关键词': FIELD_TYPE.TEXT,
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
}

// 创建单个字段
async function createTableField(
  accessToken: string,
  appToken: string,
  tableId: string,
  fieldName: string,
  fieldType: number
): Promise<void> {
  const resp = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ field_name: fieldName, type: fieldType })
    }
  )
  const data = await resp.json()
  if (data.code !== 0) {
    // 字段已存在时飞书返回 1254040，忽略
    if (data.code === 1254040) return
    throw new Error(`创建字段 "${fieldName}" 失败(code=${data.code}): ${data.msg || JSON.stringify(data)}`)
  }
}

// 确保表格中存在所需字段，缺失的自动创建
async function ensureFields(
  accessToken: string,
  appToken: string,
  tableId: string,
  rawFields: Record<string, any>,
  schema: Record<string, number>
): Promise<Array<{ field_id: string; field_name: string; type: number }>> {
  const cacheKey = `${appToken}:${tableId}`
  let tableFields = await getCachedTableFields(accessToken, appToken, tableId)
  const existingNames = new Set(tableFields.map((f) => f.field_name))

  const missing = Object.keys(rawFields).filter(
    (name) => !existingNames.has(name) && schema[name] !== undefined
  )

  if (missing.length > 0) {
    console.log(`[FeishuStore] 自动创建缺失字段: ${missing.join(', ')}`)
    for (const name of missing) {
      await createTableField(accessToken, appToken, tableId, name, schema[name])
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
      // 当前未实现飞书文件上传，避免把字符串/URL 直接写进附件字段导致 1254068
      return undefined
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
  if (note.coverUrl)         fields['封面URL'] = note.coverUrl
  if (note.imageUrls)        fields['图片URLs'] = note.imageUrls
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

  return fields
}

// ─── 核心：将原始字段映射到飞书字段格式 ───
// tableFields: 从 API 获取的字段列表，用于匹配类型
function buildFeishuRecord(
  rawFields: Record<string, any>,
  tableFields: Array<{ field_id: string; field_name: string; type: number }>
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
    const built = buildFieldValue(fieldDef.type, value)
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

// ─── 存储适配器入口 ───
export const feishuStore: StoreAdapter = {
  async save(type: CollectionType, data: any, store: StoreConfig): Promise<SaveResult | SaveResult[]> {
    if (!store.appId || !store.appSecret) {
      return { ok: false, error: '飞书配置缺少 App ID 或 App Secret' }
    }

    const accessToken = await getTenantAccessToken(store.appId, store.appSecret)
    const { appToken, tableId } = await resolveConfig(store)

    // 支持批量（数组）和单条数据
    const items: any[] = Array.isArray(data) ? data : [data]

    // 先收集所有原始字段（取第一条即可，字段名相同）
    const firstItem = items[0]
    let firstRawFields: Record<string, any>
    const schema = type === 'xhs-account' ? ACCOUNT_FIELD_SCHEMA : NOTE_FIELD_SCHEMA
    if (type === 'xhs-account') {
      firstRawFields = accountToRawFields(firstItem as XiaohongshuAccount)
    } else {
      firstRawFields = noteToRawFields(firstItem as XiaohongshuNote)
    }

    // 确保字段存在（缺失则自动创建）
    const tableFields = await ensureFields(accessToken, appToken, tableId, firstRawFields, schema)

    const records: Array<Record<string, any>> = []
    for (const item of items) {
      let rawFields: Record<string, any>

      if (type === 'xhs-account') {
        rawFields = accountToRawFields(item as XiaohongshuAccount)
      } else {
        rawFields = noteToRawFields(item as XiaohongshuNote)
      }

      const record = buildFeishuRecord(rawFields, tableFields)
      if (Object.keys(record).length > 0) {
        records.push(record)
      }
    }

    if (records.length === 0) {
      return { ok: false, error: '没有可写入的字段（请检查表格列名是否与数据字段匹配）' }
    }

    // 飞书批量写入上限 500 条，分批处理
    const BATCH_SIZE = 500
    const results: SaveResult[] = []
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE)
      await batchCreateRecords(accessToken, appToken, tableId, batch)
      for (const _ of batch) {
        results.push({ ok: true, action: 'create' })
      }
    }

    return results.length === 1 ? results[0] : results
  }
}
