import { test, expect } from '@playwright/test'
import { CollectionType } from '../../types'
let useCollectionFlow: typeof import('../../composables/useCollectionFlow').useCollectionFlow
// The workflow uses injected services; this supplies only WXT's extension environment guard.
test.beforeAll(async () => {
  ;(globalThis as any).chrome = { runtime: { id: 'isolated-test' } }
  ;({ useCollectionFlow } = await import('../../composables/useCollectionFlow'))
})
const target = { id: 'local:', type: 'local' as const, name: '本地记录' }
test('部分失败后只重试失败项，跨页面恢复也不会重复已成功项', async () => {
  const writes: string[] = [],
    records: any[] = []
  let failing = true
  const request: any = async (action: string, payload: any) => {
    if (action === 'recordTask') {
      records.push(JSON.parse(JSON.stringify(payload)))
      return null
    }
    writes.push(payload.data.title)
    return { ok: payload.data.title !== 'B' || !failing, error: '模拟失败' }
  }
  const flow = useCollectionFlow({ request })
  flow.destination.value = target
  flow.preview([{ title: 'A' }, { title: 'B' }], CollectionType.WechatArticle)
  await flow.save(flow.data.value)
  expect(flow.phase.value).toBe('partial')
  expect(writes).toEqual(['A', 'B'])
  const recovered = useCollectionFlow({ request })
  recovered.restore(records[records.length - 1])
  failing = false
  await recovered.retry()
  expect(writes).toEqual(['A', 'B', 'B'])
  expect(recovered.phase.value).toBe('done')
})
test('停止发生在项边界，继续时跳过成功项', async () => {
  const writes: string[] = []
  let shouldStop = true
  const flow = useCollectionFlow({
    request: (async (action: string, payload: any) => {
      if (action === 'recordTask') return null
      writes.push(payload.data.title)
      if (shouldStop) flow.stop()
      return { ok: true }
    }) as any
  })
  flow.destination.value = target
  flow.preview([{ title: 'A' }, { title: 'B' }], CollectionType.WechatArticle)
  await flow.save(flow.data.value)
  expect(writes).toEqual(['A'])
  expect(flow.phase.value).toBe('stopped')
  shouldStop = false
  await flow.retry()
  expect(writes).toEqual(['A', 'B'])
})
test('文件导出失败不会把成功保存改成失败或触发重复保存', async () => {
  const flow = useCollectionFlow({
    request: (async (action: string) =>
      action === 'recordTask'
        ? null
        : {
            ok: true,
            key: 'local-key',
            exportFormat: 'csv',
            exportData: { title: 'A' },
            exportType: CollectionType.WechatArticle
          }) as any,
    exportData: async () => {
      throw new Error('下载失败')
    }
  })
  flow.destination.value = target
  flow.preview({ title: 'A' }, CollectionType.WechatArticle)
  await flow.save(flow.data.value)
  expect(flow.phase.value).toBe('done')
  expect(flow.task.value!.items[0].warning).toContain('文件导出失败')
})
test('采集异常后状态恢复，可再次发起采集', async () => {
  const flow = useCollectionFlow({ request: (async () => null) as any })
  await flow.collect({
    crawl: async () => {
      throw new Error('页面未加载')
    }
  })
  expect(flow.busy.value).toBe(false)
  expect(flow.phase.value).toBe('failed')
  expect(flow.error.value).toBe('页面未加载')
  await flow.collect({
    crawl: async () => ({ title: 'ok' }),
    getCrawlerState: () => ({ collectionType: CollectionType.WechatArticle })
  })
  expect(flow.phase.value).toBe('preview')
})
