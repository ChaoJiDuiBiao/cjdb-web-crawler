/**
 * ExportUtils - 本地数据导出工具
 * 支持 CSV 和 Obsidian Markdown（Database 格式）两种导出方式
 *
 * 用法：
 *   window.ExportUtils.download(type, data, format)
 *   format: 'csv' | 'markdown'
 */

(function () {
  // ─── 字段定义 ──────────────────────────────────────────────
  // 每种 dataType 的导出字段顺序和显示名称

  const FIELD_DEFS = {
    'xiaohongshu-note': [
      { key: 'title',           label: '标题' },
      { key: 'content',         label: '正文' },
      { key: 'authorName',      label: '作者' },
      { key: 'authorFansCount', label: '粉丝数' },
      { key: 'authorLikes',     label: '作者获赞' },
      { key: 'likes',           label: '点赞' },
      { key: 'collects',        label: '收藏' },
      { key: 'comments',        label: '评论数' },
      { key: 'tags',            label: '标签' },
      { key: 'url',             label: '链接' },
      { key: 'imageUrls',       label: '图片列表' },
      { key: 'crawledAt',       label: '采集时间' }
    ],
    'xiaohongshu-feed': [
      { key: 'title',      label: '标题' },
      { key: 'authorName', label: '作者' },
      { key: 'likes',      label: '点赞' },
      { key: 'url',        label: '链接' },
      { key: 'imageUrl',   label: '封面图' },
      { key: 'crawledAt',  label: '采集时间' }
    ],
    'xiaohongshu-account': [
      { key: 'nickname',       label: '昵称' },
      { key: 'userId',         label: '用户ID' },
      { key: 'description',    label: '简介' },
      { key: 'location',       label: '地区' },
      { key: 'fansCount',      label: '粉丝数' },
      { key: 'followingCount', label: '关注数' },
      { key: 'likeCount',      label: '获赞数' },
      { key: 'noteCount',      label: '笔记数' },
      { key: 'url',            label: '主页链接' },
      { key: 'noteListText',   label: '笔记列表' },
      { key: 'crawledAt',      label: '采集时间' }
    ],
    'wechat-article': [
      { key: 'title',     label: '标题' },
      { key: 'author',    label: '作者' },
      { key: 'account',   label: '公众号' },
      { key: 'digest',    label: '摘要' },
      { key: 'url',       label: '链接' },
      { key: 'crawledAt', label: '采集时间' }
    ]
  };

  /** 回退：无字段定义时，取 data 自身的全部 key */
  function _getFields(type, data) {
    if (FIELD_DEFS[type]) return FIELD_DEFS[type];
    return Object.keys(data).map((k) => ({ key: k, label: k }));
  }

  // ─── 值序列化 ───────────────────────────────────────────────

  /** 把任意值扁平化为可读字符串 */
  function _stringify(val) {
    if (val == null) return '';
    if (Array.isArray(val)) return val.join('|');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  // ─── CSV ────────────────────────────────────────────────────

  /** CSV 单元格转义 */
  function _csvCell(val) {
    const s = _stringify(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * 生成 CSV 字符串
   * @param {string} type
   * @param {Object} data
   * @returns {string}
   */
  function toCsv(type, data) {
    const fields = _getFields(type, data);
    const header = fields.map((f) => _csvCell(f.label)).join(',');
    const row = fields.map((f) => _csvCell(data[f.key])).join(',');
    return '\uFEFF' + header + '\n' + row; // BOM 保证 Excel 正确识别 UTF-8
  }

  // ─── Obsidian Markdown（Database / Dataview 格式）──────────

  /**
   * 生成 Obsidian Markdown 字符串
   *
   * 格式采用 YAML Frontmatter（Properties），与 Obsidian 原生 Database 和 Dataview 完全兼容：
   *
   *   ---
   *   title: "xxx"
   *   author: "yyy"
   *   ...
   *   ---
   *
   *   # 标题
   *
   *   正文内容...
   *
   * @param {string} type
   * @param {Object} data
   * @returns {string}
   */
  function toMarkdown(type, data) {
    const fields = _getFields(type, data);

    // ── YAML Frontmatter ──
    const yamlLines = ['---'];
    for (const { key, label } of fields) {
      // 正文 / 笔记列表等长文本单独放 body，不放 frontmatter
      if (key === 'content' || key === 'noteListText') continue;

      const val = data[key];
      if (val == null || val === '') continue;

      if (Array.isArray(val)) {
        // 数组：Obsidian 多值 list
        yamlLines.push(`${label}:`);
        val.forEach((v) => yamlLines.push(`  - "${_escapeYaml(String(v))}"`));
      } else {
        yamlLines.push(`${label}: "${_escapeYaml(_stringify(val))}"`);
      }
    }
    yamlLines.push('---');
    yamlLines.push('');

    // ── 标题 ──
    const title = data.title || data.nickname || data.account || '采集记录';
    const lines = [yamlLines.join('\n'), `# ${title}`, ''];

    // ── 正文 ──
    const body = data.content || data.noteListText || '';
    if (body) {
      lines.push(body, '');
    }

    return lines.join('\n');
  }

  function _escapeYaml(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // ─── 文件下载 ───────────────────────────────────────────────

  /**
   * 触发浏览器下载
   * @param {string} filename
   * @param {string} content
   * @param {string} mime
   */
  function _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /**
   * 生成安全文件名（去掉非法字符）
   * @param {string} type
   * @param {Object} data
   * @param {string} ext
   * @returns {string}
   */
  function _filename(type, data, ext) {
    const raw = data.title || data.nickname || data.account || type;
    const safe = raw.replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60).trim();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${safe}_${ts}.${ext}`;
  }

  // ─── 公开 API ───────────────────────────────────────────────

  /**
   * 导出并下载
   * @param {string} type  - dataType，如 'xiaohongshu-note'
   * @param {Object} data  - 单条采集数据
   * @param {string} format - 'csv' | 'markdown'
   */
  function download(type, data, format) {
    if (!data || typeof data !== 'object') {
      console.warn('[ExportUtils] data 无效', data);
      return;
    }

    if (format === 'csv') {
      const content = toCsv(type, data);
      _download(_filename(type, data, 'csv'), content, 'text/csv');
    } else if (format === 'markdown') {
      const content = toMarkdown(type, data);
      _download(_filename(type, data, 'md'), content, 'text/markdown');
    } else {
      console.warn('[ExportUtils] 未知格式:', format);
    }
  }

  window.ExportUtils = { download, toCsv, toMarkdown };
})();
