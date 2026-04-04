import type { WechatArticle, WechatHistoryItem } from '@/types'
import { CollectionType } from '@/types'
import {
  fetchPostHistory,
  fetchArticleHtml,
  fetchArticleData,
  fetchArticleDetail,
  fetchPrincipalInfo,
  parseDajialaError
} from '@/utils/dajialaApi'
import TurndownService from 'turndown'

type HistoryEnrichStage = 'content' | 'data' | 'principal'

type EnrichHistoryOptions = {
  fetchPrincipalInfo?: boolean
  onProgress?: (msg: string) => void
  onItemError?: (payload: { url: string; stage: HistoryEnrichStage; message: string }) => void
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  linkReferenceStyle: 'full'
})

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

turndownService.remove(['script', 'style', 'svg', 'iframe'])

/**
 * 公众号历史文章爬虫
 * 功能：请求历史列表 → 用户选择 → 对选中文章调用详情解析 + 文章数据接口
 */
export class WechatAccountHistoryCrawler {
  canHandle(url: string): boolean {
    // 所有公众号页面都支持历史文章功能（包括文章页和非文章页）
    return /mp\.weixin\.qq\.com/.test(url)
  }

  /** 加载历史文章列表（供 Panel 调用）。支持 name 或 url，API 可用当前文章 URL 解析公众号并拉取历史 */
  async loadHistory(
    opts: string | { name?: string; url?: string; page?: number }
  ): Promise<{
    items: WechatHistoryItem[]
    total: number
    totalPage: number
    mpNickname?: string
    error?: string
  }> {
    const params =
      typeof opts === 'string'
        ? { name: opts, page: 1 }
        : { name: opts.name || '', url: opts.url || '', page: opts.page ?? 1 }
    const res = await fetchPostHistory(params)
    if (res.error) {
      return { items: [], total: 0, totalPage: 0, error: res.error }
    }
    if (res.code !== 0 && res.code !== undefined) {
      return { items: [], total: 0, totalPage: 0, error: res.error || parseDajialaError(res) }
    }

    const resAny = res as any
    const list = Array.isArray(resAny.data) ? resAny.data : []
    const items: WechatHistoryItem[] = list.map((item: any) => ({
      url: item.url || '',
      title: item.title || '无标题',
      post_time_str: item.post_time_str,
      cover_url: item.cover_url || item.pic_cdn_url_1_1,
      digest: item.digest,
      position: item.position
    }))

    return {
      items,
      total: resAny.total_num ?? resAny.totalNum ?? items.length,
      totalPage: resAny.total_page ?? resAny.totalPage ?? 1,
      mpNickname: resAny.mp_nickname ?? resAny.mpNickname
    }
  }

  async crawl(opts?: {
    selectedItems: WechatHistoryItem[]
    onProgress?: (msg: string) => void
  }): Promise<WechatArticle[]> {
    const selected = opts?.selectedItems || []
    const showTip = (msg: string) => {
      opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    if (selected.length === 0) {
      throw new Error('请先选择要采集的文章')
    }

    const results: WechatArticle[] = []

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i]
      const url = item.url?.trim()
      if (!url) continue

      showTip(`正在采集 ${i + 1}/${selected.length}: ${(item.title || '').slice(0, 30)}...`)

      let title = item.title
      let content = ''
      let publishTimeStr = item.post_time_str
      let coverUrl = item.cover_url

      // 1. 拉取 HTML 解析正文和标题
      try {
        const htmlRes = await fetchArticleHtml(url)
        if (htmlRes.ok && htmlRes.html) {
          const doc = new DOMParser().parseFromString(htmlRes.html, 'text/html')
          title =
            doc.querySelector('#activity-name')?.textContent?.trim() ||
            doc.querySelector('.rich_media_title')?.textContent?.trim() ||
            item.title
          const contentEl = doc.querySelector('#js_content') || doc.querySelector('.rich_media_content')
          if (contentEl) {
            const clone = contentEl.cloneNode(true) as HTMLElement
            clone.querySelectorAll('script, style').forEach((el) => el.remove())
            content = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
          }
        }
      } catch (e) {
        console.warn('[CJDB] 解析文章 HTML 失败:', url, e)
      }

      // 仅采集页面内容，阅读量等数据在确认弹窗勾选「额外数据」后由 API 补充
      results.push({
        url,
        title: title || '未知标题',
        content,
        publishTimeStr,
        coverUrl,
        source: 'dom',
        crawledAt: new Date().toISOString()
      })
    }

    showTip('历史文章采集完成')
    return results
  }

  async enrichArticles(
    articles: WechatArticle[],
    opts?: EnrichHistoryOptions
  ): Promise<WechatArticle[]> {
    if (!articles.length) return articles

    const reportItemError = (url: string, stage: HistoryEnrichStage, message: string) => {
      opts?.onItemError?.({ url, stage, message })
    }

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i]
      const url = a?.url?.trim()
      if (!url) continue

      opts?.onProgress?.(`正在获取 ${i + 1}/${articles.length} 篇的正文...`)
      try {
        const res = await fetchArticleDetail(url)
        if (res.code !== 0) {
          throw new Error(res.error || parseDajialaError(res))
        }

        const d = res as any
        if (d.content) {
          a.contentHtml = d.content
          try {
            let html = d.content.trim()
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
            if (bodyMatch) html = bodyMatch[1]

            html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            html = html.replace(/\s*style="[^"]*"/gi, '')
            html = html.replace(/\s*class="[^"]*"/gi, '')

            a.contentMarkdown = turndownService.turndown(html)
          } catch {
            a.contentMarkdown = d.content
          }
        }

        if (!a.title && d.title) a.title = d.title
        if (!a.coverUrl && d.cover_url) a.coverUrl = d.cover_url
        if (!a.publishTimeStr && d.post_time_str) a.publishTimeStr = d.post_time_str
      } catch (e: any) {
        const message = e?.message || String(e)
        console.warn('[CJDB] 获取文章正文失败:', url, e)
        reportItemError(url, 'content', message)
      }
    }

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i]
      const url = a?.url?.trim()
      if (!url || !a.fetchData) continue

      opts?.onProgress?.(`正在获取 ${i + 1}/${articles.length} 篇的阅读数据...`)
      try {
        const res = await fetchArticleData(url)
        if (res.code !== 0) {
          throw new Error(res.error || parseDajialaError(res))
        }

        if (res.data) {
          const d = res.data
          if (d.read != null) a.read = d.read
          if (d.zan != null) a.zan = d.zan
          if (d.looking != null) a.looking = d.looking
          if (d.share_num != null) a.shareNum = d.share_num
          if (d.collect_num != null) a.collectNum = d.collect_num
          if (d.comment_count != null) a.commentCount = d.comment_count
          if (!a.publishTimeStr) a.publishTimeStr = d.publish_time_str || d.publishTimeStr
          if (!a.coverUrl) a.coverUrl = d.cover_url || d.coverUrl
          if (!a.title && d.title) a.title = d.title
        }
      } catch (e: any) {
        const message = e?.message || String(e)
        console.warn('[CJDB] 获取文章数据失败:', url, e)
        reportItemError(url, 'data', message)
      }
    }

    if (opts?.fetchPrincipalInfo) {
      const firstArticle = articles.find((a) => a?.url)
      if (firstArticle?.url) {
        opts.onProgress?.('正在获取公众号主体信息...')
        try {
          const res = await fetchPrincipalInfo(firstArticle.url)
          if (res.code !== 0) {
            throw new Error(res.error || parseDajialaError(res))
          }
          if (res.data) {
            const d = res.data
            const principalInfo: any = {}
            if (d.company_name) principalInfo.companyName = d.company_name
            const region = [d.last_login_province, d.last_login_country].filter(Boolean).join(' ') || d.province || d.registered_country
            if (region) principalInfo.region = region
            if (d.name || d.owner_name) principalInfo.name = d.name ?? d.owner_name
            if (d.nick_name || d.nickName) principalInfo.nickname = d.nick_name ?? d.nickName
            if (d.verify_date) principalInfo.verifyDate = d.verify_date
            if (d.gh_id) principalInfo.ghId = d.gh_id
            if (d.verify_customer_type || d.customer_type) principalInfo.verifyType = d.verify_customer_type ?? d.customer_type
            if (Object.keys(principalInfo).length > 0) {
              articles.forEach((a) => {
                a.principalInfo = principalInfo
              })
            }
          }
        } catch (e: any) {
          const message = e?.message || String(e)
          console.warn('[CJDB] 获取公众号主体信息失败:', firstArticle.url, e)
          articles.forEach((a) => {
            const url = a?.url?.trim()
            if (url) reportItemError(url, 'principal', message)
          })
        }
      }
    }

    return articles
  }

  marker(): void {
    // 历史列表来自 API，无 DOM 标注
  }

  getCrawlerState() {
    return {
      collectionType: CollectionType.WechatArticle,
      total: 0,
      checked: 0
    }
  }
}
