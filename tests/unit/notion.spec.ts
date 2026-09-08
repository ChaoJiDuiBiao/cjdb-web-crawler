import { test, expect } from '@playwright/test'
import { searchTargets, resolveTargets, targetStats } from '../../services/notionDiscovery'
const original = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = original
})
test('名称搜索只发一次请求，保留同库各个数据源、字段及分页', async () => {
  const calls: any[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    if (!String(url).endsWith('/search')) throw new Error('不应查询父数据库')
    return new Response(
      JSON.stringify({
        results: [
          {
            object: 'data_source',
            id: 'a',
            title: [{ plain_text: '作品' }],
            parent: { database_id: 'db' },
            properties: { 标题: {} },
            created_time: '2026-09-01'
          },
          {
            object: 'data_source',
            id: 'b',
            title: [{ plain_text: '账号' }],
            parent: { database_id: 'db' },
            properties: { 标题: {}, 粉丝: {} }
          },
          {
            object: 'data_source',
            id: 'a',
            title: [{ plain_text: '作品' }],
            parent: { database_id: 'db' },
            properties: { 标题: {} },
            created_time: '2026-09-01'
          },
          { object: 'data_source', id: 'trash', in_trash: true }
        ],
        has_more: true,
        next_cursor: 'next'
      })
    )
  }) as any
  const result = await searchTargets('fake', 'c', '素材', 'previous')
  expect(calls).toHaveLength(1)
  expect(calls[0].body).toMatchObject({
    query: '素材',
    start_cursor: 'previous',
    filter: { value: 'data_source' }
  })
  expect(result.targets.map((t) => t.name)).toEqual(['作品', '账号'])
  expect(result.targets.every((t) => t.kind === 'data_source')).toBe(true)
  expect(result.targets[0].fieldNames).toEqual(['标题'])
  expect(result.targets[0].createdAt).toBe('2026-09-01')
  expect(result.cursor).toBe('next')
})
test('统一搜索区分数据库 URL 与数据源 ID，拒绝非 Notion URL', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url))
    return new Response(
      JSON.stringify({
        id: '11111111111111111111111111111111',
        title: [{ plain_text: '素材' }],
        properties: { 标题: {} },
        data_sources: [{ id: '22222222222222222222222222222222', name: '表格' }]
      })
    )
  }) as any
  expect(
    (
      await searchTargets(
        'fake',
        'c',
        'https://www.notion.so/11111111111111111111111111111111?v=22222222222222222222222222222222'
      )
    ).targets[0].kind
  ).toBe('data_source')
  expect(calls[0]).toContain('/databases/11111111111111111111111111111111')
  expect(
    (await searchTargets('fake', 'c', '11111111-1111-1111-1111-111111111111')).targets[0].kind
  ).toBe('data_source')
  expect(calls[1]).toContain('/data_sources/')
  await expect(
    searchTargets('fake', 'c', 'https://example.com/11111111111111111111111111111111')
  ).rejects.toThrow('有效的 Notion')
})
test('ID查询仅在404时回退数据库，不吞掉权限或限流错误', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('{}', { status: 403 })
  }) as any
  await expect(searchTargets('fake', 'c', '11111111111111111111111111111111')).rejects.toThrow(
    '权限'
  )
  expect(calls).toBe(1)
  globalThis.fetch = (async (url: any) =>
    String(url).includes('/data_sources/')
      ? new Response('{}', { status: 404 })
      : new Response(
          JSON.stringify({
            id: '11111111111111111111111111111111',
            title: [],
            data_sources: [{ id: '22222222222222222222222222222222', name: '目标表' }]
          })
        )) as any
  expect(
    (await searchTargets('fake', 'c', '11111111111111111111111111111111')).targets[0].kind
  ).toBe('data_source')
})
test('链接解析返回多个数据源供选择，不默认取第一个', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: 'db',
        data_sources: [
          { id: 'a', name: '作品' },
          { id: 'b', name: '账号' }
        ]
      })
    )) as any
  expect(
    await resolveTargets(
      'fake',
      'connection',
      'https://www.notion.so/11111111111111111111111111111111'
    )
  ).toHaveLength(2)
})
test('失效 Token 给出可操作错误，不误报为空列表', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 })) as any
  await expect(searchTargets('invalid', 'connection')).rejects.toThrow('令牌无效、已过期或已被撤销')
})

test('行数分页返回下限和游标，数据源日期与字段来自真实元数据', async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    const data = String(url).includes('/query')
      ? {
          results: [{ object: 'page' }, { object: 'data_source' }],
          has_more: !body.start_cursor,
          next_cursor: body.start_cursor ? null : 'next'
        }
      : String(url).includes('/databases/')
        ? { created_time: '2026-09-01T00:00:00Z' }
        : {
            created_time: '2026-09-01T00:00:00Z',
            parent: { database_id: 'db' },
            properties: { 标题: {}, 链接: {} }
          }
    return new Response(JSON.stringify(data))
  }) as any
  const d: any = { dataSourceId: '22222222222222222222222222222222' }
  const first = await targetStats('fake', d)
  expect(first).toEqual({
    createdAt: '2026-09-01T00:00:00Z',
    fields: ['标题', '链接'],
    rows: 1,
    cursor: 'next'
  })
  expect(await targetStats('fake', d, first.cursor, false)).toEqual({ rows: 1, cursor: null })
})
test('统计失败不伪装为空表，损坏的分页游标被拒绝', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 403 })) as any
  const d: any = { dataSourceId: '22222222222222222222222222222222' }
  await expect(targetStats('fake', d)).rejects.toThrow('权限')
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: [], has_more: true, next_cursor: 'same' }))) as any
  await expect(targetStats('fake', d, 'same', false)).rejects.toThrow('分页异常')
})
