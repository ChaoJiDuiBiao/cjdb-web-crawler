/**
 * MAIN World Bridge - 与页面共用 window，可读取 window.__INITIAL_STATE__
 *
 * isolated world 无法直接访问页面全局变量，通过：
 * - document CustomEvent `cjdb-request-note-detail`
 * - window.postMessage（source: `cjdb-ext`）双通道请求
 *
 * 小红书前端可能把整棵 __INITIAL_STATE__ 包成 Vue3 ref，直接读 .note 会得到 undefined，
 * 需递归解包 __v_isRef / __v_raw 后再取 note.noteDetailMap。
 */
const LOG = '[CJDB XHS MAIN]'
const MSG_SOURCE = 'cjdb-ext'

function unwrapRefs(v: unknown, depth = 0, maxDepth = 24): any {
  if (v == null || depth > maxDepth) return v
  if (typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if (o.__v_isRef === true && 'value' in o) return unwrapRefs(o.value, depth + 1, maxDepth)
  if (o.__v_isShallow === true && 'value' in o) return unwrapRefs(o.value, depth + 1, maxDepth)
  if (o.__v_isReactive === true && '__v_raw' in o) return unwrapRefs(o.__v_raw, depth + 1, maxDepth)
  return v
}

/** 扫描 window 上可能与 SSR/状态相关的属性名（仅名字，不读值，避免触发 getter 异常） */
function scanWindowStateLikeKeys(): string[] {
  try {
    return Object.getOwnPropertyNames(window).filter((k) =>
      /INITIAL|SSR_STATE|PRELOAD|noteDetail|NUXT|REDUX|__VUE|PINIA/i.test(k)
    )
  } catch {
    return []
  }
}

function resolveNoteDetailMap(): {
  map: Record<string, unknown> | null
  debug: Record<string, unknown>
} {
  const w = window as unknown as Record<string, unknown>
  const raw = w.__INITIAL_STATE__
  const debug: Record<string, unknown> = {
    hasInitialState: raw != null,
    typeofRaw: typeof raw,
    isVueRef: !!(raw && typeof raw === 'object' && (raw as Record<string, unknown>).__v_isRef),
    topKeys: raw && typeof raw === 'object' ? Object.keys(raw as object).slice(0, 50) : [],
    windowStateLikeKeys: scanWindowStateLikeKeys()
  }

  const state = unwrapRefs(raw)
  debug.unwrappedTopKeys =
    state && typeof state === 'object' ? Object.keys(state as object).slice(0, 50) : []

  let map: unknown = (state as any)?.note?.noteDetailMap
  if (map == null || typeof map !== 'object') map = (state as any)?.noteDetailMap
  map = unwrapRefs(map)

  const keys = map && typeof map === 'object' ? Object.keys(map as object) : []
  debug.mapPresent = map != null && typeof map === 'object'
  debug.mapKeyCount = keys.length
  debug.mapKeySample = keys.slice(0, 12)

  return {
    map: map && typeof map === 'object' ? (map as Record<string, unknown>) : null,
    debug
  }
}

function respond(noteId: string, noteData: unknown) {
  try {
    document.dispatchEvent(
      new CustomEvent('cjdb-note-detail-response', { detail: { noteId, noteData } })
    )
  } catch (e) {
    console.warn(LOG, 'dispatch CustomEvent(cjdb-note-detail-response) 失败', e)
  }
  try {
    window.postMessage(
      { source: MSG_SOURCE, type: 'cjdb-note-detail-response', noteId, noteData },
      '*'
    )
  } catch (e) {
    console.warn(LOG, 'postMessage(cjdb-note-detail-response) 失败', e)
  }
}

function handleRequest(noteId: string, _trigger: 'document' | 'message') {
  const { map, debug } = resolveNoteDetailMap()

  if (!map) {
    console.warn(
      LOG,
      '无法取得 noteDetailMap。若 hasInitialState=false，说明当前页 window 上未挂 __INITIAL_STATE__（可能改版、仅 CSR、或需在笔记详情加载后再采）。',
      { windowStateLikeKeys: debug.windowStateLikeKeys }
    )
    respond(noteId, null)
    return
  }

  const direct = map[noteId]
  if (direct != null) {
    respond(noteId, direct)
    return
  }

  const lowered = Object.keys(map).find((k) => k.toLowerCase() === noteId.toLowerCase())
  if (lowered) {
    respond(noteId, map[lowered])
    return
  }

  const keys = Object.keys(map)
  if (keys.length === 1) {
    console.warn(LOG, 'noteId 与 map 键不一致；map 仅 1 条，回退使用该条', {
      noteId,
      onlyKey: keys[0]
    })
    respond(noteId, map[keys[0]])
    return
  }

  console.warn(LOG, 'noteDetailMap 存在但未找到对应 noteId', { noteId, keySample: keys.slice(0, 16) })
  respond(noteId, null)
}

export default defineContentScript({
  matches: ['https://*.xiaohongshu.com/*', 'https://xhslink.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',

  main() {
    document.addEventListener('cjdb-request-note-detail', (e: Event) => {
      const noteId = (e as CustomEvent).detail?.noteId as string
      if (!noteId) {
        console.warn(LOG, 'CustomEvent 缺少 detail.noteId', (e as CustomEvent).detail)
        return
      }
      handleRequest(noteId, 'document')
    })

    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d !== 'object') return
      if (d.source !== MSG_SOURCE || d.type !== 'cjdb-request-note-detail') return
      const noteId = d.noteId as string
      if (!noteId) {
        console.warn(LOG, 'postMessage 缺少 noteId', d)
        return
      }
      handleRequest(noteId, 'message')
    })
  }
})
