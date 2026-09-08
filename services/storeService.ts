import { Store } from '@/stores/Store'
import { notionStore } from '@/stores/NotionStore'
import { feishuStore } from '@/stores/FeishuStore'
import { localFileStore } from '@/stores/LocalFileStore'
export const storeService = new Store()
storeService.register('notion', notionStore)
storeService.register('feishu', feishuStore)
storeService.register('local', localFileStore)
