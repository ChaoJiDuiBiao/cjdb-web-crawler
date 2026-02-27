/**
 * CJDB API 封装
 * 接口域名：https://www.dajiala.com
 */

const API_BASE = 'https://www.dajiala.com';

/**
 * 获取存储的 API Key（来自 CrawlerConfig.dajiala）
 */
async function getApiKey() {
  if (window.CrawlerConfig) {
    const cfg = await window.CrawlerConfig.getConfig('dajiala');
    return cfg.apiKey || '';
  }
  const result = await chrome.storage.local.get(['apiKey']);
  return result.apiKey || '';
}

/**
 * 1. 历史文章列表
 * API: /fbmain/monitor/v3/post_history
 */
async function fetchPostHistory({ name, biz = '', url = '', page = 1 }) {
  const key = await getApiKey();
  const res = await fetch(`${API_BASE}/fbmain/monitor/v3/post_history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      biz,
      url,
      name,
      page,
      key,
      verifycode: ''
    })
  });
  return res.json();
}

/**
 * 2. 文章数据（阅读、点赞等）
 * API: /fbmain/monitor/v3/read_zan_pro
 */
async function fetchArticleData(articleUrl) {
  const key = await getApiKey();
  const res = await fetch(`${API_BASE}/fbmain/monitor/v3/read_zan_pro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: articleUrl,
      key,
      verifycode: ''
    })
  });
  return res.json();
}

// 供 popup 和 background 使用
if (typeof window !== 'undefined') {
  window.CJDB_API = { fetchPostHistory, fetchArticleData, getApiKey };
}
