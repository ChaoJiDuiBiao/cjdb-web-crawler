import type { StoreAdapter, StoreConfig, SaveResult } from '@/types'

/**
 * LocalStore - 本地存储适配器
 * 使用 browser.storage.local 存储数据
 */
export const localStore: StoreAdapter = {
  async save(type: string, data: any, store: StoreConfig): Promise<SaveResult> {
    try {
      const key = `cjdb_local_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      await browser.storage.local.set({ [key]: data })
      console.log('[LocalStore] 已保存到本地:', key, data)
      return { ok: true, action: 'create', key }
    } catch (e: any) {
      console.error('[LocalStore] 保存失败:', e)
      return { ok: false, error: e.message || String(e) }
    }
  }
}
