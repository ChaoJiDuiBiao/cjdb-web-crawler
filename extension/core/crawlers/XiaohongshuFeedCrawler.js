/**
 * XiaohongshuFeedCrawler - 小红书发现页/搜索页爬虫
 * 职责：
 * 1. 识别发现页和搜索页
 * 2. 批量采集笔记（从卡片提取基础数据）
 * 3. 标注笔记卡片（注入编号 #1, #2 和勾选框 ✓）
 * 4. 管理笔记采集状态 noteCollection
 */

class XiaohongshuFeedCrawler extends BaseCrawler {
  constructor() {
    super();
    /**
     * 笔记采集集合
     * @type {Object<string, {no: number, checked: boolean, title?: string}>}
     * @example { 'https://xiaohongshu.com/explore/123': { no: 1, checked: true, title: '超好看的穿搭' } }
     */
    this.noteCollection = {};
    this.noteCounter = 0;
    this.lastFeedUrl = '';
    this.MARKER_STYLE_ID = 'cjdb-xhs-feed-marker-style';
  }

  canHandle(url) {
    return /xiaohongshu\.com\/explore(?:\?|$)/.test(url) ||
           /xiaohongshu\.com\/search_result\b/.test(url);
  }

  getDataType() {
    return 'xiaohongshu-feed';
  }

  async crawl(opts = {}) {
    // 批量采集：返回所有勾选的笔记数据数组
    const checkedUrls = Object.keys(this.noteCollection)
      .filter(url => this.noteCollection[url]?.checked !== false);

    const results = [];

    for (const url of checkedUrls) {
      try {
        const data = await this._extractNoteData(url);
        results.push(data);
      } catch (e) {
        console.warn('[XhsFeedCrawler] 采集失败:', url, e);
        results.push({ url, error: e.message });
      }
    }

    return results;
  }

  marker() {
    const url = location.href;

    // URL 变化时重置状态
    if (url !== this.lastFeedUrl) {
      this.noteCollection = {};
      this.noteCounter = 0;
      this.lastFeedUrl = url;
    }

    this._injectMarkerStyles();

    // 1. 解析可见笔记
    const noteItems = this._getAllNoteItems();

    // 2. 添加到 collection
    noteItems.forEach(item => {
      const noteUrl = this._getNoteUrl(item);
      if (!noteUrl || noteUrl in this.noteCollection) return;

      this.noteCounter++;
      this.noteCollection[noteUrl] = {
        no: this.noteCounter,
        checked: true,
        title: item.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || ''
      };
    });

    // 3. 注入标记
    noteItems.forEach(item => {
      const noteUrl = this._getNoteUrl(item);
      if (noteUrl in this.noteCollection) {
        const entry = this.noteCollection[noteUrl];
        this._injectNoteMarker(item, `#${entry.no}`, noteUrl, entry);
      }
    });

    window.dispatchEvent(new CustomEvent('cjdb-collection-changed'));
  }

  /**
   * 获取爬虫状态
   * @returns {Object}
   */
  getCrawlerState() {
    const items = Object.keys(this.noteCollection).map(url => ({
      url,
      no: this.noteCollection[url].no,
      checked: this.noteCollection[url].checked !== false,
      title: this.noteCollection[url].title || ''
    }));

    return {
      collectionType: 'note',
      count: items.length,
      checked: items.filter(item => item.checked).length,
      items
    };
  }

  // ==================== 内部方法：解析笔记 ====================

  _getAllNoteItems() {
    // 优先用链接反查（虚拟列表兼容）
    const links = document.querySelectorAll('a[href*="/explore/"]');
    const cards = new Map();

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || !/\/explore\/[\w-]+/.test(href)) continue;

      const noteId = href.match(/\/explore\/([\w-]+)/)?.[1];
      if (!noteId) continue;

      let card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover, [class*="feed-item"], [class*="waterfall-item"]');
      if (!card) {
        // 链接本身可能就是卡片
        if (link.querySelector('img') || link.querySelector('video') || link.querySelector('[class*="title"]')) {
          card = link;
        } else {
          // 向上查找包含图片/视频的父元素
          let el = link.parentElement;
          while (el && el !== document.body) {
            if (el.querySelector('img') || el.querySelector('video') || el.querySelector('[class*="title"]')) {
              card = el;
              break;
            }
            el = el.parentElement;
          }
          if (!card) card = link.parentElement;
        }
      }

      if (card && card !== document.body && !cards.has(noteId)) {
        cards.set(noteId, card);
      }
    }

    return Array.from(cards.values());
  }

  _getNoteUrl(item) {
    const link = item.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
    if (link?.href) return link.href.split('?')[0];
    if (item.tagName === 'A' && item.href) return item.href.split('?')[0];

    let p = item.parentElement;
    for (let d = 0; d < 6 && p; d++) {
      if (p.tagName === 'A' && p.href && (p.href.includes('/explore/') || p.href.includes('/discovery/item/'))) {
        return p.href.split('?')[0];
      }
      p = p.parentElement;
    }
    return '';
  }

  async _extractNoteData(url) {
    // 简化版：从卡片提取数据（如果当前页面是详情页则完整提取）
    // 检查是否是当前笔记详情页
    if (this._isCurrentNoteDetail(url)) {
      // 使用 XiaohongshuNoteCrawler 的提取逻辑
      const noteCrawler = new XiaohongshuNoteCrawler();
      return noteCrawler.crawl({ url });
    }

    // 从卡片提取基础数据
    const noteId = url.match(/\/explore\/([\w-]+)/)?.[1];
    const link = document.querySelector(`a[href*="/explore/${noteId}"]`);
    if (!link) {
      return { url, noteId, title: '', source: 'dom', crawledAt: new Date().toISOString() };
    }

    const card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover, [class*="feed-item"], [class*="waterfall-item"]') || link.parentElement || link;
    return this._extractFromCard(card, url);
  }

  _extractFromCard(card, url) {
    const noteId = url.match(/\/explore\/([\w-]+)/)?.[1] || '';
    const title = card.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim() || '';
    const likesEl = card.querySelector('.like-count, .likes, [class*="like"]');
    const collectEl = card.querySelector('.collect-count, .collect, [class*="collect"]');
    const commentEl = card.querySelector('.comment-count, .comments, [class*="comment"]');
    const coverImg = card.querySelector('img');
    const coverUrl = coverImg?.src || coverImg?.dataset?.src || '';

    return {
      url,
      noteId,
      title,
      likes: likesEl ? this._parseCount(likesEl.textContent) : 0,
      favorites: collectEl ? this._parseCount(collectEl.textContent) : 0,
      comments: commentEl ? this._parseCount(commentEl.textContent) : 0,
      coverUrl: coverUrl || undefined,
      imageUrls: coverUrl ? [coverUrl] : [],
      source: 'dom',
      crawledAt: new Date().toISOString()
    };
  }

  _isCurrentNoteDetail(url) {
    const cleanUrl = url.split('?')[0];
    const currentUrl = location.href.split('?')[0];
    if (currentUrl === cleanUrl) return true;

    const noteId = cleanUrl.match(/\/explore\/([\w-]+)/)?.[1];
    return noteId && (currentUrl.includes(`/explore/${noteId}`) ||
                      document.querySelector(`a[href*="/explore/${noteId}"]`)?.closest('.note-detail-mask, .note-container'));
  }

  // ==================== 内部方法：标注笔记 ====================

  _injectNoteMarker(item, label, url, entry) {
    let wrapper = item.querySelector('.cjdb-note-checkbox-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('span');
      wrapper.className = 'cjdb-note-checkbox-wrapper';
      const style = getComputedStyle(item);
      if (style.position === 'static') item.style.position = 'relative';
      item.insertBefore(wrapper, item.firstChild);
    }

    let numEl = wrapper.querySelector('.cjdb-note-marker');
    if (!numEl) {
      numEl = document.createElement('span');
      numEl.className = 'cjdb-note-marker';
      numEl.dataset.cjdbUrl = url;
      wrapper.appendChild(numEl);
    }
    numEl.textContent = label;

    let cb = wrapper.querySelector('.cjdb-note-checkbox');
    if (!cb) {
      cb = document.createElement('span');
      cb.className = 'cjdb-note-checkbox';
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        const cached = this.noteCollection[url];
        if (cached) {
          cached.checked = !cached.checked;
          cb.textContent = cached.checked ? '✓' : '○';
          cb.style.background = cached.checked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
          window.dispatchEvent(new CustomEvent('cjdb-collection-changed'));
        }
      });
      wrapper.appendChild(cb);
    }

    const checked = entry?.checked !== false;
    cb.textContent = checked ? '✓' : '○';
    cb.style.background = checked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
  }

  _injectMarkerStyles() {
    if (document.getElementById(this.MARKER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = this.MARKER_STYLE_ID;
    style.textContent = `
      .cjdb-note-checkbox-wrapper { position:absolute !important; top:8px !important; left:8px !important; display:flex !important; align-items:center !important; gap:4px !important; z-index:10 !important; }
      .cjdb-note-marker { display:inline-block !important; background:rgba(255,36,66,0.9) !important; color:#fff !important; font-size:11px !important; font-weight:600 !important; padding:2px 6px !important; border-radius:4px !important; pointer-events:none !important; border:1px solid rgba(255,255,255,0.5) !important; }
      .cjdb-note-checkbox { display:inline-block !important; width:20px !important; height:20px !important; line-height:20px !important; text-align:center !important; font-size:14px !important; font-weight:bold !important; border-radius:4px !important; cursor:pointer !important; user-select:none !important; border:1px solid rgba(255,255,255,0.5) !important; }
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
}

window.XiaohongshuFeedCrawler = XiaohongshuFeedCrawler;
