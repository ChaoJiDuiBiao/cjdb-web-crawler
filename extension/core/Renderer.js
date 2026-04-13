/**
 * Renderer - UI 渲染类
 * 职责：渲染采集按钮、页面类型、存储配置、配置弹窗
 */

class Renderer {
  constructor(rootElement) {
    this.root = rootElement;
    this._lastDataType = 'xiaohongshu-note';
    this._storageCache = {};

    // 采集目标配置
    this.COLLECT_TARGET = {
      'xiaohongshu-note': { btnText: '采集小红书笔记', label: '小红书笔记' },
      'xiaohongshu-feed': { btnText: '采集主页笔记', label: '发现页' },
      'xiaohongshu-account': { btnText: '采集小红书账号', label: '小红书账号' },
      'wechat-article': { btnText: '采集公众号文章', label: '公众号文章' }
    };

    this._setupStorageDropdown();
    this._setupStorageClickToggle();
  }

  /**
   * 点击存储按钮切换下拉，点击外部关闭
   * @private
   */
  _setupStorageClickToggle() {
    const wrap = this.root.querySelector('.cjdb-storage-wrap');
    const btn = this.root.querySelector('.cjdb-storage-btn');
    if (!wrap || !btn) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.classList.toggle('is-open');
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) wrap.classList.remove('is-open');
    });
  }

  /**
   * 渲染面板
   * @param {string} dataType - 'xiaohongshu-note' | 'xiaohongshu-feed' | ...
   * @param {BaseCrawler} crawler - 当前激活的 Crawler
   */
  render(dataType, crawler) {
    const target = this.COLLECT_TARGET[dataType];
    if (!target) {
      this._hidePanel();
      return;
    }

    // 显示面板
    this.root.style.display = 'block';

    // 根据 dataType 切换主题样式
    this.root.classList.remove('cjdb-theme-xiaohongshu', 'cjdb-theme-wechat');
    this.root.classList.add(this._getThemeClass(dataType));

    // 更新采集按钮（采集大字 + 小信息）
    const collectBtn = this.root.querySelector('.cjdb-collect');
    if (collectBtn) {
      const state = crawler.getCrawlerState();
      const count = state?.checked || state?.checkedNoteCount || 0;
      const subEl = collectBtn.querySelector('.cjdb-collect-sub');
      if (subEl) {
        subEl.textContent = count > 0 ? `${target.label} (${count})` : target.label;
      }
      collectBtn.dataset.collectTarget = dataType;
      collectBtn.style.display = 'flex';
    }

    this._lastDataType = dataType;
    this._renderStorage(this._getStorageType(dataType));
  }

  /** 渲染存储配置（有缓存，配置变更时传 forceRefresh=true） */
  async _renderStorage(storageType, forceRefresh = false) {
    if (forceRefresh) this._storageCache[storageType] = null;
    if (!forceRefresh && this._storageCache[storageType]) {
      this._applyStorage(storageType, this._storageCache[storageType]);
      return;
    }
    const [store, stores, idx] = await Promise.all([
      window.StorageConfig?.getCurrentStoreForType(storageType),
      window.StorageConfig?.getStoresForType(storageType),
      window.StorageConfig?.getCurrentStoreIndex(storageType)
    ]);
    this._storageCache[storageType] = { store, stores, idx };
    this._applyStorage(storageType, this._storageCache[storageType]);
  }

  _applyStorage(storageType, { store, stores, idx }) {
    const wrap = this.root.querySelector('.cjdb-storage-wrap');
    const btn = wrap?.querySelector('.cjdb-storage-btn');
    const label = wrap?.querySelector('.cjdb-store-label');
    if (label) label.textContent = '数据源';
    if (btn) btn.title = '数据源 · ' + this._getStoreLabel(store);

    const dropdown = wrap?.querySelector('.cjdb-storage-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    // + 和导出/导入
    const addRow = document.createElement('div');
    addRow.className = 'cjdb-storage-add-row';
    addRow.innerHTML = '<button class="cjdb-storage-add" title="添加存储源">+</button>';
    addRow.querySelector('button').onclick = (e) => { e.stopPropagation(); this._openConfigModal(storageType, null); };
    dropdown.appendChild(addRow);

    const backupRow = document.createElement('div');
    backupRow.className = 'cjdb-storage-backup-row';
    backupRow.innerHTML = '<button class="cjdb-storage-backup-btn" title="备份配置">导出配置</button><button class="cjdb-storage-backup-btn" title="恢复配置">导入配置</button>';
    backupRow.children[0].onclick = (e) => { e.stopPropagation(); this._exportConfig(); };
    backupRow.children[1].onclick = (e) => { e.stopPropagation(); this._triggerImportConfig(); };
    dropdown.appendChild(backupRow);

    // 存储源列表
    const fragment = document.createDocumentFragment();
    (stores || []).forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'cjdb-storage-item' + (i === idx ? ' cjdb-current' : '');
      item.textContent = this._getStoreLabel(s);
      item.onclick = () => {
        window.StorageConfig?.setCurrentStoreIndex(storageType, i);
        this._renderStorage(storageType, true);
      };
      fragment.appendChild(item);
    });
    dropdown.insertBefore(fragment, addRow);
  }

  _getStoreLabel(store) {
    if (!store) return '未配置';
    if (store.type === 'local') {
      const fmtMap = { csv: '→CSV', markdown: '→MD' };
      const fmt = fmtMap[store.exportFormat] || '';
      return '本地' + fmt;
    }
    if (store.type === 'feishu') return store.appToken ? `飞书:${store.tableId || '...'}` : '飞书';
    if (store.type === 'notion') return store.databaseId ? `Notion:${store.databaseId.slice(0, 8)}...` : 'Notion';
    return store.type;
  }

  /**
   * 隐藏面板
   * @private
   */
  _hidePanel() {
    this.root.style.display = 'none';
  }

  /**
   * 导出配置为 JSON 文件
   * @private
   */
  async _exportConfig() {
    try {
      const payload = await window.StorageConfig?.exportConfig();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cjdb-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error('[CJDB] 导出配置失败', e);
      alert('导出失败: ' + (e?.message || e));
    }
  }

  /**
   * 触发导入（创建 file input）
   * @private
   */
  _triggerImportConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const res = await window.StorageConfig?.importConfig(payload);
        if (res?.ok) {
          alert(`已恢复 ${res.count} 项配置`);
          this._renderStorage(this._getStorageType(this._lastDataType), true);
        } else {
          alert(res?.error || '导入失败');
        }
      } catch (err) {
        console.error('[CJDB] 导入配置失败', err);
        alert('导入失败: ' + (err?.message || err));
      }
    };
    input.click();
  }

  /**
   * 获取存储类型（发现页使用笔记的存储配置）
   * @param {string} dataType
   * @returns {string}
   * @private
   */
  _getStorageType(dataType) {
    const STORAGE_TYPE_MAP = { 'xiaohongshu-feed': 'xiaohongshu-note' };
    return STORAGE_TYPE_MAP[dataType] || dataType;
  }

  /**
   * 根据 dataType 返回主题 class
   * @param {string} dataType
   * @returns {string}
   * @private
   */
  _getThemeClass(dataType) {
    return dataType.startsWith('wechat') ? 'cjdb-theme-wechat' : 'cjdb-theme-xiaohongshu';
  }

  // ==================== 存储配置弹窗 ====================

  /**
   * 设置存储配置下拉菜单
   * @private
   */
  _setupStorageDropdown() {
    const modal = document.getElementById('cjdb-config-modal');
    if (!modal) return;

    modal.querySelector('.cjdb-modal-cancel')?.addEventListener('click', () => this._closeConfigModal());
    modal.querySelector('.cjdb-modal-submit')?.addEventListener('click', () => this._saveNewStore());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this._closeConfigModal();
    });

    // 存储类型切换
    const storeTypeSelect = modal.querySelector('[name="storeType"]');
    if (storeTypeSelect) {
      storeTypeSelect.addEventListener('change', () => {
        const formBody = modal.querySelector('.cjdb-modal-form-body');
        formBody.innerHTML = this._createConfigForm(storeTypeSelect.value, null);
      });
    }
  }

  /**
   * 打开配置弹窗
   * @param {string} dataType
   * @param {number|null} editIndex
   * @private
   */
  _openConfigModal(dataType, editIndex) {
    const modal = document.getElementById('cjdb-config-modal');
    if (!modal) return;

    this.root.querySelector('.cjdb-storage-wrap')?.classList.remove('is-open');

    const storeTypeSelect = modal.querySelector('[name="storeType"]');
    const formBody = modal.querySelector('.cjdb-modal-form-body');

    modal.dataset.dataType = dataType;
    modal.dataset.editIndex = String(editIndex ?? -1);
    modal.classList.add('cjdb-show');

    storeTypeSelect.innerHTML = '<option value="local">本地</option><option value="feishu">飞书</option><option value="notion">Notion</option>';
    storeTypeSelect.value = 'local';
    formBody.innerHTML = this._createConfigForm('local', null);
  }

  /**
   * 关闭配置弹窗
   * @private
   */
  _closeConfigModal() {
    const modal = document.getElementById('cjdb-config-modal');
    if (modal) modal.classList.remove('cjdb-show');
  }

  /**
   * 保存新存储源
   * @private
   */
  async _saveNewStore() {
    const modal = document.getElementById('cjdb-config-modal');
    if (!modal) return;

    const dataType = modal.dataset.dataType;
    const editIndex = parseInt(modal.dataset.editIndex, 10);
    const storeType = modal.querySelector('[name="storeType"]').value;
    const inputs = modal.querySelectorAll('.cjdb-modal-form-body input, .cjdb-modal-form-body select');
    const config = { type: storeType };

    inputs.forEach(inp => {
      if (inp.name) config[inp.name] = inp.value;
    });

    const stores = await window.StorageConfig?.getStoresForType(dataType);
    if (editIndex >= 0) {
      stores[editIndex] = config;
    } else {
      stores.push(config);
    }

    await window.StorageConfig?.saveStoresForType(dataType, stores);
    this._closeConfigModal();
    this._renderStorage(dataType, true);
  }

  /**
   * 创建配置表单
   * @param {string} storeType
   * @param {Object} existing
   * @returns {string}
   * @private
   */
  _createConfigForm(storeType, existing) {
    const schema = window.StorageConfig?.SCHEMA_MAP?.[storeType];
    if (!schema) return '';
    if (storeType === 'local') {
      const cur = existing?.exportFormat || '';
      return `
        <div class="cjdb-modal-field">
          <label>导出格式</label>
          <select name="exportFormat">
            <option value=""${cur === '' ? ' selected' : ''}>仅保存（不导出文件）</option>
            <option value="csv"${cur === 'csv' ? ' selected' : ''}>CSV（Excel 可直接打开）</option>
            <option value="markdown"${cur === 'markdown' ? ' selected' : ''}>Markdown（Obsidian Database 格式）</option>
          </select>
        </div>`;
    }

    const labels = window.StorageConfig?.SCHEMA_LABELS?.[storeType] || {};
    let html = '';

    for (const [key, defaultVal] of Object.entries(schema)) {
      const type = typeof defaultVal === 'number' ? 'number' : 'text';
      const isSecret = key.includes('Secret') || key.includes('token');
      const val = (existing && existing[key]) || '';
      const label = labels[key] || key;

      html += `
        <div class="cjdb-modal-field">
          <label>${label}</label>
          <input type="${isSecret ? 'password' : type}" name="${key}" value="${val}" placeholder="${isSecret ? '***' : ''}">
        </div>`;
    }

    return html;
  }
}

window.Renderer = Renderer;
