import type { StoreAdapter, StoreConfig, SaveResult } from '@/types'

/**
 * Store - 数据存储统一入口
 * 职责：
 * 1. 管理存储适配器（notion, feishu, local）
 * 2. 根据配置类型分发到对应的适配器
 * 3. 返回统一格式的结果
 */
export class Store {
  private adapters = new Map<string, StoreAdapter>()

  /**
   * 注册存储适配器
   * @param name - 'notion' | 'feishu' | 'local'
   * @param adapter - 实现 StoreAdapter 接口的适配器
   */
  register(name: string, adapter: StoreAdapter) {
    this.adapters.set(name, adapter)
    console.log(`[Store] 注册适配器: ${name}`)
  }

  /**
   * 获取适配器
   * @param name - 适配器名称
   */
  get(name: string): StoreAdapter | undefined {
    return this.adapters.get(name)
  }

  /**
   * 存储数据
   * @param type - 数据类型 'note' | 'feed' | 'account'
   * @param data - 单条数据或批量数据数组
   * @param storeConfig - 存储配置
   * @returns 保存结果
   */
  async save(
    type: string,
    data: any,
    storeConfig: StoreConfig
  ): Promise<SaveResult | SaveResult[]> {
    const adapter = this.adapters.get(storeConfig.type)

    if (!adapter) {
      const error = `未知存储类型: ${storeConfig.type}`
      console.error('[Store]', error)
      return { ok: false, error }
    }

    try {
      return await adapter.save(type, data, storeConfig)
    } catch (error: any) {
      console.error('[Store] 保存失败:', error)
      return { ok: false, error: error.message || String(error) }
    }
  }
}
