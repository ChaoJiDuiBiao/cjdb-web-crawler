/**
 * 小红书账号 - 扁平数据结构
 *
 * 约定：唯一标识至少填一个（url / userId），其余选传。存储侧自行处理缺失字段。
 *
 * @typedef {Object} XiaohongshuAccount
 * @property {string} [url] - 唯一标识，用户主页 URL
 * @property {string} [userId] - 唯一标识，用户 ID
 * @property {string} [nickname]
 * @property {string} [avatarUrl]
 * @property {string} [description]
 * @property {number} [fansCount]
 * @property {number} [followingCount]
 * @property {number} [noteCount]
 * @property {'api'|'dom'} [source]
 * @property {string} [crawledAt]
 * @property {string} [provider]
 */

// 供其他文件引用：/** @type {import('./schemas/xiaohongshu-account.js').XiaohongshuAccount} */
