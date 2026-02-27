// ==UserScript==
// @name         小红书数据采集到 Notion (重构版)
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  采集小红书笔记和账号数据到 Notion，支持完整字段和自动去重
// @author       Bin Chen
// @match        https://www.xiaohongshu.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xiaohongshu.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // ========== 常量定义 ==========

    const NOTE_SCHEMA = {
        '标题': { type: 'title', notionType: { title: {} } },
        'URL': { type: 'url', notionType: { url: {} }, unique: true },
        '发布时间': { type: 'date', notionType: { date: {} } },
        '发布地点': { type: 'rich_text', notionType: { rich_text: {} } },
        '正文': { type: 'rich_text', notionType: { rich_text: {} } },
        '图片': { type: 'files', notionType: { files: {} } },
        '标签': { type: 'multi_select', notionType: { multi_select: {} } },
        '点赞量': { type: 'number', notionType: { number: { format: 'number' } } },
        '收藏量': { type: 'number', notionType: { number: { format: 'number' } } },
        '评论量': { type: 'number', notionType: { number: { format: 'number' } } },
        '作者粉丝量': { type: 'number', notionType: { number: { format: 'number' } } },
        '作者获赞与收藏数': { type: 'number', notionType: { number: { format: 'number' } } },
        '采集时间': { type: 'date', notionType: { date: {} } }
    };

    const ACCOUNT_SCHEMA = {
        '昵称': { type: 'title', notionType: { title: {} } },
        '账号ID': { type: 'rich_text', notionType: { rich_text: {} }, unique: true },
        '主页URL': { type: 'url', notionType: { url: {} } },
        '头像': { type: 'files', notionType: { files: {} } },
        '账号简介': { type: 'rich_text', notionType: { rich_text: {} } },
        '归属地': { type: 'rich_text', notionType: { rich_text: {} } },
        '笔记数': { type: 'number', notionType: { number: { format: 'number' } } },
        '获赞数': { type: 'number', notionType: { number: { format: 'number' } } },
        '粉丝数': { type: 'number', notionType: { number: { format: 'number' } } },
        '关注数': { type: 'number', notionType: { number: { format: 'number' } } },
        '采集时间': { type: 'date', notionType: { date: {} } }
    };

    const NOTION_VERSION = '2022-06-28';

    // ========== 工具函数 ==========

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function parseCount(str) {
        if (!str) return 0;
        const strVal = String(str).trim();
        let multiplier = 1;
        if (strVal.includes('w') || strVal.includes('万')) multiplier = 10000;
        if (strVal.includes('k')) multiplier = 1000;
        const num = parseFloat(strVal.replace(/[^\d.]/g, ''));
        return Math.floor(num * multiplier) || 0;
    }

    function isNotePage() {
        const path = window.location.pathname;
        const href = window.location.href;

        // 检查是否有模态框（弹出框）
        const hasModal = document.querySelector('.note-detail-mask, .note-detail-modal, [class*="note-detail"]');

        // 支持多种笔记页面格式
        const patterns = [
            /\/explore\/[a-f0-9]+/,           // /explore/xxx
            /\/discovery\/item\/[a-f0-9]+/,   // /discovery/item/xxx
            /\/user\/profile\/[^\/]+\/[a-f0-9]+/, // /user/profile/xxx/noteid
        ];

        const isNote = patterns.some(pattern => pattern.test(path)) ||
                      href.includes('/explore/') ||
                      href.includes('/discovery/item/') ||
                      !!hasModal; // 如果有模态框，也认为是笔记页

        // 移除日志输出，避免频繁输出
        // console.log('[XHS] 页面检测 - 笔记页:', isNote, '路径:', path, '模态框:', !!hasModal);
        return isNote;
    }

    function isAccountPage() {
        const path = window.location.pathname;
        const isAccount = /\/user\/profile\/[a-f0-9]+\/?$/.test(path);
        // 移除日志输出，避免频繁输出
        // console.log('[XHS] 页面检测 - 账号页:', isAccount, '路径:', path);
        return isAccount;
    }

    // ========== ConfigManager ==========

    class ConfigManager {
        constructor() {
            this.config = this.load();
        }

        load() {
            return {
                apiToken: GM_getValue('api_token', ''),
                noteDatabaseId: GM_getValue('note_db_id', ''),
                accountDatabaseId: GM_getValue('account_db_id', ''),
                noteInitialized: GM_getValue('note_initialized', false),
                accountInitialized: GM_getValue('account_initialized', false),
                initVersion: GM_getValue('init_version', '0')
            };
        }

        save(apiToken, noteDatabaseId, accountDatabaseId) {
            GM_setValue('api_token', apiToken);
            GM_setValue('note_db_id', noteDatabaseId);
            GM_setValue('account_db_id', accountDatabaseId);

            // 重置初始化状态和字段名映射（配置变更时需要重新检查）
            GM_setValue('note_initialized', false);
            GM_setValue('account_initialized', false);
            GM_setValue('note_field_map', '{}');
            GM_setValue('account_field_map', '{}');

            this.config.apiToken = apiToken;
            this.config.noteDatabaseId = noteDatabaseId;
            this.config.accountDatabaseId = accountDatabaseId;
            this.config.noteInitialized = false;
            this.config.accountInitialized = false;
        }

        getFieldMap(type) {
            const key = type === 'note' ? 'note_field_map' : 'account_field_map';
            const stored = GM_getValue(key, '{}');
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.warn(`[Config] 解析字段名映射失败，使用空映射`, e);
                return {};
            }
        }

        saveFieldMap(type, fieldMap) {
            const key = type === 'note' ? 'note_field_map' : 'account_field_map';
            try {
                GM_setValue(key, JSON.stringify(fieldMap));
                console.log(`[Config] ✅ 字段名映射已保存 (${type})`);
            } catch (e) {
                console.warn(`[Config] 保存字段名映射失败`, e);
            }
        }

        markInitialized(type) {
            if (type === 'note') {
                GM_setValue('note_initialized', true);
                this.config.noteInitialized = true;
            } else if (type === 'account') {
                GM_setValue('account_initialized', true);
                this.config.accountInitialized = true;
            }
        }

        isInitialized(type) {
            if (type === 'note') {
                return this.config.noteInitialized;
            } else if (type === 'account') {
                return this.config.accountInitialized;
            }
            return false;
        }

        isConfigured(type) {
            if (type === 'note') {
                return !!(this.config.apiToken && this.config.noteDatabaseId);
            } else if (type === 'account') {
                return !!(this.config.apiToken && this.config.accountDatabaseId);
            }
            return false;
        }

        extractDatabaseId(url) {
            // 从 Notion URL 提取 Database ID
            // 格式: https://www.notion.so/xxx/DATABASE_ID?v=...
            const match = url.match(/([a-f0-9]{32})/);
            return match ? match[1] : '';
        }

        showConfigUI() {
            const currentToken = this.config.apiToken;
            const currentNoteDbId = this.config.noteDatabaseId;
            const currentAccountDbId = this.config.accountDatabaseId;

            // 创建配置界面
            const modal = document.createElement('div');
            modal.id = 'xhs-config-modal';
            modal.innerHTML = `
                <div class="xhs-config-overlay">
                    <div class="xhs-config-dialog">
                        <h2>配置小红书数据采集</h2>
                        <div class="xhs-config-form">
                            <div class="xhs-form-group">
                                <label>Notion API Token:</label>
                                <input type="text" id="xhs-api-token" placeholder="ntn_..." value="${currentToken}">
                                <small>在 <a href="https://www.notion.so/my-integrations" target="_blank">Notion Integrations</a> 创建并复制 Token</small>
                            </div>

                            <div class="xhs-form-section">
                                <h3>笔记数据库</h3>
                                <div class="xhs-form-group">
                                    <label>笔记数据库 URL:</label>
                                    <input type="text" id="xhs-note-db-url" placeholder="https://www.notion.so/...">
                                    <small>打开 Notion 笔记数据库，复制浏览器地址栏的完整 URL</small>
                                </div>
                                <div class="xhs-form-group">
                                    <label>或直接输入 Database ID:</label>
                                    <input type="text" id="xhs-note-db-id" placeholder="32位字符" value="${currentNoteDbId}">
                                </div>
                            </div>

                            <div class="xhs-form-section">
                                <h3>账号数据库</h3>
                                <div class="xhs-form-group">
                                    <label>账号数据库 URL:</label>
                                    <input type="text" id="xhs-account-db-url" placeholder="https://www.notion.so/...">
                                    <small>打开 Notion 账号数据库，复制浏览器地址栏的完整 URL</small>
                                </div>
                                <div class="xhs-form-group">
                                    <label>或直接输入 Database ID:</label>
                                    <input type="text" id="xhs-account-db-id" placeholder="32位字符" value="${currentAccountDbId}">
                                </div>
                            </div>

                            <div class="xhs-form-actions">
                                <button id="xhs-config-save" class="xhs-btn-primary">保存配置</button>
                                <button id="xhs-config-cancel" class="xhs-btn-secondary">取消</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // 添加样式
            const style = document.createElement('style');
            style.textContent = `
                .xhs-config-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                }
                .xhs-config-dialog {
                    background: white;
                    border-radius: 8px;
                    padding: 24px;
                    width: 600px;
                    max-width: 90%;
                    max-height: 90vh;
                    overflow-y: auto;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                }
                .xhs-config-dialog h2 {
                    margin: 0 0 20px 0;
                    font-size: 20px;
                    color: #333;
                }
                .xhs-config-dialog h3 {
                    margin: 0 0 12px 0;
                    font-size: 16px;
                    color: #666;
                    font-weight: 500;
                }
                .xhs-form-section {
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                }
                .xhs-form-group {
                    margin-bottom: 16px;
                }
                .xhs-form-group label {
                    display: block;
                    margin-bottom: 6px;
                    font-weight: 500;
                    color: #333;
                    font-size: 14px;
                }
                .xhs-form-group input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 14px;
                    box-sizing: border-box;
                }
                .xhs-form-group input:focus {
                    outline: none;
                    border-color: #ff2442;
                }
                .xhs-form-group small {
                    display: block;
                    margin-top: 4px;
                    color: #666;
                    font-size: 12px;
                }
                .xhs-form-group small a {
                    color: #ff2442;
                    text-decoration: none;
                }
                .xhs-form-actions {
                    display: flex;
                    gap: 12px;
                    margin-top: 24px;
                }
                .xhs-form-actions button {
                    flex: 1;
                    padding: 10px;
                    border: none;
                    border-radius: 4px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .xhs-btn-primary {
                    background: #ff2442;
                    color: white;
                }
                .xhs-btn-primary:hover {
                    background: #e61e3a;
                }
                .xhs-btn-secondary {
                    background: #f0f0f0;
                    color: #333;
                }
                .xhs-btn-secondary:hover {
                    background: #e0e0e0;
                }
            `;
            modal.appendChild(style);
            document.body.appendChild(modal);

            // 绑定事件
            const apiTokenInput = document.getElementById('xhs-api-token');
            const noteDbUrlInput = document.getElementById('xhs-note-db-url');
            const noteDbIdInput = document.getElementById('xhs-note-db-id');
            const accountDbUrlInput = document.getElementById('xhs-account-db-url');
            const accountDbIdInput = document.getElementById('xhs-account-db-id');

            // URL 输入时自动提取 ID
            noteDbUrlInput.addEventListener('input', (e) => {
                const id = this.extractDatabaseId(e.target.value);
                if (id) noteDbIdInput.value = id;
            });

            accountDbUrlInput.addEventListener('input', (e) => {
                const id = this.extractDatabaseId(e.target.value);
                if (id) accountDbIdInput.value = id;
            });

            // 保存按钮
            document.getElementById('xhs-config-save').onclick = () => {
                const apiToken = apiTokenInput.value.trim();
                const noteDbId = noteDbIdInput.value.trim();
                const accountDbId = accountDbIdInput.value.trim();

                if (!apiToken) {
                    alert('请输入 Notion API Token');
                    return;
                }

                if (!noteDbId && !accountDbId) {
                    alert('请至少配置一个数据库（笔记或账号）');
                    return;
                }

                if (noteDbId && noteDbId.length !== 32) {
                    alert('笔记数据库 ID 格式不正确（应为32位字符）');
                    return;
                }

                if (accountDbId && accountDbId.length !== 32) {
                    alert('账号数据库 ID 格式不正确（应为32位字符）');
                    return;
                }

                this.save(apiToken, noteDbId, accountDbId);
                document.body.removeChild(modal);
                alert('配置已保存！\n\n页面将自动刷新以应用配置。');
                location.reload();
            };

            // 取消按钮
            document.getElementById('xhs-config-cancel').onclick = () => {
                document.body.removeChild(modal);
            };

            // 点击遮罩关闭
            modal.querySelector('.xhs-config-overlay').onclick = (e) => {
                if (e.target.classList.contains('xhs-config-overlay')) {
                    document.body.removeChild(modal);
                }
            };
        }
    }

    // ========== NotionAPI ==========

    class NotionAPI {
        constructor(apiKey, databaseId, fieldNameMap = {}) {
            this.apiKey = apiKey;
            this.databaseId = databaseId;
            this.schemaCache = null;
            this.fieldNameMap = fieldNameMap || {}; // 存储 schema 字段名到实际数据库字段名的映射
        }

        request(method, endpoint, data = null) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: method,
                    url: `https://api.notion.com/v1${endpoint}`,
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': NOTION_VERSION
                    },
                    data: data ? JSON.stringify(data) : undefined,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(JSON.parse(response.responseText));
                        } else {
                            reject(new Error(`API Error ${response.status}: ${response.responseText}`));
                        }
                    },
                    onerror: (error) => {
                        reject(new Error(`Network Error: ${error}`));
                    }
                });
            });
        }

        async getDatabase() {
            if (this.schemaCache) return this.schemaCache;
            this.schemaCache = await this.request('GET', `/databases/${this.databaseId}`);
            return this.schemaCache;
        }

        async updateDatabaseSchema(properties) {
            try {
                const result = await this.request('PATCH', `/databases/${this.databaseId}`, { properties });
                this.schemaCache = null; // 清除缓存
                return result;
            } catch (error) {
                // 如果是 title 属性相关的错误，给出友好提示
                if (error.message && error.message.includes('title property')) {
                    console.warn('[Notion] ⚠️ 无法创建 title 属性，这通常是因为数据库已有 title 属性');
                    console.warn('[Notion] 提示：请确保数据库的 title 属性名与 schema 中定义的字段名一致');
                    // 不抛出错误，允许继续执行其他字段的创建
                    return null;
                }
                throw error;
            }
        }

        async queryDatabase(filter) {
            return await this.request('POST', `/databases/${this.databaseId}/query`, { filter });
        }

        async createPage(properties, children = null) {
            const payload = {
                parent: { database_id: this.databaseId },
                properties: properties
            };
            
            // 如果有 children（页面内容），添加到 payload
            // Notion API 限制：创建页面时 children 最多 100 个
            let remainingChildren = null;
            if (children && Array.isArray(children) && children.length > 0) {
                if (children.length > 100) {
                    console.log(`[NotionAPI] children 数量 ${children.length} 超过限制，先创建页面，然后分批添加剩余内容`);
                    // 先添加前 100 个
                    payload.children = children.slice(0, 100);
                    // 剩余的后续分批添加
                    remainingChildren = children.slice(100);
                } else {
                    payload.children = children;
                }
            }
            
            // 创建页面
            const result = await this.request('POST', '/pages', payload);
            
            // 如果有剩余的 children，分批添加
            if (remainingChildren && remainingChildren.length > 0) {
                console.log(`[NotionAPI] 分批添加剩余的 ${remainingChildren.length} 个 blocks`);
                await this.appendBlocks(result.id, remainingChildren);
            }
            
            return result;
        }

        async updatePage(pageId, properties) {
            return await this.request('PATCH', `/pages/${pageId}`, { properties });
        }

        async appendBlocks(pageId, children) {
            if (!children || !Array.isArray(children) || children.length === 0) {
                return;
            }
            
            // Notion API 限制：每次最多 100 个 blocks
            const maxBlocksPerRequest = 100;
            
            // 如果 blocks 数量超过限制，分批添加
            if (children.length <= maxBlocksPerRequest) {
                return await this.request('PATCH', `/blocks/${pageId}/children`, {
                    children: children
                });
            } else {
                console.log(`[NotionAPI] blocks 数量 ${children.length} 超过限制，分批添加...`);
                
                // 分批添加
                for (let i = 0; i < children.length; i += maxBlocksPerRequest) {
                    const batch = children.slice(i, i + maxBlocksPerRequest);
                    console.log(`[NotionAPI] 添加第 ${Math.floor(i / maxBlocksPerRequest) + 1} 批，${batch.length} 个 blocks`);
                    
                    await this.request('PATCH', `/blocks/${pageId}/children`, {
                        children: batch
                    });
                    
                    // 添加延迟，避免请求过快
                    if (i + maxBlocksPerRequest < children.length) {
                        await sleep(200);
                    }
                }
                
                console.log('[NotionAPI] 所有 blocks 添加完成');
            }
        }

        async replacePageContent(pageId, children) {
            if (!children || !Array.isArray(children) || children.length === 0) {
                return;
            }
            
            try {
                // 获取现有 blocks
                const existingBlocks = await this.request('GET', `/blocks/${pageId}/children?page_size=100`);
                
                // 查找并删除「笔记列表」或「评论列表」标题及其后续内容
                const sectionTitles = ['笔记列表', '评论列表'];
                if (existingBlocks.results && existingBlocks.results.length > 0) {
                    let foundSection = false;
                    const blocksToDelete = [];
                    
                    for (const block of existingBlocks.results) {
                        const headingText = block.type === 'heading_2' && block.heading_2?.rich_text?.[0]?.text?.content;
                        if (sectionTitles.includes(headingText)) {
                            foundSection = true;
                        }
                        if (foundSection) {
                            blocksToDelete.push(block.id);
                        }
                    }
                    
                    // 删除找到的 blocks
                    for (const blockId of blocksToDelete) {
                        try {
                            await this.request('DELETE', `/blocks/${blockId}`);
                        } catch (e) {
                            console.warn(`[NotionAPI] 删除 block ${blockId} 失败:`, e);
                        }
                    }
                }
                
                // 追加新内容
                return await this.appendBlocks(pageId, children);
            } catch (error) {
                console.warn('[NotionAPI] 替换页面内容失败，尝试直接追加:', error);
                // 如果替换失败，直接追加
                return await this.appendBlocks(pageId, children);
            }
        }

        async ensureSchema(schema, saveFieldMapCallback = null) {
            console.log('[Notion] 检查数据库结构...');
            
            let db, existing, missing = {};
            let fieldMapUpdated = false;

            try {
                db = await this.getDatabase();
                existing = db.properties;
            } catch (error) {
                console.error('[Notion] ❌ 获取数据库信息失败:', error);
                // 降级处理：如果获取数据库失败，使用已有的字段名映射继续工作
                console.warn('[Notion] ⚠️ 使用已缓存的字段名映射继续工作');
                return false;
            }

            // 只在初始化时检查并更新字段名映射（如果提供了保存回调）
            if (saveFieldMapCallback) {
                try {
                    // 检查并建立 title 属性映射
                    const titleFields = Object.entries(schema).filter(([_, config]) => config.type === 'title');
                    if (titleFields.length > 0) {
                        const [titleFieldName] = titleFields[0];
                        const titleProp = Object.entries(existing).find(([_, prop]) => prop.type === 'title');
                        
                        if (!titleProp) {
                            console.warn(`[Notion] ⚠️ 数据库缺少 title 属性，请手动在 Notion 中创建一个 title 属性`);
                            console.warn(`[Notion] 提示：创建后，重新初始化时会自动检测并使用该 title 属性`);
                            // 降级处理：使用 schema 中定义的名称
                            this.fieldNameMap[titleFieldName] = titleFieldName;
                        } else {
                            const [actualTitleName] = titleProp;
                            // 建立映射：schema 字段名 -> 实际数据库字段名
                            this.fieldNameMap[titleFieldName] = actualTitleName;
                            if (actualTitleName !== titleFieldName) {
                                console.log(`[Notion] ✅ 检测到 title 属性映射: "${titleFieldName}" -> "${actualTitleName}"`);
                            } else {
                                console.log(`[Notion] ✅ title 属性 "${titleFieldName}" 已存在且名称匹配`);
                            }
                            fieldMapUpdated = true;
                        }
                    }

                    // 建立其他字段的映射
                    for (const [name, config] of Object.entries(schema)) {
                        if (config.type === 'title') {
                            continue; // title 字段已在上面处理
                        }
                        
                        if (existing[name]) {
                            // 字段存在，建立映射
                            this.fieldNameMap[name] = name;
                        } else {
                            // 字段不存在，需要创建
                            missing[name] = config.notionType;
                            console.log(`[Notion] 缺失字段: ${name}`);
                        }
                    }

                    // 保存字段名映射
                    if (fieldMapUpdated && saveFieldMapCallback) {
                        saveFieldMapCallback(this.fieldNameMap);
                    }
                } catch (error) {
                    console.warn('[Notion] ⚠️ 字段名映射检查失败，使用降级处理:', error);
                    // 降级处理：使用 schema 中定义的名称作为默认映射
                    for (const [name] of Object.entries(schema)) {
                        if (!this.fieldNameMap[name]) {
                            this.fieldNameMap[name] = name;
                        }
                    }
                }
            }

            // 创建缺失字段
            if (Object.keys(missing).length > 0) {
                console.log('[Notion] 创建缺失字段:', Object.keys(missing));
                try {
                    await this.updateDatabaseSchema(missing);
                    // 创建成功后，更新字段名映射（新创建的字段名应该与 schema 中的名称一致）
                    for (const fieldName of Object.keys(missing)) {
                        this.fieldNameMap[fieldName] = fieldName;
                    }
                    // 如果提供了保存回调，保存更新后的映射
                    if (saveFieldMapCallback) {
                        saveFieldMapCallback(this.fieldNameMap);
                    }
                    console.log('[Notion] 字段创建完成');
                    return true; // 返回 true 表示有更新
                } catch (error) {
                    // 如果是 title 属性错误，不影响其他字段的创建
                    if (error.message && error.message.includes('title property')) {
                        console.warn('[Notion] ⚠️ title 属性创建失败，但其他字段可能已创建');
                        return false;
                    }
                    throw error;
                }
            } else {
                console.log('[Notion] 数据库结构完整');
                return false; // 返回 false 表示无需更新
            }
        }

        async findByUniqueField(schema, fieldName, value) {
            const fieldConfig = schema[fieldName];
            if (!fieldConfig) {
                throw new Error(`字段 ${fieldName} 不存在于 schema 中`);
            }

            // 使用映射后的字段名（如果存在映射，否则使用原字段名）
            const actualFieldName = this.fieldNameMap[fieldName] || fieldName;

            let filterType, filterValue;
            if (fieldConfig.type === 'url') {
                filterType = 'url';
                filterValue = { equals: value };
            } else if (fieldConfig.type === 'rich_text') {
                filterType = 'rich_text';
                filterValue = { equals: value };
            } else {
                throw new Error(`不支持的唯一字段类型: ${fieldConfig.type}`);
            }

            const result = await this.queryDatabase({
                property: actualFieldName,
                [filterType]: filterValue
            });

            return result.results && result.results.length > 0 ? result.results[0] : null;
        }
    }

    // ========== NoteExtractor ==========

    class NoteExtractor {
        constructor() {
            this.context = this.getContext();
            this.currentHovercardData = null;
            // 评论队列：{ <comment_id>: { no, comment, published_at, likes, replies_count, checked, replies: { <reply_id>: { no, comment, published_at, likes, replies_count, checked } } } }
            this.commentQueue = {};
            this.commentNoCounter = 0;
            this.scrollHandler = null;
            this.commentScrollTimer = null;
            this.scrollTargets = [];  // 已绑定的滚动元素，用于清理
            this.injectCommentNumberStyles();
            this.startCommentScrollListener();
        }

        stopCommentNumberDisplay() {
            if (this.scrollHandler) {
                this.scrollTargets.forEach((el) => {
                    try {
                        el.removeEventListener('scroll', this.scrollHandler, { passive: true });
                    } catch (e) {}
                });
            }
            this.scrollTargets = [];
            this.scrollHandler = null;
            if (this.commentScrollTimer) {
                clearTimeout(this.commentScrollTimer);
                this.commentScrollTimer = null;
            }
        }

        // 清除评论编号和复选框的 DOM 显示（可选，离开笔记页时调用）
        clearCommentNumbers() {
            try {
                this.context = this.getContext();
                const numberEls = this.context.querySelectorAll('.xhs-comment-number');
                numberEls.forEach(el => el.remove());
                const checkboxWrappers = this.context.querySelectorAll('.xhs-comment-checkbox-wrapper');
                checkboxWrappers.forEach(el => el.remove());
            } catch (e) {
                console.warn('[NoteExtractor] 清除评论编号失败', e);
            }
        }

        getContext() {
            // 与 hover.js 完全一致的上下文获取逻辑
            const modal = document.querySelector('.note-detail-mask') || 
                         document.querySelector('.note-container') ||
                         document.querySelector('.note-detail');
            return modal || document;
        }

        injectCommentNumberStyles() {
            if (document.getElementById('xhs-comment-number-style')) return;

            const styles = `
                .xhs-comment-number {
                    display: inline-block !important;
                    margin-left: 6px !important;
                    background: rgba(255, 36, 66, 0.9) !important;
                    color: white !important;
                    font-size: 12px !important;
                    font-weight: 600 !important;
                    padding: 2px 6px !important;
                    border-radius: 4px !important;
                    z-index: 1000 !important;
                    pointer-events: none !important;
                    vertical-align: middle !important;
                }
                .xhs-comment-checkbox-wrapper {
                    display: inline-block !important;
                    margin-left: 6px !important;
                    z-index: 1001 !important;
                    pointer-events: auto !important;
                    vertical-align: middle !important;
                }
                .xhs-comment-checkbox-wrapper-reply {
                    margin-left: 18px !important;
                }
            `;

            const styleSheet = document.createElement('style');
            styleSheet.id = 'xhs-comment-number-style';
            styleSheet.textContent = styles;
            document.head.appendChild(styleSheet);
        }

        // 1. 监听屏幕滚动，防抖后执行：提取 .parent-comment 列表 → 入队 → 刷新 DOM 编号
        // 笔记详情里评论列表往往在「模态内可滚动容器」里滚动，不是 window，需同时监听 window 和该容器
        startCommentScrollListener() {
            if (this.scrollHandler) return;
            this.scrollHandler = () => {
                if (!isNotePage()) return;
                if (this.commentScrollTimer) clearTimeout(this.commentScrollTimer);
                this.commentScrollTimer = setTimeout(() => {
                    this.onScrollComments();
                }, 300);
            };

            const bindScroll = (el) => {
                if (!el || this.scrollTargets.includes(el)) return;
                el.addEventListener('scroll', this.scrollHandler, { passive: true });
                this.scrollTargets.push(el);
            };

            bindScroll(window);

            const tryBindContextScroll = () => {
                if (!isNotePage()) return;
                const ctx = this.getContext();
                if (ctx && ctx !== document) {
                    bindScroll(ctx);
                    const scrollable = ctx.querySelector('[style*="overflow-y: auto"], [style*="overflow: auto"], [style*="overflow-y:scroll"], .scroll-container, [class*="scroll"]');
                    if (scrollable) bindScroll(scrollable);
                }
            };

            tryBindContextScroll();
            setTimeout(tryBindContextScroll, 800);
            setTimeout(tryBindContextScroll, 2000);

            setTimeout(() => this.onScrollComments(), 500);
            setTimeout(() => this.onScrollComments(), 1500);
        }

        getCommentId(el) {
            const id = el.getAttribute('id');
            if (id && id.startsWith('comment-')) return id;
            return this.getCommentKey(el);
        }

        getCommentKey(commentElement) {
            const commentId = commentElement.getAttribute('id');
            if (commentId && commentId.startsWith('comment-')) return commentId;
            let content = (commentElement.querySelector('.note-text') || commentElement).textContent?.trim() || '';
            const infoEl = commentElement.querySelector('.info');
            let time = '';
            if (infoEl) {
                const m = infoEl.textContent.match(/(昨天|今天|\d{1,2}月\d{1,2}日)\s*\d{1,2}:\d{2}/);
                if (m) time = m[0];
            }
            return `${time}_${content.substring(0, 50)}`;
        }

        extractCommentData(el) {
            const comment = (el.querySelector('.note-text') || el).textContent?.trim() || '无内容';
            let published_at = '未知时间';
            let likes = 0;
            let replies_count = 0;
            // 精准从 .info 结构提取：div.info > div.date > span(首个子节点为时间) | div.interactions > div.like/reply > span.count
            const infoEl = el.querySelector('.info');
            if (!infoEl) return { comment, published_at, likes, replies_count };

            const dateDiv = infoEl.querySelector('.date');
            if (dateDiv && dateDiv.firstElementChild) {
                const timeText = dateDiv.firstElementChild.textContent?.trim();
                if (timeText && timeText.length < 30) published_at = timeText;
            }

            const likeCountEl = infoEl.querySelector('.interactions .like .count');
            if (likeCountEl) {
                const n = parseInt(likeCountEl.textContent?.trim(), 10);
                if (!Number.isNaN(n)) likes = n;
            }

            const replyCountEl = infoEl.querySelector('.interactions .reply .count');
            if (replyCountEl) {
                const n = parseInt(replyCountEl.textContent?.trim(), 10);
                if (!Number.isNaN(n)) replies_count = n;
            }

            return { comment, published_at, likes, replies_count };
        }

        bindScrollTarget(el) {
            if (!el || this.scrollTargets.includes(el)) return;
            el.addEventListener('scroll', this.scrollHandler, { passive: true });
            this.scrollTargets.push(el);
        }

        onScrollComments() {
            if (!isNotePage()) return;
            try {
                this.context = this.getContext();
                const parentList = this.context.querySelectorAll('.parent-comment');
                if (!parentList.length) return;
                const first = parentList[0];
                let scrollParent = first;
                while (scrollParent && scrollParent !== document.body) {
                    const style = window.getComputedStyle(scrollParent);
                    const overflow = style.overflowY || style.overflow;
                    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
                        this.bindScrollTarget(scrollParent);
                        break;
                    }
                    scrollParent = scrollParent.parentElement;
                }

                parentList.forEach((parentComment) => {
                    // 3.1 评论：主评论（不在 reply-container 里的 .comment-item）
                    const mainEl = parentComment.querySelector('.comment-item:not(.comment-item-sub)') || parentComment.querySelector('.comment-item');
                    if (!mainEl) return;
                    const commentId = this.getCommentId(mainEl);
                    if (!this.commentQueue[commentId]) {
                        this.commentNoCounter++;
                        const data = this.extractCommentData(mainEl);
                        this.commentQueue[commentId] = {
                            no: this.commentNoCounter,
                            comment: data.comment,
                            published_at: data.published_at,
                            likes: data.likes,
                            replies_count: data.replies_count,
                            checked: true,
                            replies: {}
                        };
                    }
                    console.log("主评论已缓存：", commentId);

                    // 3.2 回复：.reply-container 内的 .comment-item
                    const replyContainer = parentComment.querySelector('.reply-container');
                    if (replyContainer) {
                        const replyEls = replyContainer.querySelectorAll('.comment-item-sub, .comment-item, [class*="comment-item"]');
                        console.log('识别到回复数：', replyEls.length);
                        replyEls.forEach((replyEl) => {
                            const replyId = this.getCommentId(replyEl);
                            if (this.commentQueue[commentId].replies[replyId]) {
                                console.log('回复已存在，跳过：', replyId);
                                return;
                            }
                            const replyNo = Object.keys(this.commentQueue[commentId].replies).length + 1;
                            const data = this.extractCommentData(replyEl);
                            this.commentQueue[commentId].replies[replyId] = {
                                no: replyNo,
                                comment: data.comment,
                                published_at: data.published_at,
                                likes: data.likes,
                                replies_count: 0,
                                checked: true
                            };
                            console.log(`${this.commentQueue[commentId].no}的回复已缓存：${replyId}，编号：${replyNo}`);
                        });
                    }
                });

                this.refreshDomNumbers();
            } catch (e) {
                console.error('[NoteExtractor] onScrollComments 失败', e);
            }
        }

        findNicknameElement(commentEl) {
            const sel = ['.author-wrapper .name', '.author-wrapper .username', '.name', '.username', '[class*="author"] [class*="name"]', '.author-wrapper a', '.info-header .name'];
            for (const s of sel) {
                const el = commentEl.querySelector(s);
                if (el && (el.textContent || '').trim().length > 0 && (el.textContent || '').trim().length < 50) return el;
            }
            return null;
        }

        insertAfter(ref, node) {
            if (ref.nextSibling) ref.parentNode.insertBefore(node, ref.nextSibling);
            else ref.parentNode.appendChild(node);
        }

        refreshDomNumbers() {
            try {
                this.context = this.getContext();
                const parentList = this.context.querySelectorAll('.parent-comment');
                parentList.forEach((parentComment) => {
                    const mainEl = parentComment.querySelector('.comment-item:not(.comment-item-sub)') || parentComment.querySelector('.comment-item');
                    if (!mainEl) return;
                    const commentId = this.getCommentId(mainEl);
                    const entry = this.commentQueue[commentId];
                    if (!entry) return;

                    const insertRef = this.findNicknameElement(mainEl) || mainEl;
                    let numEl = mainEl.querySelector('.xhs-comment-number');
                    if (!numEl) {
                        numEl = document.createElement('span');
                        numEl.className = 'xhs-comment-number';
                        this.insertAfter(insertRef, numEl);
                    } else if (insertRef !== mainEl && numEl.parentNode && !insertRef.contains(numEl)) {
                        this.insertAfter(insertRef, numEl);
                    }
                    numEl.textContent = ` #${entry.no} `;
                    this.updateCheckbox(mainEl, commentId, null, false);

                    const replyContainer = parentComment.querySelector('.reply-container');
                    if (replyContainer) {
                        const replyEls = replyContainer.querySelectorAll('.comment-item-sub, .comment-item, [class*="comment-item"]');
                        replyEls.forEach((replyEl) => {
                            const replyId = this.getCommentId(replyEl);
                            const replyEntry = entry.replies[replyId];
                            if (!replyEntry) return;
                            const replyInsertRef = this.findNicknameElement(replyEl) || replyEl;
                            let rNumEl = replyEl.querySelector('.xhs-comment-number');
                            if (!rNumEl) {
                                rNumEl = document.createElement('span');
                                rNumEl.className = 'xhs-comment-number';
                                this.insertAfter(replyInsertRef, rNumEl);
                            } else if (replyInsertRef !== replyEl && rNumEl.parentNode && !replyInsertRef.contains(rNumEl)) {
                                this.insertAfter(replyInsertRef, rNumEl);
                            }
                            rNumEl.textContent = ` Reply#${replyEntry.no} `;
                            this.updateCheckbox(replyEl, commentId, replyId, true);
                        });
                    }
                });
            } catch (e) {
                console.error('[NoteExtractor] refreshDomNumbers 失败', e);
            }
        }

        updateCheckbox(commentEl, commentId, replyId, isReply) {
            try {
                const entry = replyId == null
                    ? this.commentQueue[commentId]
                    : (this.commentQueue[commentId] && this.commentQueue[commentId].replies[replyId]);
                if (!entry) return;
                const isChecked = entry.checked !== false;

                const afterNumber = commentEl.querySelector('.xhs-comment-number');
                const insertRef = afterNumber || this.findNicknameElement(commentEl) || commentEl;
                let checkboxWrapper = commentEl.querySelector('.xhs-comment-checkbox-wrapper');
                if (!checkboxWrapper) {
                    checkboxWrapper = document.createElement('span');
                    checkboxWrapper.className = 'xhs-comment-checkbox-wrapper' + (isReply ? ' xhs-comment-checkbox-wrapper-reply' : '');
                    this.insertAfter(insertRef, checkboxWrapper);
                } else {
                    checkboxWrapper.classList.toggle('xhs-comment-checkbox-wrapper-reply', !!isReply);
                }
                let marker = checkboxWrapper.querySelector('.xhs-comment-marker');
                if (!marker) {
                    marker = document.createElement('span');
                    marker.className = 'xhs-comment-marker';
                    marker.style.cssText = `
                        display: inline-block !important; width: 20px !important; height: 20px !important;
                        line-height: 20px !important; text-align: center !important;
                        background: ${isChecked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)'} !important;
                        color: white !important; font-size: 14px !important; font-weight: bold !important;
                        border-radius: 4px !important; cursor: pointer !important; user-select: none !important;
                    `;
                    marker.textContent = isChecked ? '✓' : '○';
                    marker.addEventListener('click', (e) => {
                        e.stopPropagation();
                        entry.checked = !entry.checked;
                        marker.textContent = entry.checked ? '✓' : '○';
                        marker.style.background = entry.checked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
                    });
                    checkboxWrapper.appendChild(marker);
                } else {
                    marker.textContent = isChecked ? '✓' : '○';
                    marker.style.background = isChecked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
                }
            } catch (e) {
                console.error('[NoteExtractor] updateCheckbox 失败', e);
            }
        }

        // 从hovercard中提取数据（直接返回，不缓存）
        extractHovercardData() {
            const result = {
                followers: null,
                following: null,
                likes: null
            };

            try {
                // 查找hovercard/tooltip元素（优先查找可见的）
                const tooltipSelectors = [
                    '.tooltip-container .tooltip-content',
                    '.tooltip-content',
                    '.tooltip-container',
                    '[class*="tooltip"][style*="opacity: 1"]',
                    '[class*="tooltip"]',
                    '[class*="hovercard"]',
                    '[class*="user-card"]'
                ];

                let tooltip = null;
                for (const selector of tooltipSelectors) {
                    const elements = document.querySelectorAll(selector);
                    // 查找可见的元素
                    for (const el of elements) {
                        const style = window.getComputedStyle(el);
                        if (el.offsetParent !== null && style.opacity !== '0' && style.display !== 'none') {
                            tooltip = el;
                            break;
                        }
                    }
                    if (tooltip) break;
                }

                if (!tooltip) {
                    console.log('[NoteExtractor] 未找到hovercard元素');
                    return result;
                }

                // 提取数据
                const tooltipText = tooltip.textContent || '';
                
                // 尝试从 interaction-info 区域提取（更准确）
                const interactionInfo = tooltip.querySelector('.interaction-info, [class*="interaction"]');
                if (interactionInfo) {
                    const interactionText = interactionInfo.textContent || '';
                    
                    // 提取关注数（支持中文数字）
                    const followingMatch = interactionText.match(/([\d.]+[万千]?)\s*关注/);
                    if (followingMatch) {
                        result.following = parseCount(followingMatch[1]) || null;
                    }

                    // 提取粉丝数（支持中文数字）
                    const followersMatch = interactionText.match(/([\d.]+[万千]?)\s*粉丝/);
                    if (followersMatch) {
                        result.followers = parseCount(followersMatch[1]) || null;
                    }

                    // 提取获赞与收藏（支持中文数字）
                    const likesMatch = interactionText.match(/([\d.]+[万千]?)\s*获赞与收藏/);
                    if (likesMatch) {
                        result.likes = parseCount(likesMatch[1]) || null;
                    }
                }
                
                // 如果从 interaction-info 没提取到，从整个tooltip文本提取
                if (!result.following) {
                    const followingMatch = tooltipText.match(/([\d.]+[万千]?)\s*关注/);
                    if (followingMatch) {
                        result.following = parseCount(followingMatch[1]) || null;
                    }
                }
                
                if (!result.followers) {
                    const followersMatch = tooltipText.match(/([\d.]+[万千]?)\s*粉丝/);
                    if (followersMatch) {
                        result.followers = parseCount(followersMatch[1]) || null;
                    }
                }
                
                if (!result.likes) {
                    const likesMatch = tooltipText.match(/([\d.]+[万千]?)\s*获赞与收藏/);
                    if (likesMatch) {
                        result.likes = parseCount(likesMatch[1]) || null;
                    }
                }

                if (result.followers || result.following || result.likes) {
                    console.log('[NoteExtractor] 从hovercard提取到数据:', result);
                }
            } catch (e) {
                console.warn('[NoteExtractor] 提取hovercard数据失败', e);
            }

            return result;
        }

        // 创建完整的鼠标事件（适配 Tampermonkey 隔离作用域）
        createMouseEvent(type, x, y, relatedTarget = null) {
            // 在 Tampermonkey 隔离作用域中，不能直接使用 view: window
            // 移除 view 属性，其他属性保持不变
            const eventInit = {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                screenX: x + (window.screenX || 0),
                screenY: y + (window.screenY || 0),
                pageX: x + (window.pageXOffset || 0),
                pageY: y + (window.pageYOffset || 0),
                buttons: 0,
                button: 0,
                detail: 0,
                which: 0,
                shiftKey: false,
                ctrlKey: false,
                altKey: false,
                metaKey: false
            };
            
            // 只有在 relatedTarget 不为 null 时才添加
            if (relatedTarget !== null) {
                eventInit.relatedTarget = relatedTarget;
            }
            
            return new MouseEvent(type, eventInit);
        }

        // 模拟鼠标移动到元素上（已验证的精简版核心代码）
        async moveMouseToElement(element) {
            console.log('[NoteExtractor] 开始模拟鼠标移动...');
            
            const rect = element.getBoundingClientRect();
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            
            // 模拟从元素上方移动到元素中心
            const steps = 15;
            const startY = rect.y - 50;
            const endY = centerY;
            const startX = centerX;
            
            // 获取父元素链
            const parentChain = [];
            let parent = element.parentElement;
            while (parent && parentChain.length < 5) {
                parentChain.push(parent);
                parent = parent.parentElement;
            }
            
            let enteredElement = false;
            
            // 逐步移动鼠标
            for (let i = 0; i <= steps; i++) {
                const progress = i / steps;
                const currentY = startY + (endY - startY) * progress;
                const currentX = startX;
                
                const isInElement = currentY >= rect.y && currentY <= rect.y + rect.height &&
                                   currentX >= rect.x && currentX <= rect.x + rect.width;
                
                // 创建 mousemove 事件
                const moveEvent = this.createMouseEvent('mousemove', currentX, currentY);
                
                // 在 document 和父元素上触发
                document.dispatchEvent(moveEvent);
                parentChain.forEach(p => p.dispatchEvent(moveEvent));
                
                // 如果鼠标进入元素区域
                if (isInElement && !enteredElement) {
                    enteredElement = true;
                    console.log(`[NoteExtractor] 鼠标进入元素区域 (步骤 ${i}/${steps})`);
                    
                    // 触发 mouseover
                    const overEvent = this.createMouseEvent('mouseover', currentX, currentY, document.body);
                    document.dispatchEvent(overEvent);
                    parentChain.forEach(p => p.dispatchEvent(overEvent));
                    element.dispatchEvent(overEvent);
                    
                    // 触发 mouseenter
                    const enterEvent = this.createMouseEvent('mouseenter', currentX, currentY, null);
                    element.dispatchEvent(enterEvent);
                    parentChain.forEach(p => {
                        const parentEnterEvent = this.createMouseEvent('mouseenter', currentX, currentY, null);
                        p.dispatchEvent(parentEnterEvent);
                    });
                }
                
                // 如果鼠标在元素内，在元素上触发 mousemove
                if (isInElement) {
                    element.dispatchEvent(moveEvent);
                }
                
                // 延迟（使用 Promise，与 hover-minimal.js 一致）
                await new Promise(resolve => setTimeout(resolve, 15));
            }
            
            // 最后在元素中心触发完整的事件序列
            console.log('[NoteExtractor] 在元素中心触发最终事件...');
            const finalEvents = [
                { type: 'mousemove', relatedTarget: null },
                { type: 'mouseover', relatedTarget: document.body },
                { type: 'mouseenter', relatedTarget: null }
            ];
            
            for (const eventConfig of finalEvents) {
                const event = this.createMouseEvent(eventConfig.type, centerX, centerY, eventConfig.relatedTarget);
                document.dispatchEvent(event);
                parentChain.forEach(p => p.dispatchEvent(event));
                element.dispatchEvent(event);
                // 延迟（使用 Promise，与 hover-minimal.js 一致）
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            console.log('[NoteExtractor] ✅ 鼠标移动模拟完成');
        }

        // 在用户昵称后显示成功标记 ✅
        showSuccessMarker() {
            try {
                // 查找用户昵称元素（多种选择器）
                const nicknameSelectors = [
                    '.info a.name .username',
                    '.info a.name span.username',
                    '.info .name .username',
                    '.info .name span.username',
                    '.author a.name .username',
                    '.author a.name span.username',
                    '.author-wrapper a.name .username',
                    '.author-wrapper a.name span.username',
                    'a.name .username',
                    'a.name span.username',
                    '.username',
                    '[class*="username"]'
                ];

                let nicknameElement = null;
                for (const selector of nicknameSelectors) {
                    const elements = this.context.querySelectorAll(selector);
                    if (elements.length > 0) {
                        nicknameElement = elements[0];
                        console.log(`[NoteExtractor] 找到昵称元素: ${selector}`);
                        break;
                    }
                }

                // 如果没找到，尝试查找包含用户名的链接
                if (!nicknameElement) {
                    const nameLinks = this.context.querySelectorAll('a.name, .name');
                    for (const link of nameLinks) {
                        const text = link.textContent?.trim();
                        if (text && text.length > 0 && text.length < 50) {
                            nicknameElement = link;
                            console.log(`[NoteExtractor] 找到昵称链接: ${text}`);
                            break;
                        }
                    }
                }

                if (!nicknameElement) {
                    console.warn('[NoteExtractor] 未找到昵称元素，无法显示成功标记');
                    return;
                }

                // 检查是否已经添加过标记
                const existingMarker = nicknameElement.parentElement?.querySelector('.xhs-success-marker');
                if (existingMarker) {
                    console.log('[NoteExtractor] 成功标记已存在');
                    return;
                }

                // 创建成功标记
                const marker = document.createElement('span');
                marker.className = 'xhs-success-marker';
                marker.textContent = ' ✅';
                marker.style.cssText = `
                    display: inline-block;
                    margin-left: 4px;
                    color: #52c41a;
                    font-size: 14px;
                    vertical-align: middle;
                    animation: xhs-success-pulse 0.5s ease-in-out;
                `;

                // 添加动画样式（如果还没有）
                if (!document.getElementById('xhs-success-marker-style')) {
                    const style = document.createElement('style');
                    style.id = 'xhs-success-marker-style';
                    style.textContent = `
                        @keyframes xhs-success-pulse {
                            0% { transform: scale(0.8); opacity: 0; }
                            50% { transform: scale(1.2); }
                            100% { transform: scale(1); opacity: 1; }
                        }
                    `;
                    document.head.appendChild(style);
                }

                // 将标记添加到昵称元素后面
                if (nicknameElement.parentElement) {
                    nicknameElement.parentElement.insertBefore(marker, nicknameElement.nextSibling);
                    console.log('[NoteExtractor] ✅ 成功标记已添加到昵称后');
                } else {
                    // 如果父元素不存在，直接添加到昵称元素后面（作为文本节点）
                    nicknameElement.appendChild(marker);
                    console.log('[NoteExtractor] ✅ 成功标记已添加到昵称元素内');
                }
            } catch (e) {
                console.warn('[NoteExtractor] 显示成功标记失败', e);
            }
        }

        async triggerHovercard() {
            console.log('[NoteExtractor] ========== 开始触发hovercard ==========');
            
            // 🔥 关键：查找 .info 元素（与 hover-minimal.js 完全相同的逻辑）
            const context = this.getContext();
            const infoElement = context.querySelector('.info');
            if (!infoElement) {
                console.log('[NoteExtractor] ⚠️ 未找到 .info 元素，无法触发hovercard');
                return null;
            }
            
            console.log('[NoteExtractor] ✅ 找到 .info 元素');
            
            // 第一步：模拟鼠标移动（即使失败也继续）
            try {
                await this.moveMouseToElement(infoElement);
            } catch (e) {
                console.error('[NoteExtractor] ❌ 模拟鼠标移动失败:', e);
                // 即使失败，也继续等待检查hovercard
            }

            // 第二步：等待hovercard出现（必须执行，与 hover-minimal.js 完全一致）
            console.log('[NoteExtractor] 等待hovercard出现...');
            let hovercardVisible = false;
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 300));
                // 检查hovercard是否出现（与 hover-minimal.js 完全一致）
                const hovercard = document.querySelector('.tooltip-container, .tooltip-content, [class*="tooltip"], [class*="hovercard"], [class*="user-card"]');
                if (hovercard) {
                    const style = window.getComputedStyle(hovercard);
                    if (style.display !== 'none' && style.opacity !== '0') {
                        console.log('[NoteExtractor] ✅ hovercard已出现！');
                        hovercardVisible = true;
                        break;
                    }
                }
            }

            if (!hovercardVisible) {
                console.log('[NoteExtractor] ⚠️ hovercard未出现');
                return null;
            }

            // 第三步：等待数据加载并提取数据
            console.log('[NoteExtractor] 等待hovercard数据加载...');
            let hovercardData = null;
            for (let i = 0; i < 10; i++) {
                await sleep(200);
                hovercardData = this.extractHovercardData();
                if (hovercardData.followers || hovercardData.following || hovercardData.likes) {
                    console.log('[NoteExtractor] ✅ hovercard数据已加载');
                    // 成功读取数据后，显示成功标记
                    this.showSuccessMarker();
                    break;
                }
            }

            return hovercardData;
        }

        async extract() {
            console.log('[NoteExtractor] 开始提取笔记数据...');
            
            // 第一步：先触发hovercard获取用户数据（必须等待完成）
            console.log('[NoteExtractor] 第一步：触发hovercard获取用户数据...');
            this.currentHovercardData = await this.triggerHovercard();
            
            // 等待hovercard处理完成后再继续
            if (this.currentHovercardData) {
                console.log('[NoteExtractor] ✅ hovercard数据已获取，继续提取其他数据...');
            } else {
                console.log('[NoteExtractor] ⚠️ hovercard数据获取失败，继续提取其他数据...');
            }
            
            // 第二步：提取其他笔记数据
            console.log('[NoteExtractor] 第二步：提取笔记内容...');
            
            const content = this.extractContent();
            
            // 第三步：提取评论列表（单独字段，写入 Notion 文档正文，不挤到「正文」列）
            console.log('[NoteExtractor] 第三步：提取评论列表...');
            const commentListText = this.formatCommentList();
            if (commentListText && commentListText.trim().length > 0) {
                const totalComments = Object.values(this.commentQueue).reduce((sum, e) => sum + 1 + Object.keys(e.replies || {}).length, 0);
                console.log(`[NoteExtractor] ✅ 已提取 ${totalComments} 条评论，将写入 Notion 文档内容`);
            }
            
            const data = {
                title: this.extractTitle(),
                url: this.extractUrl(),
                publishTime: this.extractPublishTime(),
                location: this.extractLocation(),
                content: content,
                commentListText: commentListText || '',
                collectedCommentCount: Object.keys(this.commentQueue).length,
                collectedReplyCount: Object.values(this.commentQueue).reduce((sum, e) => sum + Object.keys(e.replies || {}).length, 0),
                images: this.extractImages(),
                tags: this.extractTags(),
                likes: this.extractLikes(),
                collects: this.extractCollects(),
                comments: this.extractComments(),
                authorFollowers: this.extractAuthorFollowers(),
                authorLikes: this.extractAuthorLikes()
            };
            console.log('[NoteExtractor] 提取完成:', data);
            return data;
        }

        formatCommentList() {
            try {
                const lines = [];
                // 格式：编号｜时间｜点赞👍｜回复💬｜评论内容（emoji 提高识别度）
                const line = (c, prefix = '', label = '') => {
                    const t = c.published_at || '未知时间';
                    const content = c.comment || '无内容';
                    const likes = c.likes || 0;
                    const replies = c.replies_count != null ? c.replies_count : 0;
                    return `${prefix}${label}｜${t}｜👍 ${likes}｜💬 ${replies}｜${content}`;
                };
                const sorted = Object.values(this.commentQueue).filter(e => e.checked !== false).sort((a, b) => a.no - b.no);
                sorted.forEach((entry) => {
                    lines.push(line(entry, '', `#${entry.no} `));
                    const replyList = Object.values(entry.replies || {}).filter(r => r.checked !== false).sort((a, b) => a.no - b.no);
                    replyList.forEach((r) => lines.push(line(r, '    ', `Reply#${r.no} `)));
                });
                return lines.join('\n');
            } catch (e) {
                console.error('[NoteExtractor] 格式化评论列表失败', e);
                return '';
            }
        }

        extractTitle() {
            try {
                // 优先使用 #detail-title（小红书详情页的标准结构）
                const title = this.context.querySelector('#detail-title')?.textContent?.trim() ||
                             this.context.querySelector('.title')?.textContent?.trim() ||
                             this.context.querySelector('h1')?.textContent?.trim() ||
                             document.title.replace(' - 小红书', '').trim();
                console.log('[NoteExtractor] 提取标题:', title);
                return title || '未知标题';
            } catch (e) {
                console.warn('[NoteExtractor] 提取标题失败', e);
                return '未知标题';
            }
        }

        extractUrl() {
            return window.location.href.split('?')[0];
        }

        // 格式化日期为 YYYY-MM-DD，使用本地时区，避免时区偏移
        formatLocalDate(date) {
            if (!date || !(date instanceof Date)) {
                return null;
            }
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        extractPublishTime() {
            try {
                // 优先从 span.date 元素提取（格式：MM-DD 地点 或 相对时间 地点）
                const dateEl = this.context.querySelector('span.date, .date, .publish-time, .time');
                if (dateEl) {
                    const timeText = dateEl.textContent?.trim() || '';
                    console.log('[NoteExtractor] 从 date 元素提取时间文本:', timeText);
                    
                    if (timeText) {
                        // 解析相对时间（如"2小时前"）或绝对时间（如"01-15"）
                        const date = this.parseTimeText(timeText);
                        if (date) {
                            const dateStr = this.formatLocalDate(date);
                            console.log('[NoteExtractor] 解析后的日期:', dateStr);
                            return dateStr;
                        }
                    }
                }

                // 从 __INITIAL_STATE__ 提取
                if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                    const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                    if (noteData?.time) {
                        const date = new Date(noteData.time);
                        const dateStr = this.formatLocalDate(date);
                        console.log('[NoteExtractor] 从 __INITIAL_STATE__ 提取日期:', dateStr);
                        return dateStr;
                    }
                }
            } catch (e) {
                console.warn('[NoteExtractor] 提取发布时间失败', e);
            }
            const defaultDate = this.formatLocalDate(new Date());
            console.warn('[NoteExtractor] 使用默认日期:', defaultDate);
            return defaultDate || new Date().toISOString().split('T')[0]; // 默认今天
        }

        parseTimeText(text) {
            if (!text) return null;
            
            const now = new Date();
            const currentYear = now.getFullYear();
            
            // 解析相对时间
            if (text.includes('分钟前')) {
                const minutes = parseInt(text) || 0;
                return new Date(now - minutes * 60 * 1000);
            } else if (text.includes('小时前')) {
                const hours = parseInt(text) || 0;
                return new Date(now - hours * 60 * 60 * 1000);
            } else if (text.includes('天前')) {
                const days = parseInt(text) || 0;
                return new Date(now - days * 24 * 60 * 60 * 1000);
            }
            
            // 解析 MM-DD 格式（如 "01-15"）
            const mmddMatch = text.match(/^(\d{1,2})-(\d{1,2})/);
            if (mmddMatch) {
                const month = parseInt(mmddMatch[1]) - 1; // JavaScript 月份从 0 开始
                const day = parseInt(mmddMatch[2]);
                
                if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
                    // 创建日期，如果日期已经过去，使用当前年份，否则使用去年
                    const date = new Date(currentYear, month, day);
                    if (date > now) {
                        // 如果日期在未来，说明是去年的
                        date.setFullYear(currentYear - 1);
                    }
                    const dateStr = this.formatLocalDate(date);
                    console.log('[NoteExtractor] 解析 MM-DD 格式:', `${mmddMatch[1]}-${mmddMatch[2]}`, '->', dateStr);
                    return date;
                }
            }
            
            // 解析其他日期格式
            const date = new Date(text);
            if (!isNaN(date.getTime())) {
                return date;
            }
            
            return null;
        }

        extractLocation() {
            try {
                // 从 span.date 元素提取地点（格式：MM-DD 地点 或 相对时间 地点）
                const dateEl = this.context.querySelector('span.date, .date');
                if (dateEl) {
                    const text = dateEl.textContent?.trim() || '';
                    console.log('[NoteExtractor] 从 date 元素提取地点文本:', text);
                    
                    if (text) {
                        // 提取地点：移除日期部分，保留地点
                        // 格式可能是：MM-DD 地点 或 相对时间 地点
                        let location = text;
                        
                        // 移除相对时间模式
                        location = location.replace(/\d+\s*(分钟|小时|天|周|月|年)前\s*/, '');
                        
                        // 移除 MM-DD 格式
                        location = location.replace(/^\d{1,2}-\d{1,2}\s*/, '');
                        
                        // 移除其他日期格式
                        location = location.replace(/^\d{4}-\d{1,2}-\d{1,2}\s*/, '');
                        location = location.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*/, '');
                        
                        location = location.trim();
                        
                        if (location && location.length > 0) {
                            console.log('[NoteExtractor] 提取地点:', location);
                            return location;
                        }
                    }
                }
                
                // 从 __INITIAL_STATE__ 提取
                if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                    const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                    if (noteData?.location) {
                        console.log('[NoteExtractor] 从 __INITIAL_STATE__ 提取地点:', noteData.location);
                        return noteData.location;
                    }
                }
            } catch (e) {
                console.warn('[NoteExtractor] 提取发布地点失败', e);
            }
            return '';
        }

        extractContent() {
            try {
                // 优先使用 #detail-desc（小红书详情页的标准结构）
                // 这个元素只包含正文内容，不包含日期地点（日期地点在 #note-detail-origin 中）
                const contentEl = this.context.querySelector('#detail-desc') ||
                                 this.context.querySelector('.note-content, .content, .desc, [class*="content"], [class*="desc"]');
                
                if (!contentEl) {
                    console.warn('[NoteExtractor] 未找到正文容器');
                    return '';
                }

                // 克隆元素以避免修改原始 DOM
                const clonedEl = contentEl.cloneNode(true);
                
                // 保留标签元素（标签在正文中正常显示）
                // 只移除日期和地点元素
                const dateLocationSelectors = [
                    '#note-detail-origin', // 日期地点的标准位置
                    '.date', '.publish-time', '.time', '.location', '.place',
                    '[class*="date"]', '[class*="time"]', '[class*="location"]', '[class*="place"]',
                    '[id*="origin"]' // 包含 origin 的元素通常是日期地点
                ];
                dateLocationSelectors.forEach(selector => {
                    const elements = clonedEl.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });

                // 移除 emoji 图片（保留文本内容，emoji 图片不影响文本提取）
                const emojiImages = clonedEl.querySelectorAll('img[class*="emoji"], img.note-content-emoji');
                emojiImages.forEach(img => img.remove());

                let content = clonedEl.textContent?.trim() || '';
                
                // 清理文本：移除日期和地点模式（双重保险）
                // 匹配：数字 + 时间单位 + "前" + 可选空格 + 可选地点
                content = content.replace(/\d+\s*(分钟|小时|天|周|月|年)前\s*[\u4e00-\u9fa5a-zA-Z0-9\s]*/g, '');
                
                // 清理多余的空格和换行（保留标签文本）
                content = content.replace(/\s+/g, ' ').trim();
                
                console.log('[NoteExtractor] 提取正文:', content);
                return content;
            } catch (e) {
                console.warn('[NoteExtractor] 提取正文失败', e);
                return '';
            }
        }

        extractImages() {
            try {
                const imgs = this.context.querySelectorAll('.note-content img, .carousel img, .swiper-slide img');
                const urls = Array.from(imgs)
                    .map(img => img.src || img.dataset.src)
                    .filter(src => src && !src.includes('placeholder') && !src.includes('avatar'));

                return [...new Set(urls)]; // 去重
            } catch (e) {
                console.warn('[NoteExtractor] 提取图片失败', e);
                return [];
            }
        }

        extractTags() {
            try {
                const tags = new Set();
                
                // 从 #detail-desc 的子元素中提取标签
                const detailDesc = this.context.querySelector('#detail-desc');
                
                if (!detailDesc) {
                    console.warn('[NoteExtractor] 未找到 #detail-desc 元素，尝试备用方案');
                    // 备用方案：从 __INITIAL_STATE__ 提取
                    if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                        const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                        if (noteData?.tagList && Array.isArray(noteData.tagList)) {
                            noteData.tagList.forEach(tag => {
                                if (tag?.name) {
                                    const cleanTag = tag.name.replace(/^#+/, '').trim();
                                    if (cleanTag && cleanTag.length > 0 && cleanTag.length < 50) {
                                        tags.add(cleanTag);
                                    }
                                }
                            });
                        }
                    }
                } else {
                    // 只在 #detail-desc 内查找 id="hash-tag" 的元素（会有多个，会有嵌套）
                    const hashTagElements = detailDesc.querySelectorAll('[id="hash-tag"]');
                    
                    if (hashTagElements.length > 0) {
                        console.log(`[NoteExtractor] 在 #detail-desc 中找到 ${hashTagElements.length} 个 hash-tag 元素`);
                        
                        hashTagElements.forEach((el, index) => {
                            // 检查是否有父元素也是 hash-tag（处理嵌套情况）
                            let parent = el.parentElement;
                            let hasHashTagParent = false;
                            while (parent && parent !== document.body && parent !== detailDesc) {
                                if (parent.id === 'hash-tag') {
                                    hasHashTagParent = true;
                                    break;
                                }
                                parent = parent.parentElement;
                            }
                            
                            let text = '';
                            if (hasHashTagParent) {
                                // 如果有父 hash-tag，只提取当前元素的直接文本，不包含子 hash-tag 的文本
                                // 克隆元素并移除嵌套的子 hash-tag 元素
                                const clonedEl = el.cloneNode(true);
                                const nestedTags = clonedEl.querySelectorAll('[id="hash-tag"]');
                                nestedTags.forEach(nested => nested.remove());
                                text = clonedEl.textContent?.trim() || '';
                                console.log(`[NoteExtractor] 处理嵌套的 hash-tag 元素 ${index}`);
                            } else {
                                // 没有父 hash-tag，直接提取文本内容（包含所有子元素文本）
                                text = el.textContent?.trim() || '';
                            }
                            
                            // 移除 # 符号并清理
                            const cleanTag = text.replace(/^#+/, '').trim();
                            
                            if (cleanTag && cleanTag.length > 0 && cleanTag.length < 50) {
                                tags.add(cleanTag);
                                console.log(`[NoteExtractor] 提取标签 ${index}:`, cleanTag);
                            } else {
                                console.warn(`[NoteExtractor] hash-tag 元素 ${index} 文本为空或无效:`, text);
                            }
                        });
                    } else {
                        console.warn('[NoteExtractor] 在 #detail-desc 中未找到 id="hash-tag" 的元素');
                    }
                }
                
                const tagArray = Array.from(tags);
                console.log('[NoteExtractor] 提取标签:', tagArray);
                return tagArray;
            } catch (e) {
                console.warn('[NoteExtractor] 提取标签失败', e);
                return [];
            }
        }

        extractLikes() {
            return this.extractInteractCount('.like-wrapper .count', 'likedCount');
        }

        extractCollects() {
            return this.extractInteractCount('.collect-wrapper .count', 'collectedCount');
        }

        extractComments() {
            return this.extractInteractCount('.chat-wrapper .count, .comment-wrapper .count', 'commentCount');
        }

        extractInteractCount(selector, stateKey) {
            try {
                // 方案1: DOM
                const containers = this.context.querySelectorAll('.input-box, .interactions, .interact-container');
                for (let i = containers.length - 1; i >= 0; i--) {
                    const elem = containers[i].querySelector(selector);
                    if (elem) {
                        const count = parseCount(elem.textContent);
                        if (count > 0) return count;
                    }
                }

                // 方案2: __INITIAL_STATE__
                if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                    const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                    if (noteData?.interactInfo?.[stateKey]) {
                        return parseInt(noteData.interactInfo[stateKey]) || 0;
                    }
                }
            } catch (e) {
                console.warn(`[NoteExtractor] 提取 ${stateKey} 失败`, e);
            }
            return 0;
        }

        extractAuthorFollowers() {
            try {
                // 优先使用hovercard数据
                if (this.currentHovercardData && this.currentHovercardData.followers !== null) {
                    console.log('[NoteExtractor] 使用hovercard的粉丝数:', this.currentHovercardData.followers);
                    return this.currentHovercardData.followers;
                }

                // 尝试从作者信息区域提取粉丝数
                const followerEl = this.context.querySelector('.author-info .fans, .user-info .fans, [class*="follower"]');
                if (followerEl) {
                    return parseCount(followerEl.textContent);
                }

                // 从 __INITIAL_STATE__ 提取
                if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                    const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                    if (noteData?.user?.fansCount) {
                        return parseInt(noteData.user.fansCount) || 0;
                    }
                }
            } catch (e) {
                console.warn('[NoteExtractor] 提取作者粉丝量失败', e);
            }
            return 0;
        }

        extractAuthorLikes() {
            try {
                // 优先使用hovercard数据
                if (this.currentHovercardData && this.currentHovercardData.likes !== null) {
                    console.log('[NoteExtractor] 使用hovercard的获赞与收藏数:', this.currentHovercardData.likes);
                    return this.currentHovercardData.likes;
                }

                // 尝试从作者信息区域提取获赞与收藏数
                const likesEl = this.context.querySelector('.author-info .likes, .user-info .likes, [class*="like"]');
                if (likesEl) {
                    return parseCount(likesEl.textContent);
                }

                // 从 __INITIAL_STATE__ 提取
                if (window.__INITIAL_STATE__?.note?.noteDetailMap) {
                    const noteData = Object.values(window.__INITIAL_STATE__.note.noteDetailMap)[0];
                    if (noteData?.user?.likedCount) {
                        return parseInt(noteData.user.likedCount) || 0;
                    }
                }
            } catch (e) {
                console.warn('[NoteExtractor] 提取作者获赞与收藏数失败', e);
            }
            return 0;
        }
    }

    // ========== AccountExtractor ==========
    
    // 全局共享的笔记缓存（所有 AccountExtractor 实例共享）
    const globalNoteCache = new Map();

    class AccountExtractor {
        constructor() {
            this.maxNotes = 100; // 最多采集100条笔记
            this.noteCache = globalNoteCache; // 使用全局共享缓存
            this.injectNoteNumberStyles();
            this.noteNumberObserver = null; // 存储 observer 引用，用于清理
            this.scrollHandler = null; // 存储滚动事件处理器引用，用于清理
            this.scrollTimer = null; // 滚动防抖定时器
            this.updateNoteNumbersTimer = null; // 防抖定时器
            this.lastNoteCount = 0; // 记录上次的笔记数量，避免重复更新
            // 启动编号显示监听（实时更新）
            this.startNoteNumberObserver();
            // 启动静默采集监听
            this.startSilentCollection();
        }

        injectNoteNumberStyles() {
            if (document.getElementById('xhs-note-number-style')) return;

            const styles = `
                .xhs-note-number {
                    position: absolute !important;
                    top: 8px !important;
                    left: 8px !important;
                    background: rgba(255, 36, 66, 0.9) !important;
                    color: white !important;
                    font-size: 12px !important;
                    font-weight: 600 !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                    z-index: 1000 !important;
                    pointer-events: none !important;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2) !important;
                }
                .xhs-note-checkbox-wrapper {
                    position: absolute !important;
                    top: 8px !important;
                    left: 50px !important;
                    z-index: 1001 !important;
                    pointer-events: auto !important;
                }
                .xhs-note-checkbox {
                    width: 18px !important;
                    height: 18px !important;
                    cursor: pointer !important;
                    accent-color: #ff2442 !important;
                }
            `;

            const styleSheet = document.createElement('style');
            styleSheet.id = 'xhs-note-number-style';
            styleSheet.textContent = styles;
            document.head.appendChild(styleSheet);
        }

        startNoteNumberObserver() {
            // 只在账号页面启动编号显示监听
            if (!isAccountPage()) {
                return;
            }

            // 如果已经启动，先断开
            if (this.noteNumberObserver) {
                this.noteNumberObserver.disconnect();
            }

            // 使用 MutationObserver 监听笔记元素的变化
            this.noteNumberObserver = new MutationObserver(() => {
                if (isAccountPage()) {
                    this.updateNoteNumbers();
                }
            });

            this.noteNumberObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 初始更新一次
            setTimeout(() => {
                if (isAccountPage()) {
                    this.updateNoteNumbers();
                }
            }, 500);

            // 监听滚动事件，实时更新编号
            this.scrollHandler = () => {
                if (isAccountPage()) {
                    if (this.scrollTimer) {
                        clearTimeout(this.scrollTimer);
                    }
                    this.scrollTimer = setTimeout(() => {
                        this.updateNoteNumbers();
                    }, 200);
                }
            };

            // 使用防抖的滚动监听
            window.addEventListener('scroll', this.scrollHandler, { passive: true });
        }

        stopNoteNumberDisplay() {
            // 停止编号显示
            if (this.noteNumberObserver) {
                this.noteNumberObserver.disconnect();
                this.noteNumberObserver = null;
            }
            // 移除滚动监听器
            if (this.scrollHandler) {
                window.removeEventListener('scroll', this.scrollHandler);
                this.scrollHandler = null;
            }
            // 清理定时器
            if (this.scrollTimer) {
                clearTimeout(this.scrollTimer);
                this.scrollTimer = null;
            }
            if (this.updateNoteNumbersTimer) {
                clearTimeout(this.updateNoteNumbersTimer);
                this.updateNoteNumbersTimer = null;
            }
            // 清理缓存（页面切换时）
            this.clearCache();
        }

        clearCache() {
            // 清理笔记缓存
            this.noteCache.clear();
            console.log('[AccountExtractor] 已清理笔记缓存');
        }

        clearNoteNumbers() {
            // 清除所有编号和复选框
            const numberElements = document.querySelectorAll('.xhs-note-number');
            numberElements.forEach(el => el.remove());
            const checkboxWrappers = document.querySelectorAll('.xhs-note-checkbox-wrapper');
            checkboxWrappers.forEach(el => el.remove());
        }

        // 获取笔记的唯一标识（优先使用 data-index）
        getNoteKey(item) {
            const dataIndex = item.getAttribute('data-index');
            if (dataIndex !== null && dataIndex !== '') {
                // 直接使用 data-index 作为 key，确保一致性
                return `index_${dataIndex}`;
            }
            // 备用方案：使用标题+点赞数
            const title = item.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim();
            const likesEl = item.querySelector('.like-count, .likes, [class*="like"]');
            const likes = likesEl ? parseCount(likesEl.textContent) : 0;
            return `title_${title}_${likes}`;
        }

        // 静默采集单个笔记
        collectNoteSilently(item) {
            try {
                const dataIndex = item.getAttribute('data-index');
                const noteKey = this.getNoteKey(item);
                
                // 如果已经采集过，跳过
                if (this.noteCache.has(noteKey)) {
                    return;
                }

                const title = item.querySelector('.title, .note-title, [class*="title"]')?.textContent?.trim();
                if (!title) {
                    console.warn('[AccountExtractor] 静默采集跳过：未找到标题', { dataIndex, noteKey });
                    return;
                }

                const likesEl = item.querySelector('.like-count, .likes, [class*="like"]');
                const likes = likesEl ? parseCount(likesEl.textContent) : 0;

                // 提取笔记链接
                let noteUrl = '';
                const linkEl = item.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/user/"]');
                if (linkEl && linkEl.href) {
                    noteUrl = linkEl.href.split('?')[0];
                } else if (item.tagName === 'A' && item.href) {
                    noteUrl = item.href.split('?')[0];
                } else {
                    let parent = item.parentElement;
                    let depth = 0;
                    while (parent && depth < 5) {
                        if (parent.tagName === 'A' && parent.href && 
                            (parent.href.includes('/explore/') || parent.href.includes('/discovery/item/'))) {
                            noteUrl = parent.href.split('?')[0];
                            break;
                        }
                        parent = parent.parentElement;
                        depth++;
                    }
                }

                // 判断是否置顶
                const pinMarkers = item.querySelectorAll('.pin, .pinned, [class*="pin"], [class*="top"], [class*="sticky"]');
                let isPinned = pinMarkers.length > 0;
                if (!isPinned) {
                    const classList = item.classList.toString().toLowerCase();
                    isPinned = classList.includes('pin') || 
                              classList.includes('pinned') || 
                              classList.includes('top') ||
                              classList.includes('sticky');
                }
                if (!isPinned) {
                    const itemText = item.textContent || '';
                    isPinned = itemText.includes('置顶') || itemText.includes('TOP');
                }

                // 存储到缓存，默认勾选
                this.noteCache.set(noteKey, {
                    title,
                    likes,
                    url: noteUrl,
                    isPinned,
                    checked: true
                });

                console.log(`[AccountExtractor] 静默采集笔记: ${title} (data-index: ${dataIndex}, key: ${noteKey})`);
                
                // 采集完成后，立即更新复选框显示
                this.updateCheckboxForItem(item, noteKey);
            } catch (e) {
                console.error('[AccountExtractor] 静默采集失败', e);
            }
        }

        // 更新单个笔记的复选框显示
        updateCheckboxForItem(item, noteKey) {
            try {
                // 确保父元素有相对定位
                const computedStyle = window.getComputedStyle(item);
                if (computedStyle.position === 'static') {
                    item.style.position = 'relative';
                }
                
                // 创建或获取复选框容器
                let checkboxWrapper = item.querySelector('.xhs-note-checkbox-wrapper');
                if (!checkboxWrapper) {
                    checkboxWrapper = document.createElement('div');
                    checkboxWrapper.className = 'xhs-note-checkbox-wrapper';
                    item.appendChild(checkboxWrapper);
                }
                
                // 如果已经采集到缓存，显示标记（先用可见标记测试）
                if (this.noteCache.has(noteKey)) {
                    const cached = this.noteCache.get(noteKey);
                    const isChecked = cached ? cached.checked : true;
                    
                    // 先用可见标记代替复选框，确认位置是否正确
                    let marker = checkboxWrapper.querySelector('.xhs-note-marker');
                    if (!marker) {
                        marker = document.createElement('span');
                        marker.className = 'xhs-note-marker';
                        marker.style.cssText = `
                            display: inline-block !important;
                            width: 20px !important;
                            height: 20px !important;
                            line-height: 20px !important;
                            text-align: center !important;
                            background: ${isChecked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)'} !important;
                            color: white !important;
                            font-size: 14px !important;
                            font-weight: bold !important;
                            border-radius: 4px !important;
                            cursor: pointer !important;
                            user-select: none !important;
                        `;
                        marker.textContent = isChecked ? '✓' : '○';
                        marker.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const cached = this.noteCache.get(noteKey);
                            if (cached) {
                                cached.checked = !cached.checked;
                                marker.textContent = cached.checked ? '✓' : '○';
                                marker.style.background = cached.checked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
                                console.log(`[AccountExtractor] 笔记 "${cached.title}" ${cached.checked ? '已勾选' : '已取消勾选'}`);
                            }
                        });
                        checkboxWrapper.appendChild(marker);
                        console.log(`[AccountExtractor] 创建标记: ${noteKey} (位置: ${checkboxWrapper.offsetLeft}, ${checkboxWrapper.offsetTop})`);
                    } else {
                        // 更新标记状态
                        marker.textContent = isChecked ? '✓' : '○';
                        marker.style.background = isChecked ? 'rgba(82, 196, 26, 0.9)' : 'rgba(140, 140, 140, 0.9)';
                    }
                } else {
                    // 如果没有采集到缓存，清空容器
                    checkboxWrapper.innerHTML = '';
                }
            } catch (e) {
                console.error('[AccountExtractor] 更新标记失败', e);
            }
        }

        // 启动静默采集监听
        startSilentCollection() {
            if (!isAccountPage()) {
                return;
            }

            // 使用 MutationObserver 监听新笔记加载
            const collectionObserver = new MutationObserver(() => {
                if (!isAccountPage()) return;

                // 查找所有笔记元素
                const noteSelectors = [
                    '.note-item',
                    '[class*="note-item"]',
                    '[class*="note-card"]',
                    '.cover',
                    '[class*="feed-item"]'
                ];

                let noteElements = [];
                for (const selector of noteSelectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        noteElements = Array.from(elements);
                        break;
                    }
                }

                // 对每个笔记进行静默采集
                noteElements.forEach(item => {
                    const rect = item.getBoundingClientRect();
                    const isVisible = rect.width > 0 && rect.height > 0;
                    const hasContent = item.querySelector('img, .title, [class*="title"]');
                    if (isVisible && hasContent) {
                        this.collectNoteSilently(item);
                    }
                });
            });

            collectionObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 初始采集一次
            setTimeout(() => {
                if (isAccountPage()) {
                    const noteSelectors = ['.note-item', '[class*="note-item"]', '[class*="note-card"]', '.cover', '[class*="feed-item"]'];
                    for (const selector of noteSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            Array.from(elements).forEach(item => {
                                const rect = item.getBoundingClientRect();
                                const isVisible = rect.width > 0 && rect.height > 0;
                                const hasContent = item.querySelector('img, .title, [class*="title"]');
                                if (isVisible && hasContent) {
                                    this.collectNoteSilently(item);
                                }
                            });
                            break;
                        }
                    }
                }
            }, 1000);
        }

        updateNoteNumbers() {
            // 只在账号页面显示编号
            if (!isAccountPage()) {
                return;
            }

            // 使用防抖，避免频繁更新
            if (this.updateNoteNumbersTimer) {
                clearTimeout(this.updateNoteNumbersTimer);
            }

            this.updateNoteNumbersTimer = setTimeout(() => {
                // 查找所有笔记元素（优先查找 .note-item，因为它有 data-index 属性）
                const noteSelectors = [
                    '.note-item',  // 优先：有 data-index 属性
                    '[class*="note-item"]',
                    '[class*="note-card"]',
                    '.cover',
                    '[class*="feed-item"]'
                ];

                let noteElements = [];
                for (const selector of noteSelectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        noteElements = Array.from(elements);
                        break;
                    }
                }

                if (noteElements.length === 0) {
                    return;
                }

                // 过滤掉已经有编号的元素，避免重复处理
                const validNoteElements = noteElements.filter(item => {
                    // 确保元素可见且包含笔记内容
                    const rect = item.getBoundingClientRect();
                    const isVisible = rect.width > 0 && rect.height > 0;
                    const hasContent = item.querySelector('img, .title, [class*="title"]');
                    return isVisible && hasContent;
                });

                if (validNoteElements.length === 0) {
                    return;
                }

                // 只在笔记数量变化时输出日志
                if (validNoteElements.length !== this.lastNoteCount) {
                    console.log(`[AccountExtractor] 更新编号，找到 ${validNoteElements.length} 个笔记元素`);
                    this.lastNoteCount = validNoteElements.length;
                }

                validNoteElements.forEach((item, index) => {
                    // 优先使用元素自带的 data-index 属性
                    const dataIndex = item.getAttribute('data-index');
                    const noteNumber = dataIndex !== null ? (Number(dataIndex) + 1) : (index + 1);
                    const noteKey = this.getNoteKey(item);
                    
                    // 确保父元素有相对定位
                    const computedStyle = window.getComputedStyle(item);
                    if (computedStyle.position === 'static') {
                        item.style.position = 'relative';
                    }
                    
                    // 创建或更新编号元素
                    let numberEl = item.querySelector('.xhs-note-number');
                    if (!numberEl) {
                        numberEl = document.createElement('div');
                        numberEl.className = 'xhs-note-number';
                        item.appendChild(numberEl);
                    }
                    numberEl.textContent = `#${noteNumber}`;
                    
                    // 如果还没有采集，先进行静默采集
                    if (!this.noteCache.has(noteKey)) {
                        this.collectNoteSilently(item);
                    }
                    
                    // 更新复选框显示（使用统一的方法）
                    this.updateCheckboxForItem(item, noteKey);
                });
            }, 300); // 防抖延迟 300ms
        }

        async extract() {
            console.log('[AccountExtractor] 开始提取账号数据...');
            const basic = this.extractBasicInfo();
            const noteList = await this.extractNoteList();

            // 计算缓存统计
            const totalCached = this.noteCache.size;
            const checkedCount = noteList.length;
            const ignoredCount = totalCached - checkedCount;

            const data = {
                nickname: basic.nickname,
                accountId: basic.accountId,
                profileUrl: basic.profileUrl,
                avatar: basic.avatar,
                description: basic.description,
                location: basic.location,
                noteCount: noteList.length, // 使用实际加载出来的笔记数量
                likeCount: basic.likeCount,
                followers: basic.followers,
                following: basic.following,
                noteList: this.formatNoteList(noteList),
                // 添加缓存统计信息
                noteCacheStats: {
                    total: totalCached,
                    checked: checkedCount,
                    ignored: ignoredCount
                }
            };

            console.log('[AccountExtractor] 提取完成:', data);
            return data;
        }

        extractBasicInfo() {
            try {
                const nickname = document.querySelector('.user-name, .username, [class*="user-name"]')?.textContent?.trim() || '未知用户';
                const accountId = this.extractAccountId();
                const profileUrl = window.location.href.split('?')[0];
                const avatar = document.querySelector('.user-avatar img, .avatar img')?.src || '';

                // 提取账号简介
                let description = '';
                // 尝试多种选择器
                const descSelectors = [
                    '.user-desc',
                    '[class*="user-desc"]',
                    '[class*="desc"]',
                    '[class*="description"]',
                    '[class*="bio"]',
                    '[class*="intro"]'
                ];
                
                for (const selector of descSelectors) {
                    const descEl = document.querySelector(selector);
                    if (descEl) {
                        description = descEl.textContent?.trim() || '';
                        if (description) {
                            console.log(`[AccountExtractor] 找到账号简介: ${description.substring(0, 50)}... (选择器: ${selector})`);
                            break;
                        }
                    }
                }

                // 提取归属地
                let location = '';
                // 尝试多种选择器
                const ipSelectors = [
                    '.user-IP',
                    '[class*="user-IP"]',
                    '[class*="ip"]',
                    '[class*="IP"]',
                    'span[class*="ip"]',
                    'span[class*="IP"]'
                ];
                
                for (const selector of ipSelectors) {
                    const ipEl = document.querySelector(selector);
                    if (ipEl) {
                        // 提取文本内容，可能包含 "IP属地: " 前缀
                        let locationText = ipEl.textContent?.trim() || '';
                        // 如果包含 "IP属地" 或 "IP属地:" 前缀，去掉它
                        locationText = locationText.replace(/^IP属地[：:]\s*/, '').trim();
                        if (locationText) {
                            location = locationText;
                            console.log(`[AccountExtractor] 找到归属地: ${location} (选择器: ${selector})`);
                            break;
                        }
                    }
                }

                let noteCount = 0, likeCount = 0, followers = 0, following = 0;

                // 优先从 .data-info .user-interactions 提取（新的 HTML 结构）
                const dataInfo = document.querySelector('.data-info');
                if (dataInfo) {
                    const userInteractions = dataInfo.querySelector('.user-interactions');
                    if (userInteractions) {
                        const items = userInteractions.querySelectorAll('div');
                        console.log(`[AccountExtractor] 找到 ${items.length} 个互动项`);
                        
                        items.forEach((item, index) => {
                            const countEl = item.querySelector('.count');
                            const showsEl = item.querySelector('.shows');
                            
                            if (countEl && showsEl) {
                                const count = parseCount(countEl.textContent || '0');
                                const label = showsEl.textContent?.trim() || '';
                                
                                console.log(`[AccountExtractor] 互动项 ${index}: ${label} = ${count}`);
                                
                                if (label.includes('关注')) {
                                    following = count;
                                } else if (label.includes('粉丝')) {
                                    followers = count;
                                } else if (label.includes('获赞') || label.includes('收藏')) {
                                    likeCount = count;
                                } else if (label.includes('笔记')) {
                                    noteCount = count;
                                }
                            }
                        });
                    }
                }

                // 备用方案：从旧的统计区域提取
                if (followers === 0 && following === 0 && likeCount === 0 && noteCount === 0) {
                    console.log('[AccountExtractor] 使用备用方案提取统计数据');
                    const statsContainer = document.querySelector('.user-stats, .stats-container, [class*="stats"]');
                    if (statsContainer) {
                        const items = statsContainer.querySelectorAll('.stats-item, .count-item, div[class*="item"]');
                        items.forEach(item => {
                            const label = item.textContent;
                            const value = parseCount(item.querySelector('.count, .num')?.textContent || '0');
                            if (label.includes('笔记')) noteCount = value;
                            else if (label.includes('获赞')) likeCount = value;
                            else if (label.includes('粉丝')) followers = value;
                            else if (label.includes('关注')) following = value;
                        });
                    }
                }

                console.log('[AccountExtractor] 提取的基础信息:', {
                    nickname,
                    accountId,
                    description,
                    location,
                    followers,
                    following,
                    likeCount,
                    noteCount
                });

                return { nickname, accountId, profileUrl, avatar, description, location, noteCount, likeCount, followers, following };
            } catch (e) {
                console.error('[AccountExtractor] 提取基础信息失败', e);
                return {
                    nickname: '未知用户',
                    accountId: '',
                    profileUrl: window.location.href,
                    avatar: '',
                    description: '',
                    location: '',
                    noteCount: 0,
                    likeCount: 0,
                    followers: 0,
                    following: 0
                };
            }
        }

        extractAccountId() {
            // 从 URL 提取账号 ID
            const match = window.location.pathname.match(/\/user\/profile\/([a-f0-9]+)/);
            return match ? match[1] : '';
        }

        async extractNoteList() {
            console.log('[AccountExtractor] 从缓存读取笔记列表...');
            
            // 从缓存中读取所有勾选的笔记，并保留 key 用于排序
            const notesWithKey = [];
            for (const [key, cached] of this.noteCache.entries()) {
                if (cached.checked) {
                    notesWithKey.push({
                        key,
                        title: cached.title,
                        likes: cached.likes,
                        url: cached.url,
                        isPinned: cached.isPinned
                    });
                }
            }

            // 按 data-index 排序（如果 key 是 index_xxx 格式）
            notesWithKey.sort((a, b) => {
                const aMatch = a.key.match(/^index_(\d+)$/);
                const bMatch = b.key.match(/^index_(\d+)$/);
                
                if (aMatch && bMatch) {
                    // 两个都是 index_xxx 格式，按数字排序
                    return Number(aMatch[1]) - Number(bMatch[1]);
                } else if (aMatch) {
                    // a 是 index_xxx，b 不是，a 排在前面
                    return -1;
                } else if (bMatch) {
                    // b 是 index_xxx，a 不是，b 排在前面
                    return 1;
                } else {
                    // 都不是 index_xxx 格式，按标题排序
                    return a.title.localeCompare(b.title);
                }
            });

            // 移除 key，只返回笔记数据
            const notes = notesWithKey.map(n => ({
                title: n.title,
                likes: n.likes,
                url: n.url,
                isPinned: n.isPinned
            }));

            const totalCached = this.noteCache.size;
            const checkedCount = notes.length;
            const ignoredCount = totalCached - checkedCount;

            console.log(`[AccountExtractor] 缓存统计: 共 ${totalCached} 条笔记，${checkedCount} 条已勾选，${ignoredCount} 条已忽略`);
            console.log(`[AccountExtractor] 缓存 keys:`, Array.from(this.noteCache.keys()));
            
            return notes;
        }

        formatNoteList(notes) {
            const totalCached = this.noteCache.size;
            const checkedCount = notes.length;
            const ignoredCount = totalCached - checkedCount;
            
            // 统计信息
            const stats = `识别到 ${totalCached} 条笔记，${checkedCount} 条同步，${ignoredCount} 条忽略\n\n`;
            
            if (notes.length === 0) {
                return stats + '暂无笔记';
            }
            
            const noteList = notes.map((n, index) => {
                // 笔记编号
                const number = `#${index + 1}`;
                
                // 标题（如果有链接则添加超链接）
                let titleText = n.title;
                if (n.url) {
                    titleText = `[${n.title}](${n.url})`;
                }
                
                // 点赞数
                const likesText = `❤️ ${n.likes > 0 ? parseCount(n.likes.toString()) : 0}`;
                
                // 置顶标记
                const pinnedText = n.isPinned ? ' 📌置顶' : '';
                
                return `${number} 📝 ${titleText} | ${likesText}${pinnedText}`;
            }).join('\n');
            
            return stats + noteList;
        }
    }

    // ========== UIManager ==========

    class UIManager {
        constructor() {
            this.buttons = new Map();
            this.injectStyles();
        }

        injectStyles() {
            if (document.getElementById('xhs-notion-sync-style')) return;

            const styles = `
                #xhs-floating-btn {
                    position: fixed !important;
                    bottom: 80px !important;
                    right: 20px !important;
                    width: 56px !important;
                    height: 56px !important;
                    background: linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%) !important;
                    border-radius: 50% !important;
                    box-shadow: 0 4px 12px rgba(255, 36, 66, 0.4) !important;
                    cursor: pointer !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    z-index: 999998 !important;
                    transition: all 0.3s ease !important;
                    border: none !important;
                    color: white !important;
                    font-size: 14px !important;
                    font-weight: 600 !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                }
                #xhs-floating-btn:hover {
                    transform: scale(1.1) !important;
                    box-shadow: 0 6px 16px rgba(255, 36, 66, 0.5) !important;
                }
                #xhs-floating-btn:active {
                    transform: scale(0.95) !important;
                }
                #xhs-floating-btn:disabled {
                    opacity: 0.6 !important;
                    cursor: not-allowed !important;
                    transform: none !important;
                }
                #xhs-floating-btn.loading {
                    background: linear-gradient(135deg, #1890ff 0%, #40a9ff 100%) !important;
                    animation: pulse 1.5s ease-in-out infinite !important;
                }
                #xhs-floating-btn.initializing {
                    background: linear-gradient(135deg, #722ed1 0%, #9254de 100%) !important;
                }
                #xhs-floating-btn.success {
                    background: linear-gradient(135deg, #52c41a 0%, #73d13d 100%) !important;
                }
                #xhs-floating-btn.error {
                    background: linear-gradient(135deg, #f5222d 0%, #ff4d4f 100%) !important;
                }
                @keyframes pulse {
                    0%, 100% {
                        box-shadow: 0 4px 12px rgba(24, 144, 255, 0.4);
                    }
                    50% {
                        box-shadow: 0 4px 20px rgba(24, 144, 255, 0.6);
                    }
                }
            `;

            const styleSheet = document.createElement('style');
            styleSheet.id = 'xhs-notion-sync-style';
            styleSheet.textContent = styles;
            document.head.appendChild(styleSheet);
        }

        createFloatingButton(onClick) {
            const buttonId = 'xhs-floating-btn';
            let btn = document.getElementById(buttonId);
            
            if (btn) {
                console.log('[UI] 悬浮按钮已存在');
                return btn;
            }

            console.log('[UI] 创建悬浮按钮...');
            
            btn = document.createElement('button');
            btn.id = buttonId;
            btn.className = '';
            btn.textContent = '采集';
            btn.title = '点击采集当前页面数据到 Notion';
            btn.onclick = onClick;
            
            document.body.appendChild(btn);
            console.log('[UI] ✅ 悬浮按钮已创建');
            
            return btn;
        }

        updateButtonText(pageType) {
            const btn = document.getElementById('xhs-floating-btn');
            if (!btn) return;
            
            if (pageType === 'note') {
                btn.textContent = '采集';
                btn.title = '采集当前笔记到 Notion';
            } else if (pageType === 'account') {
                btn.textContent = '账号';
                btn.title = '采集当前账号到 Notion';
            } else {
                btn.textContent = '采集';
                btn.title = '点击采集当前页面数据到 Notion';
            }
        }

        updateButtonState(state, text = null) {
            const btn = document.getElementById('xhs-floating-btn');
            if (!btn) return;

            btn.className = state ? state : '';

            if (state === 'initializing') {
                btn.textContent = '⚙️';
                btn.title = '正在初始化...';
                btn.disabled = true;
            } else if (state === 'loading') {
                btn.textContent = '⏳';
                btn.title = '采集中...';
                btn.disabled = true;
            } else if (state === 'success') {
                btn.textContent = '✅';
                btn.title = '采集成功！';
                btn.disabled = true;
                setTimeout(() => {
                    btn.className = '';
                    btn.textContent = text || '采集';
                    btn.title = '点击采集当前页面数据到 Notion';
                    btn.disabled = false;
                }, 2000);
            } else if (state === 'error') {
                btn.textContent = '❌';
                btn.title = '采集失败';
                btn.disabled = false;
                setTimeout(() => {
                    btn.className = '';
                    btn.textContent = text || '采集';
                    btn.title = '点击采集当前页面数据到 Notion';
                }, 3000);
            } else if (state === 'idle') {
                btn.textContent = text || '采集';
                btn.title = '点击采集当前页面数据到 Notion';
                btn.disabled = false;
            }
        }

        showConfirmDialog(type, data, oldData = null) {
            let message = '';

            if (type === 'note-create' || type === 'note-update') {
                const isUpdate = type === 'note-update';
                const title = `【${isUpdate ? '更新' : '新建'}笔记】`;
                
                // 格式化标签
                const tagsText = Array.isArray(data.tags) && data.tags.length > 0 
                    ? data.tags.join('、') 
                    : '无';
                
                // 格式化图片数量
                const imageCount = Array.isArray(data.images) ? data.images.length : 0;
                const imagesText = `${imageCount} 张`;
                
                // 格式化正文（限制长度，避免对话框过长）
                let contentText = data.content || '无';
                const maxContentLength = 500;
                if (contentText.length > maxContentLength) {
                    contentText = contentText.substring(0, maxContentLength) + '...';
                }
                
                // 更新时显示变化对比
                const formatValue = (field, newVal, oldVal = null) => {
                    if (isUpdate && oldVal !== null && oldVal !== undefined && oldVal !== newVal) {
                        return `${oldVal} → ${newVal}`;
                    }
                    return String(newVal || '无');
                };
                
                message = `${title}\n\n` +
                    `标题: ${data.title || '无'}\n` +
                    `URL: ${data.url || '无'}\n` +
                    `发布时间: ${data.publishTime || '无'}\n` +
                    `${data.location ? `发布地点: ${data.location}\n` : ''}` +
                    `标签: ${tagsText}\n` +
                    `图片: ${imagesText}\n` +
                    `点赞: ${formatValue('likes', data.likes || 0, oldData?.likes)}\n` +
                    `收藏: ${formatValue('collects', data.collects || 0, oldData?.collects)}\n` +
                    `评论: ${formatValue('comments', data.comments || 0, oldData?.comments)}\n` +
                    `已采集评论数: ${data.collectedCommentCount ?? 0} 条，回复数: ${data.collectedReplyCount ?? 0} 条\n` +
                    `作者粉丝量: ${formatValue('authorFollowers', data.authorFollowers || 0, oldData?.authorFollowers)}\n` +
                    `作者获赞与收藏数: ${formatValue('authorLikes', data.authorLikes || 0, oldData?.authorLikes)}\n` +
                    `\n正文:\n${contentText}\n\n` +
                    `是否${isUpdate ? '更新' : '创建'}到 Notion？`;
                    
            } else if (type === 'account-create' || type === 'account-update') {
                const isUpdate = type === 'account-update';
                const title = `【${isUpdate ? '更新' : '新建'}账号】`;
                
                // 更新时显示变化对比
                const formatValue = (field, newVal, oldVal = null) => {
                    if (isUpdate && oldVal !== null && oldVal !== undefined && oldVal !== newVal) {
                        return `${oldVal} → ${newVal}`;
                    }
                    // 对于数字类型，0 应该显示为 0，而不是 '无'
                    if (typeof newVal === 'number') {
                        return String(newVal);
                    }
                    return String(newVal || '无');
                };
                
                // 笔记列表统计信息
                let noteStatsText = '';
                if (data.noteCacheStats) {
                    const { total, checked, ignored } = data.noteCacheStats;
                    noteStatsText = `\n笔记列表: 识别到 ${total} 条笔记，${checked} 条同步，${ignored} 条忽略`;
                } else {
                    // 兼容旧数据格式
                    noteStatsText = `\n笔记数: ${formatValue('noteCount', data.noteCount ?? 0, oldData?.noteCount)}`;
                }
                
                // 格式化账号简介（限制长度）
                let descriptionText = data.description || '无';
                const maxDescLength = 200;
                if (descriptionText.length > maxDescLength) {
                    descriptionText = descriptionText.substring(0, maxDescLength) + '...';
                }
                
                message = `${title}\n\n` +
                    `昵称: ${data.nickname || '无'}\n` +
                    `账号ID: ${data.accountId || '无'}\n` +
                    `主页URL: ${data.profileUrl || '无'}\n` +
                    `账号简介: ${descriptionText}\n` +
                    `归属地: ${data.location || '无'}\n` +
                    `粉丝数: ${formatValue('followers', data.followers || 0, oldData?.followers)}\n` +
                    `关注数: ${formatValue('following', data.following || 0, oldData?.following)}\n` +
                    noteStatsText + `\n` +
                    `获赞数: ${formatValue('likeCount', data.likeCount || 0, oldData?.likeCount)}\n` +
                    `\n是否${isUpdate ? '更新' : '创建'}到 Notion？`;
            }

            return confirm(message);
        }

        showErrorDialog(error, onReinitialize = null) {
            const errorMessage = error.message || String(error);
            const isFieldMissing = errorMessage.includes('is not a property that exists') || 
                                 errorMessage.includes('不存在') ||
                                 errorMessage.includes('property');
            
            if (isFieldMissing && onReinitialize) {
                // 字段缺失错误，显示重新初始化选项
                const message = `❌ 同步失败: ${errorMessage}\n\n` +
                    `检测到数据库字段缺失，是否重新初始化数据库结构？\n\n` +
                    `点击"确定"将重新创建缺失的字段。`;
                
                if (confirm(message)) {
                    return 'reinitialize';
                }
            } else {
                // 其他错误，只显示 OK
                alert(`❌ 同步失败: ${errorMessage}`);
            }
            
            return 'ok';
        }

        startPageObserver(updateButtonText) {
            let lastUrl = window.location.href;
            let lastPageType = null;
            let checkTimer = null;

            const checkPageType = () => {
                const currentUrl = window.location.href;
                // 如果 URL 没变化，直接返回，避免不必要的检测
                if (currentUrl === lastUrl) return;

                lastUrl = currentUrl;
                const isNote = isNotePage();
                const isAccount = isAccountPage();
                
                let pageType = null;
                if (isNote) {
                    pageType = 'note';
                } else if (isAccount) {
                    pageType = 'account';
                }

                if (pageType !== lastPageType) {
                    lastPageType = pageType;
                    updateButtonText(pageType);
                    console.log('[UI] 页面类型变化:', pageType);
                }
            };

            // 防抖的页面检测函数
            const debouncedCheckPageType = () => {
                if (checkTimer) {
                    clearTimeout(checkTimer);
                }
                checkTimer = setTimeout(checkPageType, 100);
            };

            // 监听 URL 变化（SPA 路由）
            const observer = new MutationObserver(() => {
                debouncedCheckPageType();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 监听 popstate 事件（浏览器前进/后退）
            window.addEventListener('popstate', checkPageType);

            // 监听 pushstate/replacestate（SPA 路由变化）
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            history.pushState = function(...args) {
                originalPushState.apply(history, args);
                setTimeout(checkPageType, 100);
            };
            history.replaceState = function(...args) {
                originalReplaceState.apply(history, args);
                setTimeout(checkPageType, 100);
            };

            // 初始检查
            checkPageType();

            // 不需要定时轮询，所有场景都通过事件监听覆盖：
            // 1. URL变化：通过 popstate、pushState、replaceState 监听
            // 2. DOM变化：通过 MutationObserver 监听
            // 3. 按钮点击：手动触发，不需要轮询
            // 4. 编号显示：通过滚动事件和 MutationObserver 监听，不需要轮询
        }
    }

    // ========== SyncController ==========

    class SyncController {
        constructor(notionAPI, extractor, uiManager, schema, reinitializeCallback = null) {
            this.notionAPI = notionAPI;
            this.extractor = extractor;
            this.uiManager = uiManager;
            this.schema = schema;
            this.reinitializeCallback = reinitializeCallback; // 重新初始化的回调函数
        }

        async reinitialize() {
            if (!this.reinitializeCallback) {
                console.warn('[SyncController] 没有提供重新初始化回调');
                return false;
            }

            try {
                console.log('[SyncController] 开始重新初始化数据库结构...');
                this.uiManager.updateButtonState('initializing');
                
                // 调用重新初始化回调
                await this.reinitializeCallback();
                
                console.log('[SyncController] ✅ 重新初始化完成');
                this.uiManager.updateButtonState('idle', '采集');
                return true;
            } catch (error) {
                console.error('[SyncController] 重新初始化失败:', error);
                alert(`❌ 重新初始化失败: ${error.message}`);
                this.uiManager.updateButtonState('error');
                return false;
            }
        }

        async sync(type) {
            this.uiManager.updateButtonState('loading');

            try {
                // 1. 提取数据
                let rawData;
                if (type === 'note') {
                    rawData = await this.extractor.extract();
                } else if (type === 'account') {
                    rawData = await this.extractor.extract();
                }

                // 2. 先显示确认对话框（立即显示，不等待查询）
                // 查询 Notion 的操作放到用户确认后再执行，提升响应速度
                const confirmed = this.uiManager.showConfirmDialog(`${type}-create`, rawData, null);

                if (!confirmed) {
                    this.uiManager.updateButtonState('idle');
                    return;
                }

                // 3. 用户确认后，再查询是否存在（用于决定是创建还是更新）
                const uniqueField = Object.keys(this.schema).find(key => this.schema[key].unique);
                const uniqueValue = rawData[this.getExtractKey(uniqueField)];

                const existing = await this.notionAPI.findByUniqueField(this.schema, uniqueField, uniqueValue);

                // 4. 转换为 Notion 格式（根据查询结果决定是更新还是创建）
                console.log('[SyncController] 原始提取数据中的标签:', rawData.tags);
                const isUpdate = !!existing;
                const notionData = this.convertToNotionFormat(rawData, isUpdate);

                // 5. 执行同步
                let pageId;
                if (existing) {
                    await this.notionAPI.updatePage(existing.id, notionData);
                    pageId = existing.id;
                    alert('✅ 更新成功！');
                } else {
                    // 创建页面时：账号类型把笔记列表作为页面内容，笔记类型把评论列表作为页面内容
                    let children = null;
                    if (type === 'account' && rawData.noteList) {
                        children = this.convertNoteListToBlocks(rawData.noteList);
                        console.log('[SyncController] 将笔记列表作为页面内容写入:', children.length, '个 blocks');
                    } else if (type === 'note' && rawData.commentListText && rawData.commentListText.trim()) {
                        children = this.convertCommentListToBlocks(rawData.commentListText);
                        console.log('[SyncController] 将评论列表作为页面内容写入:', children.length, '个 blocks');
                    }
                    
                    const result = await this.notionAPI.createPage(notionData, children);
                    pageId = result.id;
                    alert('✅ 创建成功！');
                }

                // 6. 更新页面内容：账号更新笔记列表，笔记更新评论列表
                if (isUpdate && type === 'account' && rawData.noteList) {
                    try {
                        const children = this.convertNoteListToBlocks(rawData.noteList);
                        await this.notionAPI.replacePageContent(pageId, children);
                        console.log('[SyncController] ✅ 笔记列表内容已更新');
                    } catch (error) {
                        console.warn('[SyncController] 更新笔记列表内容失败:', error);
                    }
                } else if (isUpdate && type === 'note' && rawData.commentListText && rawData.commentListText.trim()) {
                    try {
                        const children = this.convertCommentListToBlocks(rawData.commentListText);
                        await this.notionAPI.replacePageContent(pageId, children);
                        console.log('[SyncController] ✅ 评论列表内容已更新');
                    } catch (error) {
                        console.warn('[SyncController] 更新评论列表内容失败:', error);
                    }
                }

                this.uiManager.updateButtonState('success');

            } catch (error) {
                console.error('[SyncController] 同步失败:', error);
                
                // 显示错误对话框，如果是字段缺失错误，提供重新初始化选项
                const result = this.uiManager.showErrorDialog(error, this.reinitializeCallback ? () => this.reinitialize() : null);
                
                if (result === 'reinitialize') {
                    // 用户选择重新初始化
                    const reinitSuccess = await this.reinitialize();
                    if (reinitSuccess) {
                        // 重新初始化成功后，自动重试同步
                        console.log('[SyncController] 重新初始化成功，自动重试同步...');
                        await this.sync(type);
                        return;
                    }
                }
                
                this.uiManager.updateButtonState('error');
            }
        }

        getExtractKey(fieldName) {
            // 将字段名转换为提取器返回的 key
            const mapping = {
                '标题': 'title',
                'URL': 'url',
                '发布时间': 'publishTime',
                '发布地点': 'location',
                '正文': 'content',
                '图片': 'images',
                '标签': 'tags',
                '点赞量': 'likes',
                '收藏量': 'collects',
                '评论量': 'comments',
                '作者粉丝量': 'authorFollowers',
                '作者获赞与收藏数': 'authorLikes',
                '昵称': 'nickname',
                '账号ID': 'accountId',
                '主页URL': 'profileUrl',
                '头像': 'avatar',
                '账号简介': 'description',
                '归属地': 'location',
                '笔记数': 'noteCount',
                '获赞数': 'likeCount',
                '粉丝数': 'followers',
                '关注数': 'following'
            };
            return mapping[fieldName] || fieldName;
        }

        convertNoteListToBlocks(noteList) {
            if (!noteList || noteList === '暂无笔记') {
                return [];
            }

            const blocks = [];
            
            // 添加标题
            blocks.push({
                object: 'block',
                type: 'heading_2',
                heading_2: {
                    rich_text: [{
                        type: 'text',
                        text: { content: '笔记列表' }
                    }]
                }
            });

            // 将笔记列表文本按行分割，每行作为一个段落
            const lines = noteList.split('\n').filter(line => line.trim());
            
            // 处理所有行，不截断
            lines.forEach(line => {
                const richText = this.parseMarkdownLine(line.trim());
                blocks.push({
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: richText
                    }
                });
            });

            console.log(`[SyncController] 转换笔记列表为 blocks: ${blocks.length} 个 blocks`);
            return blocks;
        }

        convertCommentListToBlocks(commentListText) {
            if (!commentListText || !commentListText.trim()) return [];
            const blocks = [];
            blocks.push({
                object: 'block',
                type: 'heading_2',
                heading_2: { rich_text: [{ type: 'text', text: { content: '评论列表' } }] }
            });
            // 用 Markdown 代码块写入，方便阅读；Notion 单段 rich_text 限 2000 字，需分块
            const text = commentListText.trim();
            const CHUNK = 2000;
            const richText = [];
            for (let i = 0; i < text.length; i += CHUNK) {
                richText.push({ type: 'text', text: { content: text.slice(i, i + CHUNK) } });
            }
            blocks.push({
                object: 'block',
                type: 'code',
                code: {
                    rich_text: richText,
                    language: 'markdown'
                }
            });
            console.log(`[SyncController] 转换评论列表为 blocks: ${blocks.length} 个 (Markdown 代码块)`);
            return blocks;
        }

        // 解析 Markdown 格式的行，转换为 Notion rich_text 格式
        parseMarkdownLine(line) {
            const richText = [];
            // 匹配 Markdown 链接格式：[文本](URL)
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            let lastIndex = 0;
            let match;

            while ((match = linkRegex.exec(line)) !== null) {
                // 添加链接前的文本
                if (match.index > lastIndex) {
                    const textBefore = line.substring(lastIndex, match.index);
                    if (textBefore) {
                        richText.push({
                            type: 'text',
                            text: { content: textBefore }
                        });
                    }
                }

                // 添加链接
                richText.push({
                    type: 'text',
                    text: { content: match[1] },
                    annotations: {
                        bold: false,
                        italic: false,
                        strikethrough: false,
                        underline: false,
                        code: false,
                        color: 'default'
                    },
                    href: match[2]
                });

                lastIndex = match.index + match[0].length;
            }

            // 添加剩余的文本
            if (lastIndex < line.length) {
                const textAfter = line.substring(lastIndex);
                if (textAfter) {
                    richText.push({
                        type: 'text',
                        text: { content: textAfter }
                    });
                }
            }

            // 如果没有匹配到任何链接，返回整行作为普通文本
            if (richText.length === 0) {
                richText.push({
                    type: 'text',
                    text: { content: line }
                });
            }

            return richText;
        }

        convertToNotionFormat(rawData, isUpdate = false) {
            const notionData = {};
            const now = new Date().toISOString();
            const fieldNameMap = this.notionAPI.fieldNameMap || {}; // 获取字段名映射

            console.log(`[SyncController] 转换为 Notion 格式 (${isUpdate ? '更新' : '创建'})`);

            for (const [fieldName, config] of Object.entries(this.schema)) {
                const key = this.getExtractKey(fieldName);
                let value = rawData[key];

                // 使用映射后的字段名（如果存在映射，否则使用原字段名）
                const actualFieldName = fieldNameMap[fieldName] || fieldName;

                // 更新时跳过 URL 字段（URL 作为唯一标识，不应该被更新）
                if (isUpdate && fieldName === 'URL') {
                    console.log(`[SyncController] 更新操作，跳过 URL 字段`);
                    continue;
                }

                // 跳过采集时间，使用当前时间
                if (fieldName === '采集时间') {
                    notionData[actualFieldName] = { date: { start: now.split('T')[0] } };
                    continue;
                }

                // 根据类型转换
                if (config.type === 'title') {
                    notionData[actualFieldName] = {
                        title: [{ text: { content: String(value || '未知') } }]
                    };
                } else if (config.type === 'url') {
                    notionData[actualFieldName] = { url: value || '' };
                } else if (config.type === 'date') {
                    notionData[actualFieldName] = { date: value ? { start: value } : null };
                } else if (config.type === 'rich_text') {
                    const text = String(value || '');
                    notionData[actualFieldName] = {
                        rich_text: [{ text: { content: text.slice(0, 2000) } }] // Notion 限制
                    };
                } else if (config.type === 'files') {
                    if (Array.isArray(value) && value.length > 0) {
                        notionData[actualFieldName] = {
                            files: value.map(url => ({ 
                                type: 'external',
                                name: 'image',
                                external: { url }
                            }))
                        };
                    } else if (typeof value === 'string' && value) {
                        notionData[actualFieldName] = {
                            files: [{ type: 'external', name: 'image', external: { url: value } }]
                        };
                    } else {
                        notionData[actualFieldName] = { files: [] };
                    }
                } else if (config.type === 'multi_select') {
                    console.log(`[SyncController] 转换标签字段 "${fieldName}" (实际字段名: "${actualFieldName}")`);
                    console.log(`[SyncController] 原始值:`, value, '类型:', typeof value, '是否为数组:', Array.isArray(value));
                    
                    if (Array.isArray(value) && value.length > 0) {
                        const multiSelect = value.map(tag => {
                            const tagName = String(tag || '').trim();
                            if (!tagName) {
                                console.warn(`[SyncController] 跳过空标签:`, tag);
                                return null;
                            }
                            return { name: tagName };
                        }).filter(item => item !== null);
                        
                        notionData[actualFieldName] = { multi_select: multiSelect };
                        console.log(`[SyncController] 转换后的标签:`, multiSelect);
                    } else {
                        console.warn(`[SyncController] 标签值为空或不是数组，设置为空数组`);
                        notionData[actualFieldName] = { multi_select: [] };
                    }
                } else if (config.type === 'number') {
                    notionData[actualFieldName] = { number: parseInt(value) || 0 };
                }
            }

            console.log('[SyncController] 转换后的 Notion 数据:', JSON.stringify(notionData, null, 2));
            return notionData;
        }
    }

    // ========== 初始化 ==========

    async function init() {
        console.log('[XHS-Notion] 🚀 脚本启动...');
        console.log('[XHS-Notion] 当前 URL:', window.location.href);

        // 1. 创建配置管理器
        const config = new ConfigManager();
        console.log('[XHS-Notion] 配置加载完成');

        // 2. 创建 UI 管理器
        const uiManager = new UIManager();
        console.log('[XHS-Notion] UI 管理器创建完成');

        // 3. 注册菜单命令
        GM_registerMenuCommand('⚙️ 配置数据库', () => config.showConfigUI());
        console.log('[XHS-Notion] 菜单命令已注册');

        // 4. 创建控制器（延迟初始化）
        let noteController = null;
        let accountController = null;
        // 用于编号显示的 AccountExtractor 实例（独立于采集功能）
        let accountExtractorForNumbering = null;
        // 用于评论编号显示的 NoteExtractor 实例（进入笔记页即创建，滚动自动显示编号）
        let noteExtractorForNumbering = null;

        // 笔记采集器工厂函数
        const createNoteController = async () => {
            if (noteController) return noteController;

            const noteConfigured = config.isConfigured('note');
            if (!noteConfigured) {
                alert('请先配置笔记数据库！\n\n点击确定打开配置界面。');
                config.showConfigUI();
                return null;
            }

            try {
                console.log('[XHS-Notion] 初始化笔记采集器...');

                // 更新按钮状态为初始化中
                uiManager.updateButtonState('initializing');

                // 加载已存储的字段名映射
                const noteFieldMap = config.getFieldMap('note');
                const noteAPI = new NotionAPI(config.config.apiToken, config.config.noteDatabaseId, noteFieldMap);

                // 检查是否已初始化
                if (!config.isInitialized('note')) {
                    console.log('[XHS-Notion] 首次初始化笔记数据库结构...');
                    // 传入保存回调，只在初始化时检查并保存字段名映射
                    await noteAPI.ensureSchema(NOTE_SCHEMA, (fieldMap) => {
                        config.saveFieldMap('note', fieldMap);
                    });
                    config.markInitialized('note');
                    console.log('[XHS-Notion] ✅ 笔记数据库初始化完成');
                } else {
                    console.log('[XHS-Notion] ⚡ 笔记数据库已初始化，使用已缓存的字段名映射');
                }

                const noteExtractor = new NoteExtractor();
                
                // 创建重新初始化回调
                const reinitializeNote = async () => {
                    console.log('[XHS-Notion] 重新初始化笔记数据库结构...');
                    // 清除初始化状态
                    GM_setValue('note_initialized', false);
                    config.config.noteInitialized = false;
                    // 清除字段名映射
                    GM_setValue('note_field_map', '{}');
                    // 重新执行初始化
                    await noteAPI.ensureSchema(NOTE_SCHEMA, (fieldMap) => {
                        config.saveFieldMap('note', fieldMap);
                    });
                    config.markInitialized('note');
                    // 更新字段名映射
                    noteAPI.fieldNameMap = config.getFieldMap('note');
                };
                
                noteController = new SyncController(noteAPI, noteExtractor, uiManager, NOTE_SCHEMA, reinitializeNote);
                console.log('[XHS-Notion] ✅ 笔记采集器就绪');

                // 恢复按钮状态
                uiManager.updateButtonState('idle', '采集');

                return noteController;
            } catch (e) {
                console.error('[XHS-Notion] ❌ 笔记采集器初始化失败:', e);
                uiManager.updateButtonState('error');
                alert(`笔记数据库初始化失败：${e.message}\n\n请检查配置是否正确。`);
                GM_setValue('note_initialized', false);
                return null;
            }
        };

        // 账号采集器工厂函数
        const createAccountController = async () => {
            if (accountController) return accountController;

            const accountConfigured = config.isConfigured('account');
            if (!accountConfigured) {
                alert('请先配置账号数据库！\n\n点击确定打开配置界面。');
                config.showConfigUI();
                return null;
            }

            try {
                console.log('[XHS-Notion] 初始化账号采集器...');

                // 更新按钮状态为初始化中
                uiManager.updateButtonState('initializing');

                // 加载已存储的字段名映射
                const accountFieldMap = config.getFieldMap('account');
                const accountAPI = new NotionAPI(config.config.apiToken, config.config.accountDatabaseId, accountFieldMap);

                // 检查是否已初始化
                if (!config.isInitialized('account')) {
                    console.log('[XHS-Notion] 首次初始化账号数据库结构...');
                    // 传入保存回调，只在初始化时检查并保存字段名映射
                    await accountAPI.ensureSchema(ACCOUNT_SCHEMA, (fieldMap) => {
                        config.saveFieldMap('account', fieldMap);
                    });
                    config.markInitialized('account');
                    console.log('[XHS-Notion] ✅ 账号数据库初始化完成');
                } else {
                    console.log('[XHS-Notion] ⚡ 账号数据库已初始化，使用已缓存的字段名映射');
                }

                const accountExtractor = new AccountExtractor();
                
                // 创建重新初始化回调
                const reinitializeAccount = async () => {
                    console.log('[XHS-Notion] 重新初始化账号数据库结构...');
                    // 清除初始化状态
                    GM_setValue('account_initialized', false);
                    config.config.accountInitialized = false;
                    // 清除字段名映射
                    GM_setValue('account_field_map', '{}');
                    // 重新执行初始化
                    await accountAPI.ensureSchema(ACCOUNT_SCHEMA, (fieldMap) => {
                        config.saveFieldMap('account', fieldMap);
                    });
                    config.markInitialized('account');
                    // 更新字段名映射
                    accountAPI.fieldNameMap = config.getFieldMap('account');
                };
                
                accountController = new SyncController(accountAPI, accountExtractor, uiManager, ACCOUNT_SCHEMA, reinitializeAccount);
                console.log('[XHS-Notion] ✅ 账号采集器就绪');

                // 恢复按钮状态
                uiManager.updateButtonState('idle', '账号');

                return accountController;
            } catch (e) {
                console.error('[XHS-Notion] ❌ 账号采集器初始化失败:', e);
                uiManager.updateButtonState('error');
                alert(`账号数据库初始化失败：${e.message}\n\n请检查配置是否正确。`);
                GM_setValue('account_initialized', false);
                return null;
            }
        };

        // 5. 创建悬浮按钮
        console.log('[XHS-Notion] 创建悬浮按钮...');
        
        // 防重复点击标记
        let isProcessing = false;

        // 点击处理函数
        const handleButtonClick = async () => {
            // 防止重复点击
            if (isProcessing) {
                console.log('[XHS-Notion] 正在处理中，忽略重复点击');
                return;
            }

            isProcessing = true;
            try {
                // 动态检测当前页面类型
                const isNote = isNotePage();
                const isAccount = isAccountPage();

                console.log('[XHS-Notion] 点击按钮，检测页面类型 - 笔记页:', isNote, '账号页:', isAccount);

                if (isNote) {
                    // 使用笔记页编号用的提取器（共享缓存，无需点击即已监听滚动并采集）
                    const noteExtractor = noteExtractorForNumbering || new NoteExtractor();
                    if (!noteExtractorForNumbering) {
                        noteExtractorForNumbering = noteExtractor;
                    }
                    const controller = await createNoteController();
                    if (controller) {
                        const originalExtractor = controller.extractor;
                        controller.extractor = noteExtractor;
                        await controller.sync('note');
                        controller.extractor = originalExtractor;
                    }
                } else if (isAccount) {
                    // 使用现有的 accountExtractorForNumbering 实例（共享缓存）
                    // 如果不存在，则创建新实例
                    if (!accountExtractorForNumbering) {
                        accountExtractorForNumbering = new AccountExtractor();
                    }
                    const controller = await createAccountController();
                    if (controller) {
                        // 使用共享的提取器实例（共享缓存）
                        const originalExtractor = controller.extractor;
                        controller.extractor = accountExtractorForNumbering;
                        await controller.sync('account');
                        controller.extractor = originalExtractor;
                    }
                } else {
                    alert('当前页面不是笔记页或账号页，无法采集数据。');
                }
            } catch (error) {
                console.error('[XHS-Notion] 采集失败:', error);
                alert(`❌ 采集失败: ${error.message}`);
            } finally {
                isProcessing = false;
            }
        };

        // 创建悬浮按钮
        uiManager.createFloatingButton(handleButtonClick);

        // 6. 启动页面监听器，更新按钮文本和编号显示
        console.log('[XHS-Notion] 启动页面监听器...');
        uiManager.startPageObserver((pageType) => {
            if (pageType === 'note') {
                uiManager.updateButtonText('note');
                // 切换到笔记页：清除账号编号，启动评论编号（自动监听滚动）
                if (accountExtractorForNumbering) {
                    accountExtractorForNumbering.stopNoteNumberDisplay();
                    accountExtractorForNumbering.clearNoteNumbers();
                    accountExtractorForNumbering = null;
                }
                if (!noteExtractorForNumbering) {
                    console.log('[XHS-Notion] 检测到笔记页面，启动评论编号显示...');
                    noteExtractorForNumbering = new NoteExtractor();
                }
            } else if (pageType === 'account') {
                uiManager.updateButtonText('account');
                // 切换到账号页，启动编号显示
                if (!accountExtractorForNumbering) {
                    console.log('[XHS-Notion] 检测到账号页面，启动编号显示...');
                    accountExtractorForNumbering = new AccountExtractor();
                }
                if (noteExtractorForNumbering) {
                    noteExtractorForNumbering.stopCommentNumberDisplay();
                    noteExtractorForNumbering.clearCommentNumbers();
                    noteExtractorForNumbering = null;
                }
            } else {
                uiManager.updateButtonText(null);
                // 切换到其他页面，清除编号显示
                if (accountExtractorForNumbering) {
                    accountExtractorForNumbering.stopNoteNumberDisplay();
                    accountExtractorForNumbering.clearNoteNumbers();
                    accountExtractorForNumbering = null;
                }
                if (noteExtractorForNumbering) {
                    noteExtractorForNumbering.stopCommentNumberDisplay();
                    noteExtractorForNumbering.clearCommentNumbers();
                    noteExtractorForNumbering = null;
                }
            }
        });

        // 7. 如果是账号页面，立即启动编号显示；如果是笔记页面，立即启动评论编号显示
        if (isAccountPage()) {
            console.log('[XHS-Notion] 检测到账号页面，启动编号显示...');
            accountExtractorForNumbering = new AccountExtractor();
        }
        if (isNotePage()) {
            console.log('[XHS-Notion] 检测到笔记页面，启动评论编号显示...');
            noteExtractorForNumbering = new NoteExtractor();
        }

        console.log('[XHS-Notion] ✅ 初始化完成，悬浮按钮已创建');
    }

    // 延迟启动，等待页面加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 1000);
        });
    } else {
        setTimeout(init, 1000);
    }

})();


