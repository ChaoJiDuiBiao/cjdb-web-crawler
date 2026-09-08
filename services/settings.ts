import { browser } from 'wxt/browser'
import type { Settings, Destination, PublicSettings } from '@/types/destination'
import type { CollectionType } from '@/types'
import { rememberDestination } from '@/utils/destinations'
const KEY = 'cjdb_settings_v2'
let serial: Promise<unknown> = Promise.resolve()
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = serial.then(fn, fn)
  serial = next.catch(() => undefined)
  return next
}
export async function readSettings(): Promise<Settings> {
  const raw = (await browser.storage.local.get([KEY, 'storesByType', 'stores'])) as Record<
    string,
    any
  >
  if (raw[KEY]?.version === 2) {
    const s = raw[KEY] as Settings
    if (s.connections.length > 1) {
      const active = s.connections.find((c) => c.id === s.activeConnectionId) || s.connections[0]
      s.connections = [active]
      s.activeConnectionId = active.id
      await writeSettings(s)
    }
    return s
  }
  const settings: Settings = {
    version: 2,
    connections: [],
    activeConnectionId: '',
    destinations: [],
    recentIds: []
  }
  const lists = raw.storesByType
    ? Object.values(raw.storesByType).flat()
    : (raw.stores || []).map((s: any) => ({ type: s.type, config: s }))
  for (const old of lists as any[]) {
    const cfg = old?.config || {}
    if (old?.type === 'notion' && cfg.token?.trim()) {
      let conn = settings.connections.find((c) => c.token === cfg.token.trim())
      if (!conn) {
        conn = {
          id: crypto.randomUUID(),
          name: `已有 Notion 连接 ${settings.connections.length + 1}`,
          token: cfg.token.trim()
        }
        settings.connections.push(conn)
      }
      if (cfg.databaseId) {
        const id = `${conn.id}:legacy:${cfg.databaseId}`
        if (!settings.destinations.some((d) => d.id === id))
          settings.destinations.push({
            id,
            type: 'notion',
            connectionId: conn.id,
            databaseId: cfg.databaseId,
            name: cfg.name || '已有数据库',
            usedFor: []
          })
      }
    } else if (old?.type === 'feishu') {
      if (
        !settings.destinations.some(
          (d) => d.type === 'feishu' && d.wikiUrl === cfg.wikiUrl && d.appId === cfg.appId
        )
      )
        settings.destinations.push({
          ...cfg,
          id: crypto.randomUUID(),
          type: 'feishu',
          name: cfg.name || '飞书多维表格',
          usedFor: []
        })
    }
  }
  settings.activeConnectionId = settings.connections[0]?.id || ''
  settings.connections = settings.connections.slice(0, 1)
  await writeSettings(settings)
  return settings
}
export async function writeSettings(settings: Settings) {
  await browser.storage.local.set({ [KEY]: settings })
}
export function publicSettings(settings: Settings): PublicSettings {
  return {
    ...settings,
    connections: settings.connections.map(({ id, name }) => ({ id, name })),
    destinations: settings.destinations
      .filter((d) => d.type !== 'notion' || d.connectionId === settings.activeConnectionId)
      .map(({ token, appSecret, ...d }) => d)
  }
}
export async function resolveStore(target: Destination): Promise<Destination> {
  const settings = await readSettings()
  if (target.type === 'notion') {
    const connection = settings.connections.find((c) => c.id === target.connectionId)
    if (!connection) throw new Error('Notion 连接已变更，请重新选择保存位置。')
    return { ...target, token: connection.token }
  }
  if (target.type === 'feishu') {
    const stored = settings.destinations.find((d) => d.id === target.id && d.type === 'feishu')
    if (!stored) throw new Error('飞书配置已变更，请重新选择。')
    return stored
  }
  return { ...target, token: undefined }
}
export async function remember(
  target: Destination,
  type?: CollectionType,
  selectedType?: CollectionType
) {
  await serialized(async () => {
    const settings = await readSettings()
    const { token, fieldNames, ...safe } = target
    // Keep private Feishu credentials in the existing entry, never overwrite with public placeholders.
    rememberDestination(
      settings,
      { ...safe, ...(fieldNames ? { fieldCount: fieldNames.length } : {}) },
      type,
      selectedType
    )
    await writeSettings(settings)
  })
}
