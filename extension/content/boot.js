/**
 * boot.js - 启动入口
 * 职责：
 * 1. 注入面板 HTML 和 CSS
 * 2. 初始化 Main 并启动
 */

(function () {
  console.log('[CJDB] boot.js 已加载', location.href);

  const STORAGE_KEY = 'cjdb-panel-position';

  function _setupPanelDrag(panel) {
    const collectBtn = panel.querySelector('.cjdb-collect');
    if (!collectBtn) return;

    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let didDrag = false;

    function loadPosition() {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(STORAGE_KEY, (data) => {
            const pos = data?.[STORAGE_KEY];
            resolve(pos && typeof pos.x === 'number' && typeof pos.y === 'number' ? pos : null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    }

    function savePosition(x, y) {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: { x, y } });
      } catch (e) {
        console.warn('[CJDB] 保存面板位置失败', e);
      }
    }

    function applyPosition(x, y) {
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    loadPosition().then((pos) => {
      if (pos) {
        applyPosition(pos.x, pos.y);
      }
    });

    collectBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      didDrag = false;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.classList.add('cjdb-dragging');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
      let x = startLeft + dx;
      let y = startTop + dy;
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      applyPosition(x, y);
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      panel.classList.remove('cjdb-dragging');
      const rect = panel.getBoundingClientRect();
      savePosition(Math.round(rect.left), Math.round(rect.top));
    });

    collectBtn.addEventListener('click', (e) => {
      if (didDrag) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function init() {
    // 1. 注入面板容器（Vue 会接管这个容器）
    const root = document.createElement('div');
    root.id = 'cjdb-panel-root';
    root.className = 'cjdb-panel-container';

    // 2. 注入 CSS
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('content/panel.css');
    document.head.appendChild(style);
    document.body.appendChild(root);

    // 3. 注入配置弹窗
    const modal = document.createElement('div');
    modal.id = 'cjdb-config-modal';
    modal.className = 'cjdb-modal-mask';
    modal.innerHTML = `
      <div class="cjdb-modal">
        <h3>添加存储源</h3>
        <div class="cjdb-modal-field">
          <label>存储类型</label>
          <select name="storeType">
            <option value="local">本地</option>
            <option value="feishu">飞书</option>
            <option value="notion">Notion</option>
          </select>
        </div>
        <div class="cjdb-modal-form-body"></div>
        <div class="cjdb-modal-actions">
          <button class="cjdb-modal-cancel" type="button">取消</button>
          <button class="cjdb-modal-submit" type="button">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 4. 初始化 Main（使用 VueRenderer）
    const crawlers = [
      new XiaohongshuNoteCrawler(),
      new XiaohongshuFeedCrawler(),
      new XiaohongshuAccountCrawler()
    ];

    const renderer = new VueRenderer(root);
    const store = window.CJDB_Store;

    const main = new Main(crawlers, renderer, store);
    main.start();

    // 5. 初始化面板拖动（需要等 Vue 渲染完成）
    setTimeout(() => {
      _setupPanelDrag(root);
    }, 100);

    // 6. 配置弹窗事件（需要在这里设置，因为弹窗不在 Vue 中）
    _setupConfigModal(renderer);

    console.log('[CJDB] Main 已启动');
  }

  function _setupConfigModal(renderer) {
    const modal = document.getElementById('cjdb-config-modal');
    if (!modal) return;

    const closeModal = () => {
      modal.classList.remove('cjdb-show');
    };

    const saveStore = async () => {
      const dataType = modal.dataset.dataType;
      const editIndex = parseInt(modal.dataset.editIndex, 10);
      const storeType = modal.querySelector('[name="storeType"]').value;
      const inputs = modal.querySelectorAll('.cjdb-modal-form-body input');
      const config = { type: storeType };

      inputs.forEach(inp => {
        if (inp.name && inp.value) config[inp.name] = inp.value;
      });

      const stores = await window.StorageConfig?.getStoresForType(dataType);
      if (editIndex >= 0) {
        stores[editIndex] = config;
      } else {
        stores.push(config);
      }

      await window.StorageConfig?.saveStoresForType(dataType, stores);
      closeModal();

      // 刷新 Vue 状态
      if (renderer.vueState) {
        await renderer._loadStorageConfig(renderer.vueState);
      }
    };

    modal.querySelector('.cjdb-modal-cancel')?.addEventListener('click', closeModal);
    modal.querySelector('.cjdb-modal-submit')?.addEventListener('click', saveStore);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  function run() {
    console.log('[CJDB] run() 被调用', { readyState: document.readyState, url: location.href });
    try {
      init();
    } catch (e) {
      console.error('[CJDB] init 报错', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
