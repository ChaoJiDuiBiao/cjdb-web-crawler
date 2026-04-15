/**
 * 最小调试：与页面同一 JS 环境，直接读 window.__INITIAL_STATE__
 *
 * 用法：打开小红书页 → F12 → Console 左上角选 **top（页面）** → 输入
 *   crawler()
 */
export default defineContentScript({
  matches: ['https://*.xiaohongshu.com/*', 'https://xhslink.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',

  main() {
    ;(window as unknown as { crawler?: () => unknown }).crawler = function crawler() {
      const s = (window as unknown as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__
      console.log('[CJDB DEMO] window.__INITIAL_STATE__', s)
      return s
    }
    console.log('[CJDB DEMO] 在 Console 选 **top**，执行: crawler()')
  }
})
