import { extractNoteImages } from '../../utils/xhsNoteImages'
import { test, expect, rpc, article, mockNotion } from './fixtures'
test('迁移旧配置：Token 跨类型去重，只保留当前 Token，公共设置不暴露密钥', async ({
  page,
  worker,
  extensionId
}) => {
  await worker.evaluate(async () => {
    const s = (globalThis as any).chrome.storage.local
    await s.clear()
    await s.set({
      storesByType: {
        'xhs-note-detail': [
          {
            type: 'notion',
            config: {
              token: 'fake-A',
              databaseId: '11111111111111111111111111111111'
            }
          }
        ],
        'xhs-account': [
          {
            type: 'notion',
            config: {
              token: 'fake-A',
              databaseId: '11111111111111111111111111111111'
            }
          },
          {
            type: 'notion',
            config: {
              token: 'fake-B',
              databaseId: '22222222222222222222222222222222'
            }
          }
        ]
      }
    })
  })
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const result = await rpc(page, 'settings')
  expect(result.ok).toBe(true)
  expect(result.data.connections).toHaveLength(1)
  expect(result.data.destinations).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('fake-')
  expect(result.data.destinations[0].usedFor).toEqual([])
  await expect(page.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible()
})
test('当前文章 → 本地预览 → 保存 → 本地记录；面板样式与宿主页面隔离', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await expect(page.getByRole('region', { name: '本次采集摘要' })).toContainText(
    '如何建立自己的素材库'
  )
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await page.getByRole('button', { name: '保存到 本地记录', exact: true }).click()
  await expect(page.getByText('本次采集结果')).toBeVisible()
  await expect(page.getByText('成功 1', { exact: false })).toBeVisible()
  const records = await context.newPage()
  await records.goto(`chrome-extension://${extensionId}/options.html#records`)
  await expect(
    records.getByRole('heading', { name: '如何建立自己的素材库', exact: true }).first()
  ).toBeVisible()
  const download = records.waitForEvent('download')
  await records.getByRole('button', { name: '导出 CSV' }).click()
  expect((await download).suggestedFilename()).toContain('.csv')
  await records.screenshot({
    path: '/private/tmp/cjdb-upgrade/records.png',
    fullPage: true
  })
  await page.screenshot({ path: '/private/tmp/cjdb-upgrade/panel.png' })
})
test('Notion 搜索、用途冲突提示、最近选择、数据源写入和多源解析', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  const settingsPage = await context.newPage()
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`)
  await settingsPage.getByLabel('Notion 个人访问令牌（PAT）').fill('fake-integration-token')
  await settingsPage.getByRole('button', { name: '保存', exact: true }).click()
  await expect(settingsPage.getByText('已保存', { exact: true })).toBeVisible()
  const settings = (await rpc(settingsPage, 'settings')).data,
    connectionId = settings.activeConnectionId
  const target = {
    id: connectionId + ':22222222222222222222222222222222',
    connectionId,
    dataSourceId: '22222222222222222222222222222222',
    databaseId: '11111111111111111111111111111111',
    name: '测试素材库',
    type: 'notion'
  }
  await rpc(settingsPage, 'remember', { destination: target })
  await worker.evaluate(async () => {
    const s = (globalThis as any).chrome.storage.local
    const data = (await s.get('cjdb_settings_v2')).cjdb_settings_v2
    data.destinations[0].usedFor = ['xhs-account']
    await s.set({ cjdb_settings_v2: data })
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: '数据源列表' })).toBeVisible()
  await page.getByRole('button', { name: /^数据源 测试素材库/ }).click()
  await expect(page.getByText(/这个表已经用来存储小红书账号/)).toBeVisible()
  await expect(page.getByRole('button', { name: '仍使用此数据源' })).toBeDisabled()
  await page.getByLabel('我知道用途不同，仍使用这个表').check()
  await page.getByRole('button', { name: '仍使用此数据源' }).click()
  await page.getByRole('button', { name: '保存到 测试素材库', exact: true }).click()
  await expect(page.getByText('本次采集结果')).toBeVisible()
  const calls = await worker.evaluate(() => (globalThis as any).__calls)
  expect(
    calls.some(
      (c: any) => c.path === '/v1/pages' && c.body.parent.data_source_id === target.dataSourceId
    )
  ).toBe(true)
  expect(
    calls
      .filter((c: any) => c.path.includes('/data_sources/'))
      .every((c: any) => c.version === '2025-09-03')
  ).toBe(true)
  const resolved = await rpc(settingsPage, 'resolve', {
    connectionId,
    input: 'https://www.notion.so/11111111111111111111111111111111'
  })
  expect(resolved.data.targets).toHaveLength(2)
  const updated = (await rpc(settingsPage, 'settings')).data
  expect(updated.destinations.find((d: any) => d.id === target.id).usedFor).toEqual([
    'xhs-account',
    'wechat-article'
  ])
})

test('任务记录可以恢复未完成保存，已成功项保持不变', async ({ page, worker, extensionId }) => {
  await worker.evaluate(async () => {
    const s = (globalThis as any).chrome.storage.local
    await s.clear()
    await s.set({
      cjdb_tasks: [
        {
          id: 'recover-test',
          createdAt: Date.now(),
          type: 'wechat-article',
          destination: '本地记录',
          target: { id: 'local:', type: 'local', name: '本地记录' },
          items: [
            { title: '已完成文章', status: 'success' },
            { title: '待重试文章', status: 'failed', error: '网络暂时不可用' }
          ],
          retryData: [null, { title: '待重试文章', content: '待保存内容' }]
        }
      ]
    })
  })
  await page.goto(`chrome-extension://${extensionId}/options.html#tasks`)
  await page.getByRole('button', { name: '只重试失败项' }).click()
  await expect(page.getByText('成功 2', { exact: false })).toBeVisible()
  const records = (await rpc(page, 'records')).data
  expect(records).toHaveLength(1)
  expect(records[0].data.title).toBe('待重试文章')
})
test('选择数据源不请求字段，实际保存时阻止不兼容字段', async ({ page, worker, context, extensionId }) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  const settings = await context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(settings, 'connect', { token: 'fake' })
  await worker.evaluate(() => {
    const original = fetch
    globalThis.fetch = async (input: any, init: any) => {
      const response = await original(input, init)
      if (String(input).includes('/data_sources/') && !String(input).endsWith('/query')) {
        const data = await response.json()
        data.properties.URL = { type: 'number', number: {} }
        return new Response(JSON.stringify(data))
      }
      return response
    }
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  await page.getByRole('button', { name: /^数据源 测试素材库/ }).click()
  const beforeSave = await worker.evaluate(() => (globalThis as any).__calls)
  expect(beforeSave.filter((c: any) => c.path.includes('/data_sources/'))).toHaveLength(0)
  await expect(page.getByRole('button', { name: '保存到 测试素材库', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存到 测试素材库', exact: true }).click()
  await expect(page.getByText('本次采集结果')).toBeVisible()
  await expect(page.getByText(/URL.*number/)).toBeVisible()
  const afterSave = await worker.evaluate(() => (globalThis as any).__calls)
  expect(afterSave.some((c: any) => c.path.includes('/data_sources/'))).toBe(true)
  expect(afterSave.some((c: any) => c.path === '/v1/pages')).toBe(false)
})

test('后台独立保存任务进度，重复或并发请求不会再次写入已完成项', async ({
  page,
  worker,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const target = { id: 'local:', type: 'local', name: '本地记录' }
  await rpc(page, 'recordTask', {
    id: 'dedup',
    createdAt: Date.now(),
    type: 'wechat-article',
    destination: '本地记录',
    target,
    items: [{ title: '文章', status: 'pending' }],
    retryData: [{ title: '文章' }]
  })
  const payload = {
    taskId: 'dedup',
    itemIndex: 0,
    type: 'wechat-article',
    destination: target,
    data: { title: '文章' }
  }
  const results = await Promise.all([rpc(page, 'save', payload), rpc(page, 'save', payload)])
  expect(results.every((r) => r.ok)).toBe(true)
  expect((await rpc(page, 'records')).data).toHaveLength(1)
  expect((await rpc(page, 'tasks')).data[0].items[0].status).toBe('success')
  await rpc(page, 'save', payload)
  expect((await rpc(page, 'records')).data).toHaveLength(1)
})

test('先识别再预览，确认后才选存储；真实摘要、红色帮助、就近配置与返回预览', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await article(page)
  await page.evaluate(() => {
    document.getElementById('js_content')!.textContent = ''
  })
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => {
    document.getElementById('js_content')!.textContent = '真实采集的正文快照'
  })
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(page.getByRole('dialog', { name: '预览采集内容' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '存储源' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '配置', exact: true })).toHaveCount(0)
  // Short body is shown directly in the overview.
  await expect(
    page
      .getByRole('dialog', { name: '预览采集内容' })
      .getByText('真实采集的正文快照', { exact: true })
  ).toBeVisible()
  await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
  await page.screenshot({ path: '/private/tmp/cjdb-preview-first.png' })
  const help = page.getByRole('button', { name: '加我微信 交流学习', exact: true })
  expect(await help.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(233, 29, 70)')
  const pageCount = context.pages().length
  await help.click()
  const contact = page.getByRole('dialog', { name: '加我微信 交流学习', exact: true })
  await expect(contact).toBeVisible()
  const qr = contact.getByRole('img', { name: '作者微信二维码' })
  await expect(qr).toBeVisible()
  await expect.poll(() => qr.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(contact).toContainText('添加时请备注「超级对标插件」')
  expect(context.pages()).toHaveLength(pageCount)
  await page.screenshot({ path: '/private/tmp/cjdb-contact-dialog.png' })
  await page.keyboard.press('Escape')
  await expect(contact).not.toBeVisible()
  await expect(help).toBeFocused()
  await help.click()
  await contact.getByRole('button', { name: '关闭交流弹窗' }).click()
  await expect(contact).not.toBeVisible()
  await page.evaluate(() => {
    document.getElementById('js_content')!.textContent = '页面变化不覆盖快照'
  })
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '选择保存位置' })).toBeVisible()
  const summary = page.getByRole('region', { name: '本次采集摘要' })
  await expect(summary).toContainText('公众号文章 · 1 篇内容')
  await expect(summary).toContainText('如何建立自己的素材库')
  const source = page.getByRole('combobox', { name: '存储源', exact: true })
  await source.selectOption('notion')
  await expect(page.getByRole('region', { name: '配置 Notion 引导' })).toBeVisible()
  const config = page.getByRole('button', { name: '配置', exact: true })
  const a = (await source.boundingBox())!,
    b = (await config.boundingBox())!
  expect(Math.abs(a.y - b.y)).toBeLessThan(5)
  expect(b.x).toBeGreaterThan(a.x)
  await config.click()
  const frame = page.frameLocator('iframe[title="采集配置"]')
  await expect(frame.getByRole('button')).toHaveCount(2)
  await frame.getByRole('button', { name: '取消', exact: true }).click()
  await source.selectOption('local')
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await page.getByRole('button', { name: '返回预览' }).click()
  await expect(
    page
      .getByRole('dialog', { name: '预览采集内容' })
      .getByText('真实采集的正文快照', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' })
  ).not.toBeChecked()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await source.selectOption('notion')
  await expect(page.getByRole('button', { name: '请先选择保存位置' })).toBeDisabled()
  await source.selectOption('local')
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await page.getByRole('button', { name: '保存到 本地记录' }).click()
  await expect(page.getByText('本次采集结果')).toBeVisible()
  await page.evaluate(() => {
    document.getElementById('activity-name')!.textContent = '第二篇真实文章'
  })
  await expect(page.getByRole('button', { name: '开始新的采集' })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '识别并采集当前页面' })).toBeEnabled()
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('dialog', { name: '预览采集内容' })
      .getByRole('heading', { name: '第二篇真实文章' })
  ).toBeVisible()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(summary).toContainText('第二篇真实文章')
  await expect(summary).not.toContainText('如何建立自己的素材库')
})

test('作品最近库不显示账号历史，搜索在最近列表上方，窄屏没有横向溢出', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  const settings = await context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/options.html`)
  const conn = (await rpc(settings, 'connect', { token: 'fake-test' })).data.activeConnectionId
  const d = (id: string, name: string) => ({
    id: conn + ':' + id,
    type: 'notion',
    connectionId: conn,
    dataSourceId: '22222222222222222222222222222222',
    name
  })
  await rpc(settings, 'remember', { destination: d('work', '作品快捷库'), type: 'wechat-article' })
  await rpc(settings, 'remember', { destination: d('account', '账号快捷库'), type: 'xhs-account' })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: /作品快捷库/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '账号', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /账号快捷库/ })).toHaveCount(0)
  const search = await page.getByRole('textbox', { name: '搜索保存位置' }).boundingBox()
  const recent = await page.getByRole('heading', { name: '最近使用' }).boundingBox()
  expect(search!.y + search!.height).toBeLessThan(recent!.y)
  const list = page.getByRole('region', { name: '数据源列表', exact: true })
  await expect(list.getByRole('button', { name: '数据源 测试素材库', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '最近使用' })).toContainText('1 个字段')
  await page.getByRole('textbox', { name: '搜索保存位置' }).fill('素材')
  await page.getByRole('button', { name: '搜索 / 刷新' }).click()
  await expect(page.getByRole('heading', { name: '搜索结果', exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: '数据源 测试素材库', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /作品快捷库/ })).toBeVisible()
  await page.screenshot({ path: '/private/tmp/cjdb-upgrade/live-picker.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.getByRole('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true)
  await page.screenshot({ path: '/private/tmp/cjdb-upgrade/live-picker-mobile.png' })
})

test('叠加配置保存单一 Token，取消不保存，更新不创建其他连接', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  const pages = context.pages().length
  const open = async () => {
    await page.getByRole('combobox', { name: '存储源', exact: true }).selectOption('notion')
    await page.getByRole('button', { name: '配置', exact: true }).click()
  }
  const config = page.frameLocator('iframe[title="采集配置"]')
  await open()
  await expect(page.locator('dialog[open]')).toHaveCount(2)
  await page.screenshot({ path: '/private/tmp/cjdb-upgrade/config-overlay.png' })
  await config.getByLabel('Notion 个人访问令牌（PAT）', { exact: true }).fill('discarded-token')
  await config.getByRole('button', { name: '取消', exact: true }).click()
  const settingsPage = await context.newPage()
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`)
  expect((await rpc(settingsPage, 'settings')).data.connections).toHaveLength(0)
  await settingsPage.close()
  await open()
  await config.getByLabel('Notion 个人访问令牌（PAT）', { exact: true }).fill('saved-token')
  await config.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '配置', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '存储源', exact: true })).toHaveValue('notion')
  await open()
  await expect(config.getByLabel('Notion 个人访问令牌（PAT）', { exact: true })).toHaveValue('')
  await config.getByLabel('Notion 个人访问令牌（PAT）', { exact: true }).fill('new-token')
  await config.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '配置', exact: true })).toHaveCount(0)
  expect(context.pages()).toHaveLength(pages)
  const state = await worker.evaluate(
    async () =>
      (await (globalThis as any).chrome.storage.local.get('cjdb_settings_v2')).cjdb_settings_v2
  )
  expect(state.connections).toHaveLength(1)
  expect(state.connections[0].token).toBe('new-token')
})

test('存储源下拉按源引导配置，取消保留当前来源，公众号没有第三方补充入口', async ({
  page,
  worker
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  const source = page.getByRole('combobox', { name: '存储源', exact: true })
  await source.selectOption('notion')
  await page.getByRole('button', { name: '配置 Notion 个人令牌', exact: true }).click()
  const frame = page.frameLocator('iframe[title="采集配置"]')
  await expect(frame.getByLabel('Notion 个人访问令牌（PAT）', { exact: true })).toBeVisible()
  await expect(frame.getByText('App ID', { exact: true })).toHaveCount(0)
  await expect(frame.getByRole('button')).toHaveCount(2)
  await frame.getByRole('button', { name: '取消', exact: true }).click()
  await expect(source).toHaveValue('notion')
  await source.selectOption('feishu')
  await page.getByRole('button', { name: '配置飞书', exact: true }).click()
  await expect(frame.getByLabel('App ID', { exact: true })).toBeVisible()
  await expect(frame.getByText('Notion 个人访问令牌（PAT）', { exact: true })).toHaveCount(0)
  await frame.getByRole('button', { name: '取消', exact: true }).click()
  await expect(source).toHaveValue('feishu')
  await page.getByRole('button', { name: '配置', exact: true }).click()
  await expect(frame.getByLabel('App ID', { exact: true })).toBeVisible()
  await frame.getByLabel('名称', { exact: true }).fill('飞书素材库')
  await frame.getByLabel('App ID', { exact: true }).fill('fake-app')
  await frame.getByLabel('App Secret', { exact: true }).fill('fake-secret')
  await frame
    .getByLabel('多维表格链接', { exact: true })
    .fill('https://test.feishu.cn/wiki/test?table=tbltest')
  await frame.getByRole('button', { name: '保存', exact: true }).click()
  await expect(source).toHaveValue('feishu')
  await expect(page.getByRole('button', { name: '飞书素材库', exact: true })).toBeVisible()
  await source.selectOption('local')
  await page.getByRole('button', { name: '使用本地存储' }).click()
  await expect(page.getByText('补充阅读、点赞、分享等数据')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '公众号历史文章', exact: true })).toHaveCount(0)
})
test('初始列表只请求搜索，字段直接展示；详情按需统计行数，列表内部滚动', async ({
  page,
  worker,
  extensionId
}) => {
  await mockNotion(worker)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(page, 'connect', { token: 'fake-token' })
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      const response = await original(input, init)
      if (String(input).endsWith('/search')) {
        const data = await response.json()
        data.results = Array.from({ length: 20 }, (_, i) => ({
          ...data.results[0],
          id: String(i).padStart(32, '0'),
          title: [{ plain_text: '素材 ' + i }]
        }))
        return new Response(JSON.stringify(data))
      }
      return response
    }
    ;(globalThis as any).__calls = []
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  const region = page.getByRole('region', { name: '数据源列表' })
  await expect(region.getByRole('button', { name: /^数据源 素材 / })).toHaveCount(20)
  await expect(region.getByText('创建于 2026/9/1 · 1 个字段').first()).toBeVisible()
  expect(await worker.evaluate(() => (globalThis as any).__calls.map((c: any) => c.path))).toEqual([
    '/v1/search'
  ])
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await region.getByText('查看详情', { exact: true }).first().click()
  await region.getByRole('button', { name: '读取行数与信息' }).first().click()
  await expect(region.getByText(/· 0 行数据$/).first()).toBeVisible()
  const paths = await worker.evaluate(() => (globalThis as any).__calls.map((c: any) => c.path))
  expect(paths).toHaveLength(2)
  expect(paths[1]).toContain('/query')
  await page.screenshot({ path: '/private/tmp/cjdb-direct-sources.png' })
})
test('统一搜索支持数据库 URL 与数据源 ID，直接返回可选择的数据源', async ({
  page,
  worker,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(page, 'connect', { token: 'fake-token' })
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      const response = await original(input, init)
      if (String(input).includes('/databases/')) {
        const db = await response.json()
        db.data_sources = db.data_sources.slice(0, 1)
        return new Response(JSON.stringify(db))
      }
      return response
    }
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await expect(
    page
      .getByRole('button', { name: '确认', exact: true })
      .or(page.getByRole('combobox', { name: '存储源', exact: true }))
  ).toBeVisible()
  if (await page.getByRole('button', { name: '确认', exact: true }).isVisible()) {
    await page.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).uncheck()
    await page.getByRole('button', { name: '确认', exact: true }).click()
  }
  const search = page.getByRole('textbox', { name: '搜索保存位置' })
  await search.fill(
    'https://www.notion.so/11111111111111111111111111111111?v=99999999999999999999999999999999'
  )
  await search.press('Enter')
  await expect(page.getByRole('region', { name: '选择数据源' })).toHaveCount(0)
  await page.getByRole('button', { name: '数据源 测试素材库', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存到 测试素材库', exact: true })).toBeEnabled()
  await search.fill('22222222-2222-2222-2222-222222222222')
  await search.press('Enter')
  await page.getByRole('button', { name: /数据源 测试素材库/ }).click()
  await expect(page.getByRole('button', { name: '保存到 测试素材库', exact: true })).toBeEnabled()
  // Recently selected source appears immediately in the persistent chip strip.
  await expect(page.getByRole('heading', { name: '最近使用' })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: '最近使用', exact: true })
      .getByRole('button', { name: /测试素材库/ })
  ).toBeVisible()
  await expect(page.getByRole('region', { name: '数据源列表', exact: true })).toBeVisible()
  await expect(page.getByText('通过数据库链接查找', { exact: true })).toHaveCount(0)
})

test('已配置但搜索为空时，结果区域不重复展示配置或帮助入口', async ({
  page,
  worker,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(page, 'connect', { token: 'fake' })
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) =>
      String(input).endsWith('/search')
        ? new Response(JSON.stringify({ results: [], has_more: false }))
        : original(input, init)
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面' }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  const region = page.getByRole('region', { name: '数据源列表' })
  await expect(region.getByText('没有找到匹配项，请检查名称、ID 或数据库授权。')).toBeVisible()
  await expect(region.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '配置 Notion 引导' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '加我微信 交流学习' })).toHaveCount(1)
  await page.screenshot({ path: '/private/tmp/cjdb-storage-empty.png' })
})

test('每次入口读取同 URL 最新内容并回到预览，重新采集失败不回退旧数据', async ({ page }) => {
  await article(page)
  const launch = () => page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  const preview = page.getByRole('heading', { name: '本次采集全貌' })
  await launch()
  await expect(preview).toBeVisible()
  await expect(page.getByRole('button', { name: '放弃本次预览' })).toHaveCount(0)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.evaluate(() => {
    document.querySelector('#activity-name')!.textContent = '同 URL 的新内容'
  })
  await launch()
  await expect(preview).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('同 URL 的新内容')
  await expect(page.getByRole('combobox', { name: '存储源', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重新采集', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('同 URL 的新内容')
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.evaluate(() => {
    history.pushState({}, '', '/s/second-article')
    document.querySelector('#activity-name')!.textContent = '第二篇文章'
  })
  await launch()
  await expect(page.getByRole('dialog')).toContainText('第二篇文章')
  await expect(page.getByRole('dialog')).not.toContainText('同 URL 的新内容')
  await page.evaluate(() => {
    document.querySelector('#js_content')!.textContent = ''
  })
  await page.getByRole('button', { name: '重新采集', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: '未识别到文章内容，请等待页面加载完成后重试。' })
  ).toBeVisible()
  await page.evaluate(() => {
    document.querySelector('#activity-name')!.textContent = '修复后的文章'
    document.querySelector('#js_content')!.textContent = '重新加载后的正文'
  })
  await launch()
  await expect(page.getByRole('dialog')).toContainText('修复后的文章')
})

test('搜索合集预览展示整批条目，并在搜索 URL 改变后立即读取新列表', async ({ page }) => {
  await page.route('https://www.xiaohongshu.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body:
        '<html><body><main>' +
        Array.from(
          { length: 25 },
          (_, i) =>
            `<section class="note-item"><a href="/explore/note${i}"><span class="title">作品 ${i + 1}</span></a><span class="author">作者 ${i + 1}</span><span class="like-wrapper"><span class="count">${i + 10}</span></span></section>`
        ).join('') +
        '</main></body></html>'
    })
  )
  await page.goto('https://www.xiaohongshu.com/search_result_ai?keyword=设计')
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  const batch = page.getByRole('region', { name: '批量采集预览' })
  await expect(batch.getByRole('row')).toHaveCount(26)
  await expect(page.getByRole('dialog')).toContainText('设计')
  expect(await batch.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await batch.getByText('作品 25', { exact: true }).scrollIntoViewIfNeeded()
  await expect(batch.getByText('作品 25', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/private/tmp/cjdb-upgrade/batch-preview.png' })
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.evaluate(() => {
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<section class="note-item"><a href="/explore/loaded"><span class="title">继续加载的作品</span></a></section>'
      )
  })
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await expect(batch.getByRole('row')).toHaveCount(27)
  await expect(batch).toContainText('继续加载的作品')
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.evaluate(() => {
    history.pushState({}, '', '/search_result?keyword=新的搜索')
    document.querySelector('main')!.innerHTML =
      '<section class="note-item"><a href="/explore/newnote"><span class="title">新搜索作品</span></a></section>'
  })
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await expect(batch.getByRole('row')).toHaveCount(2)
  await expect(batch).toContainText('新搜索作品')
  await expect(page.getByRole('dialog')).toContainText('新的搜索')
})

test('默认检索未完成时仍可选择最近胶囊，列表返回后保留选择', async ({
  page,
  worker,
  context,
  extensionId
}) => {
  await mockNotion(worker)
  const settings = await context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/options.html`)
  const conn = (await rpc(settings, 'connect', { token: 'fake-test' })).data.activeConnectionId
  await rpc(settings, 'remember', {
    type: 'wechat-article',
    destination: {
      id: conn + ':22222222222222222222222222222222',
      type: 'notion',
      connectionId: conn,
      dataSourceId: '22222222222222222222222222222222',
      name: '快捷保存'
    }
  })
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      if (String(input).endsWith('/search'))
        await new Promise<void>((resolve) => {
          ;(globalThis as any).__releaseSearch = resolve
        })
      return original(input, init)
    }
  })
  await article(page)
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => worker.evaluate(() => !!(globalThis as any).__releaseSearch)).toBe(true)
  await expect(
    page.getByRole('region', { name: '数据源列表', exact: true }).getByRole('status')
  ).toHaveText('加载中…')
  await page
    .getByRole('region', { name: '最近使用' })
    .getByRole('button', { name: /快捷保存/ })
    .click()
  await expect(page.getByRole('button', { name: /^保存到 / })).toBeEnabled()
  await worker.evaluate(() => (globalThis as any).__releaseSearch())
  await expect(
    page
      .getByRole('region', { name: '数据源列表', exact: true })
      .getByRole('button', { name: '数据源 测试素材库', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^保存到 / })).toBeEnabled()
  await expect(page.getByRole('region', { name: '最近使用' })).toContainText('1 个字段')
  const rowQueries = await worker.evaluate(
    () => (globalThis as any).__calls.filter((c: any) => c.path.endsWith('/query')).length
  )
  expect(rowQueries).toBe(0)
  await worker.evaluate(() => {
    ;(globalThis as any).__releaseSearch = null
  })
  await page.getByRole('textbox', { name: '搜索保存位置' }).fill('素材')
  await page.getByRole('button', { name: '搜索 / 刷新' }).click()
  await expect(
    page.getByRole('region', { name: '数据源列表', exact: true }).getByRole('status')
  ).toHaveText('搜索中…')
  await expect.poll(() => worker.evaluate(() => !!(globalThis as any).__releaseSearch)).toBe(true)
  await worker.evaluate(() => (globalThis as any).__releaseSearch())
  await expect(
    page
      .getByRole('region', { name: '数据源列表', exact: true })
      .getByRole('button', { name: '数据源 测试素材库', exact: true })
  ).toBeVisible()
})

test('同篇笔记继续加载评论后再次预览读取最新标记缓存，并保留取消勾选的状态', async ({ page }) => {
  await page.route('https://www.xiaohongshu.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div class="note-container"><div id="detail-title">评论测试笔记</div><div id="detail-desc">测试正文</div><div class="comments-container"><div class="parent-comment"><div class="comment-item" id="comment-first"><span class="name">评论用户</span><span class="note-text">第一条评论</span></div></div></div></div></body></html>'
    })
  )
  await page.goto('https://www.xiaohongshu.com/explore/testcomments')
  const launch = () => page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  await launch()
  await expect(page.getByText('已采集评论 1 条', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.evaluate(() =>
    document
      .querySelector('.comments-container')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="parent-comment"><div class="comment-item" id="comment-second"><span class="note-text">新加载的第二条评论</span></div></div>'
      )
  )
  await launch()
  await page.getByText('已采集评论 2 条', { exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('新加载的第二条评论')
  await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  await page.locator('#comment-first .cjdb-comment-checkbox').click()
  await launch()
  await page.getByText('已采集评论 1 条', { exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('新加载的第二条评论')
  await expect(page.getByRole('dialog')).not.toContainText('第一条评论')
})

test('个人令牌使用用户身份：搜索、重复保存和跨令牌隔离；无效替换不覆盖配置', async ({
  page,
  worker,
  extensionId
}) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      if (String(input).endsWith('/users/me')) {
        const invalid = init.headers.Authorization === 'Bearer invalid-pat'
        return new Response(
          JSON.stringify(
            invalid
              ? { message: 'Unauthorized' }
              : { object: 'user', type: 'person', id: 'same-user', name: '个人用户', person: {} }
          ),
          { status: invalid ? 401 : 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return original(input, init)
    }
  })
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await page.getByLabel('Notion 个人访问令牌（PAT）', { exact: true }).fill('personal-pat-A')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  expect((await rpc(page, 'configState')).data.authType).toBe('personal')
  const first = (await rpc(page, 'settings')).data
  expect(first.connections[0].name).toBe('个人用户')
  expect(JSON.stringify(first)).not.toContain('personal-pat')
  const search = await rpc(page, 'search')
  expect(search.ok).toBe(true)
  await rpc(page, 'remember', { destination: search.data.targets[0], type: 'xhs-note-detail' })
  await rpc(page, 'saveConfig', { token: 'personal-pat-A' })
  expect((await rpc(page, 'settings')).data.connections[0].id).toBe(first.connections[0].id)
  const invalid = await rpc(page, 'saveConfig', { token: 'invalid-pat' })
  expect(invalid.ok).toBe(false)
  expect((await rpc(page, 'settings')).data.destinations).toHaveLength(1)
  await rpc(page, 'saveConfig', { token: 'personal-pat-B' })
  const second = (await rpc(page, 'settings')).data
  expect(second.connections).toHaveLength(1)
  expect(second.connections[0].id).not.toBe(first.connections[0].id)
  expect(second.destinations).toHaveLength(0)
})

test('笔记图片下载开始前更新进度，不沿用查重提示', async ({ page, worker, extensionId }) => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.clear()
  })
  await mockNotion(worker)
  await worker.evaluate(() => {
    const state = globalThis as any
    state.__tips = []
    state.chrome.tabs.sendMessage = async (_tab: number, message: any) => {
      state.__tips.push(message.message)
    }
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      const url = String(input)
      if (url === 'https://media.example.test/cover.png') {
        state.__downloadTip = state.__tips.at(-1)
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
      }
      if (url.includes('/file_uploads')) {
        return new Response(JSON.stringify({ id: 'upload-test', status: 'uploaded' }))
      }
      return original(input, init)
    }
  })
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(page, 'connect', { token: 'test-token' })
  const search = await rpc(page, 'search')
  const result = await rpc(page, 'save', {
    type: 'xhs-note-detail',
    destination: search.data.targets[0],
    data: {
      title: '图片进度测试', url: 'https://www.xiaohongshu.com/explore/test',
      coverUrl: 'https://media.example.test/cover.png',
      _metaData: { downloadImagesAndVideo: true }
    }
  })
  expect(result.ok).toBe(true)
  const state = await worker.evaluate(() => ({
    atDownload: (globalThis as any).__downloadTip,
    tips: (globalThis as any).__tips
  }))
  expect(state.atDownload).toContain('正在处理封面 0/1')
  expect(state.tips).toContain('正在处理封面 1/1（下载并上传）...')
  expect(state.tips.at(-1)).toBe('正在创建新笔记...')
})

test('笔记主轮播按数字序号提取，排除复制项、其他笔记及周边图片', async ({ page }) => {
  const slide = (index: string, extra = '', name = index) =>
    `<div class="swiper-slide ${extra}" data-index="${index}"><div class="img-container"><div class="note-slider-img"><img src="https://images.example.test/${name}.jpg"></div></div><img src="https://images.example.test/unrelated.jpg"></div>`
  const note = (id: string, slides: string) =>
    `<div class="note-detail-mask" note-id="${id}"><div id="noteContainer" class="note-container"><div class="note-content"><img src="https://images.example.test/body.jpg"></div><div class="media-container"><div elementtiming="note-cover"><div class="note-slider"><div class="swiper-wrapper">${slides}</div></div></div></div></div></div>`
  await page.setContent(note('other', slide('0', '', 'other')) +
    note('current', slide('7', 'swiper-slide-duplicate', 'clone') + slide('10') +
      slide('2') + slide('0') + slide('1') + slide('1', '', 'repeated') + slide('invalid')))
  const read = (id: string) => page.evaluate(({ source, id }) =>
    (0, eval)(`(${source})`)(id), { source: extractNoteImages.toString(), id })
  expect(await read('current')).toEqual(['0', '1', '2', '10'].map(i => `https://images.example.test/${i}.jpg`))
  expect(await read('missing')).toEqual([])
  await page.locator('[note-id="current"] .media-container').evaluate(el => el.remove())
  expect(await read('current')).toEqual([])
})

for (const [dataType, label] of [['video', '视频'], ['normal', '图文']]) {
  test(`作品类型识别与分组预览：${label}`, async ({ page, worker, extensionId }) => {
    await page.route('https://www.xiaohongshu.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<div class="note-detail-mask" note-id="typetest"><div id="noteContainer" class="note-container" data-type="${dataType}">
        <div id="detail-title">类型测试</div><div id="detail-desc">正文</div>
        <div class="author-wrapper"><a class="name">测试作者</a></div>
        <div class="media-container">${dataType === 'video' ? '<div elementtiming="note-cover"><video src="blob:https://www.xiaohongshu.com/test"></video></div>' : ''}</div>
        </div></div><video src="https://media.example.test/unrelated.mp4"></video>`
    }))
    await page.goto('https://www.xiaohongshu.com/explore/typetest')
    await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.cjdb-tag').filter({ hasText: label })).toBeVisible()
    await expect(dialog.getByRole('region', { name: '作品信息', exact: true })).not.toContainText('作者名称')
    const metrics = dialog.locator('dl[aria-label="互动数据"]')
    await expect(metrics).toContainText('点赞')
    await expect(metrics).toContainText('收藏')
    await expect(metrics).toContainText('评论')
    const detailBox = await dialog.locator('dl[aria-label="作品详情"]').boundingBox()
    const metricBox = await metrics.boundingBox()
    expect(metricBox!.x).toBeGreaterThan(detailBox!.x)
    const details = dialog.locator('dl[aria-label="作品详情"]')
    await expect(details).toContainText('0 个')
    await expect(details).toContainText('0 张')
    await expect(dialog).not.toContainText('未获取到可保存的视频地址')
    await mockNotion(worker)
    const config = await page.context().newPage()
    await config.goto(`chrome-extension://${extensionId}/options.html`)
    await rpc(config, 'connect', { token: 'test-type-token' })
    const search = await rpc(config, 'search')
    await rpc(config, 'save', { type: 'xhs-note-detail', destination: search.data.targets[0],
      data: { title: '类型测试', url: 'https://www.xiaohongshu.com/explore/typetest', workType: label } })
    const calls = await worker.evaluate(() => (globalThis as any).__calls)
    expect(calls.find((c: any) => c.path === '/v1/pages').body.properties['作品类型']).toEqual({ select: { name: label } })
  })
}

for (const uploadMedia of [false, true]) {
test(`og 视频直链与播放器封面进入预览并可保存：上传=${uploadMedia}`, async ({ page, worker, extensionId }) => {
  await page.route('https://www.xiaohongshu.com/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<meta property="og:url" content="https://www.xiaohongshu.com/explore/playertest"><meta property="og:video" content="https://media.example.test/video.mp4?sign=abc%2F123&amp;t=456"><div class="note-detail-mask" note-id="playertest"><div id="noteContainer"><div id="detail-title">视频封面测试</div><div class="media-container"><div elementtiming="note-cover"><video src="https://media.example.test/video.mp4"></video><xg-poster style="background-image:url(https://media.example.test/cover.jpg)"></xg-poster></div></div></div></div>'
  }))
  await page.goto('https://www.xiaohongshu.com/explore/playertest')
  await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.cjdb-tag').filter({ hasText: '视频' })).toBeVisible()
  await expect(dialog.locator('img[alt="内容封面"]')).toHaveAttribute('src', 'https://media.example.test/cover.jpg')
  await expect(dialog).not.toContainText('未获取到')
  await expect(dialog.locator('dl[aria-label="作品详情"]')).toContainText('1 个')
  await mockNotion(worker)
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input: any, init: any) => {
      const url = String(input)
      if (url.startsWith('https://media.example.test/'))
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' } })
      if (url.includes('/file_uploads'))
        return new Response(JSON.stringify({ id: 'uploaded-media', status: 'uploaded' }))
      return original(input, init)
    }
  })
  const config = await page.context().newPage()
  await config.goto(`chrome-extension://${extensionId}/options.html`)
  await rpc(config, 'connect', { token: 'test-player-token' })
  await dialog.getByRole('checkbox', { name: '保存图片与视频文件（耗时较长）' }).setChecked(uploadMedia)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByRole('combobox', { name: '存储源', exact: true }).selectOption('notion')
  await page.getByText('测试素材库', { exact: true }).first().click()
  await page.getByRole('button', { name: '保存到 测试素材库', exact: true }).click()
  await expect(page.getByText('本次采集结果')).toBeVisible()
  const calls = await worker.evaluate(() => (globalThis as any).__calls)
  const props = calls.find((c: any) => c.path === '/v1/pages').body.properties
  if (uploadMedia) {
    expect(props['视频'].files[0].file_upload.id).toBe('uploaded-media')
    expect(props['封面'].files[0].file_upload.id).toBe('uploaded-media')
  } else {
  expect(props['视频'].files[0].external.url).toBe('https://media.example.test/video.mp4?sign=abc%2F123&t=456')
  expect(props['封面'].files[0].external.url).toBe('https://media.example.test/cover.jpg')
  }
})
}

test('缺少或不匹配的 og 元数据不回退播放器链接', async ({ page }) => {
  await page.route('https://www.xiaohongshu.com/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<meta property="og:url" content="https://www.xiaohongshu.com/explore/oldnote"><meta property="og:video" content="https://media.example.test/old.mp4"><div class="note-detail-mask" note-id="currentnote"><div id="noteContainer" data-type="video"><div id="detail-title">来源验证</div><div class="media-container"><div elementtiming="note-cover"><video src="https://media.example.test/player.mp4"></video></div></div></div></div>'
  }))
  await page.goto('https://www.xiaohongshu.com/explore/currentnote')
  for (const mode of ['mismatch', 'missing', 'blob', 'valid']) {
    await page.evaluate(mode => {
      const url = document.querySelector<HTMLMetaElement>('meta[property="og:url"]')!
      const video = document.querySelector<HTMLMetaElement>('meta[property="og:video"]')!
      if (mode !== 'mismatch') url.content = location.href
      video.content = mode === 'missing' ? '' : mode === 'blob' ? 'blob:https://www.xiaohongshu.com/test' : 'https://media.example.test/og.mp4'
    }, mode)
    await page.getByRole('button', { name: '识别并采集当前页面', exact: true }).click()
    await expect(page.locator('dl[aria-label="作品详情"]')).toContainText(mode === 'valid' ? '1 个' : '0 个')
    await page.getByRole('button', { name: '关闭采集弹窗' }).click()
  }
})
