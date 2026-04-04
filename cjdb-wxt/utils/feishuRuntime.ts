export const FEISHU_RUNTIME_REQUEST = 'CJDB_FEISHU_RUNTIME_REQUEST'
export const FEISHU_RUNTIME_RESPONSE = 'CJDB_FEISHU_RUNTIME_RESPONSE'
export const FEISHU_RUNTIME_SCRIPT_ID = 'cjdb-feishu-runtime-bridge'
const FEISHU_RUNTIME_BRIDGE_PATH = 'feishu-runtime-bridge.js'

export type FeishuRuntimeOp = {
  insert: string
  attributes?: Record<string, any>
}

export type FeishuRuntimeBlock = {
  id?: string
  recordId?: string
  type: string
  allText?: string
  ops?: FeishuRuntimeOp[]
  seq?: string
  seqLevel?: number
  done?: boolean
  language?: string
  url?: string
  title?: string
  imageToken?: string
  fileToken?: string
  children: FeishuRuntimeBlock[]
}

export type FeishuRuntimeDoc = {
  title?: string
  root: FeishuRuntimeBlock
  debug?: {
    ready: boolean
    pendingCount: number
    totalBlocks: number
  }
}

type FeishuRuntimeResponse = {
  source: string
  type: string
  id: string
  ok: boolean
  doc?: FeishuRuntimeDoc
  error?: string
}

let bridgeReadyPromise: Promise<void> | null = null

export function isFeishuDocUrl(url: string): boolean {
  return /https:\/\/[^/]+\.feishu\.cn\/(docx|docs|wiki|sheet|slides|mindnote|base)\//.test(url)
}

export function ensureFeishuRuntimeBridge(): Promise<void> {
  if (bridgeReadyPromise) return bridgeReadyPromise

  bridgeReadyPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(FEISHU_RUNTIME_SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if ((existing as any).dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('飞书 runtime bridge 加载失败')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = FEISHU_RUNTIME_SCRIPT_ID
    script.src = browser.runtime.getURL(FEISHU_RUNTIME_BRIDGE_PATH)
    script.async = false
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () => reject(new Error('飞书 runtime bridge 加载失败'))
    ;(document.head || document.documentElement).appendChild(script)
  }).catch((error) => {
    bridgeReadyPromise = null
    throw error
  })

  return bridgeReadyPromise
}

export async function requestFeishuRuntimeDoc(timeoutMs = 20000): Promise<FeishuRuntimeDoc> {
  await ensureFeishuRuntimeBridge()

  const id = `cjdb-feishu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise<FeishuRuntimeDoc>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('读取飞书 runtime 超时'))
    }, timeoutMs)

    const onMessage = (event: MessageEvent<FeishuRuntimeResponse>) => {
      if (event.source !== window) return
      const payload = event.data
      if (!payload || payload.source !== FEISHU_RUNTIME_SCRIPT_ID || payload.type !== FEISHU_RUNTIME_RESPONSE || payload.id !== id) return

      clearTimeout(timer)
      window.removeEventListener('message', onMessage)

      if (!payload.ok || !payload.doc?.root) {
        reject(new Error(payload.error || '飞书 runtime 返回空数据'))
        return
      }

      resolve(payload.doc)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({
      source: FEISHU_RUNTIME_SCRIPT_ID,
      type: FEISHU_RUNTIME_REQUEST,
      id,
      action: 'collect'
    }, '*')
  })
}
