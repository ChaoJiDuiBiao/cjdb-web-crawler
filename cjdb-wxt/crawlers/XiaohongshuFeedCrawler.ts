import type { XiaohongshuNote } from '@/types'
import { CollectionType } from '@/types'

interface NoteCollectionItem {
  no: number
  checked: boolean
  title: string
}

/**
 * 小红书发现页/搜索页爬虫
 * 功能：批量采集笔记卡片
 */
export class XiaohongshuFeedCrawler {
  noteCollection: Map<string, NoteCollectionItem> = new Map()
  noteCounter = 0
  lastFeedUrl = ''

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

    showTip('正在采集笔记列表...')

    const results: XiaohongshuNote[] = []

    this.noteCollection.forEach((item, url) => {
      if (!item.checked) return

      const noteId = url.match(/\/explore\/([\w-]+)/)?.[1] || ''
      const link = document.querySelector(`a[href*="/explore/${noteId}"]`)
      if (!link) {
        results.push({ url, noteId, title: item.title, source: 'dom', crawledAt: new Date().toISOString() })
        return
      }

      const card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover') || link.parentElement || link
      const data = this.extractFromCard(card as HTMLElement, url)
      results.push(data)
    })

    showTip(`已采集 ${results.length} 条笔记`)

    return results
  }

  marker(): void {
    const url = location.href

    if (url !== this.lastFeedUrl) {
      this.noteCollection.clear()
      this.noteCounter = 0
      this.lastFeedUrl = url
    }

    this.injectMarkerStyles()

    const noteItems = this.getAllNoteItems()

    noteItems.forEach(item => {
      const noteUrl = this.getNoteUrl(item)
      if (!noteUrl || this.noteCollection.has(noteUrl)) return

      this.noteCounter++
      this.noteCollection.set(noteUrl, {
        no: this.noteCounter,
        checked: true,
        title: item.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || ''
      })
      // 每标记一条就更新提示（使用 updateKey 更新同一个 tip）
      ;(window as any).CJDB_TipsDisplay?.(`已标记 ${this.noteCounter} 条笔记`, true, 'marker-feed')
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
    const links = document.querySelectorAll('a[href*="/explore/"]')
    const cards = new Map<string, HTMLElement>()

    for (const link of links) {
      const href = link.getAttribute('href')
      if (!href || !/\/explore\/[\w-]+/.test(href)) continue

      const noteId = href.match(/\/explore\/([\w-]+)/)?.[1]
      if (!noteId) continue

      let card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover') as HTMLElement
      if (!card) {
        if (link.querySelector('img') || link.querySelector('video')) {
          card = link as HTMLElement
        } else {
          let el = link.parentElement
          while (el && el !== document.body) {
            if (el.querySelector('img') || el.querySelector('video')) {
              card = el
              break
            }
            el = el.parentElement
          }
          if (!card) card = link.parentElement as HTMLElement
        }
      }

      if (card && card !== document.body && !cards.has(noteId)) {
        cards.set(noteId, card)
      }
    }

    return Array.from(cards.values())
  }

  private getNoteUrl(item: HTMLElement): string {
    const link = item.querySelector('a[href*="/explore/"]') as HTMLAnchorElement
    if (link?.href) return link.href.split('?')[0]
    if (item.tagName === 'A' && (item as HTMLAnchorElement).href) {
      return (item as HTMLAnchorElement).href.split('?')[0]
    }

    let p = item.parentElement
    for (let d = 0; d < 6 && p; d++) {
      if (p.tagName === 'A' && (p as HTMLAnchorElement).href?.includes('/explore/')) {
        return (p as HTMLAnchorElement).href.split('?')[0]
      }
      p = p.parentElement
    }
    return ''
  }

  private extractFromCard(card: HTMLElement, url: string): XiaohongshuNote {
    const noteId = url.match(/\/explore\/([\w-]+)/)?.[1] || ''
    const title = card.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || ''
    const coverImg = card.querySelector('img') as HTMLImageElement
    const coverUrl = coverImg?.src || coverImg?.dataset?.src || ''

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
      title,
      likes,
      coverUrl: coverUrl || undefined,
      imageUrls: coverUrl,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
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
