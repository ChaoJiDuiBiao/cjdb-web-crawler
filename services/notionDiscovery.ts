import { parseNotionDatabaseId } from '@/utils/notion'
import type { Destination } from '@/types/destination'
export const NOTION_API_VERSION = '2025-09-03'
export async function notionRequest(token: string, endpoint: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000)
  })
  const data = await response.json()
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: '令牌无效、已过期或已被撤销，请在配置中更新，并确认已启用 Notion API。',
      403: '没有所需权限，请检查令牌权限及当前账号对目标内容的读写权限。',
      404: '找不到目标内容，可能已删除或当前令牌无权访问。',
      429: 'Notion 请求过于频繁，请稍后重试。'
    }
    throw Object.assign(
      new Error(
        messages[response.status] || data.message || `Notion 请求失败（${response.status}）`
      ),
      { status: response.status }
    )
  }
  return data
}
const title = (value: any[]) =>
  (value || []).map((t) => t.plain_text || t.text?.content || '').join('')
export function targetFromSource(source: any, connectionId: string, database?: any): Destination {
  return {
    id: `${connectionId}:${source.id.replaceAll('-', '')}`,
    type: 'notion',
    kind: 'data_source',
    databaseName: title(database?.title),
    createdAt: source.created_time,
    fieldNames: source.properties ? Object.keys(source.properties) : undefined,
    connectionId,
    dataSourceId: source.id,
    databaseId: source.parent?.database_id || database?.id,
    name: title(source.title) || source.name || title(database?.title) || '未命名数据库',
    url: source.url || database?.url,
    usedFor: []
  }
}
export async function searchTargets(
  token: string,
  connectionId: string,
  query = '',
  cursor?: string
): Promise<{ targets: Destination[]; cursor: string | null }> {
  const input = query.trim()
  const id = parseNotionDatabaseId(input)
  if (id) {
    if (/^[a-f0-9-]{32,36}$/i.test(input)) {
      try {
        const source = await notionRequest(token, `/data_sources/${id}`)
        if (source.in_trash || source.archived) throw new Error('这个数据源已被移入废纸篓。')
        return { targets: [targetFromSource(source, connectionId)], cursor: null }
      } catch (e: any) {
        if (e.status !== 404) throw e
      }
    }
    const db = await notionRequest(token, `/databases/${id}`)
    if (db.in_trash || db.archived) throw new Error('这个数据库已被移入废纸篓。')
    return {
      targets: (db.data_sources || []).map((ds: any) =>
        targetFromSource({ ...ds, parent: { database_id: db.id } }, connectionId, db)
      ),
      cursor: null
    }
  }
  if (/^(?:https?:|www\.|notion\.)/i.test(input))
    throw new Error('请填写有效的 Notion 数据库 URL、Data source ID 或名称。')
  // Preserve source identity and metadata returned by search; no parent lookups.
  const data = await notionRequest(token, '/search', {
    filter: { property: 'object', value: 'data_source' },
    ...(input ? { query: input } : {}),
    ...(cursor ? { start_cursor: cursor } : {}),
    page_size: 20,
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  })
  const targets = new Map<string, Destination>()
  for (const source of data.results || []) {
    if (source.object !== 'data_source' || source.in_trash || source.archived) continue
    const target = targetFromSource(source, connectionId)
    targets.set(target.id, target)
  }
  if (data.has_more && (!data.next_cursor || data.next_cursor === cursor))
    throw new Error('数据库检索分页异常，请重新搜索。')
  return { targets: [...targets.values()], cursor: data.has_more ? data.next_cursor : null }
}
export async function resolveTargets(
  token: string,
  connectionId: string,
  input: string
): Promise<Destination[]> {
  const id = parseNotionDatabaseId(input)
  if (!id) throw new Error('请粘贴完整的 Notion 数据库链接。')
  const db = await notionRequest(token, `/databases/${id}`)
  if (db.in_trash || db.archived) throw new Error('这个数据库已被移入废纸篓。')
  return (db.data_sources || []).map((ds: any) =>
    targetFromSource({ ...ds, parent: { database_id: db.id } }, connectionId, db)
  )
}

// Metadata requests are serialized and paced so scrolling does not burst against Notion.
let statsQueue: Promise<unknown> = Promise.resolve()
export function targetStats(
  token: string,
  destination: Destination,
  cursor?: string,
  metadata = true
): Promise<any> {
  const run = statsQueue.then(async () => {
    const id = destination.dataSourceId
    if (!id || !/^[a-f0-9-]{32,36}$/i.test(id)) throw new Error('请先选择具体的数据源。')
    const get = async (endpoint: string, body?: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return notionRequest(token, endpoint, body)
    }
    let info = {}
    if (metadata) {
      const source = await get(`/data_sources/${id}`)
      info = { createdAt: source.created_time, fields: Object.keys(source.properties || {}) }
    }
    const page = await get(`/data_sources/${id}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    })
    if (page.has_more && (!page.next_cursor || page.next_cursor === cursor))
      throw new Error('行数统计分页异常，请重试。')
    return {
      ...info,
      rows: (page.results || []).filter((row: any) => row.object === 'page').length,
      cursor: page.has_more ? page.next_cursor : null
    }
  })
  statsQueue = run.catch(() => {})
  return run
}
