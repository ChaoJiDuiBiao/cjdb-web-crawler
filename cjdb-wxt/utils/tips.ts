/**
 * 通用进度提示
 * - Content Script：直接调用 window.CJDB_TipsDisplay
 * - Background：通过 sendMessage 推送给 Content，由 listener 调用 CJDB_TipsDisplay
 */
export function tryShowTip(msg: string, ..._args: unknown[]) {
  if (typeof window !== 'undefined') {
    ;(window as any).CJDB_TipsDisplay?.(msg, ..._args)
  } else {
    browser.runtime.sendMessage({ type: 'cjdb-tips-display', message: msg }).catch(() => {})
  }
}
