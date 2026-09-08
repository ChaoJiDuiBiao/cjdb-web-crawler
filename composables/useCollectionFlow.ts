import { computed, ref } from 'vue'
import { CollectionType } from '@/types'
import type { Destination, TaskRecord } from '@/types/destination'
import { service } from '@/utils/service'
import { itemTitle, safeUrl } from '@/utils/destinations'
import { exportCollection } from '@/utils/exportCollection'
export type Phase =
  'idle' | 'collecting' | 'preview' | 'saving' | 'done' | 'partial' | 'failed' | 'stopped'
export function useCollectionFlow(
  dependencies: {
    request?: typeof service
    exportData?: typeof exportCollection
  } = {}
) {
  const request = dependencies.request || service
  const exportData = dependencies.exportData || exportCollection
  const phase = ref<Phase>('idle'),
    progress = ref(''),
    error = ref('')
  const data = ref<any>(null),
    type = ref<CollectionType>(CollectionType.XHSNoteDetail),
    destination = ref<Destination | null>(null)
  const task = ref<TaskRecord | null>(null),
    stopRequested = ref(false)
  let prepared: any[] = [],
    lastDestination: Destination | null = null
  const busy = computed(() => phase.value === 'collecting' || phase.value === 'saving')
  function preview(value: any, collectionType: CollectionType) {
    data.value = value
    type.value = collectionType
    phase.value = 'preview'
    error.value = ''
    task.value = null
  }
  async function collect(crawler: any) {
    if (busy.value) return
    phase.value = 'collecting'
    progress.value = '正在读取页面内容…'
    error.value = ''
    task.value = null
    try {
      const result = await crawler.crawl({
        onProgress: (message: string) => {
          progress.value = message
        }
      })
      if (!result || (Array.isArray(result) && !result.length))
        throw new Error('没有采集到内容，请确认页面已加载并选中了需要的内容。')
      preview(result, crawler.getCrawlerState().collectionType)
    } catch (e: any) {
      error.value = e.message
      phase.value = 'failed'
    } finally {
      progress.value = ''
    }
  }
  async function record() {
    if (task.value)
      try {
        await request('recordTask', {
          ...task.value,
          target: lastDestination,
          retryData: prepared.map((item, i) =>
            task.value!.items[i].status === 'success' ? null : item
          )
        })
      } catch {
        error.value = '内容处理结果已保留在当前面板，但任务记录写入失败。请检查浏览器存储空间。'
      }
  }
  async function save(value: any, retry = false) {
    if (busy.value || !destination.value) return
    phase.value = 'saving'
    stopRequested.value = false
    error.value = ''
    if (!retry) {
      lastDestination = JSON.parse(JSON.stringify(destination.value))
      // A search feed is intentionally one collection document in the existing adapters.
      prepared =
        type.value === CollectionType.XHSFeed ? [value] : Array.isArray(value) ? value : [value]
      task.value = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        type: type.value,
        destination: lastDestination!.name,
        items: prepared.map((item) => ({
          title: Array.isArray(item) ? `搜索合集 · ${item.length} 条作品` : itemTitle(item),
          status: 'pending'
        }))
      }
    }
    await record()
    try {
      for (let i = 0; i < prepared.length; i++) {
        const entry = task.value!.items[i]
        if (entry.status === 'success') continue
        if (stopRequested.value) break
        progress.value = `正在保存 ${i + 1}/${prepared.length}：${entry.title}`
        entry.error = undefined
        entry.warning = undefined
        try {
          const result = await request('save', {
            type: type.value,
            taskId: task.value!.id,
            itemIndex: i,
            data: prepared[i],
            destination: lastDestination
          })
          const results = Array.isArray(result) ? result : [result]
          if (!results.length || results.some((r) => !r.ok))
            throw new Error(results.find((r) => !r.ok)?.error || '保存未返回成功结果')
          entry.status = 'success'
          entry.key = results.find((r) => r.key)?.key
          entry.url =
            safeUrl(results.find((r) => r.url)?.url) ||
            (results.find((r) => r.pageId)?.pageId && lastDestination?.type === 'notion'
              ? `https://www.notion.so/${results.find((r) => r.pageId).pageId.replaceAll('-', '')}`
              : safeUrl(lastDestination?.url || lastDestination?.wikiUrl))
          entry.warning =
            results
              .map((r) => r.warning)
              .filter(Boolean)
              .join('；') || undefined
          try {
            for (const r of results)
              if (r.exportFormat && r.exportData && r.exportType)
                await exportData(r.exportType, r.exportData, r.exportFormat)
          } catch (e: any) {
            entry.warning = `内容已保存，文件导出失败：${e.message}。可在本地记录重新导出。`
          }
        } catch (e: any) {
          entry.status = 'failed'
          entry.error = e.message
        }
        await record()
      }
      const items = task.value!.items
      task.value!.stopped = stopRequested.value && items.some((i) => i.status === 'pending')
      phase.value = task.value!.stopped
        ? 'stopped'
        : items.every((i) => i.status === 'success')
          ? 'done'
          : items.some((i) => i.status === 'success')
            ? 'partial'
            : 'failed'
    } finally {
      if (phase.value === 'saving') phase.value = 'failed'
      progress.value = ''
      await record()
    }
  }
  return {
    phase,
    progress,
    error,
    data,
    type,
    destination,
    task,
    busy,
    stopRequested,
    collect,
    preview,
    save,
    restore: (saved: TaskRecord) => {
      if (busy.value || !saved.target || !saved.retryData) return
      task.value = JSON.parse(JSON.stringify(saved))
      prepared = saved.retryData
      lastDestination = saved.target
      destination.value = saved.target
      type.value = saved.type
      phase.value = 'partial'
    },
    retry: () => save(null, true),
    stop: () => {
      stopRequested.value = true
    }
  }
}
