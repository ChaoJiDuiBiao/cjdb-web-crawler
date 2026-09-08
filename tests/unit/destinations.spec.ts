import { test, expect } from '@playwright/test'
import { CollectionType } from '../../types'
import {
  recentDestinations,
  rememberDestination,
  purposeConflict,
  safeUrl
} from '../../utils/destinations'
import type { Settings } from '../../types/destination'
const empty = (): Settings => ({
  version: 2,
  connections: [],
  activeConnectionId: 'a',
  destinations: [],
  recentIds: []
})
test('最近库去重、按最新使用排序、每个连接最多展示六个', () => {
  const settings = empty()
  for (let i = 0; i < 8; i++)
    rememberDestination(settings, {
      id: `a:${i}`,
      type: 'notion',
      connectionId: 'a',
      name: `库${i}`
    })
  rememberDestination(settings, {
    id: 'b:1',
    type: 'notion',
    connectionId: 'b',
    name: '其他工作区'
  })
  rememberDestination(settings, {
    id: 'a:2',
    type: 'notion',
    connectionId: 'a',
    name: '库2'
  })
  expect(recentDestinations(settings, 'a').map((d) => d.id)).toEqual([
    'a:2',
    'a:7',
    'a:6',
    'a:5',
    'a:4',
    'a:3'
  ])
  expect(recentDestinations(settings, 'b')).toHaveLength(1)
})
test('选择不标记用途，成功保存才累积用途，不覆盖旧用途', () => {
  const settings = empty(),
    target = {
      id: 'a:1',
      type: 'notion' as const,
      connectionId: 'a',
      name: '资料库'
    }
  rememberDestination(settings, target)
  expect(settings.destinations[0].usedFor).toEqual([])
  rememberDestination(settings, target, CollectionType.XHSNoteDetail)
  rememberDestination(settings, { ...target, usedFor: [] })
  expect(settings.destinations[0].usedFor).toEqual([CollectionType.XHSNoteDetail])
  expect(purposeConflict(settings.destinations[0].usedFor!, CollectionType.XHSAccount)).toBe(true)
  expect(purposeConflict([], CollectionType.XHSAccount)).toBe(false)
})
test('不允许内容链接注入 javascript 协议', () => {
  expect(safeUrl('javascript:alert(1)')).toBeUndefined()
  expect(safeUrl('https://www.notion.so/example')).toBe('https://www.notion.so/example')
})

test('作品和账号各有六个最近库，选择不改变用途，其他连接不混入', () => {
  const s = empty()
  const work = CollectionType.WechatArticle,
    account = CollectionType.XHSAccount
  for (const type of [work, account])
    for (let i = 0; i < 8; i++) {
      rememberDestination(
        s,
        { id: `${type}:${i}`, type: 'notion', connectionId: 'a', name: `${type}${i}` },
        undefined,
        type
      )
    }
  expect(recentDestinations(s, 'a', work)).toHaveLength(6)
  expect(recentDestinations(s, 'a', account)).toHaveLength(6)
  expect(recentDestinations(s, 'a', work).every((d) => d.id.startsWith(work))).toBe(true)
  expect(recentDestinations(s, 'a', account).every((d) => d.id.startsWith(account))).toBe(true)
  expect(recentDestinations(s, 'b', account)).toEqual([])
  expect(s.destinations.every((d) => d.usedFor?.length === 0)).toBe(true)
  const shared = { id: 'shared', type: 'notion' as const, connectionId: 'a', name: '共用' }
  rememberDestination(s, shared, undefined, work)
  rememberDestination(s, shared, undefined, account)
  expect(recentDestinations(s, 'a', work)[0].id).toBe('shared')
  expect(recentDestinations(s, 'a', account)[0].id).toBe('shared')
})

test('旧最近历史只按已知成功用途归类，未知用途不混进两类', () => {
  const s = empty()
  for (const id of ['work', 'account', 'unknown'])
    rememberDestination(s, { id, type: 'notion', connectionId: 'a', name: id })
  s.destinations.find((d) => d.id === 'work')!.usedFor = [CollectionType.WechatArticle]
  s.destinations.find((d) => d.id === 'account')!.usedFor = [CollectionType.XHSAccount]
  expect(recentDestinations(s, 'a', CollectionType.XHSNoteDetail).map((d) => d.id)).toEqual([
    'work'
  ])
  expect(recentDestinations(s, 'a', CollectionType.XHSAccount).map((d) => d.id)).toEqual([
    'account'
  ])
})
