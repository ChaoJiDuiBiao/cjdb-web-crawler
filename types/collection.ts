/** 采集数据类型（与爬虫 / Store 路由一致） */
export enum CollectionType {
  XHSNoteDetail = 'xhs-note-detail', // 小红书笔记详情页
  XHSFeed = 'xhs-feed', // 小红书搜索结果（沿用 feed 类型标识）
  XHSAccount = 'xhs-account', // 小红书账号
  WechatArticle = 'wechat-article', // 公众号文章（内容/数据完整性取决于采集方式）
  FeishuDoc = 'feishu-doc' // 飞书文档
}
