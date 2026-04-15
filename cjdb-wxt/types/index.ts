import { CollectionType } from './collection'

export { CollectionType }

// ─── 小红书 _metaData（与 XiaohongshuNote / XiaohongshuAccount 紧邻，仅类型无逻辑）────

/** 笔记详情页 → 保存时的元信息 */
export interface XiaohongshuNoteDetailPayloadMeta {
  /** 是否下载并上传笔记内图片、原视频（关闭则仅用外链等，本地 ZIP 也不打包二进制） */
  downloadImagesAndVideo?: boolean
}

/** 搜索结果每条卡片 → 保存时的元信息 */
export interface XiaohongshuSearchFeedItemPayloadMeta {
  /** 是否下载并上传封面图 */
  downloadImagesAndVideo?: boolean
}

/** 账号主页 → 保存时的元信息 */
export interface XiaohongshuAccountPayloadMeta {
  /** 是否下载并上传头像等附件 */
  downloadImagesAndVideo?: boolean
}

// 小红书笔记数据结构
export interface XiaohongshuNote {
  url?: string
  noteId?: string
  rank?: number
  /**
   * 详情页为 XiaohongshuNoteDetailPayloadMeta；搜索结果每条为 XiaohongshuSearchFeedItemPayloadMeta。
   * 二者当前字段一致，便于共用 XiaohongshuNote 类型。
   */
  _metaData?: XiaohongshuNoteDetailPayloadMeta | XiaohongshuSearchFeedItemPayloadMeta
  searchKeyword?: string  // 搜索关键词（搜索结果采集时）
  title?: string
  content?: string
  publishTime?: number
  publishTimeStr?: string
  location?: string  // 发布地点
  likes?: number
  favorites?: number
  comments?: number
  shares?: number
  authorUserId?: string
  authorNickname?: string
  authorAvatarUrl?: string
  authorFansCount?: number
  authorLikes?: number
  authorFollowing?: number
  coverUrl?: string | null  // 封面图（默认取图片第一张）
  imageUrls?: string | null
  videoUrl?: string
  mediaType?: 'image' | 'video'
  tags?: string[]
  source?: 'api' | 'dom'
  crawledAt?: string
  provider?: string
  commentList?: CommentExport[]
}

// 评论数据结构（内部采集用）
export interface Comment {
  id: string
  no: number
  checked: boolean
  content: string
  time: string
  likes: number
  repliesCount?: number
  replies?: Comment[]
}

// 评论导出格式（crawl 返回的 commentList，与 JS/Notion 写入格式一致）
export interface CommentExport {
  no: number
  comment: string
  published_at: string
  likes: number
  replies_count?: number
  checked?: boolean
  replies?: { no: number; comment: string; published_at: string; likes: number; checked?: boolean }[]
}

// 小红书账号数据结构
export interface XiaohongshuAccount {
  userId: string
  nickname: string
  _metaData?: XiaohongshuAccountPayloadMeta
  avatarUrl?: string
  description?: string
  location?: string  // 归属地
  fansCount?: number
  followingCount?: number
  likedCount?: number
  notesCount?: number
  url?: string
  noteListText?: string
  source?: 'api' | 'dom'
  crawledAt?: string
}

// 公众号主体信息（来自 principal_info API）
export interface WechatPrincipalInfo {
  companyName?: string   // 公司名称 company_name
  region?: string       // 地区（省+国家）
  name?: string         // 主体名称 name
  nickname?: string     // 公众号名称 nick_name
  verifyDate?: string   // 认证时间 verify_date
  ghId?: string        // gh_id
  verifyType?: string   // 认证类型 verify_customer_type
}

// 公众号文章数据结构（内容+数据+主体信息，完整性取决于采集方式）
export interface WechatArticle {
  url?: string
  title?: string
  /** 是否下载图片到 Notion/飞书（公众号预览勾选）；非 _metaData */
  downloadImages?: boolean
  content?: string        // 纯文本内容
  contentHtml?: string    // HTML 内容（从文章详情 API 获取）
  contentMarkdown?: string // Markdown 内容（从 contentHtml 转换）
  publishTimeStr?: string
  ipLocation?: string     // IP 归属地
  coverUrl?: string
  read?: number           // 阅读量
  zan?: number            // 拇指赞
  looking?: number        // 爱心赞
  shareNum?: number       // 转发量
  collectNum?: number     // 收藏量
  commentCount?: number   // 评论数
  principalInfo?: WechatPrincipalInfo
  source?: 'dom' | 'api'
  crawledAt?: string
  // 表格列中的复选框状态
  fetchData?: boolean           // 是否采集数据（阅读/点赞等）
}

// 公众号历史文章列表项（来自 post_history API）
export interface WechatHistoryItem {
  url: string
  title: string
  post_time_str?: string
  cover_url?: string
  digest?: string
  position?: number
  fetchData?: boolean     // 是否采集数据（阅读/点赞等）
  collected?: boolean     // 是否已收录（从 Notion 检测）
}

// 飞书文档数据结构
export interface FeishuDoc {
  url?: string
  title?: string
  docType?: string
  workspace?: string
  excerpt?: string
  content?: string
  contentHtml?: string
  contentMarkdown?: string
  source?: 'dom' | 'runtime'
  crawledAt?: string
}

// 存储源类型
export enum StoreType {
  Local = 'local',
  Notion = 'notion',
  Feishu = 'feishu'
}

// 存储源配置（config 为各类型专属字段）
export interface Store {
  type: StoreType
  is_selected: boolean
  config: Record<string, unknown>
}

// 存储配置（供 adapter 使用，由 Store 转换）
export interface StoreConfig {
  type: 'local' | 'notion' | 'feishu'
  name?: string

  // Notion 配置
  token?: string
  databaseId?: string

  // 飞书配置
  appId?: string
  appSecret?: string
  wikiUrl?: string   // 飞书 Wiki 页面 URL（含 ?table=xxx），自动解析 app_token 和 table_id
  appToken?: string  // 可选，直接填写时跳过 wiki 解析
  tableId?: string   // 可选，直接填写时跳过 URL 解析
}

// 存储结果
export interface SaveResult {
  ok: boolean
  action?: 'create' | 'update' | 'skip'
  pageId?: string
  key?: string
  error?: string
}

// 存储适配器接口
export interface StoreAdapter {
  save(
    type: CollectionType,
    data: XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[] | WechatArticle[] | FeishuDoc | FeishuDoc[],
    store: StoreConfig,
    fromTabId?: number
  ): Promise<SaveResult | SaveResult[]>
}


export enum MessageTypes {
  StoreCrawlData = 'cjdb-store-crawl-data',
  ShowPanelTip = 'cjdb-show-panel-tip',
  HTTPRequest = 'cjdb-http-request',
  DajialaPostHistory = 'cjdb-dajiala-post-history',
  DajialaArticleData = 'cjdb-dajiala-article-data',
  DajialaPrincipalInfo = 'cjdb-dajiala-principal-info',
  DajialaFetchArticleHtml = 'cjdb-dajiala-fetch-article-html',
  DajialaArticleDetail = 'cjdb-dajiala-article-detail',
  /** 在目标 tab 的 MAIN world 读取 __INITIAL_STATE__.note.noteDetailMap（bridge 超时/无响应时兜底） */
  XhsNoteDetailMain = 'cjdb-xhs-note-detail-main',
}

// 供 storeCrawlData payload 使用
export type StoreCrawlDataPayload = {
  collectionType: CollectionType
  data: any
  storeCfg?: StoreConfig
  fromTabId?: number
}
