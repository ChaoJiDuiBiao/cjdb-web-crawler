/**
 * VueRenderer - Vue 3 响应式 UI 渲染器（使用 Render 函数，无需运行时编译）
 * 职责：
 * 1. 使用 Vue 3 响应式系统管理状态
 * 2. 自动同步 Crawler 状态到 UI
 * 3. 提供 tipsDisplay 方法显示进度信息
 * 4. 集成 Element Plus UI 组件
 */

class VueRenderer {
  constructor(rootElement) {
    this.root = rootElement;
    this.vueApp = null;
    this.vueInstance = null;

    // 采集目标配置
    this.COLLECT_TARGET = {
      'xiaohongshu-note': { btnText: '采集小红书笔记', label: '小红书笔记' },
      'xiaohongshu-feed': { btnText: '采集主页笔记', label: '发现页' },
      'xiaohongshu-account': { btnText: '采集小红书账号', label: '小红书账号' },
      'wechat-article': { btnText: '采集公众号文章', label: '公众号文章' }
    };

    this._initVue();
  }

  /**
   * 初始化 Vue 应用
   * @private
   */
  _initVue() {
    const { createApp, reactive, computed, h } = Vue;
    const self = this;

    // Vue 组件配置
    const AppComponent = {
      setup() {
        // 响应式状态
        const state = reactive({
          dataType: 'xiaohongshu-note',
          checkedCount: 0,
          label: '小红书笔记',
          storageType: 'local',
          storageLabel: '未配置',
          tipMessage: '',  // 进度提示信息
          showTip: false,   // 是否显示提示
          stores: [],
          currentStoreIndex: -1,
          dropdownOpen: false
        });

        // 计算属性
        const displayText = computed(() => {
          return state.checkedCount > 0
            ? `${state.label} (${state.checkedCount})`
            : state.label;
        });

        const themeClass = computed(() => {
          return state.dataType?.startsWith('wechat')
            ? 'cjdb-theme-wechat'
            : 'cjdb-theme-xiaohongshu';
        });

        // 方法
        const tipsDisplay = (msg) => {
          state.tipMessage = msg;
          state.showTip = !!msg;
        };

        const toggleDropdown = () => {
          state.dropdownOpen = !state.dropdownOpen;
        };

        const closeDropdown = () => {
          state.dropdownOpen = false;
        };

        const selectStore = async (index) => {
          await window.StorageConfig?.setCurrentStoreIndex(
            self._getStorageType(state.dataType),
            index
          );
          state.currentStoreIndex = index;
          await self._loadStorageConfig(state);
          closeDropdown();
        };

        const openConfigModal = () => {
          closeDropdown();
          self._openConfigModal(state.dataType, null);
        };

        const exportConfig = async () => {
          closeDropdown();
          await self._exportConfig();
        };

        const importConfig = () => {
          closeDropdown();
          self._triggerImportConfig(state);
        };

        const onCollect = () => {
          if (self.collectCallback) {
            self.collectCallback();
          }
        };

        // 暴露给外部调用
        self.vueState = state;
        self.vueMethods = { tipsDisplay };

        return {
          state,
          displayText,
          themeClass,
          tipsDisplay,
          toggleDropdown,
          closeDropdown,
          selectStore,
          openConfigModal,
          exportConfig,
          importConfig,
          onCollect
        };
      },
      // 使用 render 函数代替 template（符合 CSP）
      render() {
        const { state, displayText, themeClass, toggleDropdown, selectStore,
                openConfigModal, exportConfig, importConfig, onCollect } = this;

        // 存储源列表项
        const storeItems = state.stores.map((store, index) =>
          h('div', {
            key: index,
            class: ['cjdb-storage-item', { 'cjdb-current': index === state.currentStoreIndex }],
            onClick: () => selectStore(index)
          }, self._getStoreLabel(store))
        );

        // 存储下拉菜单
        const storageDropdown = h('div', {
          class: 'cjdb-storage-dropdown',
          style: { display: state.dropdownOpen ? 'block' : 'none' }
        }, [
          ...storeItems,
          h('div', { class: 'cjdb-storage-add-row' }, [
            h('button', {
              class: 'cjdb-storage-add',
              title: '添加存储源',
              onClick: (e) => {
                e.stopPropagation();
                openConfigModal();
              }
            }, '+')
          ]),
          h('div', { class: 'cjdb-storage-backup-row' }, [
            h('button', {
              class: 'cjdb-storage-backup-btn',
              title: '备份配置',
              onClick: (e) => {
                e.stopPropagation();
                exportConfig();
              }
            }, '导出配置'),
            h('button', {
              class: 'cjdb-storage-backup-btn',
              title: '恢复配置',
              onClick: (e) => {
                e.stopPropagation();
                importConfig();
              }
            }, '导入配置')
          ])
        ]);

        // 存储按钮容器
        const storageWrap = h('div', {
          class: ['cjdb-storage-wrap', { 'is-open': state.dropdownOpen }]
        }, [
          h('button', {
            class: 'cjdb-btn cjdb-storage-btn',
            title: '数据源 · ' + state.storageLabel,
            onClick: toggleDropdown
          }, [
            h('span', { class: 'cjdb-store-label' }, '数据源')
          ]),
          storageDropdown
        ]);

        // 采集按钮
        const collectButton = h('button', {
          class: 'cjdb-btn cjdb-collect',
          title: '拖动移动 / 点击采集',
          'data-collect-target': state.dataType,
          onClick: onCollect
        }, [
          h('span', { class: 'cjdb-collect-main' }, '采集'),
          h('span', { class: 'cjdb-collect-sub' }, displayText)
        ]);

        // 进度提示
        const tipDisplay = state.showTip
          ? h('div', { class: 'cjdb-tip-display' }, state.tipMessage)
          : null;

        // 根容器
        return h('div', {
          class: ['cjdb-panel', themeClass],
          onClick: (e) => e.stopPropagation()
        }, [
          storageWrap,
          collectButton,
          tipDisplay
        ]);
      }
    };

    // 创建并挂载 Vue 应用
    this.vueApp = createApp(AppComponent);

    // 如果 Element Plus 可用，则使用
    if (window.ElementPlus) {
      this.vueApp.use(window.ElementPlus);
    }

    this.vueInstance = this.vueApp.mount(this.root);

    // 点击外部关闭下拉
    document.addEventListener('click', () => {
      if (this.vueState) {
        this.vueState.dropdownOpen = false;
      }
    });
  }

  /**
   * 渲染面板
   * @param {string} dataType - 'xiaohongshu-note' | 'xiaohongshu-feed' | ...
   * @param {BaseCrawler} crawler - 当前激活的 Crawler
   */
  async render(dataType, crawler) {
    const target = this.COLLECT_TARGET[dataType];
    if (!target) {
      this._hidePanel();
      return;
    }

    // 更新响应式状态
    this.vueState.dataType = dataType;
    this.vueState.label = target.label;

    // 获取 Crawler 状态
    const state = crawler.getCrawlerState();
    this.vueState.checkedCount = state?.checked || state?.checkedNoteCount || 0;

    // 显示面板
    this.root.style.display = 'block';

    // 加载存储配置
    await this._loadStorageConfig(this.vueState);
  }

  /**
   * 隐藏面板
   * @private
   */
  _hidePanel() {
    this.root.style.display = 'none';
  }

  /**
   * 加载存储配置
   * @private
   */
  async _loadStorageConfig(state) {
    const storageType = this._getStorageType(state.dataType);
    const [store, stores, idx] = await Promise.all([
      window.StorageConfig?.getCurrentStoreForType(storageType),
      window.StorageConfig?.getStoresForType(storageType),
      window.StorageConfig?.getCurrentStoreIndex(storageType)
    ]);

    state.stores = stores || [];
    state.currentStoreIndex = idx ?? -1;
    state.storageLabel = this._getStoreLabel(store);
  }

  /**
   * 获取存储源标签
   * @private
   */
  _getStoreLabel(store) {
    if (!store) return '未配置';
    if (store.type === 'local') return '本地';
    if (store.type === 'feishu') return store.appToken ? `飞书:${store.tableId || '...'}` : '飞书';
    if (store.type === 'notion') return store.databaseId ? `Notion:${store.databaseId.slice(0, 8)}...` : 'Notion';
    return store.type;
  }

  /**
   * 获取存储类型（发现页使用笔记的存储配置）
   * @private
   */
  _getStorageType(dataType) {
    const STORAGE_TYPE_MAP = { 'xiaohongshu-feed': 'xiaohongshu-note' };
    return STORAGE_TYPE_MAP[dataType] || dataType;
  }

  /**
   * 打开配置弹窗
   * @private
   */
  _openConfigModal(dataType, editIndex) {
    const modal = document.getElementById('cjdb-config-modal');
    if (!modal) return;

    const storeTypeSelect = modal.querySelector('[name="storeType"]');
    const formBody = modal.querySelector('.cjdb-modal-form-body');

    modal.dataset.dataType = dataType;
    modal.dataset.editIndex = String(editIndex ?? -1);
    modal.classList.add('cjdb-show');

    storeTypeSelect.innerHTML = '<option value="local">本地</option><option value="feishu">飞书</option><option value="notion">Notion</option>';
    storeTypeSelect.value = 'local';
    formBody.innerHTML = this._createConfigForm('local', null);

    // 监听类型切换
    storeTypeSelect.onchange = () => {
      formBody.innerHTML = this._createConfigForm(storeTypeSelect.value, null);
    };
  }

  /**
   * 创建配置表单
   * @private
   */
  _createConfigForm(storeType, existing) {
    const schema = window.StorageConfig?.SCHEMA_MAP?.[storeType];
    if (!schema) return '';
    if (storeType === 'local') return '<p class="cjdb-page-type">本地存储无需配置</p>';

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

  /**
   * 导出配置
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
   * 触发导入配置
   * @private
   */
  _triggerImportConfig(state) {
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
          await this._loadStorageConfig(state);
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
   * 公开方法：显示进度提示
   * @param {string} msg - 提示信息，如 "正在采集评论..."
   */
  tipsDisplay(msg) {
    if (this.vueMethods?.tipsDisplay) {
      this.vueMethods.tipsDisplay(msg);
    }
  }

  /**
   * 公开方法：设置采集按钮点击回调
   * @param {Function} callback - 点击回调函数
   */
  onCollect(callback) {
    this.collectCallback = callback;
  }
}

window.VueRenderer = VueRenderer;
