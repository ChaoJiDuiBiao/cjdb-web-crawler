import type { StoreAdapter, StoreConfig, SaveResult, CollectionType } from '@/types'

/**
 * FeishuStore - 飞书多维表格存储适配器
 * TODO: 待实现
 *
 * 实现时需要：
 * 1. 使用飞书开放平台 API：https://open.feishu.cn/document/
 * 2. 获取 app_access_token
 * 3. 对接多维表格 API
 * 4. 实现数据映射和字段创建
 */
export const feishuStore: StoreAdapter = {
  async save(type: CollectionType, data: any, store: StoreConfig, _fromTabId?: number): Promise<SaveResult> {
    console.warn('[FeishuStore] 待实现', type, data, store)
    return { ok: false, error: '飞书存储待实现' }
  }
}
