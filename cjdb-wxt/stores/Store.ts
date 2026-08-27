import type { StoreAdapter, StoreConfig, SaveResult } from '@/types'
import type { CollectionType } from '@/types'
import { MessageTypes } from '@/types'
import { browser } from 'wxt/browser'

/**
 * 中转：将采集数据转发到 Background
 * @param collectionType - 采集数据类型
 * @param data - 采集数据
 * @param storeCfg - 可选，传入时优先使用，否则 background 从 storage 读取
 * @param fromTabId - 可选，调用方所在 tab，供 showPanelTip 使用
 */
export async function storeCrawlData(
  collectionType: CollectionType,
  data: any,
  storeCfg?: StoreConfig,
  fromTabId?: number
): Promise<SaveResult | SaveResult[]> {
  let tabId = fromTabId
  if (tabId == null) {
    try {
      const t = await browser.tabs.getCurrent()
      tabId = t?.id
    } catch {
      /* 非浏览器 tab 上下文时无法定向推送面板进度 */
    }
  }
  console.log('[CJDB] storeCrawlData Dispatch:', collectionType, !!storeCfg, tabId)
  return browser.runtime.sendMessage({
    type: MessageTypes.StoreCrawlData,
    payload: { collectionType, data, storeCfg, fromTabId: tabId }
  })
}

/**
 * Store - 数据存储统一入口
 * 职责：
 * 1. 管理存储适配器（notion, feishu, local → LocalFileStore）
 * 2. 根据配置类型分发到对应的适配器
 * 3. 返回统一格式的结果
 */
export class Store {
  private adapters = new Map<string, StoreAdapter>()

  /**
   * 注册存储适配器
   * @param name - 'notion' | 'feishu' | 'local'（适配器实现为 LocalFileStore）
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
   * @param type - 数据类型 CollectionType
   * @param data - 单条数据或批量数据数组
   * @param storeCfg - 可选，传入则用，否则从 storage 读取当前配置
   * @param fromTabId - 可选，供 showPanelTip 推送进度到指定 tab
   * @returns 保存结果
   */
  async save(
    type: CollectionType,
    data: any,
    storeCfg?: StoreConfig,
    fromTabId?: number
  ): Promise<SaveResult | SaveResult[]> {
    const { getCurrentStoreFromStorage } = await import('@/config/StoreConfig')
    const cfg = storeCfg ?? (await getCurrentStoreFromStorage(type))

    const adapter = this.adapters.get(cfg.type)
    if (!adapter) {
      const error = `未知存储类型: ${cfg.type}`
      console.error('[Store]', error)
      return { ok: false, error }
    }

    try {
      return await adapter.save(type, data, cfg, fromTabId)
    } catch (error: any) {
      console.error('[Store] 保存失败:', error)
      return { ok: false, error: error.message || String(error) }
    }
  }
}
