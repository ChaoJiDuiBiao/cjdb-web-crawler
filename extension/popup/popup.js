const output = document.getElementById('output');
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKey');
const mpNameInput = document.getElementById('mpName');
const pageInput = document.getElementById('page');
const fetchHistoryBtn = document.getElementById('fetchHistory');
const articleUrlInput = document.getElementById('articleUrl');
const fetchArticleBtn = document.getElementById('fetchArticle');
const copyResultBtn = document.getElementById('copyResult');

// 加载保存的 API Key
(async () => {
  if (window.CrawlerConfig) {
    const cfg = await CrawlerConfig.getConfig('dajiala');
    if (cfg.apiKey) apiKeyInput.value = cfg.apiKey;
  } else {
    const result = await chrome.storage.local.get(['apiKey']);
    if (result.apiKey) apiKeyInput.value = result.apiKey;
  }
})();

// 保存 API Key
saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showOutput('请输入 API Key', true);
    return;
  }
  if (window.CrawlerConfig) {
    await CrawlerConfig.saveConfig('dajiala', { apiKey: key });
  } else {
    await chrome.storage.local.set({ apiKey: key });
  }
  showOutput('API Key 已保存', false);
});

// 获取历史文章列表
fetchHistoryBtn.addEventListener('click', async () => {
  const name = mpNameInput.value.trim();
  if (!name) {
    showOutput('请输入公众号名称', true);
    return;
  }
  showOutput('请求中...', false);
  try {
    const data = await CJDB_API.fetchPostHistory({
      name,
      page: parseInt(pageInput.value) || 1
    });
    showOutput(JSON.stringify(data, null, 2), data.code !== 0);
  } catch (err) {
    showOutput('请求失败: ' + err.message, true);
  }
});

// 获取文章数据
fetchArticleBtn.addEventListener('click', async () => {
  const url = articleUrlInput.value.trim();
  if (!url) {
    showOutput('请输入文章 URL', true);
    return;
  }
  showOutput('请求中...', false);
  try {
    const data = await CJDB_API.fetchArticleData(url);
    showOutput(JSON.stringify(data, null, 2), data.code !== 0);
  } catch (err) {
    showOutput('请求失败: ' + err.message, true);
  }
});

// 复制结果
copyResultBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(output.textContent).then(() => {
    copyResultBtn.textContent = '已复制';
    setTimeout(() => { copyResultBtn.textContent = '复制结果'; }, 1500);
  });
});

function showOutput(text, isError = false) {
  output.textContent = text;
  output.style.color = isError ? '#f38ba8' : '#cdd6f4';
}
