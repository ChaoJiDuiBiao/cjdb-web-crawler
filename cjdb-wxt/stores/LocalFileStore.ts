import type { StoreAdapter, StoreConfig, SaveResult, CollectionType, XiaohongshuNote } from '@/types'

/**
 * LocalFileStore - 本地文件存储适配器（在 background Service Worker 中运行）
 *
 * 写入 browser.storage.local，并由 content 侧根据返回的 exportFormat / exportData 触发
 * exportFile 中的 CSV、Markdown、ZIP 等落盘逻辑（与「本地文件」相关的策略可从此模块导出，供 export 使用）。
 */
export const localFileStore: StoreAdapter = {
  async save(type: CollectionType, data: any, store: StoreConfig, _fromTabId?: number): Promise<SaveResult> {
    try {
      const key = `cjdb_local_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      await browser.storage.local.set({ [key]: data })
      console.log('[LocalFileStore] 已保存到本地:', key)

      const exportFormat = (store as any)?.exportFormat as string | undefined

      return {
        ok: true,
        action: 'create',
        key,
        exportFormat: exportFormat || undefined,
        exportData: exportFormat === 'csv' || exportFormat === 'markdown' ? data : undefined,
        exportType: exportFormat === 'csv' || exportFormat === 'markdown' ? type : undefined
      } as SaveResult & { exportFormat?: string; exportData?: any; exportType?: string }
    } catch (e: any) {
      console.error('[LocalFileStore] 保存失败:', e)
      return { ok: false, error: e.message || String(e) }
    }
  }
}

/** 本地 ZIP（小红书笔记详情）：是否把图片/视频打进包；与 LocalFileStore 写入的数据约定一致 */
export function localFileStoreShouldEmbedXHSNoteZipMedia(note: XiaohongshuNote): boolean {
  const m = note._metaData as Record<string, unknown> | undefined
  if (m && typeof m === 'object') {
    if (typeof m.downloadImagesAndVideo === 'boolean') return m.downloadImagesAndVideo
    if (typeof m.downloadImages === 'boolean') return m.downloadImages
  }
  return true
}
