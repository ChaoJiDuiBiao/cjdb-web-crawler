/**
 * CJDB 数据抓取 - Background Service Worker
 * 可用于：网络请求拦截、定时任务、消息转发等
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('CJDB 数据抓取插件已安装');
});

// 监听来自 popup 或 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchPostHistory') {
    // 可在 background 中发起请求，避免 CORS
    fetch('https://www.dajiala.com/fbmain/monitor/v3/post_history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request.payload,
        verifycode: ''
      })
    })
      .then(res => res.json())
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // 保持消息通道开放，用于异步响应
  }

  if (request.action === 'fetchArticleData') {
    chrome.storage.local.get(['apiKey'], (result) => {
      fetch('https://www.dajiala.com/fbmain/monitor/v3/read_zan_pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: request.url,
          key: result.apiKey || '',
          verifycode: ''
        })
      })
        .then(res => res.json())
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // 通用跨域代理：Notion、飞书等第三方 API 均可使用，避免 content script 的 CORS/CORB 限制
  if (request.action === 'fetchProxy') {
    const { url, method = 'GET', headers = {}, body } = request.payload || {};
    if (!url || typeof url !== 'string') {
      sendResponse({ ok: false, error: 'Missing url' });
      return false;
    }
    const allowedOrigins = [
      'https://api.notion.com',
      'https://open.feishu.cn',
      'https://open.larksuite.com'
    ];
    const origin = new URL(url).origin;
    if (!allowedOrigins.includes(origin)) {
      sendResponse({ ok: false, error: `URL not allowed: ${origin}` });
      return false;
    }
    fetch(url, {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
    })
      .then(async (res) => {
        const text = await res.text();
        if (res.ok) {
          const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : {};
          sendResponse({ ok: true, data });
        } else {
          sendResponse({ ok: false, error: `API Error ${res.status}: ${text}` });
        }
      })
      .catch((err) => sendResponse({ ok: false, error: `Network Error: ${err?.message || err}` }));
    return true;
  }
});
