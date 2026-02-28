import type { XiaohongshuNote, Comment } from '@/types'
import { zh } from 'chrono-node'
import { parseDateTime, formatDate } from '@/utils/dateTimeParse'

/**
 * 小红书笔记爬虫
 * 功能：识别页面、标注评论、爬取数据
 */
export class XiaohongshuNoteCrawler {
  commentCollection: Map<string, Comment> = new Map()
  commentCounter = 0
  lastNoteUrl = ''

  // 判断是否可以处理当前页面
  canHandle(url: string): boolean {
    // URL 包含 /explore/
    if (/\/explore\/[\w-]+/.test(url)) return true

    // 检测笔记详情弹窗（从作者主页点击弹出）
    if (!/xiaohongshu\.com/.test(location.hostname)) return false

    const noteLinks = document.querySelectorAll('a[href*="/explore/"]')
    for (const link of noteLinks) {
      const rect = link.getBoundingClientRect()
      const style = getComputedStyle(link)
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
        continue
      }

      let el = link.parentElement
      while (el && el !== document.body) {
        const p = getComputedStyle(el)
        if ((p.position === 'fixed' || p.position === 'absolute') && parseInt(p.zIndex || '0', 10) > 100) {
          const pr = el.getBoundingClientRect()
          if (pr.width > 300 && pr.height > 300) return true
        }
        el = el.parentElement
      }
    }
    return false
  }

  // 爬取笔记数据（含作者 hovercard，onProgress 可反馈进度）
  async crawl(opts?: { onProgress?: (msg: string) => void }): Promise<XiaohongshuNote> {
    // 通用 tips 显示函数（爬取过程中一直显示）
    const showTip = (msg: string) => {
      opts?.onProgress?.(msg)
      ;(window as any).CJDB_TipsDisplay?.(msg, false)
    }

    showTip('正在解析笔记内容...')

    const url = this.getCurrentNoteUrl()
    const ctx = this.getNoteContext()
    const noteId = url.match(/\/explore\/([\w-]+)/)?.[1] || ''
    const state = (window as any).__INITIAL_STATE__
    const noteData = state?.note?.noteDetailMap ? Object.values(state.note.noteDetailMap)[0] as any : null

    const parseCount = (text: string): number => {
      const match = String(text || '').match(/(\d+\.?\d*)(k|w|万|千)?/i)
      if (!match) return 0
      const num = parseFloat(match[1])
      const unit = (match[2] || '').toLowerCase()
      if (unit === 'w' || unit === '万') return Math.round(num * 10000)
      if (unit === 'k' || unit === '千') return Math.round(num * 1000)
      return Math.round(num)
    }

    // 标题
    const title = ctx.querySelector('#detail-title')?.textContent?.trim() ||
                  ctx.querySelector('.title')?.textContent?.trim() ||
                  ctx.querySelector('h1')?.textContent?.trim() ||
                  document.title.replace(' - 小红书', '').trim() ||
                  '未知标题'

    // 发布时间、发布地点（小红书笔记 detail 的 dateEl 可能为 "昨天 18:59 浙江" 混合格式）
    let publishTimeStr = ''
    let publishLocation = ''
    const dateEl = ctx.querySelector('span.date, .date, .publish-time, .time')
    const locEl = ctx.querySelector('.location, .place, [class*="location"], [class*="place"]')
    const dateText = dateEl?.textContent?.trim() || ''
    if (locEl && locEl !== dateEl) {
      publishLocation = (locEl.textContent?.trim() || '').replace(/·\s*/g, ' ').trim()
    }
    if (dateText) {
      const parsed = parseDateTime(dateText)
      publishTimeStr = parsed ? formatDate(parsed) : ''
      if (!publishLocation) {
        let remaining = dateText
        for (const r of zh.hans.parse(dateText, new Date())) {
          if (r.text) remaining = remaining.replace(r.text, '').trim()
        }
        if (remaining === dateText) {
          remaining = dateText
            .replace(/\d+\s*(分钟|小时|天|周|月|年)前\s*/g, '')
            .replace(/昨天\s*\d{1,2}:\d{2}\s*/g, '')
            .replace(/今天\s*\d{1,2}:\d{2}\s*/g, '')
            .replace(/^\d{1,2}-\d{1,2}\s*/g, '')
            .replace(/刚刚\s*/g, '')
            .replace(/·\s*/g, ' ')
            .trim()
        }
        publishLocation = remaining
      }
    }
    if (!publishTimeStr && noteData?.time) {
      publishTimeStr = formatDate(new Date(noteData.time))
    }
    if (!publishTimeStr) publishTimeStr = formatDate(new Date())
    if (!publishLocation && noteData?.location) publishLocation = noteData.location || ''

    // 正文
    const contentEl = ctx.querySelector('#detail-desc') as HTMLElement
    let content = ''
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement
      ;['#note-detail-origin', '.date', '.publish-time', '.time', '.location', '.place'].forEach(s => {
        clone.querySelectorAll(s).forEach(el => el.remove())
      })
      content = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim()
    }

    // 图片
    const imgs = Array.from(ctx.querySelectorAll('.note-content img, .carousel img, .swiper-slide img') as NodeListOf<HTMLImageElement>)
    const imageUrls = [...new Set(
      imgs.map(img => img.src || img.dataset?.src)
          .filter(src => src && !src.includes('placeholder') && !src.includes('avatar'))
    )].join(',')

    // 标签
    const tags = new Set<string>()
    const detailDesc = ctx.querySelector('#detail-desc')
    if (detailDesc) {
      detailDesc.querySelectorAll('[id="hash-tag"]').forEach(el => {
        let text = el.textContent?.trim() || ''
        text = text.replace(/^#+/, '').trim()
        if (text && text.length < 50) tags.add(text)
      })
    }
    if (tags.size === 0 && noteData?.tagList) {
      noteData.tagList.forEach((tag: any) => {
        const t = (tag?.name || '').replace(/^#+/, '').trim()
        if (t && t.length < 50) tags.add(t)
      })
    }

    // 互动数据（DOM + __INITIAL_STATE__）
    const extractInteract = (selector: string, stateKey: string): number => {
      const containers = Array.from(ctx.querySelectorAll('.input-box, .interactions, .interact-container')).reverse()
      for (const container of containers) {
        const el = container.querySelector(selector)
        if (el) {
          const n = parseCount(el.textContent || '')
          if (n > 0) return n
        }
      }
      const v = noteData?.interactInfo?.[stateKey]
      if (v != null) return parseInt(String(v), 10) || 0
      return 0
    }
    const likes = extractInteract('.like-wrapper .count', 'likedCount')
    const favorites = extractInteract('.collect-wrapper .count', 'collectedCount')
    const comments = extractInteract('.chat-wrapper .count, .comment-wrapper .count', 'commentCount')

    // 作者信息（与 original 一致：在 ctx 内查 .author-info .fans / .user-info .fans 等，避免误取笔记点赞）
    let authorFansCount = 0
    let authorLikes = 0
    const followerEl = ctx.querySelector('.author-info .fans, .user-info .fans, [class*="follower"]')
    if (followerEl) authorFansCount = parseCount(followerEl.textContent || '')
    const likesEl = ctx.querySelector('.author-info .likes, .user-info .likes, [class*="like"]')
    if (likesEl) authorLikes = parseCount(likesEl.textContent || '')
    if (!authorFansCount && noteData?.user?.fansCount) {
      authorFansCount = parseInt(String(noteData.user.fansCount), 10) || 0
    }
    if (!authorLikes && noteData?.user?.likedCount) {
      authorLikes = parseInt(String(noteData.user.likedCount), 10) || 0
    }

    let authorFollowing = 0
    if (noteData?.user?.followCount) {
      authorFollowing = parseInt(String(noteData.user.followCount), 10) || 0
    }

    const user = noteData?.user
    let authorUserId = user?.userId || user?.id || ''
    let authorNickname = user?.nickname || user?.nick_name || ''
    let authorAvatarUrl = user?.avatar || user?.image || ''
    if (!authorNickname) {
      const nameEl = ctx.querySelector('.author-wrapper .name, .author-wrapper .username, .info .name, .info .username, [class*="author"] .name, [class*="user"] .name')
      authorNickname = nameEl?.textContent?.trim() || ''
    }

    // Hovercard 补充作者数据（若 __INITIAL_STATE__ 无完整信息，先完成再返回）
    showTip('正在获取作者信息...')
    const hovercardData = await this.triggerHovercard(ctx)
    if (hovercardData) {
      if (hovercardData.followers != null) authorFansCount = hovercardData.followers
      if (hovercardData.likes != null) authorLikes = hovercardData.likes
      if (hovercardData.following != null) authorFollowing = hovercardData.following
    }

    // 评论列表
    showTip('正在整理评论列表...')
    const commentList: Comment[] = []
    this.commentCollection.forEach(comment => {
      if (comment.checked) commentList.push(comment)
    })

    showTip('数据采集完成')

    return {
      url,
      noteId,
      title,
      content,
      publishTimeStr,
      location: publishLocation,
      likes,
      favorites,
      comments,
      authorUserId,
      authorNickname,
      authorAvatarUrl,
      authorFansCount,
      authorLikes,
      authorFollowing,
      imageUrls,
      tags: Array.from(tags),
      commentList,
      source: 'dom',
      crawledAt: new Date().toISOString()
    }
  }

  private getCurrentNoteUrl(): string {
    if (/\/explore\/[\w-]+/.test(location.pathname)) return location.href.split('?')[0]
    const links = document.querySelectorAll('a[href*="/explore/"]')
    for (const link of links) {
      let el = link.parentElement
      while (el && el !== document.body) {
        const p = getComputedStyle(el)
        if ((p.position === 'fixed' || p.position === 'absolute') && parseInt(p.zIndex || '0', 10) > 100) {
          const pr = el.getBoundingClientRect()
          if (pr.width > 300 && pr.height > 300) {
            const href = link.getAttribute('href')
            if (href) return href.startsWith('/') ? location.origin + href : href.split('?')[0]
          }
        }
        el = el.parentElement
      }
    }
    return location.href.split('?')[0]
  }

  private getNoteContext(): Element {
    return document.querySelector('.note-detail-mask') ||
           document.querySelector('.note-container') ||
           document.querySelector('.note-detail') ||
           document
  }

  private async triggerHovercard(ctx: Element): Promise<{ followers?: number; likes?: number; following?: number } | null> {
    // 优先作者区的 .info（悬停触发展示粉丝/关注等），避免选中评论的 .info
    const infoEl = ctx.querySelector('.author-wrapper .info, .author-info .info, .user-info .info, .header .info') ||
      ctx.querySelector('.info')
    if (!infoEl) return null
    try {
      await this.moveMouseToElement(infoEl as HTMLElement)
    } catch {
      return null
    }
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300))
      const hovercard = document.querySelector('.tooltip-container, .tooltip-content, [class*="tooltip"], [class*="hovercard"], [class*="user-card"]')
      if (hovercard) {
        const style = getComputedStyle(hovercard)
        if (style.display !== 'none' && style.opacity !== '0') {
          for (let j = 0; j < 10; j++) {
            await new Promise(r => setTimeout(r, 200))
            const data = this.extractHovercardData()
            if (data.followers || data.following || data.likes) return data
          }
          return null
        }
      }
    }
    return null
  }

  private createMouseEvent(type: string, x: number, y: number, relatedTarget: EventTarget | null = null): MouseEvent {
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      pageX: x + (window.pageXOffset || 0),
      pageY: y + (window.pageYOffset || 0),
      buttons: 0,
      button: 0,
      detail: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false
    }
    if (relatedTarget !== null) eventInit.relatedTarget = relatedTarget
    return new MouseEvent(type, eventInit)
  }

  private async moveMouseToElement(element: HTMLElement): Promise<void> {
    const rect = element.getBoundingClientRect()
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const steps = 15
    const startY = rect.y - 50

    const parentChain: Element[] = []
    let parent = element.parentElement
    while (parent && parentChain.length < 5) {
      parentChain.push(parent)
      parent = parent.parentElement
    }

    let enteredElement = false
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps
      const currentY = startY + (centerY - startY) * progress
      const isInElement = currentY >= rect.y && currentY <= rect.y + rect.height &&
        centerX >= rect.x && centerX <= rect.x + rect.width

      const moveEvent = this.createMouseEvent('mousemove', centerX, currentY)
      document.dispatchEvent(moveEvent)
      parentChain.forEach(p => p.dispatchEvent(moveEvent))

      if (isInElement && !enteredElement) {
        enteredElement = true
        const overEvent = this.createMouseEvent('mouseover', centerX, currentY, document.body)
        document.dispatchEvent(overEvent)
        parentChain.forEach(p => p.dispatchEvent(overEvent))
        element.dispatchEvent(overEvent)
        const enterEvent = this.createMouseEvent('mouseenter', centerX, currentY, null)
        element.dispatchEvent(enterEvent)
        parentChain.forEach(p => p.dispatchEvent(this.createMouseEvent('mouseenter', centerX, currentY, null)))
      }
      if (isInElement) element.dispatchEvent(moveEvent)
      await new Promise(r => setTimeout(r, 15))
    }

    // 与原版一致：最后再派发一轮事件，确保 hover 被触发
    const finalEvents: Array<{ type: string; relatedTarget: EventTarget | null }> = [
      { type: 'mousemove', relatedTarget: null },
      { type: 'mouseover', relatedTarget: document.body },
      { type: 'mouseenter', relatedTarget: null }
    ]
    for (const cfg of finalEvents) {
      const ev = this.createMouseEvent(cfg.type, centerX, centerY, cfg.relatedTarget)
      document.dispatchEvent(ev)
      parentChain.forEach(p => p.dispatchEvent(ev))
      element.dispatchEvent(ev)
      await new Promise(r => setTimeout(r, 10))
    }
  }

  private extractHovercardData(): { followers: number | null; following: number | null; likes: number | null } {
    const result = { followers: null as number | null, following: null as number | null, likes: null as number | null }
    const parseCount = (s: string): number => {
      const m = String(s || '').match(/(\d+\.?\d*)(k|w|万|千)?/i)
      if (!m) return 0
      const n = parseFloat(m[1])
      if ((m[2] || '').toLowerCase().match(/w|万/)) return Math.round(n * 10000)
      if ((m[2] || '').toLowerCase().match(/k|千/)) return Math.round(n * 1000)
      return Math.round(n)
    }
    const selectors = [
      '.tooltip-container .tooltip-content',
      '.tooltip-content',
      '.tooltip-container',
      '[class*="tooltip"][style*="opacity: 1"]',
      '[class*="tooltip"]',
      '[class*="hovercard"]',
      '[class*="user-card"]'
    ]
    let tooltip: Element | null = null
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel)
      for (const el of els) {
        const style = getComputedStyle(el)
        if (el instanceof HTMLElement && el.offsetParent !== null && style.opacity !== '0' && style.display !== 'none') {
          tooltip = el
          break
        }
      }
      if (tooltip) break
    }
    if (!tooltip) return result

    const getText = (el: Element) => (el as HTMLElement).innerText || el.textContent || ''
    const tooltipText = getText(tooltip)
    const interactionInfo = tooltip.querySelector('.interaction-info, [class*="interaction"]')
    const searchText = interactionInfo ? getText(interactionInfo) : tooltipText

    const patterns: Array<{ key: 'following' | 'followers' | 'likes'; regexes: RegExp[] }> = [
      { key: 'following', regexes: [/([\d.]+[万千]?)\s*关注/, /关注\s*([\d.]+[万千]?)/] },
      { key: 'followers', regexes: [/([\d.]+[万千]?)\s*粉丝/, /粉丝\s*([\d.]+[万千]?)/, /(\d+)\s*位粉丝/] },
      { key: 'likes', regexes: [/([\d.]+[万千]?)\s*获赞与收藏/, /获赞与收藏\s*([\d.]+[万千]?)/, /([\d.]+[万千]?)\s*获赞\b/, /\b获赞\s*([\d.]+[万千]?)/] }
    ]
    for (const { key, regexes } of patterns) {
      if ((result as any)[key] != null) continue
      for (const r of regexes) {
        const m = searchText.match(r)
        if (m) {
          const v = parseCount(m[1])
          if (v > 0) (result as any)[key] = v
          break
        }
      }
    }
    if (!result.following || !result.followers || !result.likes) {
      for (const { key, regexes } of patterns) {
        if ((result as any)[key] != null) continue
        for (const r of regexes) {
          const m = tooltipText.match(r)
          if (m) {
            const v = parseCount(m[1])
            if (v > 0) (result as any)[key] = v
            break
          }
        }
      }
    }
    return result
  }

  // 标注评论（注入编号和勾选框）
  marker(): void {
    const url = location.href.split('?')[0]

    // URL 变化时重置状态
    if (url !== this.lastNoteUrl) {
      this.commentCollection.clear()
      this.commentCounter = 0
      this.lastNoteUrl = url
    }

    // 注入样式
    if (!document.getElementById('cjdb-xhs-marker-style')) {
      const style = document.createElement('style')
      style.id = 'cjdb-xhs-marker-style'
      style.textContent = `
        .cjdb-comment-marker-wrap {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 8px;
        }
        .cjdb-comment-marker {
          display: inline-block;
          padding: 2px 6px;
          background: rgba(254, 44, 85, 0.1);
          color: #fe2c55;
          font-size: 11px;
          font-weight: 600;
          border-radius: 4px;
        }
        .cjdb-comment-checkbox {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(82,196,26,0.9);
          color: #fff;
          font-size: 12px;
          cursor: pointer;
          transition: transform 0.1s;
        }
        .cjdb-comment-checkbox:hover {
          transform: scale(1.1);
        }
      `
      document.head.appendChild(style)
    }

    // 标注评论
    const comments = document.querySelectorAll('.comment-item, [class*="comment"]')

    comments.forEach((commentEl, index) => {
      // 如果已标注，跳过
      if (commentEl.querySelector('.cjdb-comment-marker-wrap')) return

      // 获取评论 ID
      const commentId = `comment-${index}`

      // 提取评论内容
      const contentEl = commentEl.querySelector('.note-text, .content')
      const content = contentEl?.textContent?.trim() || ''

      if (!content) return

      // 保存到集合
      if (!this.commentCollection.has(commentId)) {
        this.commentCounter++
        this.commentCollection.set(commentId, {
          id: commentId,
          no: this.commentCounter,
          checked: true,
          content,
          time: '',
          likes: 0
        })
        // 每标记一条就更新提示（使用 updateKey 更新同一个 tip）
        ;(window as any).CJDB_TipsDisplay?.(`已标记 ${this.commentCounter} 条评论`, true, 'marker-comment')
      }

      const comment = this.commentCollection.get(commentId)!

      // 注入标注
      const wrap = document.createElement('span')
      wrap.className = 'cjdb-comment-marker-wrap'

      const marker = document.createElement('span')
      marker.className = 'cjdb-comment-marker'
      marker.textContent = `#${comment.no}`
      wrap.appendChild(marker)

      const checkbox = document.createElement('span')
      checkbox.className = 'cjdb-comment-checkbox'
      checkbox.textContent = comment.checked ? '✓' : '○'
      checkbox.style.background = comment.checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)'
      checkbox.onclick = (e) => {
        e.stopPropagation()
        comment.checked = !comment.checked
        checkbox.textContent = comment.checked ? '✓' : '○'
        checkbox.style.background = comment.checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)'

        // 触发状态变化事件
        window.dispatchEvent(new CustomEvent('cjdb-collection-changed'))
      }
      wrap.appendChild(checkbox)

      // 插入到评论内容旁边
      const insertRef = commentEl.querySelector('.author-wrapper .name, .name') || commentEl
      if (insertRef && insertRef.parentNode) {
        insertRef.parentNode.insertBefore(wrap, insertRef.nextSibling)
      }
    })
  }

  // 获取爬虫状态（给 UI 显示）
  getCrawlerState() {
    let checkedCount = 0
    this.commentCollection.forEach(comment => {
      if (comment.checked) checkedCount++
    })

    return {
      collectionType: 'comment',
      total: this.commentCollection.size,
      checked: checkedCount
    }
  }
}
