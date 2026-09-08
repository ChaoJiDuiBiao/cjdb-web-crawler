import { CollectionType } from '@/types'
export async function exportCollection(type: CollectionType, data: any, format: string) {
  const exporters = await import('./exportFile')
  switch (type) {
    case CollectionType.XHSNoteDetail:
      for (const item of Array.isArray(data) ? data : [data])
        await exporters.exportXHSNoteDetail(item, format)
      break
    case CollectionType.XHSFeed:
      exporters.exportXHSFeed(data, format)
      break
    case CollectionType.XHSAccount:
      exporters.exportXHSAccount(data, format)
      break
    case CollectionType.WechatArticle:
      exporters.exportWechatArticle(data, format)
      break
    case CollectionType.FeishuDoc:
      exporters.exportFeishuDoc(data, format)
      break
  }
}
