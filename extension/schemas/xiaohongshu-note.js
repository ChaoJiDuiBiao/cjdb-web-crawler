/**
 * 小红书笔记 - 扁平数据结构
 *
 * 约定：唯一标识至少填一个（url / noteId），其余选传。存储侧自行处理缺失字段。
 *
 * @typedef {Object} XiaohongshuNote
 * @property {string} [url] - 唯一标识，内容页 URL
 * @property {string} [noteId] - 唯一标识，笔记 ID
 * @property {string} [title]
 * @property {string} [content]
 * @property {number} [publishTime]
 * @property {string} [publishTimeStr]
 * @property {number} [likes]
 * @property {number} [favorites]
 * @property {number} [comments]
 * @property {number} [shares]
 * @property {string} [authorUserId]
 * @property {string} [authorNickname]
 * @property {string} [authorAvatarUrl]
 * @property {number} [authorFansCount] - 作者粉丝量
 * @property {number} [authorLikes] - 作者获赞与收藏数
 * @property {number} [authorFollowing] - 作者关注数
 * @property {string} [coverUrl]
 * @property {string} [imageUrls]
 * @property {string} [videoUrl]
 * @property {'image'|'video'} [mediaType]
 * @property {'api'|'dom'} [source]
 * @property {string} [crawledAt]
 * @property {string} [provider]
 */

// 供其他文件引用：/** @type {import('./schemas/xiaohongshu-note.js').XiaohongshuNote} */
