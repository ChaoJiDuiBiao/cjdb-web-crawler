import { browser } from 'wxt/browser'
import type { CollectionType } from '@/types'
import type { Destination, TaskRecord } from '@/types/destination'
import {
  publicSettings,
  readSettings,
  resolveStore,
  serialized,
  writeSettings,
  remember
} from './settings'
import { notionRequest, resolveTargets, searchTargets, targetStats } from './notionDiscovery'
import { inspectNotionTarget } from '@/stores/NotionStore'
import { storeService } from './storeService'
export async function handleService(action: string, payload: any = {}): Promise<any> {
  const settings = await serialized(readSettings)
  const connection = settings.connections.find(
    (c) => c.id === (payload.connectionId || settings.activeConnectionId)
  )
  switch (action) {
    case 'settings':
      return publicSettings(settings)
    case 'configState':
      return {
        hasToken: !!connection,
        authType: connection?.authType || (connection?.botId ? 'connection' : undefined),
        destinations: publicSettings(settings).destinations.filter((d) => d.type === 'feishu')
      }
    case 'saveConfig':
    case 'connect': {
      const token = String(payload.token || '').trim()
      if (!token && action === 'connect') throw new Error('请填写 Notion 个人访问令牌（PAT）。')
      const f = payload.feishu
      if (f) {
        const previous = settings.destinations.find((d) => d.type === 'feishu' && d.id === f.id)
        f.appSecret = String(f.appSecret || '').trim() || previous?.appSecret
        if (!f.name?.trim() || !f.appId?.trim() || !f.appSecret)
          throw new Error('请填写飞书名称、App ID 和 App Secret。')
        let url: URL
        try {
          url = new URL(f.wikiUrl)
        } catch {
          throw new Error('请填写完整飞书多维表格链接。')
        }
        if (
          url.protocol !== 'https:' ||
          !/(^|\.)feishu\.cn$/.test(url.hostname) ||
          !url.pathname.includes('/wiki/') ||
          !url.searchParams.get('table')
        )
          throw new Error('请填写包含 /wiki/ 和 ?table= 的飞书链接。')
      }
      const me = token ? await notionRequest(token, '/users/me') : null
      await serialized(async () => {
        const latest = await readSettings()
        if (token) {
          const old = latest.connections[0]
          const authType = me.type === 'person' ? 'personal' : 'connection'
          // A personal user ID does not identify the token's workspace.
          // Keep scope for the same token; only bots identify a stable connection.
          const sameScope =
            old &&
            (old.token === token ||
              (authType === 'connection' &&
                old.authType !== 'personal' &&
                (old.principalId || old.botId) === me.id))
          const id = sameScope ? old.id : crypto.randomUUID()
          latest.connections = [
            {
              id,
              token,
              authType,
              principalId: me.id,
              name: me.bot?.workspace_name || me.name || 'Notion'
            }
          ]
          latest.activeConnectionId = id
        }
        if (f) {
          const id = f.id || crypto.randomUUID()
          latest.destinations = [
            ...latest.destinations.filter((d) => d.id !== id),
            {
              id,
              type: 'feishu',
              name: f.name.trim(),
              appId: f.appId.trim(),
              appSecret: f.appSecret,
              wikiUrl: f.wikiUrl.trim()
            }
          ]
        }
        await browser.storage.local.set({
          cjdb_settings_v2: latest
        })
      })
      return publicSettings(await readSettings())
    }
    case 'disconnect':
      await serialized(async () => {
        const s = await readSettings()
        s.connections = s.connections.filter((c) => c.id !== payload.connectionId)
        s.destinations = s.destinations.filter((d) => d.connectionId !== payload.connectionId)
        s.recentIds = s.recentIds.filter((id) => s.destinations.some((d) => d.id === id))
        if (s.activeConnectionId === payload.connectionId)
          s.activeConnectionId = s.connections[0]?.id || ''
        await writeSettings(s)
      })
      return publicSettings(await readSettings())
    case 'targetStats': {
      const cfg = await resolveStore(payload.destination)
      if (cfg.type !== 'notion') throw new Error('请选择 Notion 数据库。')
      return targetStats(
        cfg.token!,
        payload.destination,
        payload.cursor,
        payload.metadata !== false
      )
    }
    case 'search':
      if (!connection) throw new Error('请先连接 Notion。')
      return searchTargets(connection.token, connection.id, payload.query, payload.cursor)
    case 'resolve':
      if (!connection) throw new Error('请先连接 Notion。')
      return {
        targets: await resolveTargets(connection.token, connection.id, payload.input),
        cursor: null
      }
    case 'check': {
      let d: Destination = payload.destination
      const cfg = await resolveStore(d)
      if (d.type !== 'notion') return { destination: d, usedFor: [], conflicts: [], missing: [] }
      if (!d.dataSourceId) {
        const targets = await resolveTargets(cfg.token!, d.connectionId!, d.databaseId!)
        if (!targets.length) throw new Error('这个数据库没有可用的数据源。')
        if (targets.length !== 1) return { choices: targets }
        d = targets[0]
      }
      const check = await inspectNotionTarget(cfg.token!, d.dataSourceId!, payload.type)
      const previous = settings.destinations.find((t) => t.id === d.id)
      return { ...check, destination: d, usedFor: previous?.usedFor || [] }
    }
    case 'remember':
      if (payload.destination?.type === 'notion' && !payload.destination.dataSourceId)
        throw new Error('请先选择数据源。')
      await remember(payload.destination, undefined, payload.type)
      return null
    case 'saveFeishu':
      if (payload.id && !payload.appSecret?.trim())
        payload.appSecret = settings.destinations.find((d) => d.id === payload.id)?.appSecret
      if (!payload.name?.trim() || !payload.appId?.trim() || !payload.appSecret?.trim())
        throw new Error('请填写名称、App ID 和 App Secret。')
      {
        let url: URL
        try {
          url = new URL(payload.wikiUrl)
        } catch {
          throw new Error('请填写完整飞书多维表格链接。')
        }
        if (
          !/(^|\.)feishu\.cn$/.test(url.hostname) ||
          !url.pathname.includes('/wiki/') ||
          !url.searchParams.get('table')
        )
          throw new Error('请使用包含 /wiki/ 和 ?table= 参数的飞书多维表格链接。')
      }
      await serialized(async () => {
        const s = await readSettings()
        const id = payload.id || crypto.randomUUID()
        s.destinations = [
          ...s.destinations.filter((d) => d.id !== id),
          {
            id,
            type: 'feishu',
            name: payload.name.trim(),
            appId: payload.appId.trim(),
            appSecret: payload.appSecret.trim(),
            wikiUrl: payload.wikiUrl.trim()
          }
        ]
        await writeSettings(s)
      })
      return publicSettings(await readSettings())
    case 'removeDestination':
      await serialized(async () => {
        const s = await readSettings()
        s.destinations = s.destinations.filter((d) => d.id !== payload.id)
        s.recentIds = s.recentIds.filter((id) => id !== payload.id)
        await writeSettings(s)
      })
      return null
    case 'save': {
      if (!payload.taskId) return saveItem(payload)
      const key = `${payload.taskId}:${payload.itemIndex}`
      const tasks = ((await browser.storage.local.get('cjdb_tasks')).cjdb_tasks ||
        []) as TaskRecord[]
      const existing = tasks.find((t) => t.id === payload.taskId)?.items[payload.itemIndex]
      if (existing?.status === 'success')
        return {
          ok: true,
          action: 'skip',
          key: existing.key,
          url: existing.url,
          warning: existing.warning
        }
      if (!inFlight.has(key))
        inFlight.set(
          key,
          saveItem(payload).finally(() => inFlight.delete(key))
        )
      return inFlight.get(key)
    }
    case 'records': {
      const all = await browser.storage.local.get(null)
      const types = ['xhs-note-detail', 'xhs-feed', 'xhs-account', 'wechat-article', 'feishu-doc']
      const records = Object.entries(all)
        .filter(([key]) => key.startsWith('cjdb_local_'))
        .map(([key, data]) => ({
          key,
          data,
          type: types.find((t) => key.startsWith(`cjdb_local_${t}_`)) || 'xhs-note-detail',
          createdAt: Number(key.match(/_(\d{13})_/)?.[1] || 0)
        }))
      if (all.collected)
        records.push({
          key: 'collected',
          data: all.collected,
          type: 'xhs-note-detail',
          createdAt: 0
        })
      return records.sort((a, b) => b.createdAt - a.createdAt)
    }
    case 'tasks':
      return (await browser.storage.local.get('cjdb_tasks')).cjdb_tasks || []
    case 'recordTask':
      await serialized(async () => {
        const previous = ((await browser.storage.local.get('cjdb_tasks')).cjdb_tasks ||
          []) as TaskRecord[]
        const previousTask = previous.find((t) => t.id === payload.id)
        const items = payload.items.map((item: any, i: number) =>
          previousTask?.items[i]?.status === 'success' && item.status !== 'success'
            ? previousTask.items[i]
            : item
        )
        const clean = {
          ...payload,
          items,
          retryData: items.every((i: any) => i.status === 'success')
            ? undefined
            : payload.retryData?.map((data: any, i: number) =>
                items[i].status === 'success' ? null : data
              )
        }
        await browser.storage.local.set({
          cjdb_tasks: [clean, ...previous.filter((t) => t.id !== payload.id)].slice(0, 50)
        })
      })
      return null
    case 'openHelp':
      await browser.tabs.create({
        url: browser.runtime.getURL('/help.html') + (payload.section === 'notion' ? '#notion' : '')
      })
      return null
    case 'openSettings':
      await browser.tabs.create({
        url:
          browser.runtime.getURL('/options.html') +
          '#' +
          (['records', 'tasks'].includes(payload.section) ? payload.section : 'settings')
      })
      return null
    default:
      throw new Error('未知操作')
  }
}

const inFlight = new Map<string, Promise<any>>()
async function saveItem(payload: any) {
  const cfg = await resolveStore(payload.destination)
  if (cfg.type === 'notion') {
    const check = await inspectNotionTarget(cfg.token!, cfg.dataSourceId!, payload.type)
    if (check.conflicts.length) throw new Error(check.conflicts.join('；'))
  }
  const result = await storeService.save(payload.type, payload.data, cfg, payload.tabId)
  const results = Array.isArray(result) ? result : [result]
  if (results.some((r) => r.ok)) {
    try {
      await remember(payload.destination, payload.type)
    } catch {
      /* Saving data succeeded; do not turn metadata failure into a retry. */
    }
  }
  if (payload.taskId && Number.isInteger(payload.itemIndex)) {
    try {
      await serialized(async () => {
        const tasks = ((await browser.storage.local.get('cjdb_tasks')).cjdb_tasks ||
          []) as TaskRecord[]
        const task = tasks.find((t) => t.id === payload.taskId)
        const item = task?.items[payload.itemIndex]
        if (item) {
          const first = results[0]
          const success = results.length > 0 && results.every((r) => r.ok)
          item.status = success ? 'success' : 'failed'
          item.error = success ? undefined : results.find((r) => !r.ok)?.error
          item.key = first?.key
          item.url =
            first?.url ||
            (cfg.type === 'notion' && first?.pageId
              ? `https://www.notion.so/${first.pageId.replaceAll('-', '')}`
              : cfg.url || cfg.wikiUrl)
          item.warning = first?.warning
          if (success && task?.retryData) task.retryData[payload.itemIndex] = null
          if (task?.items.every((i) => i.status === 'success')) task.retryData = undefined
          await browser.storage.local.set({ cjdb_tasks: tasks })
        }
      })
    } catch {
      for (const r of results)
        if (r.ok)
          r.warning = [r.warning, '内容已保存，但任务记录更新失败。重新操作前请核对目标库。']
            .filter(Boolean)
            .join('；')
    }
  }
  return result
}
