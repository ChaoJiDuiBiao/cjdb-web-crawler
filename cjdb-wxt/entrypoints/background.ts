import { Store } from '@/stores/Store'
import { notionStore } from '@/stores/NotionStore'
import { feishuStore } from '@/stores/FeishuStore'
import { localStore } from '@/stores/LocalStore'
import { MessageTypes } from '@/types'
import type { CollectionType } from '@/types'
import { storage } from 'wxt/utils/storage'

type SavePayload = {
  collectionType: CollectionType
  data: any
  storeCfg?: import('@/types').StoreConfig
  fromTabId?: number
}

const DAJIALA_API_KEY = 'local:dajialaApiKey'
const DAJIALA_BASE = 'https://www.dajiala.com'

// 初始化 Store 并注册所有适配器
const store = new Store()
store.register('notion', notionStore)
store.register('feishu', feishuStore)
store.register('local', localStore)

async function getDajialaApiKey(): Promise<string> {
  const key = await storage.getItem(DAJIALA_API_KEY)
  return (key as string) || ''
}

export default defineBackground(() => {
  console.log('[CJDB] Background script loaded')

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[CJDB] Extension installed')
    } else if (details.reason === 'update') {
      console.log('[CJDB] Extension updated')
    }
  })

  browser.runtime.onMessage.addListener(
    (message: { type: string; payload?: any }, sender, sendResponse) => {
      // 大加辣：历史文章列表
      if (message.type === MessageTypes.DajialaPostHistory) {
        ;(async () => {
          try {
            const apiKey = await getDajialaApiKey()
            if (!apiKey) {
              sendResponse({ code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' })
              return
            }
            const body = { ...message.payload, key: apiKey, verifycode: '' }
            const res = await fetch(`${DAJIALA_BASE}/fbmain/monitor/v3/post_history`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            })
            const data = await res.json()
            sendResponse(data)
          } catch (e: any) {
            sendResponse({ code: -1, error: e?.message || '请求失败' })
          }
        })()
        return true
      }

      // 大加辣：文章数据（阅读、点赞等）
      if (message.type === MessageTypes.DajialaArticleData) {
        ;(async () => {
          try {
            const apiKey = await getDajialaApiKey()
            if (!apiKey) {
              sendResponse({ code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' })
              return
            }
            const { url } = message.payload || {}
            const res = await fetch(`${DAJIALA_BASE}/fbmain/monitor/v3/read_zan_pro`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, key: apiKey, verifycode: '' })
            })
            const data = await res.json()
            sendResponse(data)
          } catch (e: any) {
            sendResponse({ code: -1, error: e?.message || '请求失败' })
          }
        })()
        return true
      }

      // 大加辣：公众号主体信息
      if (message.type === MessageTypes.DajialaPrincipalInfo) {
        ;(async () => {
          try {
            const apiKey = await getDajialaApiKey()
            if (!apiKey) {
              sendResponse({ code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' })
              return
            }
            const { url } = message.payload || {}
            const res = await fetch(`${DAJIALA_BASE}/fbmain/monitor/v3/principal_info`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, biz: '', wxid: '', key: apiKey, verifycode: '' })
            })
            const data = await res.json()
            sendResponse(data)
          } catch (e: any) {
            sendResponse({ code: -1, error: e?.message || '请求失败' })
          }
        })()
        return true
      }

      // 拉取文章 HTML（用于解析正文）
      if (message.type === MessageTypes.DajialaFetchArticleHtml) {
        ;(async () => {
          try {
            const { url } = message.payload || {}
            if (!url) {
              sendResponse({ ok: false, error: '缺少 URL' })
              return
            }
            const res = await fetch(url, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            })
            const html = await res.text()
            sendResponse({ ok: true, html })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || '请求失败' })
          }
        })()
        return true
      }

      // 大加辣：文章详情（包含 HTML 正文）
      if (message.type === MessageTypes.DajialaArticleDetail) {
        ;(async () => {
          try {
            const apiKey = await getDajialaApiKey()
            if (!apiKey) {
              sendResponse({ code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' })
              return
            }
            const { url } = message.payload || {}
            const res = await fetch(`${DAJIALA_BASE}/fbmain/monitor/v3/article_detail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, key: apiKey, verifycode: '' })
            })
            const data = await res.json()
            sendResponse(data)
          } catch (e: any) {
            sendResponse({ code: -1, error: e?.message || '请求失败' })
          }
        })()
        return true
      }

      // 存储请求
      if (message.type !== MessageTypes.StoreCrawlData) return false

      console.log('[CJDB] StoreCrawlData Received:', message)
      const { payload } = message
      if (!payload) {
        sendResponse({ ok: false, error: '缺少 payload' })
        return true
      }

      const fromTabId = payload.fromTabId ?? sender.tab?.id

      ;(async () => {
        try {
          const result = await store.save(payload.collectionType, payload.data, payload.storeCfg, fromTabId)
          sendResponse(result)
        } catch (error: any) {
          console.error('[CJDB] 保存失败:', error)
          sendResponse({ ok: false, error: error.message || '保存失败' })
        }
      })()

      return true
    }
  )
})
