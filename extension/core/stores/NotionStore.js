/**
 * Notion 存储适配器
 * 参考 xhs-to-notion-v2.user.js：动态 Schema、字段映射、错误提示
 */

(function () {
  const NOTION_VERSION = '2022-06-28';

  // 笔记详情页 Schema（完整数据）
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

  // 发现页 Schema（卡片数据）
  const FEED_SCHEMA = {
    '标题': { type: 'title', notionType: { title: {} } },
    'URL': { type: 'url', notionType: { url: {} }, unique: true },
    '封面': { type: 'files', notionType: { files: {} } },
    '点赞量': { type: 'number', notionType: { number: { format: 'number' } } },
    '收藏量': { type: 'number', notionType: { number: { format: 'number' } } },
    '评论量': { type: 'number', notionType: { number: { format: 'number' } } },
    '采集时间': { type: 'date', notionType: { date: {} } }
  };

  // 账号主页 Schema（账号信息）
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

  // 根据数据类型选择对应的 schema
  function getSchemaByType(type) {
    const schemaMap = {
      'xiaohongshu-note': NOTE_SCHEMA,
      'xiaohongshu-feed': FEED_SCHEMA,
      'xiaohongshu-account': ACCOUNT_SCHEMA
    };
    return schemaMap[type] || null;
  }

  // 为每个数据类型生成独立的 key
  function fieldMapKey(dbId, type) { return `cjdb_notion_field_map_${dbId}_${type}`; }
  function initFlagKey(dbId, type) { return `cjdb_notion_initialized_${dbId}_${type}`; }

  function parseNotionError(err) {
    const msg = err?.message || String(err);
    if (msg.includes('401') || msg.includes('Unauthorized')) return 'Notion API Token 无效或已过期，请检查配置';
    if (msg.includes('404') || msg.includes('Could not find')) return '数据库不存在或无权访问，请检查 Database ID';
    if (msg.includes('403') || msg.includes('Forbidden')) return '无权限访问该数据库，请确认 Token 已分享给该数据库';
    if (msg.includes('429') || msg.includes('rate')) return '请求过于频繁，请稍后再试';
    if (msg.includes('title property')) return '数据库已有 title 属性，请确保名称与「标题」一致';
    if (msg.includes('Network')) return '网络请求失败，请检查网络连接';
    return msg;
  }

  async function getFieldMap(dbId, type) {
    const r = await chrome.storage.local.get([fieldMapKey(dbId, type)]);
    return r[fieldMapKey(dbId, type)] || {};
  }

  async function saveFieldMap(dbId, type, map) {
    await chrome.storage.local.set({ [fieldMapKey(dbId, type)]: map });
  }

  async function isInitialized(dbId, type) {
    const r = await chrome.storage.local.get([initFlagKey(dbId, type)]);
    return !!r[initFlagKey(dbId, type)];
  }

  async function markInitialized(dbId, type) {
    await chrome.storage.local.set({ [initFlagKey(dbId, type)]: true });
  }

  class NotionAPI {
    constructor(apiKey, databaseId, fieldNameMap = {}) {
      this.apiKey = apiKey;
      this.databaseId = databaseId;
      this.schemaCache = null;
      this.fieldNameMap = fieldNameMap || {};
    }

    async request(method, endpoint, data = null) {
      const fetchProxy = window.CJDB_fetchProxy;
      if (!fetchProxy) throw new Error('CJDB_fetchProxy 未加载，请确保 utils/fetchProxy.js 已注入');
      const url = `https://api.notion.com/v1${endpoint}`;
      const res = await fetchProxy(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION
        },
        body: data
      });
      return res ?? {};
    }

    async getDatabase() {
      if (this.schemaCache) return this.schemaCache;
      this.schemaCache = await this.request('GET', `/databases/${this.databaseId}`);
      return this.schemaCache;
    }

    async updateDatabaseSchema(properties) {
      try {
        const result = await this.request('PATCH', `/databases/${this.databaseId}`, { properties });
        this.schemaCache = null;
        return result;
      } catch (e) {
        if (e?.message?.includes('title property')) {
          console.warn('[Notion] title 属性创建失败，可能已存在');
          return null;
        }
        throw e;
      }
    }

    async queryDatabase(filter) {
      return this.request('POST', `/databases/${this.databaseId}/query`, { filter });
    }

    async createPage(properties, children = null) {
      const payload = { parent: { database_id: this.databaseId }, properties };
      if (children && Array.isArray(children) && children.length > 0) {
        payload.children = children.length > 100 ? children.slice(0, 100) : children;
      }
      const result = await this.request('POST', '/pages', payload);
      if (children && children.length > 100) {
        const rest = children.slice(100);
        for (let i = 0; i < rest.length; i += 100) {
          await this.request('PATCH', `/blocks/${result.id}/children`, { children: rest.slice(i, i + 100) });
        }
      }
      return result;
    }

    async updatePage(pageId, properties) {
      return this.request('PATCH', `/pages/${pageId}`, { properties });
    }

    async ensureSchema(schema, saveFieldMapCallback = null) {
      let db; let existing; const missing = {};
      try {
        db = await this.getDatabase();
        existing = db.properties || {};
      } catch (e) {
        console.error('[Notion] 获取数据库失败:', e);
        return false;
      }

      if (saveFieldMapCallback) {
        const titleFields = Object.entries(schema).filter(([, c]) => c.type === 'title');
        if (titleFields.length > 0) {
          const [titleFieldName] = titleFields[0];
          const titleProp = Object.entries(existing).find(([, p]) => p.type === 'title');
          if (titleProp) {
            this.fieldNameMap[titleFieldName] = titleProp[0];
          } else {
            this.fieldNameMap[titleFieldName] = titleFieldName;
          }
        }
        for (const [name, config] of Object.entries(schema)) {
          if (config.type === 'title') continue;
          if (existing[name]) {
            this.fieldNameMap[name] = name;
          } else {
            missing[name] = config.notionType;
          }
        }
      }

      if (Object.keys(missing).length > 0) {
        try {
          await this.updateDatabaseSchema(missing);
          for (const k of Object.keys(missing)) this.fieldNameMap[k] = k;
        } catch (e) {
          if (e?.message?.includes('title property')) return false;
          throw e;
        }
      }
      if (saveFieldMapCallback && Object.keys(this.fieldNameMap).length > 0) {
        await saveFieldMapCallback(this.fieldNameMap);
      }
      return true;
    }

    async findByUniqueField(schema, fieldName, value) {
      const config = schema[fieldName];
      if (!config) throw new Error(`字段 ${fieldName} 不存在`);
      const actualName = this.fieldNameMap[fieldName] || fieldName;
      let filterType, filterValue;
      if (config.type === 'url') {
        filterType = 'url';
        filterValue = { equals: value };
      } else if (config.type === 'rich_text') {
        filterType = 'rich_text';
        filterValue = { equals: value };
      } else {
        throw new Error(`不支持的唯一字段类型: ${config.type}`);
      }
      const result = await this.queryDatabase({ property: actualName, [filterType]: filterValue });
      return result?.results?.[0] || null;
    }
  }

  function toNotionProperties(raw, schema, fieldNameMap, isUpdate = false) {
    const now = new Date().toISOString().split('T')[0];

    // 根据 schema 判断数据类型
    const hasContent = schema.hasOwnProperty('正文');
    const hasNickname = schema.hasOwnProperty('昵称');

    // 笔记详情页字段映射（完整数据）
    const noteFieldMap = {
      title: '标题', url: 'URL', publishTimeStr: '发布时间', location: '发布地点', content: '正文',
      imageUrls: '图片', tags: '标签', likes: '点赞量', favorites: '收藏量', comments: '评论量',
      authorFansCount: '作者粉丝量', authorLikes: '作者获赞与收藏数'
    };

    // 卡片数据字段映射（发现页）
    const cardFieldMap = {
      title: '标题', url: 'URL', coverUrl: '封面', imageUrls: '封面',
      likes: '点赞量', favorites: '收藏量', comments: '评论量'
    };

    // 账号数据字段映射（账号主页）
    const accountFieldMap = {
      nickname: '昵称', userId: '账号ID', url: '主页URL', avatarUrl: '头像',
      description: '账号简介', location: '归属地', noteCount: '笔记数',
      likeCount: '获赞数', fansCount: '粉丝数', followingCount: '关注数'
    };

    const map = hasNickname ? accountFieldMap : (hasContent ? noteFieldMap : cardFieldMap);

    const out = {};
    for (const [fieldName, config] of Object.entries(schema)) {
      const actualName = fieldNameMap[fieldName] || fieldName;
      if (isUpdate && (fieldName === 'URL' || fieldName === '主页URL' || fieldName === '账号ID')) continue;
      if (fieldName === '采集时间') {
        out[actualName] = { date: { start: now } };
        continue;
      }
      const key = Object.keys(map).find((k) => map[k] === fieldName);
      let value = key ? raw[key] : raw[fieldName];

      if (config.type === 'title') {
        out[actualName] = { title: [{ text: { content: String(value || '未知') } }] };
      } else if (config.type === 'url') {
        out[actualName] = { url: value || '' };
      } else if (config.type === 'date') {
        out[actualName] = value ? { date: { start: value } } : null;
      } else if (config.type === 'rich_text') {
        out[actualName] = { rich_text: [{ text: { content: String(value || '').slice(0, 2000) } }] };
      } else if (config.type === 'files') {
        const arr = Array.isArray(value) ? value : (typeof value === 'string' && value ? [value] : []);
        out[actualName] = {
          files: arr.map((u) => ({ type: 'external', name: 'image', external: { url: u } }))
        };
      } else if (config.type === 'multi_select') {
        const arr = Array.isArray(value) ? value : [];
        out[actualName] = { multi_select: arr.filter(Boolean).map((t) => ({ name: String(t).trim() })).filter((t) => t.name) };
      } else if (config.type === 'number') {
        out[actualName] = { number: parseInt(value, 10) || 0 };
      }
    }
    return out;
  }

  if (!window.CJDB_Store) return;

  window.CJDB_Store.register('notion', {
    async save(type, data, store) {
      // 1. 验证配置
      const token = store?.token?.trim();
      let databaseId = (store?.databaseId || '').replace(/\s/g, '');
      const urlMatch = databaseId.match(/notion\.(?:so|com)\/[^/]+\/([a-f0-9]{32})/);
      if (urlMatch) databaseId = urlMatch[1];
      if (!token || !databaseId) {
        return { ok: false, error: '请先配置 Notion：填写 Token 和 Database ID' };
      }
      if (databaseId.length !== 32) {
        return { ok: false, error: 'Database ID 格式不正确（应为 32 位字符）' };
      }

      // 2. 获取 schema
      const schema = getSchemaByType(type);
      if (!schema) {
        return { ok: false, error: `Notion 适配器不支持数据类型: ${type}` };
      }

      // 3. 初始化 API（按需 ensureSchema）
      const dbId = databaseId;
      let fieldMap = await getFieldMap(dbId, type);
      const api = new NotionAPI(token, dbId, { ...fieldMap });

      const initialized = await isInitialized(dbId, type);
      if (!initialized || Object.keys(fieldMap).length === 0) {
        await api.ensureSchema(schema, async (m) => {
          fieldMap = m;
          await saveFieldMap(dbId, type, m);
        });
        await markInitialized(dbId, type);
        api.fieldNameMap = fieldMap;
      }

      // 4. 根据 type 调用对应的存储方法
      if (type === 'xiaohongshu-note') {
        return await saveXhsNoteToNotion(data, schema, api, dbId, type);
      } else if (type === 'xiaohongshu-feed') {
        return await saveXhsFeedToNotion(data, schema, api);
      } else if (type === 'xiaohongshu-account') {
        return await saveXhsAccountToNotion(data, schema, api, dbId, type);
      }

      return { ok: false, error: '未实现的数据类型' };
    }
  });

  // ==================== 笔记详情页存储（单条，带重试） ====================
  async function saveXhsNoteToNotion(data, schema, api, dbId, type) {
    const url = data?.url || (data?.noteId ? `https://www.xiaohongshu.com/explore/${data.noteId}` : '');
    if (!url) return { ok: false, error: '缺少笔记 URL' };

    let lastErr;
    for (let retry = 0; retry < 2; retry++) {
      try {
        if (retry > 0) {
          await chrome.storage.local.remove([initFlagKey(dbId, type), fieldMapKey(dbId, type)]);
          api.schemaCache = null;
          const fieldMap = await getFieldMap(dbId, type);
          await api.ensureSchema(schema, async (m) => {
            await saveFieldMap(dbId, type, m);
          });
          await markInitialized(dbId, type);
        }

        const existing = await api.findByUniqueField(schema, 'URL', url);
        const props = toNotionProperties(data, schema, api.fieldNameMap, !!existing);

        // 转换图片和评论为 blocks
        const children = [];

        // 添加图片 blocks
        if (data.imageUrls && data.imageUrls.length > 0) {
          const imageBlocks = convertImageUrlsToBlocks(data.imageUrls);
          children.push(...imageBlocks);
        }

        // 添加评论 blocks
        if (data.commentList && data.commentList.length > 0) {
          const commentBlocks = convertCommentListToBlocks(data.commentList);
          children.push(...commentBlocks);
        }

        if (existing) {
          await api.updatePage(existing.id, props);
          // 更新页面内容（图片 + 评论列表）
          if (children.length > 0) {
            try {
              await replacePageContent(api, existing.id, children);
              console.log('[Notion] 笔记图片和评论列表已更新');
            } catch (e) {
              console.warn('[Notion] 更新页面内容失败:', e);
            }
          }
          return { ok: true, action: 'update', pageId: existing.id };
        } else {
          const result = await api.createPage(props, children.length > 0 ? children : null);
          return { ok: true, action: 'create', pageId: result?.id };
        }
      } catch (e) {
        lastErr = e;
        const msg = e?.message || String(e);
        if (retry === 0 && (msg.includes('validation_error') || msg.includes('is not a property that exists'))) continue;
        break;
      }
    }
    const errMsg = parseNotionError(lastErr);
    console.error('[Notion]', lastErr);
    return { ok: false, error: errMsg };
  }

  // ==================== 发现页存储（批量，优化去重） ====================
  async function saveXhsFeedToNotion(data, schema, api) {
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return [];

    console.log(`[Notion] 批量保存发现页 ${items.length} 条`);

    // 提取所有 URL
    const urlMap = new Map();
    items.forEach((item, idx) => {
      const url = item?.url || (item?.noteId ? `https://www.xiaohongshu.com/explore/${item.noteId}` : '');
      if (url) urlMap.set(url, { item, idx });
    });

    const urls = Array.from(urlMap.keys());
    if (urls.length === 0) {
      return items.map(() => ({ ok: false, error: '缺少 URL' }));
    }

    // 批量查询已存在的（每次 10 个）
    const existingMap = new Map();
    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      const actualFieldName = api.fieldNameMap['URL'] || 'URL';
      const orFilters = batch.map(url => ({ property: actualFieldName, url: { equals: url } }));
      try {
        const result = await api.queryDatabase({ or: orFilters });
        (result?.results || []).forEach(page => {
          const urlProp = page.properties?.[actualFieldName];
          const url = urlProp?.url;
          if (url) existingMap.set(url, page.id);
        });
      } catch (e) {
        console.warn(`[Notion] 批量查询失败:`, e);
      }
    }

    console.log(`[Notion] ${existingMap.size} 条已存在, ${urls.length - existingMap.size} 条需创建`);

    // 分类
    const results = new Array(items.length);
    const toCreate = [];
    urlMap.forEach(({ item, idx }, url) => {
      if (existingMap.has(url)) {
        results[idx] = { ok: true, action: 'skip', pageId: existingMap.get(url) };
      } else {
        toCreate.push({ item, idx, url });
      }
    });

    // 并发创建（3 并发，避免 rate limit）
    for (let i = 0; i < toCreate.length; i += 3) {
      const batch = toCreate.slice(i, i + 3);
      await Promise.all(batch.map(async ({ item, idx, url }) => {
        try {
          const props = toNotionProperties(item, schema, api.fieldNameMap, false);
          const result = await api.createPage(props);
          results[idx] = { ok: true, action: 'create', pageId: result?.id };
        } catch (e) {
          console.error(`[Notion] 创建失败 (${url}):`, e);
          results[idx] = { ok: false, error: parseNotionError(e) };
        }
      }));
      if (i + 3 < toCreate.length) {
        await new Promise(r => setTimeout(r, 350)); // 避免 rate limit
      }
    }

    return results;
  }

  // ==================== 账号主页存储（单条账号信息，带重试） ====================
  async function saveXhsAccountToNotion(data, schema, api, dbId, type) {
    const userId = data?.userId;
    if (!userId) return { ok: false, error: '缺少账号 ID' };

    let lastErr;
    for (let retry = 0; retry < 2; retry++) {
      try {
        if (retry > 0) {
          await chrome.storage.local.remove([initFlagKey(dbId, type), fieldMapKey(dbId, type)]);
          api.schemaCache = null;
          const fieldMap = await getFieldMap(dbId, type);
          await api.ensureSchema(schema, async (m) => {
            await saveFieldMap(dbId, type, m);
          });
          await markInitialized(dbId, type);
        }

        const existing = await api.findByUniqueField(schema, '账号ID', userId);
        const props = toNotionProperties(data, schema, api.fieldNameMap, !!existing);

        // 转换 noteListText 为 blocks
        const children = data.noteListText ? convertNoteListToBlocks(data.noteListText) : null;

        if (existing) {
          await api.updatePage(existing.id, props);
          // 更新页面内容（笔记列表）
          if (children && children.length > 0) {
            try {
              await replacePageContent(api, existing.id, children);
              console.log('[Notion] 账号笔记列表已更新');
            } catch (e) {
              console.warn('[Notion] 更新笔记列表失败:', e);
            }
          }
          return { ok: true, action: 'update', pageId: existing.id };
        } else {
          const result = await api.createPage(props, children);
          return { ok: true, action: 'create', pageId: result?.id };
        }
      } catch (e) {
        lastErr = e;
        const msg = e?.message || String(e);
        if (retry === 0 && (msg.includes('validation_error') || msg.includes('is not a property that exists'))) continue;
        break;
      }
    }
    const errMsg = parseNotionError(lastErr);
    console.error('[Notion]', lastErr);
    return { ok: false, error: errMsg };
  }

  // ==================== 辅助函数：转换 noteList 为 blocks ====================
  function convertNoteListToBlocks(noteListText) {
    if (!noteListText || noteListText === '暂无笔记') {
      return [];
    }

    const blocks = [];

    // 添加标题
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '笔记列表' } }]
      }
    });

    // 将笔记列表文本按行分割
    const lines = noteListText.split('\n').filter(line => line.trim());

    // 每行转换为一个 paragraph
    lines.forEach(line => {
      const richText = parseMarkdownLine(line.trim());
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: richText }
      });
    });

    console.log(`[Notion] 转换笔记列表为 ${blocks.length} 个 blocks`);
    return blocks;
  }

  // ==================== 辅助函数：转换 commentList 为 blocks ====================
  function convertCommentListToBlocks(commentList) {
    if (!commentList || commentList.length === 0) {
      return [];
    }

    const blocks = [];

    // 添加标题
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '评论列表' } }]
      }
    });

    // 统计信息
    const totalComments = commentList.length;
    const totalReplies = commentList.reduce((sum, c) => sum + (c.replies?.length || 0), 0);
    const stats = `共 ${totalComments} 条评论，${totalReplies} 条回复\n`;

    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: stats } }]
      }
    });

    // 转换每条评论
    commentList.forEach(comment => {
      const commentText = `#${comment.no} 💬 ${comment.comment} | ⏰ ${comment.published_at} | ❤️ ${comment.likes}`;
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: commentText } }]
        }
      });

      // 添加回复
      if (comment.replies && comment.replies.length > 0) {
        comment.replies.forEach(reply => {
          const replyText = `  ↳ R${reply.no} ${reply.comment} | ⏰ ${reply.published_at} | ❤️ ${reply.likes}`;
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: replyText } }]
            }
          });
        });
      }
    });

    console.log(`[Notion] 转换评论列表为 ${blocks.length} 个 blocks`);
    return blocks;
  }

  function parseMarkdownLine(line) {
    const richText = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(line)) !== null) {
      // 添加链接前的文本
      if (match.index > lastIndex) {
        const textBefore = line.substring(lastIndex, match.index);
        if (textBefore) {
          richText.push({ type: 'text', text: { content: textBefore } });
        }
      }

      // 添加链接
      richText.push({
        type: 'text',
        text: { content: match[1] },
        href: match[2]
      });

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余的文本
    if (lastIndex < line.length) {
      const textAfter = line.substring(lastIndex);
      if (textAfter) {
        richText.push({ type: 'text', text: { content: textAfter } });
      }
    }

    // 如果没有匹配到任何内容，返回整行
    if (richText.length === 0) {
      richText.push({ type: 'text', text: { content: line } });
    }

    return richText;
  }

  async function replacePageContent(api, pageId, children) {
    // 1. 获取现有的 blocks
    const response = await api.request('GET', `/blocks/${pageId}/children?page_size=100`);
    const existingBlocks = response?.results || [];

    // 2. 删除所有现有 blocks
    for (const block of existingBlocks) {
      try {
        await api.request('DELETE', `/blocks/${block.id}`);
      } catch (e) {
        console.warn('[Notion] 删除 block 失败:', e);
      }
    }

    // 3. 添加新 blocks（分批，每次 100 个）
    for (let i = 0; i < children.length; i += 100) {
      const batch = children.slice(i, i + 100);
      await api.request('PATCH', `/blocks/${pageId}/children`, { children: batch });
    }
  }
})();
