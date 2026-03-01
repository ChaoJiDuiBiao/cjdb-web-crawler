/**
 * StoreConfig - 存储配置模块
 * 数据结构：{ [collectionType]: Store[] }
 * Store: { type, is_selected, config }
 */
import { ref, nextTick, watch } from 'vue'
import { storage } from 'wxt/utils/storage'
import { CollectionType, StoreType } from '@/types'
import type { Store, StoreConfig as IStoreConfig } from '@/types'

const STORES_BY_TYPE_KEY = 'local:storesByType'
const LEGACY_STORES_KEY = 'local:stores'
const LEGACY_INDEX_KEY = 'local:currentStoreIndex'

const ALL_COLLECTION_TYPES: string[] = Object.values(CollectionType) as string[]

function storeToConfig(store: Store): IStoreConfig {
  return {
    type: store.type as 'local' | 'notion' | 'feishu',
    ...store.config
  } as IStoreConfig
}

function ensureStoreList(val: unknown): Store[] {
  if (!Array.isArray(val)) return []
  return val
    .map((item): Store | null => {
      if (item && typeof item === 'object' && 'type' in item && 'is_selected' in item && 'config' in item) {
        return {
          type: item.type as StoreType,
          is_selected: !!item.is_selected,
          config: (item as Store).config || {}
        }
      }
      return null
    })
    .filter((s): s is Store => s != null)
}

function ensureStoresByType(val: unknown): Record<string, Store[]> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const result: Record<string, Store[]> = {}
    for (const k of ALL_COLLECTION_TYPES) {
      result[k] = ensureStoreList((val as Record<string, unknown>)[k])
    }
    return result
  }
  const result: Record<string, Store[]> = {}
  for (const k of ALL_COLLECTION_TYPES) {
    result[k] = []
  }
  return result
}

// ─── 显示配置 ───
export interface StoreTypeField {
  key: string
  label: string
  inputType?: 'text' | 'password'
}

export const STORE_SCHEMA: Record<
  StoreType,
  { label: string; fields: StoreTypeField[]; getDisplayLabel: (s: Store) => string; disabled?: boolean }
> = {
  [StoreType.Local]: {
    label: '本地存储（未实现）',
    fields: [],
    getDisplayLabel: () => '本地存储（未实现）',
    disabled: true
  },
  [StoreType.Notion]: {
    label: 'Notion',
    fields: [
      { key: 'token', label: 'Token', inputType: 'password' },
      { key: 'databaseId', label: 'Database ID', inputType: 'text' }
    ],
    getDisplayLabel: (s) => {
      const name = (s.config as any)?.name?.trim()
      const fallback = (String((s.config as any).databaseId ?? '')).slice(0, 8) || '...'
      return name ? `Notion \\ ${name}` : `Notion \\ ${fallback}`
    }
  },
  [StoreType.Feishu]: {
    label: '飞书',
    fields: [
      { key: 'appId', label: 'App ID', inputType: 'text' },
      { key: 'appSecret', label: 'App Secret', inputType: 'password' },
      { key: 'appToken', label: 'App Token', inputType: 'text' },
      { key: 'tableId', label: 'Table ID', inputType: 'text' }
    ],
    getDisplayLabel: (s) => {
      const name = (s.config as any)?.name?.trim()
      const fallback = (s.config as any)?.tableId || '...'
      return name ? `飞书 \\ ${name}` : `飞书 \\ ${fallback}`
    }
  }
}

// ─── 响应式状态 ───
const storesByType = ref<Record<string, Store[]>>({})
let inited = false
let isInitializing = false // 防止 init 时 watch 覆盖 storage

/** 初始化（含旧格式迁移） */
export async function initStoreConfig() {
  if (inited) return
  isInitializing = true
  try {
    let saved = await storage.getItem(STORES_BY_TYPE_KEY)

    if (!saved) {
      const legacyStores = await storage.getItem(LEGACY_STORES_KEY)
      const legacyIdx = await storage.getItem(LEGACY_INDEX_KEY)
      if (legacyStores && Array.isArray(legacyStores)) {
        const byType: Record<string, Store[]> = {}
        const idx = typeof legacyIdx === 'number' ? legacyIdx : 0
        for (const k of ALL_COLLECTION_TYPES) {
          byType[k] = legacyStores
            .map((item: any, i: number) => {
              if (!item || typeof item !== 'object') return null
              const { type, ...config } = item
              if (type === StoreType.Local || type === 'local') return null
              return {
                type: type as StoreType,
                is_selected: i === idx,
                config
              }
            })
            .filter(Boolean)
        }
        saved = byType
      }
    }

    storesByType.value = ensureStoresByType(saved)
  } finally {
    await nextTick() // 确保 watch 已执行完毕
    isInitializing = false
  }
  inited = true
}

// watch：用户操作后同步到 storage。init 期间 isInitializing=true 不写入，避免空数据覆盖
watch(
  storesByType,
  (val) => {
    if (isInitializing) return
    storage.setItem(STORES_BY_TYPE_KEY, JSON.parse(JSON.stringify(val)))
  },
  { deep: true }
)

/** 同步到 storage 并等待完成（避免 background 读到未落盘的数据） */
async function persistToStorage(): Promise<void> {
  await storage.setItem(STORES_BY_TYPE_KEY, JSON.parse(JSON.stringify(storesByType.value)))
}

/** 从 storage 读取当前选中的 StoreConfig（供 background 用） */
export async function getCurrentStoreFromStorage(
  collectionType: CollectionType
): Promise<IStoreConfig> {
  const saved = await storage.getItem(STORES_BY_TYPE_KEY)
  const byType = ensureStoresByType(saved)
  const list = byType[collectionType] ?? []
  const selected = list.find((s) => s.is_selected) ?? list[0]
  if (!selected) {
    throw new Error('请先配置存储源')
  }
  return storeToConfig(selected)
}

/** 按 CollectionType 获取 store 列表 */
export function getStoresByCollectionType(collectionType: CollectionType): Store[] {
  const byType = storesByType.value
  return ensureStoreList(byType[collectionType])
}

/** 获取当前选中的 store 索引 */
function getCurrentStoreIndex(collectionType: CollectionType): number {
  const list = getStoresByCollectionType(collectionType)
  const idx = list.findIndex((s) => s.is_selected)
  return idx >= 0 ? idx : 0
}

/** 获取当前选中的 store（转 StoreConfig），无则返回 null */
function getCurrentStore(collectionType: CollectionType): IStoreConfig | null {
  const list = getStoresByCollectionType(collectionType)
  const selected = list.find((s) => s.is_selected) ?? list[0]
  return selected ? storeToConfig(selected) : null
}

/** 获取显示标签 */
function getStoreLabel(store: Store): string {
  const schema = STORE_SCHEMA[store.type]
  return schema ? schema.getDisplayLabel(store) : store.type
}

/** 设置当前选中（将其他 is_selected 置为 false） */
async function setSelected(collectionType: CollectionType, index: number) {
  const next = { ...storesByType.value }
  const list = [...(next[collectionType] ?? [])]
  if (index < 0 || index >= list.length) return
  list.forEach((s, i) => {
    s.is_selected = i === index
  })
  next[collectionType] = list
  storesByType.value = next
  await persistToStorage()
}

/** 添加 store */
async function addStore(collectionType: CollectionType, store: Partial<Store>) {
  const next = { ...storesByType.value }
  const list = [...(next[collectionType] ?? [])]
  // 新添加的设为选中，其他取消选中
  list.forEach((s) => {
    s.is_selected = false
  })
  list.push({
    type: (store.type ?? StoreType.Notion) as StoreType,
    is_selected: true,
    config: store.config ?? {}
  })
  next[collectionType] = list
  storesByType.value = next
  await persistToStorage()
}

/** 删除 store */
async function removeStore(collectionType: CollectionType, index: number) {
  const next = { ...storesByType.value }
  const list = [...(next[collectionType] ?? [])]
  if (index < 0 || index >= list.length) return
  const wasSelected = list[index].is_selected
  list.splice(index, 1)
  if (wasSelected && list.length > 0) {
    list[0].is_selected = true
  }
  next[collectionType] = list
  storesByType.value = next
  await persistToStorage()
}

/** 更新 store */
async function updateStore(collectionType: CollectionType, index: number, store: Partial<Store>) {
  const next = { ...storesByType.value }
  const list = [...(next[collectionType] ?? [])]
  if (index < 0 || index >= list.length) return
  const existing = list[index]
  list[index] = {
    ...existing,
    type: (store.type ?? existing.type) as StoreType,
    config: { ...existing.config, ...(store.config ?? {}) }
  }
  next[collectionType] = list
  storesByType.value = next
  await persistToStorage()
}

export const storeConfig = {
  storesByType,
  init: initStoreConfig,
  getStoresByCollectionType,
  getCurrentStoreIndex,
  getCurrentStore,
  getStoreLabel,
  setSelected,
  addStore,
  removeStore,
  updateStore
}
