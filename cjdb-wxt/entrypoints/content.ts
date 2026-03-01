/**
 * Content Script - 承担原 extension Main.js 的调度职责
 *
 * 职责拆分：
 * - 事件监听：URL 变化、滚动、DOM 变化 → 由 content.ts 负责
 * - Crawler 调度：识别页面、运行 marker → 由 content.ts 负责
 * - 采集 / 预览 / 存储 / 进度：点击采集 → 由 CollectPanel.vue 负责
 *
 * 流程：URL 变化 → checkAndInit → 选择 Crawler → 挂载 CollectPanel → marker
 *       用户点击采集 → CollectPanel.handleCollect → crawl（含 hovercard）→ 预览 → 确认 → 存储
 */
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import CollectPanel from '@/components/CollectPanel.vue'
import { MessageTypes } from '@/types'
import { XiaohongshuNoteCrawler } from '@/crawlers/XiaohongshuNoteCrawler'
import { XiaohongshuFeedCrawler } from '@/crawlers/XiaohongshuFeedCrawler'
import { XiaohongshuAccountCrawler } from '@/crawlers/XiaohongshuAccountCrawler'
import { WechatArticleContentCrawler } from '@/crawlers/WechatArticleContentCrawler'
import { WechatArticleDataCrawler } from '@/crawlers/WechatArticleDataCrawler'
import { WechatAccountHistoryCrawler } from '@/crawlers/WechatAccountHistoryCrawler'

export default defineContentScript({
  matches: ['https://www.xiaohongshu.com/*', 'https://xhslink.com/*', 'https://mp.weixin.qq.com/*'],

  main() {
    console.log('[CJDB] Content script loaded')

    // 创建所有 Crawler（顺序影响多匹配时默认选中）
    const crawlers = [
      new XiaohongshuNoteCrawler(),
      new XiaohongshuFeedCrawler(),
      new XiaohongshuAccountCrawler(),
      new WechatArticleContentCrawler(),
      new WechatArticleDataCrawler(),
      new WechatAccountHistoryCrawler()
    ]

    let currentCrawlers: typeof crawlers = []
    let currentCrawler: (typeof crawlers)[number] | null = null

    // 识别并激活对应的 Crawler
    function checkAndInit() {
      const url = location.href

      // 找到能处理当前 URL 的所有 Crawler
      const crawlersMatch = crawlers.filter((c) => c.canHandle(url))
      const crawler = crawlersMatch[0] ?? null

      if (!crawler) {
        console.log('[CJDB] 未找到匹配的 Crawler')
        return
      }

      // 如果 Crawler 切换了，重新挂载 UI
      const crawlersChanged =
        crawlersMatch.length !== currentCrawlers.length ||
        crawlersMatch.some((c, i) => c !== currentCrawlers[i])

      if (crawlersChanged) {
        currentCrawlers = crawlersMatch
        currentCrawler = crawler

        // 清理旧面板（兼容直接挂载与 Shadow DOM 挂载）
        const oldHost = document.getElementById('cjdb-panel-host')
        if (oldHost) oldHost.remove()

        // Shadow DOM 隔离页面 CSS，避免公众号等页面的全局样式污染 el-dialog、el-form
        const host = document.createElement('div')
        host.id = 'cjdb-panel-host'
        const shadow = host.attachShadow({ mode: 'open' })

        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = browser.runtime.getURL('content-scripts/content.css')
        shadow.appendChild(link)

        const root = document.createElement('div')
        root.id = 'cjdb-panel-root'
        shadow.appendChild(root)

        document.body.appendChild(host)

        const isWeixin = /mp\.weixin\.qq\.com/.test(location.href)
        const wechatHistoryCrawler = isWeixin ? crawlers.find((c) => c.constructor?.name === 'WechatAccountHistoryCrawler') ?? null : null
        const app = createApp(CollectPanel, {
          crawlers: currentCrawlers,
          wechatHistoryCrawler
        })
        app.use(ElementPlus)

        let mounted = false
        const mountApp = () => {
          if (mounted) return
          mounted = true
          app.mount(root)
        }
        link.addEventListener('load', mountApp)
        setTimeout(mountApp, 500)

        console.log('[CJDB] Panel mounted with crawlers:', currentCrawlers.map((c) => c.constructor.name))
      }

      // 运行 marker
      if (currentCrawler) {
        setTimeout(() => currentCrawler!.marker(), 500)
      }
    }

    // 初始化
    checkAndInit()

    // 监听 URL 变化（SPA 页面）
    let lastUrl = location.href
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        checkAndInit()
      }
    }, 500)

    // 监听滚动和 DOM 变化，重新运行 marker
    let markerTimer: ReturnType<typeof setTimeout> | null = null
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
    browser.runtime.onMessage.addListener((msg: { type?: string; message?: string, tabId?: number }) => {
      if (msg.type === MessageTypes.ShowPanelTip) {
        ;(window as any).CJDB_TipsDisplay?.(msg.message)
      }
    })

    const observer = new MutationObserver(runMarker)
    observer.observe(document.body, { childList: true, subtree: true })

    console.log('[CJDB] Event listeners setup')
  }
})
