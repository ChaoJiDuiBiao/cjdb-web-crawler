/**
 * XiaohongshuAccountCrawler - 小红书账号主页爬虫
 * 职责：
 * 1. 识别账号主页
 * 2. 采集账号基本信息（昵称、简介、粉丝数等）
 * 3. 标注笔记卡片（注入编号 #1, #2 和勾选框 ✓）
 * 4. 管理笔记采集状态 noteCollection（用于生成笔记列表）
 */

class XiaohongshuAccountCrawler extends BaseCrawler {
  constructor() {
    super();
    /**
     * 笔记采集集合
     * @type {Object<string, {no: number, checked: boolean, title?: string}>}
     */
    this.noteCollection = {};
    this.noteCounter = 0;
    this.lastAccountUrl = '';
    this.MARKER_STYLE_ID = 'cjdb-xhs-account-marker-style';
  }

  canHandle(url) {
    // 账号主页：/user/profile/xxx，但排除笔记详情弹窗场景
    return /xiaohongshu\.com\/user\/profile\/[\w-]+/.test(url) && !/\/explore\//.test(url);
  }

  getDataType() {
    return 'xiaohongshu-account';
  }

  async crawl(opts = {}) {
    // 采集账号信息 + 笔记列表
    const basicInfo = this._extractBasicInfo();
    const noteListText = this._formatNoteListText();

    return {
      nickname: basicInfo.nickname,
      userId: basicInfo.userId,
      url: basicInfo.url,
      avatarUrl: basicInfo.avatarUrl,
      description: basicInfo.description,
      location: basicInfo.location,
      noteCount: this._getCheckedNoteCount(),
      likeCount: basicInfo.likeCount,
      fansCount: basicInfo.fansCount,
      followingCount: basicInfo.followingCount,
      noteListText,  // 格式化的笔记列表文本
      source: 'dom',
      crawledAt: new Date().toISOString()
    };
  }

  marker() {
    const url = location.href;

    // URL 变化时重置状态
    if (url !== this.lastAccountUrl) {
      this.noteCollection = {};
      this.noteCounter = 0;
      this.lastAccountUrl = url;
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

    const checkedNotes = items.filter(item => item.checked);

    return {
      collectionType: 'account',
      accountUrl: this.lastAccountUrl,
      noteCount: items.length,
      checkedNoteCount: checkedNotes.length,
      items
    };
  }

  // ==================== 内部方法：提取账号信息 ====================

  _extractBasicInfo() {
    // 昵称
    const nickname = document.querySelector('.user-name, .username, [class*="user-name"]')?.textContent?.trim() || '未知用户';

    // 账号 ID
    const userId = this._extractUserId();

    // 主页 URL
    const url = window.location.href.split('?')[0];

    // 头像
    const avatarUrl = document.querySelector('.user-avatar img, .avatar img')?.src || '';

    // 账号简介
    let description = '';
    const descSelectors = [
      '.user-desc',
      '[class*="user-desc"]',
      '[class*="desc"]',
      '[class*="description"]',
      '[class*="bio"]',
      '[class*="intro"]'
    ];
    for (const selector of descSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        description = el.textContent.trim();
        break;
      }
    }

    // 归属地
    let location = '';
    const locationSelectors = [
      '.user-location',
      '[class*="location"]',
      '[class*="place"]',
      '[class*="area"]'
    ];
    for (const selector of locationSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        location = el.textContent.trim();
        break;
      }
    }

    // 互动数据
    const likeCount = this._extractCountByLabel('获赞');
    const fansCount = this._extractCountByLabel('粉丝');
    const followingCount = this._extractCountByLabel('关注');

    return {
      nickname,
      userId,
      url,
      avatarUrl,
      description,
      location,
      likeCount,
      fansCount,
      followingCount
    };
  }

  _extractUserId() {
    // 提取小红书号（不是 URL 中的 token）
    const redIdEl = document.querySelector('.user-redId, [class*="user-redId"], [class*="redId"]');
    if (redIdEl) {
      const text = redIdEl.textContent?.trim() || '';
      // 可能格式：小红书号: FreDesing 或 FreDesing
      const match = text.match(/小红书号[:：]?\s*(\S+)/) || text.match(/^(\S+)$/);
      if (match) return match[1];
    }

    // 备用：从 URL 提取（如果找不到小红书号）
    const url = window.location.href;
    const urlMatch = url.match(/\/user\/profile\/([\w-]+)/);
    return urlMatch ? urlMatch[1] : '';
  }

  _extractCountByLabel(label) {
    // 尝试查找包含标签的元素
    const elements = document.querySelectorAll('[class*="count"], [class*="number"], .stat, [class*="stat"]');
    for (const el of elements) {
      const parent = el.parentElement || el;
      const text = parent.textContent || '';
      if (text.includes(label)) {
        const numText = el.textContent?.trim();
        return this._parseCount(numText);
      }
    }
    return 0;
  }

  _extractNoteList() {
    // 提取所有勾选的笔记
    const noteItems = Object.keys(this.noteCollection)
      .map(url => {
        const noteData = this.noteCollection[url];
        const card = this._findNoteCardByUrl(url);

        return {
          no: noteData.no,
          title: noteData.title || '未知标题',
          url,
          likes: card ? this._extractLikesFromCard(card) : 0,
          isPinned: false,  // TODO: 检测置顶
          checked: noteData.checked !== false
        };
      })
      .filter(item => item.checked)
      .sort((a, b) => a.no - b.no);

    return noteItems;
  }

  _formatNoteListText() {
    const noteItems = this._extractNoteList();

    if (noteItems.length === 0) {
      return '暂无笔记';
    }

    const totalCached = Object.keys(this.noteCollection).length;
    const checkedCount = noteItems.length;
    const ignoredCount = totalCached - checkedCount;

    // 统计信息
    const stats = `识别到 ${totalCached} 条笔记，${checkedCount} 条同步，${ignoredCount} 条忽略\n\n`;

    // 笔记列表
    const noteList = noteItems.map(note => {
      const number = `#${note.no}`;
      const titleText = note.url ? `[${note.title}](${note.url})` : note.title;
      const likesText = `❤️ ${note.likes > 0 ? note.likes : 0}`;
      const pinnedText = note.isPinned ? ' 📌置顶' : '';
      return `${number} 📝 ${titleText} | ${likesText}${pinnedText}`;
    }).join('\n');

    return stats + noteList;
  }

  _getCheckedNoteCount() {
    return Object.keys(this.noteCollection)
      .filter(url => this.noteCollection[url]?.checked !== false)
      .length;
  }

  _findNoteCardByUrl(url) {
    const noteId = url.match(/\/explore\/([\w-]+)/)?.[1];
    if (!noteId) return null;

    const link = document.querySelector(`a[href*="/explore/${noteId}"]`);
    if (!link) return null;

    return link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover, [class*="feed-item"], [class*="waterfall-item"]') || link.parentElement || link;
  }

  _extractLikesFromCard(card) {
    const likesEl = card.querySelector('.like-count, .likes, [class*="like"]');
    return likesEl ? this._parseCount(likesEl.textContent) : 0;
  }

  // ==================== 内部方法：解析笔记 ====================

  _getAllNoteItems() {
    // 账号主页：合并选择器和链接反查
    const fromLinks = this._getNoteItemsFromExploreLinks();
    const bySelectors = this._getNoteItemsBySelectors();

    const seen = new Set();
    const merged = [];

    for (const el of [...fromLinks, ...bySelectors]) {
      if (seen.has(el)) continue;
      const hasContent = el.querySelector('img, video, .title, [class*="title"], a[href*="/explore/"]');
      if (hasContent) {
        seen.add(el);
        merged.push(el);
      }
    }

    return merged;
  }

  _getNoteItemsFromExploreLinks() {
    const links = document.querySelectorAll('a[href*="/explore/"]');
    const cards = new Map();

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || !/\/explore\/[\w-]+/.test(href)) continue;

      const noteId = href.match(/\/explore\/([\w-]+)/)?.[1];
      if (!noteId) continue;

      let card = link.closest('.note-item, [class*="note-item"], [class*="note-card"], .cover, [class*="feed-item"], [class*="waterfall-item"]');
      if (!card) {
        if (link.querySelector('img') || link.querySelector('video') || link.querySelector('[class*="title"]')) {
          card = link;
        } else {
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

  _getNoteItemsBySelectors() {
    const selectors = [
      '.note-item',
      '[class*="note-item"]',
      '[class*="note-card"]',
      '.cover',
      '[class*="feed-item"]',
      '[class*="waterfall-item"]'
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    }
    return [];
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
    // 简化版：从卡片提取数据
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

window.XiaohongshuAccountCrawler = XiaohongshuAccountCrawler;
