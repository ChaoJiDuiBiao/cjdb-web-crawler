/**
 * 通用跨域请求代理
 * content script 受 CORS 限制，通过 background 发起请求
 * 适用于：Notion、飞书、以及未来其他第三方 API
 *
 * 使用方式：
 *   const res = await fetchProxy('https://api.notion.com/v1/databases/xxx', {
 *     method: 'GET',
 *     headers: { Authorization: 'Bearer xxx', 'Notion-Version': '2022-06-28' }
 *   });
 */

function fetchProxy(url, options = {}) {
  const { method = 'GET', headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'fetchProxy',
        payload: { url, method, headers, body }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Extension Error: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (response?.ok) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      }
    );
  });
}

if (typeof window !== 'undefined') {
  window.CJDB_fetchProxy = fetchProxy;
}
