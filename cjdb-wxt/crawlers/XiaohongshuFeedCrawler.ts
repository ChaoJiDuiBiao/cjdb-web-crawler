import type { XiaohongshuNote } from '@/types'
import { CollectionType } from '@/types'
import { parseDateTime, formatDate } from '@/utils/dateTimeParse'

interface NoteCollectionItem {
  no: number
  checked: boolean
  title: string
  searchKeyword: string   // marker 时锁定的关键词，不随后续搜索变化
  coverUrl?: string
  likes?: number
  authorNickname?: string
  publishTimeStr?: string
}

/**
 * 小红书搜索页爬虫（沿用 feed 选择逻辑）
 * 功能：批量采集搜索结果卡片
 */
export class XiaohongshuFeedCrawler {
  noteCollection: Map<string, NoteCollectionItem> = new Map()
  noteCounter = 0
  lastFeedUrl = ''
  lastSearchKeyword = ''   // marker 时记录的最新关键词

  canHandle(url: string): boolean {
    return /xiaohongshu\.com\/explore(?:\?|$)/.test(url) ||
           /xiaohongshu\.com\/search_result\b/.test(url)
  }

  async crawl(opts?: { onProgress?: (msg: string) => void }): Promise<XiaohongshuNote[]> {
    // 通用 tips 显示函数（爬取过程中一直显示）
    const showTip = (msg: string) => {
      opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    // 用 marker 时锁定的关键词，避免用户切换搜索后 crawl 拿到错误的词
    const currentKeyword = this.lastSearchKeyword || this.getSearchKeyword()

    showTip(`正在采集搜索结果${currentKeyword ? `（${currentKeyword}）` : ''}...`)

    const results: XiaohongshuNote[] = []

    this.noteCollection.forEach((item, url) => {
      if (!item.checked) return

      // 每条笔记使用自身 marker 时锁定的 searchKeyword
      const searchKeyword = item.searchKeyword || currentKeyword

      const noteId = this.extractNoteIdFromUrl(url)
      const link = this.findNoteLinkInDom(url, noteId)
      if (!link) {
        results.push({
          url,
          noteId,
          searchKeyword,
          title: item.title || '',
          likes: item.likes,
          coverUrl: item.coverUrl,
          imageUrls: item.coverUrl,
          authorNickname: item.authorNickname,
          publishTimeStr: item.publishTimeStr,
          source: 'dom',
          crawledAt: new Date().toISOString()
        })
        return
      }

      const card = this.resolveCardContainer(link as HTMLElement)
      const data = this.extractFromCard(card as HTMLElement, url, searchKeyword)
      if (!data.title) data.title = item.title || ''
      if (!data.likes && item.likes != null) data.likes = item.likes
      if (!data.coverUrl && item.coverUrl) {
        data.coverUrl = item.coverUrl
        data.imageUrls = item.coverUrl
      }
      if (!data.authorNickname && item.authorNickname) data.authorNickname = item.authorNickname
      if (!data.publishTimeStr && item.publishTimeStr) data.publishTimeStr = item.publishTimeStr
      results.push(data)
    })

    showTip(`已采集 ${results.length} 条搜索结果`)

    return results
  }

  marker(): void {
    const url = location.href
    const searchKeyword = this.getSearchKeyword()

    // URL 或关键词任一变化，都重置采集列表
    if (url !== this.lastFeedUrl || searchKeyword !== this.lastSearchKeyword) {
      this.noteCollection.clear()
      this.noteCounter = 0
      this.lastFeedUrl = url
      this.lastSearchKeyword = searchKeyword
    }

    this.injectMarkerStyles()

    const noteItems = this.getAllNoteItems()

    noteItems.forEach(item => {
      const noteUrl = this.getNoteUrl(item)
      if (!noteUrl) return

      const snapshot = this.extractFromCard(item, noteUrl, searchKeyword)
      const existing = this.noteCollection.get(noteUrl)

      if (!existing) {
        this.noteCounter++
        this.noteCollection.set(noteUrl, {
          no: this.noteCounter,
          checked: true,
          searchKeyword,
          title: snapshot.title || item.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || '',
          coverUrl: snapshot.coverUrl,
          likes: snapshot.likes,
          authorNickname: snapshot.authorNickname,
          publishTimeStr: snapshot.publishTimeStr
        })
        // 每标记一条就更新提示（使用 updateKey 更新同一个 tip）
        ;(window as any).CJDB_TipsDisplay?.(`已标记 ${this.noteCounter} 条搜索结果`, true, 'marker-feed')
      } else {
        if (!existing.title && snapshot.title) existing.title = snapshot.title
        if (!existing.coverUrl && snapshot.coverUrl) existing.coverUrl = snapshot.coverUrl
        if ((existing.likes == null || existing.likes === 0) && snapshot.likes != null) existing.likes = snapshot.likes
        if (!existing.authorNickname && snapshot.authorNickname) existing.authorNickname = snapshot.authorNickname
        if (!existing.publishTimeStr && snapshot.publishTimeStr) existing.publishTimeStr = snapshot.publishTimeStr
      }
    })

    noteItems.forEach(item => {
      const noteUrl = this.getNoteUrl(item)
      const entry = this.noteCollection.get(noteUrl)
      if (entry) {
        this.injectNoteMarker(item, `#${entry.no}`, noteUrl, entry)
      }
    })

    window.dispatchEvent(new CustomEvent('cjdb-collection-changed'))
  }

  getCrawlerState() {
    let checkedCount = 0
    this.noteCollection.forEach(item => {
      if (item.checked) checkedCount++
    })

    return {
      collectionType: CollectionType.XHSFeed,
      total: this.noteCollection.size,
      checked: checkedCount
    }
  }

  private getAllNoteItems(): HTMLElement[] {
    const links = document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')
    const cards = new Map<string, HTMLElement>()

    for (const link of links) {
      const normalizedUrl = this.normalizeNoteUrl((link as HTMLAnchorElement).href || link.getAttribute('href') || '')
      if (!normalizedUrl) continue
      const noteId = this.extractNoteIdFromUrl(normalizedUrl)
      if (!noteId) continue

      const card = this.resolveCardContainer(link as HTMLElement)

      if (card && card !== document.body && !cards.has(noteId)) {
        cards.set(noteId, card)
      }
    }

    return Array.from(cards.values())
  }

  private getNoteUrl(item: HTMLElement): string {
    const preferred = this.findPreferredNoteLink(item)
    return preferred ? this.normalizeNoteUrl(preferred.href) : ''
  }

  private extractFromCard(card: HTMLElement, url: string, searchKeyword: string): XiaohongshuNote {
    const noteId = this.extractNoteIdFromUrl(url)
    const title = card.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || ''
    const coverImg = card.querySelector(
      'a.cover img, a[class*="cover"] img, img[data-xhs-img], .cover img, [class*="cover"] img, img'
    ) as HTMLImageElement
    const coverUrl = coverImg?.src || coverImg?.dataset?.src || ''
    const authorNickname = this.extractAuthorNickname(card)
    const publishTimeRaw = this.extractPublishTimeText(card)
    const publishTimeStr = this.normalizePublishTime(publishTimeRaw)

    const parseCount = (text: string): number => {
      const match = text.match(/(\d+\.?\d*)(k|w|万|千)?/i)
      if (!match) return 0
      const num = parseFloat(match[1])
      const unit = (match[2] || '').toLowerCase()
      if (unit === 'w' || unit === '万') return Math.round(num * 10000)
      if (unit === 'k' || unit === '千') return Math.round(num * 1000)
      return Math.round(num)
    }

    const likesEl = card.querySelector('.like-count, .likes, [class*="like"]')
    const likes = likesEl ? parseCount(likesEl.textContent || '') : 0

    return {
      url,
      noteId,
      searchKeyword,
      title,
      likes,
      publishTimeStr: publishTimeStr || undefined,
      authorNickname: authorNickname || undefined,
      coverUrl: coverUrl || undefined,
      imageUrls: coverUrl,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
  }

  private extractAuthorNickname(card: HTMLElement): string {
    const wrapper = this.findNameTimeWrapper(card)
    if (wrapper) {
      const direct = Array.from(wrapper.children).find((el) => el.classList.contains('name')) as HTMLElement | undefined
      const directText = direct?.textContent?.trim() || ''
      if (directText) return directText

      const nested = wrapper.querySelector('.name') as HTMLElement | null
      const nestedText = nested?.textContent?.trim() || ''
      if (nestedText) return nestedText
    }

    return ''
  }

  private extractPublishTimeText(card: HTMLElement): string {
    const wrapper = this.findNameTimeWrapper(card)
    if (wrapper) {
      const direct = Array.from(wrapper.children).find((el) => el.classList.contains('time')) as HTMLElement | undefined
      const directText = direct?.textContent?.trim() || ''
      if (directText) return directText

      const nested = wrapper.querySelector('.time') as HTMLElement | null
      const nestedText = nested?.textContent?.trim() || ''
      if (nestedText) return nestedText
    }

    return ''
  }

  private findNameTimeWrapper(card: HTMLElement): HTMLElement | null {
    const wrappers = Array.from(card.querySelectorAll('.name-time-wrapper')) as HTMLElement[]
    for (const wrapper of wrappers) {
      const hasName = !!Array.from(wrapper.children).find((el) => el.classList.contains('name')) || !!wrapper.querySelector('.name')
      const hasTime = !!Array.from(wrapper.children).find((el) => el.classList.contains('time')) || !!wrapper.querySelector('.time')
      if (hasName && hasTime) {
        return wrapper
      }
    }
    return null
  }

  private normalizePublishTime(raw: string): string {
    const text = String(raw || '').replace(/·/g, ' ').trim()
    if (!text) return ''

    const direct = parseDateTime(text)
    if (direct) return formatDate(direct)

    const fallback = text.match(/(\d+\s*(分钟前|小时前|天前|周前|星期前)|昨天\s*\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2})?)/)
    if (fallback?.[1]) {
      const parsed = parseDateTime(fallback[1])
      if (parsed) return formatDate(parsed)
    }

    return ''
  }

  private isNoteHref(href: string): boolean {
    return /\/search_result\/[\w-]+/.test(href) || /\/explore\/[\w-]+/.test(href)
  }

  private findNoteLinkInDom(targetUrl: string, noteId: string): HTMLAnchorElement | null {
    const normalizedTarget = this.normalizeNoteUrl(targetUrl)
    const links = document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')

    if (normalizedTarget) {
      for (const a of links) {
        const link = a as HTMLAnchorElement
        const normalized = this.normalizeNoteUrl(link.href || link.getAttribute('href') || '')
        if (normalized && normalized === normalizedTarget) return link
      }
    }

    if (noteId) {
      for (const a of links) {
        const link = a as HTMLAnchorElement
        const href = link.href || link.getAttribute('href') || ''
        if (href.includes(`/search_result/${noteId}`) || href.includes(`/explore/${noteId}`)) return link
      }
    }

    return null
  }

  private normalizeNoteUrl(href: string): string {
    try {
      const u = new URL(href, location.origin)
      if (!this.isNoteHref(u.pathname)) return ''
      u.hash = ''
      return u.toString()
    } catch {
      return ''
    }
  }

  private extractNoteIdFromUrl(url: string): string {
    const m = url.match(/\/(?:search_result|explore)\/([\w-]+)/)
    return m?.[1] || ''
  }

  private findPreferredNoteLink(root: HTMLElement): HTMLAnchorElement | null {
    const candidates: HTMLAnchorElement[] = []

    if (root.tagName === 'A') {
      const self = root as HTMLAnchorElement
      if (self.href && this.isNoteHref(self.href)) candidates.push(self)
    }

    const nested = root.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')
    nested.forEach((a) => {
      const el = a as HTMLAnchorElement
      if (el.href && this.isNoteHref(el.href)) candidates.push(el)
    })

    let p = root.parentElement
    for (let d = 0; d < 6 && p; d++) {
      if (p.tagName === 'A') {
        const a = p as HTMLAnchorElement
        if (a.href && this.isNoteHref(a.href)) candidates.push(a)
      }
      p = p.parentElement
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => this.noteLinkScore(b) - this.noteLinkScore(a))
    return candidates[0]
  }

  private noteLinkScore(a: HTMLAnchorElement): number {
    let score = 0
    const href = a.href || ''
    if (/\/search_result\/[\w-]+/.test(href)) score += 50
    if (href.includes('xsec_token=')) score += 100
    if (a.className.includes('cover')) score += 20
    return score
  }

  private resolveCardContainer(linkEl: HTMLElement): HTMLElement {
    let el: HTMLElement | null = linkEl
    let fallback: HTMLElement = linkEl

    for (let depth = 0; depth < 8 && el && el !== document.body; depth++) {
      const hasMedia = !!el.querySelector('img, video')
      const hasTitle = !!el.querySelector('.title, .note-title, [class*="title"]')
      const hasAuthorOrTime = !!el.querySelector(
        '.name-time-wrapper .name, .name-time-wrapper .time, .author .name, .author-name, .time'
      )
      if (hasMedia) fallback = el
      if (hasMedia && (hasTitle || hasAuthorOrTime)) {
        return el
      }
      el = el.parentElement
    }

    return fallback
  }

  private getSearchKeyword(): string {
    const decodeKeyword = (raw: string): string => {
      let value = String(raw || '').trim()
      if (!value) return ''

      // 最多解码 2 次，兼容 keyword=%25E7...（解码后变成 %E7...）场景
      for (let i = 0; i < 2; i++) {
        try {
          const decoded = decodeURIComponent(value)
          if (!decoded || decoded === value) break
          value = decoded
        } catch {
          break
        }
      }

      return value.trim()
    }

    // 1) 优先从 DOM 搜索输入框读取
    const input = document.querySelector(
      'input[type="search"], input[placeholder*="搜索"], input[class*="search"], input[id*="search"]'
    ) as HTMLInputElement | null
    if (input?.value?.trim()) {
      const fromDom = decodeKeyword(input.value)
      if (fromDom) return fromDom
    }

    // 2) 其次从 URL 参数读取
    const url = new URL(location.href)
    const candidates = [
      url.searchParams.get('keyword'),
      url.searchParams.get('q'),
      url.searchParams.get('query')
    ]
      .map(v => decodeKeyword(v || ''))
      .filter(Boolean)

    if (candidates.length > 0) return candidates[0]

    return document.title.replace(' - 小红书', '').trim()
  }

  private injectNoteMarker(item: HTMLElement, label: string, url: string, entry: NoteCollectionItem): void {
    let wrapper = item.querySelector('.cjdb-note-checkbox-wrapper') as HTMLElement
    if (!wrapper) {
      wrapper = document.createElement('span')
      wrapper.className = 'cjdb-note-checkbox-wrapper'
      const style = getComputedStyle(item)
      if (style.position === 'static') item.style.position = 'relative'
      item.insertBefore(wrapper, item.firstChild)
    }

    let numEl = wrapper.querySelector('.cjdb-note-marker') as HTMLElement
    if (!numEl) {
      numEl = document.createElement('span')
      numEl.className = 'cjdb-note-marker'
      wrapper.appendChild(numEl)
    }
    numEl.textContent = label

    let cb = wrapper.querySelector('.cjdb-note-checkbox') as HTMLElement
    if (!cb) {
      cb = document.createElement('span')
      cb.className = 'cjdb-note-checkbox'
      cb.onclick = (e) => {
        e.stopPropagation()
        entry.checked = !entry.checked
        cb.textContent = entry.checked ? '✓' : '○'
        cb.style.background = entry.checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)'
        window.dispatchEvent(new CustomEvent('cjdb-collection-changed'))
      }
      wrapper.appendChild(cb)
    }

    cb.textContent = entry.checked ? '✓' : '○'
    cb.style.background = entry.checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)'
  }

  private injectMarkerStyles(): void {
    if (document.getElementById('cjdb-xhs-feed-marker-style')) return

    const style = document.createElement('style')
    style.id = 'cjdb-xhs-feed-marker-style'
    style.textContent = `
      .cjdb-note-checkbox-wrapper {
        position: absolute !important;
        top: 8px !important;
        left: 8px !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        z-index: 10 !important;
      }
      .cjdb-note-marker {
        display: inline-block !important;
        background: rgba(255,36,66,0.9) !important;
        color: #fff !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        pointer-events: none !important;
        border: 1px solid rgba(255,255,255,0.5) !important;
      }
      .cjdb-note-checkbox {
        display: inline-block !important;
        width: 20px !important;
        height: 20px !important;
        line-height: 20px !important;
        text-align: center !important;
        font-size: 14px !important;
        font-weight: bold !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        user-select: none !important;
        border: 1px solid rgba(255,255,255,0.5) !important;
      }
    `
    document.head.appendChild(style)
  }
}
