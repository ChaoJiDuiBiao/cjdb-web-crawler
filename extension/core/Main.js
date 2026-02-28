/**
 * Main - 主调度类
 * 职责：
 * 1. 监听 URL 变化、滚动、DOM 变化
 * 2. 根据 URL 识别并激活对应的 Crawler
 * 3. 调度 Crawler 标注（marker）
 * 4. 调度 Renderer 渲染 UI
 * 5. 处理采集按钮点击，调用 Crawler 爬取数据
 * 6. 调用 Store 存储数据（只做传递，不做遍历）
 */

class Main {
  constructor(crawlers, renderer, store) {
    this.crawlers = crawlers;  // [XhsNoteCrawler, XhsFeedCrawler, XhsAccountCrawler, ...]
    this.renderer = renderer;
    this.store = store;

    this.currentCrawler = null;
    this.currentDataType = null;

    this.DEBUG = false; // 调试开关
  }

  /**
   * 启动：监听事件、初始化页面
   */
  start() {
    this._debug('[Main] start()');
    this._setupListeners();
    this._onUrlChange();  // 初始化
  }

  /**
   * URL 变化时：识别页面类型、调度 marker、渲染 UI
   * @private
   */
  _onUrlChange() {
    const url = location.href;
    this._debug('[Main] URL 变化:', url);

    // 找到能处理当前 URL 的 Crawler
    this.currentCrawler = this.crawlers.find(c => c.canHandle(url));

    if (!this.currentCrawler) {
      this._debug('[Main] 未找到匹配的 Crawler');
      this.renderer._hidePanel();
      return;
    }

    // 获取数据类型
    this.currentDataType = this.currentCrawler.getDataType();
    this._debug('[Main] 当前数据类型:', this.currentDataType);

    // 调度 marker（标注）
    this._runMarker();

    // 渲染 UI
    this.renderer.render(this.currentDataType, this.currentCrawler);
  }

  /**
   * 运行 marker（防抖）
   * @private
   */
  _runMarker() {
    if (!this.currentCrawler) return;

    try {
      this.currentCrawler.marker();
    } catch (e) {
      console.warn('[Main] marker 异常:', e);
    }
  }

  /**
   * 点击采集按钮
   * @private
   */
  async _onClickCollect() {
    if (!this.currentCrawler || !this.currentDataType) {
      alert('未识别页面类型');
      return;
    }

    try {
      // 1. 爬取数据（单条或批量，由 Crawler 决定）
      const data = await this.currentCrawler.crawl();

      if (!data) {
        alert('未获取到数据');
        return;
      }

      // 2. 存储数据（Main 只做传递，不做遍历）
      const results = await this.store.save(this.currentDataType, data);

      // 3. 显示结果
      this._showSaveResult(results);
    } catch (e) {
      console.error('[Main] 采集失败:', e);
      alert('采集失败: ' + (e.message || String(e)));
    }
  }

  /**
   * 显示存储结果
   * @param {Array<{ok: boolean, action?: string, error?: string}>} results
   * @private
   */
  _showSaveResult(results) {
    if (!Array.isArray(results) || results.length === 0) {
      alert('存储失败：未返回结果');
      return;
    }

    const okCount = results.filter(r => r.ok).length;
    const failCount = results.length - okCount;

    if (failCount === 0) {
      alert(`已采集 ${okCount} 条数据`);
    } else {
      const firstError = results.find(r => !r.ok)?.error || '未知错误';
      alert(`已采集 ${okCount} 条，失败 ${failCount} 条\n首个错误: ${firstError}`);
    }
  }

  /**
   * 监听事件
   * @private
   */
  _setupListeners() {
    // 1. SPA 路由变化
    window.addEventListener('cjdb-spa-navigate', () => {
      this._debug('[Main] cjdb-spa-navigate');
      this._onUrlChange();
    });

    window.addEventListener('popstate', () => {
      this._debug('[Main] popstate');
      this._onUrlChange();
    });

    window.addEventListener('hashchange', () => {
      this._debug('[Main] hashchange');
      this._onUrlChange();
    });

    // 2. URL 轮询（后备方案，仅比较字符串）
    if (/xiaohongshu\.com|xhslink\.com|mp\.weixin\.qq\.com/.test(location.hostname)) {
      let lastUrl = location.href;
      setInterval(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          this._debug('[Main] URL 轮询检测到变化');
          this._onUrlChange();
        }
      }, 400);
    }

    // 3. 滚动事件 → 重新 marker（防抖）
    let scrollTimer = null;
    const onScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        this._debug('[Main] scroll → marker');
        this._runMarker();
      }, 300);
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    // 4. DOM 变化 → 重新 marker（防抖）
    const MutationObserverCtor = window.MutationObserver || window.WebKitMutationObserver;
    if (MutationObserverCtor) {
      let moTimer = null;
      const mo = new MutationObserverCtor(() => {
        if (moTimer) clearTimeout(moTimer);
        moTimer = setTimeout(() => {
          this._debug('[Main] DOM 变化 → marker');
          this._runMarker();
        }, 150);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // 5. collection 变化 → 更新 UI
    window.addEventListener('cjdb-collection-changed', () => {
      this._debug('[Main] collection 变化 → render');
      if (this.currentCrawler && this.currentDataType) {
        this.renderer.render(this.currentDataType, this.currentCrawler);
      }
    });

    // 6. 采集按钮点击（通过 VueRenderer 注册回调）
    if (this.renderer.onCollect) {
      this.renderer.onCollect(() => this._onClickCollect());
    }
  }

  /**
   * 调试日志
   * @private
   */
  _debug(...args) {
    if (this.DEBUG) console.log('[CJDB]', ...args);
  }
}

window.Main = Main;
