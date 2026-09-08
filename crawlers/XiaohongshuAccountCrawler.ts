import type { XiaohongshuAccount } from '@/types'
import { CollectionType } from '@/types'

interface NoteCollectionItem {
  no: number
  checked: boolean
  title: string
  likes?: number
}

/**
 * 小红书账号主页爬虫
 * 功能：采集账号信息 + 笔记列表
 */
export class XiaohongshuAccountCrawler {
  noteCollection: Map<string, NoteCollectionItem> = new Map()
  noteCounter = 0
  lastAccountUrl = ''

  canHandle(url: string): boolean {
    return /xiaohongshu\.com\/user\/profile\/[\w-]+/.test(url) && !/\/explore\//.test(url)
  }

  async crawl(opts?: { onProgress?: (msg: string) => void }): Promise<XiaohongshuAccount> {
    // 通用 tips 显示函数（爬取过程中一直显示）
    const showTip = (msg: string) => {
      opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    showTip('正在采集账号信息...')

    const url = location.href.split('?')[0]
    const userId = this.extractUserId()

    showTip('正在解析账号资料...')

    const nickname = document.querySelector('.user-name, .username, [class*="user-name"]')?.textContent?.trim() || '未知用户'
    const avatarEl = document.querySelector('.user-avatar img, .avatar img') as HTMLImageElement
    const avatarUrl = avatarEl?.src || ''

    let description = ''
    const descSelectors = ['.user-desc', '[class*="user-desc"]', '[class*="desc"]', '[class*="description"]']
    for (const selector of descSelectors) {
      const el = document.querySelector(selector)
      if (el?.textContent?.trim()) {
        description = el.textContent.trim()
        break
      }
    }

    const accountLocation = this.extractAccountLocation()

    const fansCount = this.extractCountByLabel('粉丝')
    const followingCount = this.extractCountByLabel('关注')
    const likedCount = this.extractCountByLabel('获赞')

    showTip('正在整理笔记列表...')

    const noteListText = this.formatNoteListText()

    showTip('账号信息采集完成')

    return {
      userId,
      nickname,
      url,
      avatarUrl,
      description,
      location: accountLocation,
      fansCount,
      followingCount,
      likedCount,
      notesCount: this.getCheckedNoteCount(),
      noteListText,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
  }

  marker(): void {
    const url = location.href

    if (url !== this.lastAccountUrl) {
      this.noteCollection.clear()
      this.noteCounter = 0
      this.lastAccountUrl = url
    }

    this.injectMarkerStyles()

    const noteItems = this.getAllNoteItems()

    noteItems.forEach(item => {
      const noteUrl = this.getNoteUrl(item)
      if (!noteUrl) return

      const snapshot = this.extractFromCard(item)
      const existing = this.noteCollection.get(noteUrl)

      if (!existing) {
        this.noteCounter++
        this.noteCollection.set(noteUrl, {
          no: this.noteCounter,
          checked: true,
          title: snapshot.title,
          likes: snapshot.likes
        })
        // 每标记一条就更新提示（使用 updateKey 更新同一个 tip）
        ;(window as any).CJDB_TipsDisplay?.(`已标记 ${this.noteCounter} 条笔记`, true, 'marker-account')
      } else {
        if (!existing.title && snapshot.title) existing.title = snapshot.title
        if ((existing.likes == null || existing.likes === 0) && snapshot.likes != null) existing.likes = snapshot.likes
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
      collectionType: CollectionType.XHSAccount,
      total: this.noteCollection.size,
      checked: checkedCount
    }
  }

  private extractAccountLocation(): string {
    // 与 userId 类似：user-redId 和 user-IP 同属 basic-info 容器，用 innerText 可获取渲染文本（含 ::before）
    const container = document.querySelector('.user-redId, [class*="user-redId"]')?.parentElement
    if (container) {
      const text = (container as HTMLElement).innerText || ''
      const m = text.match(/IP属地[：:]\s*([^\s\n]+)/) || text.match(/归属地[：:]\s*([^\s\n]+)/)
      if (m) return m[1].trim()
    }

    const basicInfo = document.querySelector('.basic-info, .user-content, .info-part, [class*="basic-info"]')
    if (basicInfo) {
      const text = (basicInfo as HTMLElement).innerText || ''
      const m = text.match(/IP属地[：:]\s*([^\s\n]+)/) || text.match(/归属地[：:]\s*([^\s\n]+)/)
      if (m) return m[1].trim()
    }

    return ''
  }

  private extractUserId(): string {
    const redIdEl = document.querySelector('.user-redId, [class*="user-redId"], [class*="redId"]')
    if (redIdEl) {
      const text = redIdEl.textContent?.trim() || ''
      const match = text.match(/小红书号[:：]?\s*(\S+)/) || text.match(/^(\S+)$/)
      if (match) return match[1]
    }

    const urlMatch = location.href.match(/\/user\/profile\/([\w-]+)/)
    return urlMatch ? urlMatch[1] : ''
  }

  private extractCountByLabel(label: string): number {
    const elements = document.querySelectorAll('[class*="count"], [class*="number"], .stat, [class*="stat"]')
    for (const el of elements) {
      const parent = el.parentElement || el
      const text = parent.textContent || ''
      if (text.includes(label)) {
        const numText = el.textContent?.trim() || ''
        return this.parseCount(numText)
      }
    }
    return 0
  }

  private formatNoteListText(): string {
    const noteItems: Array<{ no: number; title: string; url: string; checked: boolean; likes?: number }> = []

    this.noteCollection.forEach((item, url) => {
      if (item.checked) {
        noteItems.push({
          no: item.no,
          title: item.title || '未知标题',
          url,
          checked: item.checked,
          likes: item.likes
        })
      }
    })

    noteItems.sort((a, b) => a.no - b.no)

    if (noteItems.length === 0) return '暂无笔记'

    const totalCached = this.noteCollection.size
    const checkedCount = noteItems.length
    const lines = [`识别到 ${totalCached} 条，采集 ${checkedCount} 条`]

    noteItems.forEach(({ no, title, url, likes }) => {
      const safeTitle = this.escapeMarkdownText(title || '未知标题')
      const suffix = likes != null && likes > 0 ? ` | 点赞 ${likes}` : ''
      lines.push(`#${no} [${safeTitle}](${url})${suffix}`)
    })

    return lines.join('\n')
  }

  private getCheckedNoteCount(): number {
    let count = 0
    this.noteCollection.forEach(item => {
      if (item.checked) count++
    })
    return count
  }

  private getAllNoteItems(): HTMLElement[] {
    const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]')
    const cards = new Map<string, HTMLElement>()

    for (const link of links) {
      const noteUrl = this.normalizeNoteUrl((link as HTMLAnchorElement).href || link.getAttribute('href') || '')
      const noteId = noteUrl.match(/\/explore\/([\w-]+)/)?.[1]
      if (!noteId) continue

      let card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], article, section, li, .cover') as HTMLElement
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
    const link = item.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]') as HTMLAnchorElement
    if (link?.href) return this.normalizeNoteUrl(link.href)
    if (item.tagName === 'A' && (item as HTMLAnchorElement).href) {
      return this.normalizeNoteUrl((item as HTMLAnchorElement).href)
    }

    let p = item.parentElement
    for (let d = 0; d < 6 && p; d++) {
      if (p.tagName === 'A' && /(\/explore\/|\/discovery\/item\/)/.test((p as HTMLAnchorElement).href || '')) {
        return this.normalizeNoteUrl((p as HTMLAnchorElement).href)
      }
      p = p.parentElement
    }
    return ''
  }

  private extractFromCard(item: HTMLElement): { title: string; likes?: number } {
    const title = this.extractTitle(item)
    const likes = this.extractLikes(item)
    return {
      title: title || '未知标题',
      likes
    }
  }

  private extractTitle(item: HTMLElement): string {
    const titleSelectors = [
      '.title',
      '.note-title',
      '[class*="title"]',
      '[class*="desc"]',
      'img[alt]'
    ]

    for (const selector of titleSelectors) {
      const el = item.querySelector(selector) as HTMLElement | HTMLImageElement | null
      if (!el) continue
      const text = el instanceof HTMLImageElement ? (el.alt || '').trim() : (el.textContent || '').trim()
      if (text) return text.replace(/\s+/g, ' ').trim()
    }

    return ''
  }

  private extractLikes(item: HTMLElement): number | undefined {
    const likeSelectors = [
      '.like-wrapper .count',
      '.like-count',
      '[class*="like"] [class*="count"]',
      '[class*="like-count"]',
      '.count'
    ]

    for (const selector of likeSelectors) {
      const el = item.querySelector(selector) as HTMLElement | null
      const text = el?.textContent?.trim() || ''
      if (!text) continue
      const likes = this.parseCount(text)
      if (likes > 0) return likes
    }

    return undefined
  }

  private normalizeNoteUrl(url: string): string {
    const cleanUrl = String(url || '').split('#')[0].split('?')[0]
    const match = cleanUrl.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)
    return match ? `https://www.xiaohongshu.com/explore/${match[1]}` : ''
  }

  private escapeMarkdownText(text: string): string {
    return String(text || '')
      .replace(/\[/g, '［')
      .replace(/\]/g, '］')
      .replace(/\(/g, '（')
      .replace(/\)/g, '）')
      .replace(/\s+/g, ' ')
      .trim()
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
    if (document.getElementById('cjdb-xhs-account-marker-style')) return

    const style = document.createElement('style')
    style.id = 'cjdb-xhs-account-marker-style'
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

  private parseCount(str: string): number {
    const match = str.match(/(\d+\.?\d*)(k|w|万|千)?/i)
    if (!match) return 0
    const num = parseFloat(match[1])
    const unit = (match[2] || '').toLowerCase()
    if (unit === 'w' || unit === '万') return Math.round(num * 10000)
    if (unit === 'k' || unit === '千') return Math.round(num * 1000)
    return Math.round(num)
  }
}
