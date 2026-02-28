import { Store } from '@/stores/Store'
import { notionStore } from '@/stores/NotionStore'
import { feishuStore } from '@/stores/FeishuStore'
import { localStore } from '@/stores/LocalStore'
import type { StoreConfig, XiaohongshuNote, XiaohongshuAccount } from '@/types'

type SavePayload =
  | { collectionType: 'note'; data: XiaohongshuNote; store: StoreConfig }
  | { collectionType: 'account'; data: XiaohongshuAccount; store: StoreConfig }
  | { collectionType: 'feed'; data: XiaohongshuNote[]; store: StoreConfig }

// 初始化 Store 并注册所有适配器
const store = new Store()
store.register('notion', notionStore)
store.register('feishu', feishuStore)
store.register('local', localStore)

export default defineBackground(() => {
  console.log('[CJDB] Background script loaded')

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[CJDB] Extension installed')
    } else if (details.reason === 'update') {
      console.log('[CJDB] Extension updated')
    }
  })

  // 在 background 中执行存储请求，避免 Content Script 的 CORS 限制
  browser.runtime.onMessage.addListener(
    (message: { type: string; payload?: SavePayload }, sender, sendResponse) => {
      if (message.type !== 'cjdb-save-to-notion') return false

      const { payload } = message
      if (!payload || !payload.store) {
        sendResponse({ ok: false, error: '缺少存储配置' })
        return true
      }

      // 异步处理
      ;(async () => {
        try {
          const result = await store.save(
            payload.collectionType,
            payload.data,
            payload.store
          )
          sendResponse(result)
        } catch (error: any) {
          console.error('[CJDB] 保存失败:', error)
          sendResponse({ ok: false, error: error.message || '保存失败' })
        }
      })()

      return true // 保持消息通道开启，支持异步响应
    }
  )
})
