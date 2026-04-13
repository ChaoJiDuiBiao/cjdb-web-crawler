import type { StoreAdapter, StoreConfig, SaveResult, CollectionType } from '@/types'

/**
 * LocalStore - 本地存储适配器（在 background Service Worker 中运行）
 *
 * 只负责写入 browser.storage.local。
 * 文件下载（URL.createObjectURL / DOM）必须在 content script 侧执行，
 * 因此将 exportFormat 和原始 data 通过 SaveResult 返回给 CollectPanel.vue 处理。
 */
export const localStore: StoreAdapter = {
  async save(type: CollectionType, data: any, store: StoreConfig, _fromTabId?: number): Promise<SaveResult> {
    try {
      const key = `cjdb_local_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      await browser.storage.local.set({ [key]: data })
      console.log('[LocalStore] 已保存到本地:', key)

      const exportFormat = (store as any)?.exportFormat as string | undefined

      return {
        ok: true,
        action: 'create',
        key,
        // content script 侧凭此字段决定是否触发文件下载
        exportFormat: exportFormat || undefined,
        exportData: (exportFormat === 'csv' || exportFormat === 'markdown') ? data : undefined,
        exportType: (exportFormat === 'csv' || exportFormat === 'markdown') ? type : undefined
      } as SaveResult & { exportFormat?: string; exportData?: any; exportType?: string }
    } catch (e: any) {
      console.error('[LocalStore] 保存失败:', e)
      return { ok: false, error: e.message || String(e) }
    }
  }
}
