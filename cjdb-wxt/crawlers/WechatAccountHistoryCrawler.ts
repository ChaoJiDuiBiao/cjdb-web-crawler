import type { WechatArticle, WechatHistoryItem } from '@/types'
import { CollectionType } from '@/types'
import { fetchPostHistory, fetchArticleHtml, parseDajialaError } from '@/utils/dajialaApi'

/**
 * 公众号历史文章爬虫
 * 功能：请求历史列表 → 用户选择 → 对选中文章调用详情解析 + 文章数据接口
 */
export class WechatAccountHistoryCrawler {
  canHandle(url: string): boolean {
    // 匹配公众号相关页面，排除文章详情页（文章页由 Content/Data crawler 处理）
    return /mp\.weixin\.qq\.com/.test(url) && !/mp\.weixin\.qq\.com\/s/.test(url)
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
