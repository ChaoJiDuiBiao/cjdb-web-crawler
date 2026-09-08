import type { CollectionType, StoreConfig } from './index'
export interface Connection {
  id: string
  name: string
  token: string
  authType?: 'personal' | 'connection'
  principalId?: string
  botId?: string
}
export interface Destination extends StoreConfig {
  id: string
  name: string
  connectionId?: string
  kind?: 'database' | 'data_source'
  databaseName?: string
  createdAt?: string
  fieldNames?: string[]
  fieldCount?: number
  sourceCount?: number
  dataSourceId?: string
  url?: string
  lastUsed?: number
  usedFor?: CollectionType[]
}
export interface Settings {
  version: 2
  connections: Connection[]
  activeConnectionId: string
  destinations: Destination[]
  recentIds: string[]
  recentByScope?: Record<string, string[]>
  lastDestinationId?: string
}
export type PublicSettings = Omit<Settings, 'connections'> & {
  connections: Omit<Connection, 'token'>[]
}
export interface TargetCheck {
  destination: Destination
  conflicts: string[]
  missing: string[]
  usedFor: CollectionType[]
}
export interface TaskItem {
  title: string
  status: 'success' | 'failed' | 'pending'
  error?: string
  url?: string
  key?: string
  warning?: string
}
export interface TaskRecord {
  id: string
  createdAt: number
  type: CollectionType
  destination: string
  items: TaskItem[]
  stopped?: boolean
  retryData?: any[]
  target?: Destination
}
