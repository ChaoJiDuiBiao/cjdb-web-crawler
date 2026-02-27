/**
 * LocalStore - 本地存储适配器
 * 使用 chrome.storage.local 存储数据
 */

(function () {
  if (!window.CJDB_Store) return;

  window.CJDB_Store.register('local', {
    async save(type, data, store) {
      try {
        const key = `cjdb_local_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await chrome.storage.local.set({ [key]: data });
        console.log('[LocalStore] 已保存到本地:', key, data);
        return { ok: true, action: 'create', key };
      } catch (e) {
        console.error('[LocalStore] 保存失败:', e);
        return { ok: false, error: e.message || String(e) };
      }
    }
  });
})();
