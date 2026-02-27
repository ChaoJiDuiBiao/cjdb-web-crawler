/**
 * BaseCrawler - 爬虫基类
 * 所有平台的爬虫都需要实现以下接口
 */

class BaseCrawler {
  /**
   * 判断是否能处理该 URL
   * @param {string} url - 当前页面 URL
   * @returns {boolean}
   */
  canHandle(url) {
    throw new Error('需实现 canHandle(url)')
  }

  /**
   * 获取数据类型
   * @returns {string} 'xiaohongshu-note' | 'xiaohongshu-feed' | 'xiaohongshu-account' | 'wechat-article'
   */
  getDataType() {
    throw new Error('需实现 getDataType()')
  }

  /**
   * 爬取数据
   * @param {Object} [opts] - 可选参数，如 { url, method }
   * @returns {Promise<Object|Array>} 单条数据或批量数据数组
   */
  async crawl(opts = {}) {
    throw new Error('需实现 crawl(opts)')
  }

  /**
   * 页面标注（由 Main 调度时机：URL 变化、滚动、DOM 变化）
   * @returns {void}
   */
  marker() {
    throw new Error('需实现 marker()')
  }

  /**
   * 获取爬虫状态（元数据，非爬取结果）
   * @returns {Object} 当前爬虫的状态信息
   * @example
   * {
   *   collectionType: 'note' | 'comment' | 'account',
   *   count: 10,        // 总共解析了多少条
   *   checked: 8,       // 勾选了多少条
   *   items: [{ id, checked, ... }]  // 详细列表
   * }
   */
  getCrawlerState() {
    return {
      collectionType: null,
      count: 0,
      checked: 0,
      items: []
    }
  }
}

window.BaseCrawler = BaseCrawler;
