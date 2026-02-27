/**
 * FeishuStore - 飞书多维表格存储适配器
 * 暂未实现
 *
 * 实现时请使用 window.CJDB_fetchProxy 发起请求，避免 content script 的 CORS 限制：
 *   const res = await window.CJDB_fetchProxy('https://open.feishu.cn/open-apis/...', { method, headers, body });
 */

(function () {
  if (!window.CJDB_Store) return;

  window.CJDB_Store.register('feishu', {
    async save(type, data, store) {
      // TODO: 对接飞书多维表格 API，使用 CJDB_fetchProxy
      console.warn('[FeishuStore] 待实现', type, data, store);
      return { ok: false, error: '飞书存储待实现' };
    }
  });
})();
