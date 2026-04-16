import { Store } from '@/stores/Store'
import { notionStore } from '@/stores/NotionStore'
import { feishuStore } from '@/stores/FeishuStore'
import { localFileStore } from '@/stores/LocalFileStore'
import { MessageTypes } from '@/types'
import type { CollectionType } from '@/types'
import { storage } from 'wxt/utils/storage'
import { browser } from 'wxt/browser'

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
store.register('local', localFileStore)

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
      // 小红书：在 tab 的 MAIN world 读 __INITIAL_STATE__（与 xiaohongshu-bridge 同源逻辑；不依赖跨 world 的 CustomEvent）
      if (message.type === MessageTypes.XhsNoteDetailMain) {
        ;(async () => {
          const tabId = sender.tab?.id
          const noteId = (message.payload || {}).noteId as string | undefined
          if (!tabId) {
            sendResponse({ ok: false, error: '无 tabId（需从笔记页 content script 发起）' })
            return
          }
          if (!noteId) {
            sendResponse({ ok: false, error: '缺少 noteId' })
            return
          }
          try {
            const inj = await browser.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              args: [noteId],
              func: (requestedNoteId: string) => {
                function unwrapRefs(v: any, depth = 0, maxDepth = 24): any {
                  if (v == null || depth > maxDepth) return v
                  if (typeof v !== 'object') return v
                  if (v.__v_isRef === true && 'value' in v) return unwrapRefs(v.value, depth + 1, maxDepth)
                  if (v.__v_isShallow === true && 'value' in v) return unwrapRefs(v.value, depth + 1, maxDepth)
                  if (v.__v_isReactive === true && '__v_raw' in v) return unwrapRefs(v.__v_raw, depth + 1, maxDepth)
                  return v
                }
                function cloneForMsg(obj: any): any {
                  try {
                    return structuredClone(obj)
                  } catch {
                    try {
                      return JSON.parse(JSON.stringify(obj))
                    } catch {
                      return null
                    }
                  }
                }
                try {
                  const raw = (window as unknown as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__
                  const state = unwrapRefs(raw)
                  let map: any = (state as any)?.note?.noteDetailMap
                  if (map == null || typeof map !== 'object') map = (state as any)?.noteDetailMap
                  map = unwrapRefs(map)
                  if (!map || typeof map !== 'object') {
                    return { ok: false, reason: 'no_map' }
                  }
                  let entry = map[requestedNoteId]
                  if (entry == null) {
                    const k = Object.keys(map).find((x) => x.toLowerCase() === requestedNoteId.toLowerCase())
                    if (k) entry = map[k]
                  }
                  const keys = Object.keys(map)
                  if (entry == null && keys.length === 1) entry = map[keys[0]]
                  if (entry == null) {
                    return { ok: false, reason: 'no_entry', keys: keys.slice(0, 20) }
                  }
                  const noteData = cloneForMsg(entry)
                  if (noteData == null) {
                    return { ok: false, reason: 'clone_failed' }
                  }
                  return { ok: true, noteData }
                } catch (e: any) {
                  return { ok: false, reason: 'throw', error: String(e?.message || e) }
                }
              }
            })
            const r = inj?.[0]?.result as { ok?: boolean; noteData?: unknown; reason?: string; keys?: string[]; error?: string }
            if (r?.ok === true && r.noteData != null) {
              sendResponse({ ok: true, noteData: r.noteData })
            } else {
              sendResponse({ ok: false, reason: r?.reason, keys: r?.keys, error: r?.error })
            }
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || String(e) })
          }
        })()
        return true
      }

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

      // HTTP 代理请求（用于解决 Panel/content context 的 CORS）
      if (message.type === MessageTypes.HTTPRequest) {
        ;(async () => {
          try {
            const { url, init } = (message.payload || {}) as { url?: string; init?: RequestInit }
            if (!url) {
              sendResponse({ ok: false, error: '缺少 URL' })
              return
            }

            // Limited proxy: AbortSignal/streaming not supported
            const reqInit = init || {}
            // Ensure we don't accidentally forward extension/user cookies.
            if (!reqInit.credentials) reqInit.credentials = 'omit'

            const res = await fetch(url, reqInit)
            const arrayBuffer = await res.arrayBuffer()
            const headers: Array<[string, string]> = []
            res.headers.forEach((v, k) => headers.push([k, v]))
            sendResponse({
              ok: true,
              status: res.status,
              statusText: res.statusText,
              headers,
              // ArrayBuffer 无法经 sendMessage 传递，转为普通数组
              body: Array.from(new Uint8Array(arrayBuffer))
            })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || '请求失败' })
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
