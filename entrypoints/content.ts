import { createApp, h, shallowRef } from 'vue'
import '@/styles/theme.css'
import CollectPanel from '@/components/CollectPanel.vue'
import { MessageTypes } from '@/types'
import { XiaohongshuNoteCrawler } from '@/crawlers/XiaohongshuNoteCrawler'
import { XiaohongshuFeedCrawler } from '@/crawlers/XiaohongshuFeedCrawler'
import { XiaohongshuAccountCrawler } from '@/crawlers/XiaohongshuAccountCrawler'
import { WechatArticleCrawler } from '@/crawlers/WechatArticleCrawler'
import { FeishuDocCrawler } from '@/crawlers/FeishuDocCrawler'
import { ensureFeishuRuntimeBridge, isFeishuDocUrl } from '@/utils/feishuRuntime'

export default defineContentScript({
  matches: [
    'https://www.xiaohongshu.com/*',
    'https://xhslink.com/*',
    'https://mp.weixin.qq.com/*',
    'https://*.feishu.cn/*'
  ],

  main(ctx) {
    console.log('[CJDB] Content script loaded')

    // 创建所有 Crawler（顺序影响多匹配时默认选中）
    const crawlers = [
      new XiaohongshuNoteCrawler(),
      new XiaohongshuFeedCrawler(),
      new XiaohongshuAccountCrawler(),
      new WechatArticleCrawler(),
      new FeishuDocCrawler()
    ]

    const activeCrawlers = shallowRef<any[]>([])
    let currentCrawler: (typeof crawlers)[number] | null = null
    let lastUrl = location.href
    let markerTimer: ReturnType<typeof setTimeout> | null = null
    const host = document.createElement('div')
    host.id = 'cjdb-panel-host'
    // Reset inherited page styles at the host boundary.
    host.style.cssText = 'all: initial; position: relative; z-index: 2147483600;'
    const shadow = host.attachShadow({ mode: 'open' })
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = chrome.runtime.getURL('content-scripts/content.css')
    shadow.appendChild(link)
    const root = document.createElement('div')
    shadow.appendChild(root)
    document.getElementById('cjdb-panel-host')?.remove()
    document.body.appendChild(host)
    const app = createApp({
      render: () =>
        h(CollectPanel, {
          crawlers: activeCrawlers.value,
          resolveCrawler: () => crawlers.find((c) => c.canHandle(location.href))
        })
    })
    let mounted = false,
      disposed = false
    const mountApp = () => {
      if (!mounted && !disposed) {
        mounted = true
        app.mount(root)
      }
    }
    link.addEventListener('load', mountApp, { once: true })
    const mountTimer = setTimeout(mountApp, 500)
    function checkAndInit() {
      const url = location.href
      if (isFeishuDocUrl(url))
        ensureFeishuRuntimeBridge().catch((error) => console.warn('[CJDB] 飞书桥接失败:', error))
      activeCrawlers.value = crawlers.filter((c) => c.canHandle(url))
      currentCrawler = activeCrawlers.value[0] ?? null
      if (markerTimer) clearTimeout(markerTimer)
      markerTimer = setTimeout(() => currentCrawler?.marker(), 500)
    }

    // 初始化
    checkAndInit()

    // 监听 URL 变化（SPA 页面）
    const urlTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        checkAndInit()
      }
    }, 500)

    // 监听滚动和 DOM 变化，重新运行 marker
    const runMarker = () => {
      if (markerTimer) clearTimeout(markerTimer)
      markerTimer = setTimeout(() => {
        const match = crawlers.find((c) => c.canHandle(location.href))
        if (match) {
          match.marker()
        }
      }, 300)
    }

    window.addEventListener('scroll', runMarker, { passive: true })

    // 接收 Background 发来的进度提示（showPanelTip 经 tabs.sendMessage 发送），调用 Panel 的 tipsDisplay
    const onMessage = (msg: { type?: string; message?: string; tabId?: number }) => {
      if (msg.type === MessageTypes.ShowPanelTip) {
        ;(window as any).CJDB_TipsDisplay?.(msg.message)
      }
    }
    browser.runtime.onMessage.addListener(onMessage)

    const observer = new MutationObserver(runMarker)
    observer.observe(document.body, { childList: true, subtree: true })

    ctx.onInvalidated(() => {
      disposed = true
      clearTimeout(mountTimer)
      clearInterval(urlTimer)
      if (markerTimer) clearTimeout(markerTimer)
      observer.disconnect()
      window.removeEventListener('scroll', runMarker)
      browser.runtime.onMessage.removeListener(onMessage)
      if (mounted) app.unmount()
      host.remove()
    })
  }
})
