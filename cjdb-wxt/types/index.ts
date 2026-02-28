// 小红书笔记数据结构
export interface XiaohongshuNote {
  url?: string
  noteId?: string
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
  coverUrl?: string
  imageUrls?: string
  videoUrl?: string
  mediaType?: 'image' | 'video'
  tags?: string[]
  source?: 'api' | 'dom'
  crawledAt?: string
  provider?: string
  commentList?: Comment[]
}

// 评论数据结构
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

// 小红书账号数据结构
export interface XiaohongshuAccount {
  userId: string
  nickname: string
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

// 存储配置
export interface StoreConfig {
  type: 'local' | 'notion' | 'feishu'
  name?: string

  // Notion 配置
  token?: string
  databaseId?: string

  // 飞书配置
  appId?: string
  appSecret?: string
  appToken?: string
  tableId?: string
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
    type: string,
    data: XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[],
    store: StoreConfig
  ): Promise<SaveResult | SaveResult[]>
}
