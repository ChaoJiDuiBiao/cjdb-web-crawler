import type { FeishuDoc } from '@/types'
import { CollectionType } from '@/types'
import TurndownService from 'turndown'
import { feishuRuntimeDocToMarkdown, feishuRuntimeDocToText } from '@/utils/feishuMarkdown'
import { requestFeishuRuntimeDoc } from '@/utils/feishuRuntime'

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
  replacement: (_content, node: any) => {
    const alt = node.alt || ''
    const src = node.src || ''
    return src ? `![${alt}](${src})` : ''
  }
})

turndownService.remove(['script', 'style', 'svg', 'canvas', 'iframe'])

const CONTENT_CANDIDATE_SELECTORS = [
  '.page-block-children',
  '.root-render-unit-container',
  '.page-block',
  '[role="main"]',
  'main'
]

const REMOVE_SELECTORS = [
  'script',
  'style',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'aside',
  'header',
  'footer',
  '[role="navigation"]',
  '[role="dialog"]',
  '[role="toolbar"]',
  '[class*="sidebar"]',
  '[class*="catalog"]',
  '[class*="outline"]',
  '[class*="toolbar"]',
  '[class*="comment"]',
  '[class*="float"]',
  '[class*="popover"]',
  '[class*="modal"]',
  '[class*="watermark"]'
]

function stripTitleSuffix(title: string): string {
  return String(title || '')
    .replace(/\s*[-|｜]\s*(飞书云文档|飞书文档|飞书知识库|Feishu Docs|Lark Docs).*$/i, '')
    .trim()
}

function detectDocType(pathname: string): string {
  if (/\/docx\//.test(pathname)) return '文档'
  if (/\/docs\//.test(pathname)) return '旧版文档'
  if (/\/wiki\//.test(pathname)) return '知识库'
  if (/\/sheet\//.test(pathname)) return '电子表格'
  if (/\/slides\//.test(pathname)) return '幻灯片'
  if (/\/mindnote\//.test(pathname)) return '思维笔记'
  if (/\/base\//.test(pathname)) return '多维表格'
  return '飞书文档'
}

function normalizeWhitespace(text: string): string {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractTitleFromDom(): string {
  const title =
    document.querySelector('h1.page-block-content')?.textContent ||
    document.querySelector('.page-block-header .page-block-content')?.textContent ||
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    document.title ||
    '未命名文档'

  return stripTitleSuffix(title) || '未命名文档'
}

function extractWorkspace(): string {
  const hostWorkspace = location.hostname.split('.').slice(0, -2).join('.')
  const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || ''
  return (siteName && !/(飞书|feishu|lark)/i.test(siteName) ? siteName : '') || hostWorkspace || '飞书'
}

function findContentRoot(): HTMLElement {
  for (const selector of CONTENT_CANDIDATE_SELECTORS) {
    const el = document.querySelector(selector)
    if (el instanceof HTMLElement) return el
  }
  return document.body
}

function parseDomFallback(title: string) {
  const root = findContentRoot()
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll(REMOVE_SELECTORS.join(',')).forEach((el) => el.remove())
  clone.querySelectorAll('h1, h2, [class*="title"]').forEach((el) => {
    const text = normalizeWhitespace((el as HTMLElement).innerText || el.textContent || '')
    if (text && text === title) el.remove()
  })

  const contentHtml = clone.innerHTML || ''
  const contentMarkdown = normalizeWhitespace(turndownService.turndown(contentHtml))
  const content = normalizeWhitespace(clone.innerText || clone.textContent || '')
  return { contentHtml, contentMarkdown, content }
}

function pickRuntimeTitle(runtimeTitle: string | undefined, fallbackTitle: string): string {
  const title = normalizeWhitespace(runtimeTitle || '')
  if (!title) return fallbackTitle
  if (title.includes('\n')) return fallbackTitle
  if (title.length > 150) return fallbackTitle
  return stripTitleSuffix(title) || fallbackTitle
}

export class FeishuDocCrawler {
  canHandle(url: string): boolean {
    return /https:\/\/[^/]+\.feishu\.cn\/(docx|docs|wiki|sheet|slides|mindnote|base)\//.test(url)
  }

  async crawl(opts?: { onProgress?: (msg: string) => void }): Promise<FeishuDoc> {
    const showTip = (msg: string) => {
      opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    const url = location.href.split(/[?#]/)[0]
    const fallbackTitle = extractTitleFromDom()
    const workspace = extractWorkspace()
    const docType = detectDocType(location.pathname)

    showTip('正在读取飞书文档 runtime...')

    try {
      const runtimeDoc = await requestFeishuRuntimeDoc()
      const title = pickRuntimeTitle(runtimeDoc.title, fallbackTitle)
      const contentMarkdown = normalizeWhitespace(feishuRuntimeDocToMarkdown(runtimeDoc))
      const content = normalizeWhitespace(feishuRuntimeDocToText(runtimeDoc))
      const excerpt = (contentMarkdown || content).slice(0, 300).trim()

      if (!contentMarkdown && !content) {
        throw new Error('飞书 runtime 返回空正文')
      }

      showTip('飞书文档采集完成')
      return {
        url,
        title,
        docType,
        workspace,
        excerpt,
        content,
        contentMarkdown,
        source: 'runtime',
        crawledAt: new Date().toISOString()
      }
    } catch (error) {
      console.warn('[FeishuDocCrawler] runtime 采集失败，回退 DOM:', error)
    }

    showTip('飞书 runtime 不可用，回退 DOM 解析...')
    const domParsed = parseDomFallback(fallbackTitle)
    const excerpt = (domParsed.contentMarkdown || domParsed.content).slice(0, 300).trim()

    showTip('飞书文档采集完成')
    return {
      url,
      title: fallbackTitle,
      docType,
      workspace,
      excerpt,
      content: domParsed.content,
      contentHtml: domParsed.contentHtml,
      contentMarkdown: domParsed.contentMarkdown,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
  }

  marker(): void {
    // 单篇文档，无需额外标注
  }

  getCrawlerState() {
    return {
      collectionType: CollectionType.FeishuDoc,
      total: 1,
      checked: 1
    }
  }
}
