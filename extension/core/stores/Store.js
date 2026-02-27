/**
 * Store - 数据存储统一入口
 * 职责：
 * 1. 管理存储适配器（notion, feishu, local）
 * 2. 根据数据类型分发到对应的适配器
 * 3. 处理单条或批量数据（Main 原封不动传过来）
 * 4. 返回统一格式的结果 { ok, action?, error? }
 */

class Store {
  constructor() {
    /**
     * 存储适配器注册表
     * @type {Object<string, {save: Function}>}
     * @example { 'notion': { save: async (type, data, config) => {...} } }
     */
    this.adapters = {};
  }

  /**
   * 注册存储适配器
   * @param {string} name - 'notion' | 'feishu' | 'local'
   * @param {Object} adapter - { save: async (type, data, config) => {...} }
   */
  register(name, adapter) {
    this.adapters[name] = adapter;
  }

  /**
   * 获取适配器
   * @param {string} name
   * @returns {Object|null}
   */
  get(name) {
    return this.adapters[name] || null;
  }

  /**
   * 存储数据（自动获取当前配置）
   * @param {string} dataType - 'xiaohongshu-note' | 'xiaohongshu-account' | 'wechat-article'
   * @param {Object|Array} data - 单条数据或批量数据数组（Main 原封不动传过来）
   * @returns {Promise<Array<{ok: boolean, action?: string, error?: string}>>}
   */
  async save(dataType, data) {
    // 获取当前存储配置
    const config = await this._getCurrentConfig(dataType);
    const adapter = this.adapters[config.type];

    if (!adapter) {
      return [{ ok: false, error: `未知存储类型: ${config.type}` }];
    }

    // 支持单条和批量
    const items = Array.isArray(data) ? data : [data];
    const results = [];

    for (const item of items) {
      try {
        // 验证数据（可选）
        window.Validators?.validateOrThrow?.(dataType, item);

        const res = await adapter.save(dataType, item, config);
        results.push(res);
      } catch (e) {
        results.push({ ok: false, error: e.message || String(e) });
      }
    }

    return results;
  }

  /**
   * 获取当前数据类型的存储配置
   * @param {string} dataType
   * @returns {Promise<Object>}
   * @private
   */
  async _getCurrentConfig(dataType) {
    // 从 StorageConfig 读取当前配置
    const storageType = this._getStorageType(dataType);
    const config = await window.StorageConfig?.getCurrentStoreForType(storageType);
    return config || { type: 'local' };
  }

  /**
   * 获取存储类型
   * @param {string} dataType
   * @returns {string}
   * @private
   */
  _getStorageType(dataType) {
    // 每种数据类型使用独立的存储配置
    return dataType;
  }
}

// 全局单例
window.CJDB_Store = new Store();
