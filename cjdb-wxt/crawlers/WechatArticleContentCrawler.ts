import type { WechatArticle } from '@/types'
import { CollectionType } from '@/types'
import TurndownService from 'turndown'

// 初始化 Turndown（HTML 转 Markdown）
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  linkReferenceStyle: 'full'
})

// 添加自定义规则
turndownService.addRule('preserveLineBreaks', {
  filter: ['br'],
  replacement: () => '\n'
})

turndownService.addRule('images', {
  filter: 'img',
  replacement: (content, node: any) => {
    const alt = node.alt || ''
    const src = node.src || ''
    return src ? `![${alt}](${src})` : ''
  }
})

// 移除无用标签
turndownService.remove(['script', 'style', 'svg', 'iframe'])

/**
 * 公众号文章内容爬虫
 * 功能：采集网页版正文、标题、时间、公众号名称、归属地等（DOM 解析 + HTML 转 Markdown）
 */
export class WechatArticleContentCrawler {
  canHandle(url: string): boolean {
    return /mp\.weixin\.qq\.com\/s/.test(url)
  }

  async crawl(_opts?: { onProgress?: (msg: string) => void }): Promise<WechatArticle> {
    const showTip = (msg: string) => {
      _opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    showTip('正在解析文章内容...')

    const url = location.href.split('?')[0]

    // 标题：优先 #activity-name，备选 .rich_media_title 等
    const title =
      document.querySelector('#activity-name')?.textContent?.trim() ||
      document.querySelector('.rich_media_title')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.replace(/\s*[|｜-]\s*微信公众号$/, '').trim() ||
      '未知标题'

    // 发布时间：从 <em id="publish_time"> 提取
    let publishTimeStr = ''
    const publishTimeEl = document.querySelector('#publish_time')
    if (publishTimeEl) {
      publishTimeStr = publishTimeEl.textContent?.trim() || ''
    }

    // 公众号名称：从 <a id="js_name"> 提取
    let mpNickname = ''
    const mpNameEl = document.querySelector('#js_name')
    if (mpNameEl) {
      mpNickname = mpNameEl.textContent?.trim() || ''
    }

    // IP 归属地：从 <span id="js_ip_wording"> 提取
    let ipLocation = ''
    const ipEl = document.querySelector('#js_ip_wording')
    if (ipEl) {
      ipLocation = ipEl.textContent?.trim() || ''
    }

    // 正文：优先 #js_content，备选 .rich_media_content
    let content = ''
    let contentHtml = ''
    let contentMarkdown = ''

    const contentEl =
      document.querySelector('#js_content') || document.querySelector('.rich_media_content')

    if (contentEl) {
      // 1. 保存原始 HTML
      contentHtml = contentEl.innerHTML || ''

      // 2. 转换为 Markdown
      try {
        let html = contentHtml.trim()

        // 移除 script、style 标签
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

        // 移除内联样式和 class（可选，看是否需要保留）
        // html = html.replace(/\s*style="[^"]*"/gi, '')
        // html = html.replace(/\s*class="[^"]*"/gi, '')

        contentMarkdown = turndownService.turndown(html)
        console.log('[WechatContentCrawler] HTML 转 Markdown 成功，长度:', contentMarkdown.length)
        console.log('[WechatContentCrawler] Markdown 预览（前500字符）:', contentMarkdown.substring(0, 500))
      } catch (e) {
        console.warn('[WechatContentCrawler] HTML 转 Markdown 失败:', e)
        // 回退到纯文本
        const clone = contentEl.cloneNode(true) as HTMLElement
        clone.querySelectorAll('script, style').forEach((el) => el.remove())
        contentMarkdown = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
      }

      // 3. 纯文本（用于备用）
      const clone = contentEl.cloneNode(true) as HTMLElement
      clone.querySelectorAll('script, style').forEach((el) => el.remove())
      content = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
    }

    showTip('文章内容采集完成')

    return {
      url,
      title,
      content,
      contentHtml,
      contentMarkdown,
      publishTimeStr,
      ipLocation,
      principalInfo: mpNickname ? { nickname: mpNickname } : undefined,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
  }

  marker(): void {
    // 单篇文章，无需标注
  }

  getCrawlerState() {
    return {
      collectionType: CollectionType.WechatArticle,
      total: 1,
      checked: 1
    }
  }
}
