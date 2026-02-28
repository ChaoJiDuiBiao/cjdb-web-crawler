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
import { XiaohongshuNoteCrawler } from '@/crawlers/XiaohongshuNoteCrawler'
import { XiaohongshuFeedCrawler } from '@/crawlers/XiaohongshuFeedCrawler'
import { XiaohongshuAccountCrawler } from '@/crawlers/XiaohongshuAccountCrawler'

export default defineContentScript({
  matches: ['https://www.xiaohongshu.com/*', 'https://xhslink.com/*'],

  main() {
    console.log('[CJDB] Content script loaded')

    // 创建所有 Crawler
    const crawlers = [
      new XiaohongshuNoteCrawler(),
      new XiaohongshuFeedCrawler(),
      new XiaohongshuAccountCrawler()
    ]

    let currentCrawler: typeof crawlers[number] | null = null

    // 识别并激活对应的 Crawler
    function checkAndInit() {
      const url = location.href

      // 找到能处理当前 URL 的 Crawler
      const crawler = crawlers.find(c => c.canHandle(url))

      if (!crawler) {
        console.log('[CJDB] 未找到匹配的 Crawler')
        return
      }

      // 如果 Crawler 切换了，重新挂载 UI
      if (crawler !== currentCrawler) {
        currentCrawler = crawler

        // 清理旧面板
        const oldRoot = document.getElementById('cjdb-panel-root')
        if (oldRoot) oldRoot.remove()

        // 注入新面板
        const root = document.createElement('div')
        root.id = 'cjdb-panel-root'
        document.body.appendChild(root)

        // 挂载 Vue 应用，传递 crawler
        const app = createApp(CollectPanel, { crawler: currentCrawler })
        app.use(ElementPlus)
        app.mount(root)

        console.log('[CJDB] Panel mounted with crawler:', crawler.constructor.name)
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
        if (currentCrawler && currentCrawler.canHandle(location.href)) {
          currentCrawler.marker()
        }
      }, 300)
    }

    window.addEventListener('scroll', runMarker, { passive: true })

    // 接收 Background 发来的进度提示，调用 Panel 的 tipsDisplay
    browser.runtime.onMessage.addListener((msg: { type?: string; message?: string }) => {
      if (msg.type === 'cjdb-tips-display' && msg.message) {
        ;(window as any).CJDB_TipsDisplay?.(msg.message)
      }
    })

    const observer = new MutationObserver(runMarker)
    observer.observe(document.body, { childList: true, subtree: true })

    console.log('[CJDB] Event listeners setup')
  }
})
