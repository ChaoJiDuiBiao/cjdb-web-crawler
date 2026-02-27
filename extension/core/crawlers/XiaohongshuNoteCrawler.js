/**
 * XiaohongshuNoteCrawler - 小红书笔记详情爬虫
 * 职责：
 * 1. 识别笔记详情页（含弹窗场景）
 * 2. 提取笔记数据（标题、正文、图片、互动数据等）
 * 3. 标注评论（注入编号 #1, #2 和勾选框 ✓）
 * 4. 管理评论采集状态 commentCollection
 */

class XiaohongshuNoteCrawler extends BaseCrawler {
  constructor() {
    super();
    /**
     * 评论采集集合
     * @type {Object<string, {checked: boolean, content?: string}>}
     * @example { 'comment-123': { checked: true, content: '太好看了！' } }
     */
    this.commentCollection = {};
    this.lastNoteUrl = '';
    this.MARKER_STYLE_ID = 'cjdb-xhs-note-marker-style';
  }

  canHandle(url) {
    // 1. URL 包含 /explore/
    if (/\/explore\/[\w-]+/.test(url)) return true;

    // 2. 检测笔记详情弹窗（作者主页点击笔记弹出的情况）
    return this._detectNoteModal();
  }

  getDataType() {
    return 'xiaohongshu-note';
  }

  async crawl(opts = {}) {
    const url = opts.url || this._getCurrentNoteUrl();
    const noteData = this._extractFromNoteDetail(url);
    const hovercardData = await this._triggerHovercard();
    if (hovercardData) {
      if (hovercardData.followers != null) noteData.authorFansCount = hovercardData.followers;
      if (hovercardData.likes != null) noteData.authorLikes = hovercardData.likes;
      if (hovercardData.following != null) noteData.authorFollowing = hovercardData.following;
    }
    return noteData;
  }

  marker() {
    const url = this._getCurrentNoteUrl();

    // URL 变化时重置状态
    if (url !== this.lastNoteUrl) {
      this.commentCollection = {};
      this.lastNoteUrl = url;
    }

    this._injectMarkerStyles();
    this._markComments();
  }

  /**
   * 获取爬虫状态
   * @returns {Object}
   */
  getCrawlerState() {
    const items = Object.keys(this.commentCollection).map(id => ({
      id,
      checked: this.commentCollection[id]?.checked !== false,
      content: this.commentCollection[id]?.content || ''
    }));

    return {
      collectionType: 'comment',
      count: items.length,
      checked: items.filter(item => item.checked).length,
      items
    };
  }

  // ==================== 内部方法：检测与定位 ====================

  _detectNoteModal() {
    if (!/xiaohongshu\.com/.test(location.hostname)) return false;

    const noteLinks = document.querySelectorAll('a[href*="/explore/"]');
    for (const link of noteLinks) {
      const rect = link.getBoundingClientRect();
      const style = getComputedStyle(link);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
        continue;
      }

      let el = link.parentElement;
      while (el && el !== document.body) {
        const p = getComputedStyle(el);
        if ((p.position === 'fixed' || p.position === 'absolute') && parseInt(p.zIndex || '0', 10) > 100) {
          const pr = el.getBoundingClientRect();
          if (pr.width > 300 && pr.height > 300) {
            return true;
          }
        }
        el = el.parentElement;
      }
    }
    return false;
  }

  _getCurrentNoteUrl() {
    if (/\/explore\/[\w-]+/.test(location.pathname)) return location.href.split('?')[0];

    const links = document.querySelectorAll('a[href*="/explore/"]');
    for (const link of links) {
      let el = link.parentElement;
      while (el && el !== document.body) {
        const p = getComputedStyle(el);
        if ((p.position === 'fixed' || p.position === 'absolute') && parseInt(p.zIndex || '0', 10) > 100) {
          const pr = el.getBoundingClientRect();
          if (pr.width > 300 && pr.height > 300) {
            const href = link.getAttribute('href');
            if (href) return href.startsWith('/') ? location.origin + href : href.split('?')[0];
          }
        }
        el = el.parentElement;
      }
    }
    return location.href.split('?')[0];
  }

  _getNoteContext() {
    return document.querySelector('.note-detail-mask') ||
           document.querySelector('.note-container') ||
           document.querySelector('.note-detail') ||
           document;
  }

  // ==================== 内部方法：数据提取 ====================

  _extractFromNoteDetail(url) {
    const ctx = this._getNoteContext();
    const cleanUrl = (url || window.location.href).split('?')[0];
    const noteId = cleanUrl.match(/\/explore\/([\w-]+)/)?.[1] || '';

    const sel = (selector) => ctx.querySelector(selector);
    const selAll = (selector) => Array.from(ctx.querySelectorAll(selector) || []);

    // 标题
    const title = sel('#detail-title')?.textContent?.trim() ||
                  sel('.title')?.textContent?.trim() ||
                  sel('h1')?.textContent?.trim() ||
                  document.title.replace(' - 小红书', '').trim() ||
                  '未知标题';

    // 发布时间
    let publishTimeStr = null;
    const dateEl = sel('span.date, .date, .publish-time, .time');
    if (dateEl) {
      const timeText = dateEl.textContent?.trim() || '';
      const parsed = this._parseTimeText(timeText);
      publishTimeStr = parsed ? this._formatLocalDate(parsed) : null;
    }
    if (!publishTimeStr && window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      if (noteData?.time) publishTimeStr = this._formatLocalDate(new Date(noteData.time));
    }
    if (!publishTimeStr) publishTimeStr = this._formatLocalDate(new Date());

    // 发布地点
    let location = '';
    if (dateEl) {
      let loc = dateEl.textContent?.trim() || '';
      loc = loc.replace(/\d+\s*(分钟|小时|天|周|月|年)前\s*/, '');
      loc = loc.replace(/^\d{1,2}-\d{1,2}\s*/, '').trim();
      if (loc) location = loc;
    }
    if (!location && window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      if (noteData?.location) location = noteData.location;
    }

    // 正文
    const contentEl = sel('#detail-desc') || sel('.note-content, .content, .desc, [class*="content"], [class*="desc"]');
    let content = '';
    if (contentEl) {
      const clone = contentEl.cloneNode(true);
      ['#note-detail-origin', '.date', '.publish-time', '.time', '.location', '.place'].forEach((s) => {
        clone.querySelectorAll(s).forEach((el) => el.remove());
      });
      content = (clone.textContent?.trim() || '').replace(/\s+/g, ' ').trim();
    }

    // 图片
    const imgs = selAll('.note-content img, .carousel img, .swiper-slide img');
    const imageUrls = imgs.map((img) => img.src || img.dataset?.src).filter((src) => src && !src.includes('placeholder') && !src.includes('avatar'));
    const images = [...new Set(imageUrls)];

    // 标签
    const tags = new Set();
    const detailDesc = sel('#detail-desc');
    if (detailDesc) {
      detailDesc.querySelectorAll('[id="hash-tag"]').forEach((el) => {
        let parent = el.parentElement;
        let hasParent = false;
        while (parent && parent !== document.body && parent !== detailDesc) {
          if (parent.id === 'hash-tag') { hasParent = true; break; }
          parent = parent.parentElement;
        }
        let text = hasParent ? (() => { const c = el.cloneNode(true); c.querySelectorAll('[id="hash-tag"]').forEach((n) => n.remove()); return c.textContent?.trim() || ''; })() : (el.textContent?.trim() || '');
        text = text.replace(/^#+/, '').trim();
        if (text && text.length < 50) tags.add(text);
      });
    }
    if (tags.size === 0 && window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      (noteData?.tagList || []).forEach((tag) => {
        const t = (tag?.name || '').replace(/^#+/, '').trim();
        if (t && t.length < 50) tags.add(t);
      });
    }

    // 互动数据
    const extractInteract = (selector, stateKey) => {
      for (const container of selAll('.input-box, .interactions, .interact-container').reverse()) {
        const el = container.querySelector(selector);
        if (el) {
          const n = this._parseCount(el.textContent);
          if (n > 0) return n;
        }
      }
      if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
        const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
        const v = noteData?.interactInfo?.[stateKey];
        if (v != null) return parseInt(v, 10) || 0;
      }
      return 0;
    };
    const likes = extractInteract('.like-wrapper .count', 'likedCount');
    const favorites = extractInteract('.collect-wrapper .count', 'collectedCount');
    const comments = extractInteract('.chat-wrapper .count, .comment-wrapper .count', 'commentCount');

    // 作者信息（DOM + __INITIAL_STATE__，hovercard 在 crawl 中合并）
    let authorFansCount = 0;
    const followerEl = sel('.author-info .fans, .user-info .fans, [class*="follower"]');
    if (followerEl) authorFansCount = this._parseCount(followerEl.textContent);
    if (!authorFansCount && window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      if (noteData?.user?.fansCount) authorFansCount = parseInt(noteData.user.fansCount, 10) || 0;
    }

    let authorLikes = 0;
    const likesEl = sel('.author-info .likes, .user-info .likes, [class*="like"]');
    if (likesEl) authorLikes = this._parseCount(likesEl.textContent);
    if (!authorLikes && window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      if (noteData?.user?.likedCount) authorLikes = parseInt(noteData.user.likedCount, 10) || 0;
    }

    let authorFollowing = 0;
    if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
      const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
      if (noteData?.user?.followCount) authorFollowing = parseInt(noteData.user.followCount, 10) || 0;
    }

    return {
      url: cleanUrl,
      noteId,
      title,
      content,
      publishTimeStr,
      location,
      likes,
      favorites,
      comments,
      authorFansCount,
      authorLikes,
      authorFollowing,
      imageUrls: images,
      tags: Array.from(tags),
      source: 'dom',
      crawledAt: new Date().toISOString()
    };
  }

  // ==================== 内部方法：Hovercard 获取作者信息 ====================
  // 参考 xhs-to-notion-v2.user.js：模拟鼠标悬停触发 hovercard，从中提取粉丝数、关注数、获赞与收藏

  _createMouseEvent(type, x, y, relatedTarget = null) {
    const eventInit = {
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
      which: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false
    };
    if (relatedTarget !== null) eventInit.relatedTarget = relatedTarget;
    return new MouseEvent(type, eventInit);
  }

  async _moveMouseToElement(element) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const steps = 15;
    const startY = rect.y - 50;
    const endY = centerY;
    const startX = centerX;

    const parentChain = [];
    let parent = element.parentElement;
    while (parent && parentChain.length < 5) {
      parentChain.push(parent);
      parent = parent.parentElement;
    }

    let enteredElement = false;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const currentY = startY + (endY - startY) * progress;
      const currentX = startX;
      const isInElement = currentY >= rect.y && currentY <= rect.y + rect.height &&
        currentX >= rect.x && currentX <= rect.x + rect.width;

      const moveEvent = this._createMouseEvent('mousemove', currentX, currentY);
      document.dispatchEvent(moveEvent);
      parentChain.forEach(p => p.dispatchEvent(moveEvent));

      if (isInElement && !enteredElement) {
        enteredElement = true;
        const overEvent = this._createMouseEvent('mouseover', currentX, currentY, document.body);
        document.dispatchEvent(overEvent);
        parentChain.forEach(p => p.dispatchEvent(overEvent));
        element.dispatchEvent(overEvent);
        const enterEvent = this._createMouseEvent('mouseenter', currentX, currentY, null);
        element.dispatchEvent(enterEvent);
        parentChain.forEach(p => {
          p.dispatchEvent(this._createMouseEvent('mouseenter', currentX, currentY, null));
        });
      }
      if (isInElement) element.dispatchEvent(moveEvent);
      await new Promise(r => setTimeout(r, 15));
    }

    const finalEvents = [
      { type: 'mousemove', relatedTarget: null },
      { type: 'mouseover', relatedTarget: document.body },
      { type: 'mouseenter', relatedTarget: null }
    ];
    for (const cfg of finalEvents) {
      const ev = this._createMouseEvent(cfg.type, centerX, centerY, cfg.relatedTarget);
      document.dispatchEvent(ev);
      parentChain.forEach(p => p.dispatchEvent(ev));
      element.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 10));
    }
  }

  _extractHovercardData() {
    const result = { followers: null, following: null, likes: null };
    try {
      const tooltipSelectors = [
        '.tooltip-container .tooltip-content',
        '.tooltip-content',
        '.tooltip-container',
        '[class*="tooltip"][style*="opacity: 1"]',
        '[class*="tooltip"]',
        '[class*="hovercard"]',
        '[class*="user-card"]'
      ];
      let tooltip = null;
      for (const selector of tooltipSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          if (el.offsetParent !== null && style.opacity !== '0' && style.display !== 'none') {
            tooltip = el;
            break;
          }
        }
        if (tooltip) break;
      }
      if (!tooltip) return result;

      const tooltipText = tooltip.textContent || '';
      const interactionInfo = tooltip.querySelector('.interaction-info, [class*="interaction"]');
      if (interactionInfo) {
        const t = interactionInfo.textContent || '';
        const followingMatch = t.match(/([\d.]+[万千]?)\s*关注/);
        if (followingMatch) result.following = this._parseCount(followingMatch[1]) || null;
        const followersMatch = t.match(/([\d.]+[万千]?)\s*粉丝/);
        if (followersMatch) result.followers = this._parseCount(followersMatch[1]) || null;
        const likesMatch = t.match(/([\d.]+[万千]?)\s*获赞与收藏/);
        if (likesMatch) result.likes = this._parseCount(likesMatch[1]) || null;
      }
      if (!result.following) {
        const m = tooltipText.match(/([\d.]+[万千]?)\s*关注/);
        if (m) result.following = this._parseCount(m[1]) || null;
      }
      if (!result.followers) {
        const m = tooltipText.match(/([\d.]+[万千]?)\s*粉丝/);
        if (m) result.followers = this._parseCount(m[1]) || null;
      }
      if (!result.likes) {
        const m = tooltipText.match(/([\d.]+[万千]?)\s*获赞与收藏/);
        if (m) result.likes = this._parseCount(m[1]) || null;
      }
    } catch (e) {
      console.warn('[XhsNoteCrawler] 提取 hovercard 数据失败', e);
    }
    return result;
  }

  async _triggerHovercard() {
    const ctx = this._getNoteContext();
    const infoEl = ctx.querySelector('.info');
    if (!infoEl) return null;

    try {
      await this._moveMouseToElement(infoEl);
    } catch (e) {
      console.warn('[XhsNoteCrawler] 模拟鼠标移动失败', e);
    }

    let hovercardVisible = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hovercard = document.querySelector('.tooltip-container, .tooltip-content, [class*="tooltip"], [class*="hovercard"], [class*="user-card"]');
      if (hovercard) {
        const style = window.getComputedStyle(hovercard);
        if (style.display !== 'none' && style.opacity !== '0') {
          hovercardVisible = true;
          break;
        }
      }
    }
    if (!hovercardVisible) return null;

    let hovercardData = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 200));
      hovercardData = this._extractHovercardData();
      if (hovercardData.followers || hovercardData.following || hovercardData.likes) break;
    }
    return hovercardData;
  }

  // ==================== 内部方法：标注评论 ====================

  _markComments() {
    const ctx = this._getNoteContext();
    const parents = ctx.querySelectorAll('.parent-comment');
    if (!parents.length) return;

    let no = 0;
    parents.forEach((parent) => {
      const mainEl = parent.querySelector('.comment-item:not(.comment-item-sub)') || parent.querySelector('.comment-item');
      if (!mainEl) return;

      const commentId = mainEl.getAttribute('id') || this._getCommentKey(mainEl);
      if (!(commentId in this.commentCollection)) {
        this.commentCollection[commentId] = { checked: true };
      }
      no++;
      this._injectCommentMarker(mainEl, `#${no}`, commentId);

      // 标注回复评论
      const replyContainer = parent.querySelector('.reply-container');
      if (replyContainer) {
        const replyEls = replyContainer.querySelectorAll('.comment-item-sub, .comment-item, [class*="comment-item"]');
        replyEls.forEach((replyEl, ri) => {
          const replyId = replyEl.getAttribute('id') || this._getCommentKey(replyEl);
          if (!(replyId in this.commentCollection)) {
            this.commentCollection[replyId] = { checked: true };
          }
          this._injectCommentMarker(replyEl, `R${ri + 1}`, replyId);
        });
      }
    });

    window.dispatchEvent(new CustomEvent('cjdb-collection-changed'));
  }

  _injectCommentMarker(el, label, key) {
    if (el.querySelector('.cjdb-comment-marker-wrap')) return;

    const wrap = document.createElement('span');
    wrap.className = 'cjdb-comment-marker-wrap';

    const marker = document.createElement('span');
    marker.className = 'cjdb-comment-marker';
    marker.textContent = label;
    marker.dataset.cjdbKey = key;
    wrap.appendChild(marker);

    const cb = document.createElement('span');
    cb.className = 'cjdb-comment-checkbox';
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = this.commentCollection[key];
      if (entry) {
        entry.checked = !entry.checked;
        cb.textContent = entry.checked ? '✓' : '○';
        cb.style.background = entry.checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)';
        window.dispatchEvent(new CustomEvent('cjdb-collection-changed'));
      }
    });

    const entry = this.commentCollection[key];
    const checked = entry?.checked !== false;
    cb.textContent = checked ? '✓' : '○';
    cb.style.background = checked ? 'rgba(82,196,26,0.9)' : 'rgba(140,140,140,0.9)';
    wrap.appendChild(cb);

    const insertRef = el.querySelector('.author-wrapper .name, .author-wrapper .username, .name, .username') || el;
    if (!insertRef?.parentNode) return;
    insertRef.parentNode.insertBefore(wrap, insertRef.nextSibling);
  }

  _getCommentKey(el) {
    const id = el.getAttribute('id');
    if (id?.startsWith('comment-')) return id;
    const content = (el.querySelector('.note-text') || el).textContent?.trim()?.slice(0, 40) || '';
    const info = el.querySelector('.info');
    const time = info?.textContent?.match(/(昨天|今天|\d{1,2}月\d{1,2}日)\s*\d{1,2}:\d{2}/)?.[0] || '';
    return `${time}_${content}`;
  }

  _injectMarkerStyles() {
    if (document.getElementById(this.MARKER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = this.MARKER_STYLE_ID;
    style.textContent = `
      .cjdb-comment-marker { display:inline-block !important; margin-left:6px !important; background:rgba(255,36,66,0.85) !important; color:#fff !important; font-size:11px !important; padding:2px 5px !important; border-radius:4px !important; pointer-events:none !important; }
      .cjdb-comment-marker-wrap { display:inline-block !important; margin-left:6px !important; vertical-align:middle !important; }
      .cjdb-comment-checkbox { display:inline-block !important; width:18px !important; height:18px !important; line-height:18px !important; text-align:center !important; font-size:12px !important; font-weight:bold !important; border-radius:4px !important; cursor:pointer !important; margin-left:4px !important; }
    `;
    document.head.appendChild(style);
  }

  // ==================== 工具方法 ====================

  _parseCount(str) {
    if (!str) return 0;
    const s = String(str).trim();
    let m = 1;
    if (s.includes('w') || s.includes('万')) m = 10000;
    if (s.includes('k')) m = 1000;
    return Math.floor((parseFloat(s.replace(/[^\d.]/g, '')) || 0) * m);
  }

  _formatLocalDate(date) {
    if (!date || !(date instanceof Date)) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _parseTimeText(text) {
    if (!text) return null;
    const now = new Date();
    const currentYear = now.getFullYear();

    if (text.includes('分钟前')) {
      const minutes = parseInt(text) || 0;
      return new Date(now - minutes * 60 * 1000);
    }
    if (text.includes('小时前')) {
      const hours = parseInt(text) || 0;
      return new Date(now - hours * 60 * 60 * 1000);
    }
    if (text.includes('天前')) {
      const days = parseInt(text) || 0;
      return new Date(now - days * 24 * 60 * 60 * 1000);
    }

    const mmdd = text.match(/^(\d{1,2})-(\d{1,2})/);
    if (mmdd) {
      const month = parseInt(mmdd[1], 10) - 1;
      const day = parseInt(mmdd[2], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const date = new Date(currentYear, month, day);
        if (date > now) date.setFullYear(currentYear - 1);
        return date;
      }
    }

    const d = new Date(text);
    return !isNaN(d.getTime()) ? d : null;
  }
}

window.XiaohongshuNoteCrawler = XiaohongshuNoteCrawler;
