/**
 * 大加辣 API 封装
 * 接口域名：https://www.dajiala.com
 */
import { browser } from 'wxt/browser'
import { storage } from 'wxt/utils/storage'
import { MessageTypes } from '@/types'
import type { WechatArticle } from '@/types'
import TurndownService from 'turndown'

const DAJIALA_API_KEY = 'local:dajialaApiKey'

// 初始化 Turndown（HTML 转 Markdown）
// 在 content script 环境，有 document 对象
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

/** 解析大加辣 API 错误，返回用户可读提示 */
export function parseDajialaError(res: { code?: number; msg?: string; error?: string }): string {
  const code = res?.code
  const msg = res?.msg || res?.error || ''
  if (code === 20001) {
    return '大加辣余额不足，请求已被限流，约 2 分钟后恢复，请稍后再试'
  }
  if (code === -1 || !code) return msg || '请求失败'
  return msg || `请求失败 (code: ${code})`
}

export async function getDajialaApiKey(): Promise<string> {
  const key = await storage.getItem(DAJIALA_API_KEY)
  return (key as string) || ''
}

export async function setDajialaApiKey(key: string): Promise<void> {
  await storage.setItem(DAJIALA_API_KEY, key)
}

/** 获取公众号历史文章列表。支持 name 或 url，API 可用当前文章 URL 解析公众号 */
export async function fetchPostHistory(params: {
  name?: string
  biz?: string
  url?: string
  page?: number
}): Promise<{ code: number; msg: string; data?: any[]; error?: string }> {
  const apiKey = await getDajialaApiKey()
  if (!apiKey) {
    return { code: -1, msg: '请先在 Popup 中配置大加辣 API Key', error: 'API Key 未配置' }
  }

  const resp = (await browser.runtime.sendMessage({
    type: MessageTypes.DajialaPostHistory,
    payload: {
      name: params.name || '',
      biz: params.biz || '',
      url: params.url || '',
      page: params.page ?? 1
    }
  })) as { code?: number; msg?: string; data?: any; error?: string }
  if (resp && resp.code !== 0 && resp.code !== undefined) {
    resp.error = parseDajialaError(resp)
  }
  return resp || {}
}

/** 获取文章数据（阅读、点赞等） */
export async function fetchArticleData(
  articleUrl: string
): Promise<{ code: number; msg: string; data?: any; error?: string }> {
  const apiKey = await getDajialaApiKey()
  if (!apiKey) {
    return { code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' }
  }

  const resp = (await browser.runtime.sendMessage({
    type: MessageTypes.DajialaArticleData,
    payload: { url: articleUrl }
  })) as { code?: number; msg?: string; data?: any; error?: string }
  if (resp && resp.code !== 0 && resp.code !== undefined) {
    resp.error = parseDajialaError(resp)
  }
  return resp || {}
}

/** 获取公众号主体信息（公司名称、地区、认证等） */
export async function fetchPrincipalInfo(
  articleUrl: string
): Promise<{ code: number; msg: string; data?: any; error?: string }> {
  const apiKey = await getDajialaApiKey()
  if (!apiKey) {
    return { code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' }
  }

  const resp = (await browser.runtime.sendMessage({
    type: MessageTypes.DajialaPrincipalInfo,
    payload: { url: articleUrl }
  })) as { code?: number; msg?: string; data?: any; error?: string }
  if (resp && resp.code !== 0 && resp.code !== undefined) {
    resp.error = parseDajialaError(resp)
  }
  return resp || {}
}

/** 为文章列表补充公众号主体信息（只调用一次 API，所有文章共用） */
export async function augmentWechatArticlesWithPrincipalInfo(
  articles: WechatArticle[],
  onProgress?: (msg: string) => void
): Promise<WechatArticle[]> {
  if (!articles.length) return articles

  // 只用第一篇文章的 URL 调用一次 API
  const firstArticle = articles.find(a => a?.url)
  if (!firstArticle?.url) return articles

  onProgress?.('正在获取公众号主体信息...')
  try {
    const res = await fetchPrincipalInfo(firstArticle.url)
    if (res.code !== 0 && res.code !== undefined) {
      throw new Error(res.error || parseDajialaError(res))
    }
    if (res.data) {
      const d = res.data
      // 构建主体信息对象（只在有值时设置字段）
      const principalInfo: any = {}
      if (d.company_name) principalInfo.companyName = d.company_name

      // region: 优先使用 last_login_province + last_login_country，其次 province，最后 registered_country
      const region = [d.last_login_province, d.last_login_country].filter(Boolean).join(' ') || d.province || d.registered_country
      if (region) principalInfo.region = region

      if (d.name || d.owner_name) principalInfo.name = d.name ?? d.owner_name
      if (d.nick_name || d.nickName) principalInfo.nickname = d.nick_name ?? d.nickName
      if (d.verify_date) principalInfo.verifyDate = d.verify_date
      if (d.gh_id) principalInfo.ghId = d.gh_id
      if (d.verify_customer_type || d.customer_type) principalInfo.verifyType = d.verify_customer_type ?? d.customer_type

      // 将主体信息应用到所有文章
      if (Object.keys(principalInfo).length > 0) {
        articles.forEach(a => {
          a.principalInfo = principalInfo
        })
      }
    }
  } catch (e: any) {
    console.warn('[CJDB] 获取主体信息失败:', firstArticle.url, e)
    throw e
  }
  return articles
}

/** 为文章列表补充阅读量、点赞等 API 数据 */
export async function augmentWechatArticlesWithApiData(
  articles: WechatArticle[],
  onProgress?: (msg: string) => void
): Promise<WechatArticle[]> {
  if (!articles.length) return []
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i]
    if (!a?.url || !a.fetchData) continue
    onProgress?.(`正在获取 ${i + 1}/${articles.length} 篇的阅读数据...`)
    try {
      const res = await fetchArticleData(a.url)
      if (res.code !== 0 && res.code !== undefined) {
        throw new Error(res.error || parseDajialaError(res))
      }
      if (res.data) {
        const d = res.data
        // 只在有值时设置，避免用默认值覆盖已有数据
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
      console.warn('[CJDB] 获取文章数据失败:', a.url, e)
      throw e
    }
  }
  return articles
}

/** 通过 Background 拉取文章 HTML（用于解析正文） */
export async function fetchArticleHtml(
  articleUrl: string
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const resp = await browser.runtime.sendMessage({
    type: MessageTypes.DajialaFetchArticleHtml,
    payload: { url: articleUrl }
  })

  return (resp || { ok: false, error: '请求失败' }) as any
}

/** 获取文章详情（包含 HTML 正文） */
export async function fetchArticleDetail(
  articleUrl: string
): Promise<{ code: number; msg: string; data?: any; error?: string }> {
  const apiKey = await getDajialaApiKey()
  if (!apiKey) {
    return { code: -1, msg: '请先配置大加辣 API Key', error: 'API Key 未配置' }
  }

  const resp = (await browser.runtime.sendMessage({
    type: MessageTypes.DajialaArticleDetail,
    payload: { url: articleUrl }
  })) as { code?: number; msg?: string; data?: any; error?: string }
  if (resp && resp.code !== 0 && resp.code !== undefined) {
    resp.error = parseDajialaError(resp)
  }
  return resp || {}
}

/** 为文章列表补充文章详情（HTML 正文），并转换为 Markdown */
export async function augmentWechatArticlesWithContent(
  articles: WechatArticle[],
  onProgress?: (msg: string) => void
): Promise<WechatArticle[]> {
  if (!articles.length) return articles
  console.log('[CJDB] augmentWechatArticlesWithContent 开始，共', articles.length, '篇文章')

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i]
    if (!a?.url) continue
    onProgress?.(`正在获取 ${i + 1}/${articles.length} 篇的正文...`)
    try {
      console.log('[CJDB] 调用 fetchArticleDetail，URL:', a.url)
      const res = await fetchArticleDetail(a.url)

      if (res.code !== 0 && res.code !== undefined) {
        throw new Error(res.error || parseDajialaError(res))
      }

      // 注意：文章详情接口返回的数据，content 是直接和 code 平行的，不在 data 里
      const d = res as any
      console.log('[CJDB] content 字段存在:', !!d.content, '长度:', d.content?.length || 0)

      if (d.content) {
        a.contentHtml = d.content

        // 转换 HTML 为 Markdown
        try {
          let html = d.content.trim()

          // 预处理：提取 body 内容
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
          if (bodyMatch) {
            html = bodyMatch[1]
          }

          // 移除内联样式和一些无用标签
          html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          html = html.replace(/\s*style="[^"]*"/gi, '')
          html = html.replace(/\s*class="[^"]*"/gi, '')

          const markdown = turndownService.turndown(html)
          a.contentMarkdown = markdown

          console.log('[CJDB] HTML 转 Markdown 成功，Markdown 长度:', markdown.length)
          console.log('[CJDB] Markdown 预览（前500字符）:', markdown.substring(0, 500))
        } catch (e) {
          console.warn('[CJDB] HTML 转 Markdown 失败:', e)
          // 回退到纯文本
          a.contentMarkdown = d.content
        }
      }

      if (!a.title && d.title) a.title = d.title
      if (!a.coverUrl && d.cover_url) a.coverUrl = d.cover_url
      if (!a.publishTimeStr && d.post_time_str) a.publishTimeStr = d.post_time_str

      console.log('[CJDB] 设置后 article.contentMarkdown 存在:', !!a.contentMarkdown, '长度:', a.contentMarkdown?.length || 0)
    } catch (e: any) {
      console.warn('[CJDB] 获取文章详情失败:', a.url, e)
      throw e
    }
  }
  console.log('[CJDB] augmentWechatArticlesWithContent 完成')
  return articles
}
