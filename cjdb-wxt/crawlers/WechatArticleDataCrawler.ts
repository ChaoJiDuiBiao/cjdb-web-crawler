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
 * 公众号文章数据爬虫
 * 功能：采集 DOM 内容（正文 Markdown、时间、公众号名称等），额外数据（阅读/点赞等）在确认弹窗中勾选后由 API 补充
 */
export class WechatArticleDataCrawler {
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

    // 标题
    const title =
      document.querySelector('#activity-name')?.textContent?.trim() ||
      document.querySelector('.rich_media_title')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.replace(/\s*[|｜-]\s*微信公众号$/, '').trim() ||
      '未知标题'

    // 发布时间
    let publishTimeStr = ''
    const publishTimeEl = document.querySelector('#publish_time')
    if (publishTimeEl) {
      publishTimeStr = publishTimeEl.textContent?.trim() || ''
    }

    // 公众号名称
    let mpNickname = ''
    const mpNameEl = document.querySelector('#js_name')
    if (mpNameEl) {
      mpNickname = mpNameEl.textContent?.trim() || ''
    }

    // IP 归属地
    let ipLocation = ''
    const ipEl = document.querySelector('#js_ip_wording')
    if (ipEl) {
      ipLocation = ipEl.textContent?.trim() || ''
    }

    // 正文
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
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

        contentMarkdown = turndownService.turndown(html)
        console.log('[WechatDataCrawler] HTML 转 Markdown 成功，长度:', contentMarkdown.length)
      } catch (e) {
        console.warn('[WechatDataCrawler] HTML 转 Markdown 失败:', e)
        const clone = contentEl.cloneNode(true) as HTMLElement
        clone.querySelectorAll('script, style').forEach((el) => el.remove())
        contentMarkdown = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
      }

      // 3. 纯文本
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

  marker(): void {}

  getCrawlerState() {
    return { collectionType: CollectionType.WechatArticle, total: 1, checked: 1 }
  }
}
