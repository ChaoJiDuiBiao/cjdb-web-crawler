/**
 * StorageConfig - 存储相关配置
 * 各 SCHEMA 扁平独立，互不影响
 * 存储源按数据类型分：xiaohongshu-note、xiaohongshu-account 等各有自己的 stores 列表
 */

(function () {
  const STORAGE_KEY = 'cjdb_storage_config';
  const STORES_BY_TYPE_KEY = 'cjdb_stores_by_type';
  const CURRENT_INDEX_BY_TYPE_KEY = 'cjdb_current_store_index_by_type';

  const FEISHU_SCHEMA = {
    appId: '',
    appSecret: '',
    token: '',
    baseUrl: 'https://open.feishu.cn',
    appToken: '',
    tableId: ''
  };

  const NOTION_SCHEMA = {
    token: '',
    databaseId: ''
  };
  /** 配置表单显示名称（可选） */
  const SCHEMA_LABELS = {
    notion: { token: 'API Token', databaseId: 'Database ID（或数据库 URL）' }
  };

  const LOCAL_SCHEMA = {};

  const SCHEMA_MAP = {
    feishu: FEISHU_SCHEMA,
    notion: NOTION_SCHEMA,
    local: LOCAL_SCHEMA
  };

  /** 数据类型与默认存储源 */
  const DATA_TYPES = ['xiaohongshu-note', 'xiaohongshu-account', 'wechat-article'];
  const DEFAULT_STORES = [{ type: 'local' }];

  async function getConfig(key) {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const config = result[STORAGE_KEY] || {};
    const data = config[key] || {};
    const schema = SCHEMA_MAP[key];
    return schema ? { ...schema, ...data } : data;
  }

  async function saveConfig(key, data) {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const config = result[STORAGE_KEY] || {};
    config[key] = { ...config[key], ...data };
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
  }

  /**
   * 获取某数据类型的存储源列表
   * @param {string} dataType - 'xiaohongshu-note' | 'xiaohongshu-account' | 'wechat-article'
   */
  async function getStoresForType(dataType) {
    const result = await chrome.storage.local.get([STORES_BY_TYPE_KEY]);
    const byType = result[STORES_BY_TYPE_KEY] || {};
    const stores = byType[dataType];
    return Array.isArray(stores) && stores.length > 0 ? stores : [...DEFAULT_STORES];
  }

  /**
   * 保存某数据类型的存储源列表
   */
  async function saveStoresForType(dataType, stores) {
    if (!Array.isArray(stores)) throw new Error('stores 必须为数组');
    const result = await chrome.storage.local.get([STORES_BY_TYPE_KEY]);
    const byType = result[STORES_BY_TYPE_KEY] || {};
    byType[dataType] = stores;
    await chrome.storage.local.set({ [STORES_BY_TYPE_KEY]: byType });
  }

  /**
   * 获取当前选中的存储源索引
   */
  async function getCurrentStoreIndex(dataType) {
    const result = await chrome.storage.local.get([CURRENT_INDEX_BY_TYPE_KEY]);
    const byType = result[CURRENT_INDEX_BY_TYPE_KEY] || {};
    const idx = byType[dataType];
    return typeof idx === 'number' ? idx : 0;
  }

  /**
   * 设置当前选中的存储源索引
   */
  async function setCurrentStoreIndex(dataType, index) {
    const result = await chrome.storage.local.get([CURRENT_INDEX_BY_TYPE_KEY]);
    const byType = result[CURRENT_INDEX_BY_TYPE_KEY] || {};
    byType[dataType] = index;
    await chrome.storage.local.set({ [CURRENT_INDEX_BY_TYPE_KEY]: byType });
  }

  /**
   * 获取当前选中的存储源
   */
  async function getCurrentStoreForType(dataType) {
    const stores = await getStoresForType(dataType);
    const idx = await getCurrentStoreIndex(dataType);
    return stores[Math.min(idx, stores.length - 1)] || stores[0] || { type: 'local' };
  }

  /** 配置相关的 key 前缀（不含 cjdb_local_ 采集数据） */
  const CONFIG_KEY_PREFIXES = ['cjdb_storage_config', 'cjdb_stores_by_type', 'cjdb_current_store_index_by_type', 'cjdb_notion_field_map_', 'cjdb_notion_initialized_'];

  /**
   * 导出配置（用于重装/更新后恢复）
   * @returns {Promise<Object>} 可序列化的配置对象
   */
  async function exportConfig() {
    const all = await chrome.storage.local.get(null);
    const config = {};
    for (const [key, value] of Object.entries(all)) {
      if (key === 'apiKey' || CONFIG_KEY_PREFIXES.some((p) => key === p || key.startsWith(p))) {
        config[key] = value;
      }
    }
    return { version: 1, exportedAt: new Date().toISOString(), data: config };
  }

  /**
   * 导入配置（覆盖现有配置）
   * @param {Object} payload - exportConfig 导出的对象
   * @returns {Promise<{ok: boolean, count: number, error?: string}>}
   */
  async function importConfig(payload) {
    if (!payload || !payload.data || typeof payload.data !== 'object') {
      return { ok: false, error: '无效的配置文件格式' };
    }
    const data = payload.data;
    const count = Object.keys(data).length;
    await chrome.storage.local.set(data);
    return { ok: true, count };
  }

  window.StorageConfig = {
    getConfig,
    saveConfig,
    getStoresForType,
    saveStoresForType,
    getCurrentStoreIndex,
    setCurrentStoreIndex,
    getCurrentStoreForType,
    exportConfig,
    importConfig,
    FEISHU_SCHEMA,
    NOTION_SCHEMA,
    LOCAL_SCHEMA,
    SCHEMA_MAP: { feishu: FEISHU_SCHEMA, notion: NOTION_SCHEMA, local: LOCAL_SCHEMA },
    SCHEMA_LABELS,
    DATA_TYPES,
    DEFAULT_STORES
  };
})();
