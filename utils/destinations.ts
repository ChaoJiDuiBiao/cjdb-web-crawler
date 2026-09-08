import { CollectionType } from '@/types'
import type { Destination, Settings } from '@/types/destination'
export const collectionLabels: Record<CollectionType, string> = {
  [CollectionType.XHSNoteDetail]: '小红书作品',
  [CollectionType.XHSFeed]: '小红书搜索合集',
  [CollectionType.XHSAccount]: '小红书账号',
  [CollectionType.WechatArticle]: '公众号文章',
  [CollectionType.FeishuDoc]: '飞书文档'
}
export function purposeConflict(used: CollectionType[], current: CollectionType): boolean {
  return used.some((type) => type !== current)
}
export function collectionCategory(type: CollectionType): 'account' | 'work' {
  return type === CollectionType.XHSAccount ? 'account' : 'work'
}
export function recentScope(connectionId: string, type: CollectionType): string {
  return `${connectionId}:${collectionCategory(type)}`
}
export function recentDestinations(
  settings: Pick<Settings, 'recentIds' | 'destinations' | 'recentByScope'>,
  connectionId: string,
  type?: CollectionType
): Destination[] {
  const scope = type ? recentScope(connectionId, type) : ''
  const ids = type
    ? (settings.recentByScope?.[scope] ??
      settings.recentIds.filter((id) =>
        settings.destinations
          .find((d) => d.id === id)
          ?.usedFor?.some((t) => collectionCategory(t) === collectionCategory(type))
      ))
    : settings.recentIds
  return ids
    .map((id) => settings.destinations.find((d) => d.id === id))
    .filter((d): d is Destination => !!d && d.type === 'notion' && d.connectionId === connectionId)
    .slice(0, 6)
}
export function rememberDestination(
  settings: Settings,
  target: Destination,
  type?: CollectionType,
  selectedType?: CollectionType
): void {
  const previous = settings.destinations.find((d) => d.id === target.id)
  const usedFor = Array.from(new Set([...(previous?.usedFor || []), ...(type ? [type] : [])]))
  const saved = { ...previous, ...target, usedFor, lastUsed: Date.now() }
  settings.destinations = [...settings.destinations.filter((d) => d.id !== target.id), saved]
  settings.recentIds = [target.id, ...settings.recentIds.filter((id) => id !== target.id)].slice(
    0,
    60
  )
  const categoryType = selectedType || type
  if (categoryType && target.connectionId && target.type === 'notion') {
    const scope = recentScope(target.connectionId, categoryType)
    const previousIds = recentDestinations(settings, target.connectionId, categoryType).map(
      (d) => d.id
    )
    settings.recentByScope ||= {}
    settings.recentByScope[scope] = [
      target.id,
      ...previousIds.filter((id) => id !== target.id)
    ].slice(0, 6)
  }
  settings.lastDestinationId = target.id
}
export function itemTitle(data: any): string {
  return data?.title || data?.nickname || data?.authorNickname || '未命名内容'
}
export function safeUrl(value?: string): string | undefined {
  try {
    const url = new URL(value || '')
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
