/**
 * Validators - 模块入口处的数据结构校验
 * 各类型必填字段：唯一标识至少填一个
 */

(function () {
  const RULES = {
    'xiaohongshu-note': {
      identifiers: ['url', 'noteId'],
      message: '小红书笔记至少填一个：url 或 noteId'
    },
    'xiaohongshu-account': {
      identifiers: ['url', 'userId'],
      message: '小红书账号至少填一个：url 或 userId'
    }
  };

  /**
   * 校验数据是否满足必填标识
   * @param {string} type - 数据类型
   * @param {Object} data
   * @returns {{ valid: boolean, error?: string }}
   */
  function validate(type, data) {
    const rule = RULES[type];
    if (!rule) return { valid: true };

    const hasId = rule.identifiers.some(k => {
      const v = data?.[k];
      return v != null && String(v).trim() !== '';
    });

    if (!hasId) {
      return { valid: false, error: rule.message };
    }
    return { valid: true };
  }

  /**
   * 校验并抛出，不通过时 throw Error
   */
  function validateOrThrow(type, data) {
    const result = validate(type, data);
    if (!result.valid) {
      throw new Error(result.error);
    }
  }

  window.Validators = {
    validate,
    validateOrThrow,
    RULES
  };
})();
