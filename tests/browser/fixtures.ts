import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
  type Page
} from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
export const test = base.extend<{
  context: BrowserContext
  worker: Worker
  extensionId: string
}>({
  context: async ({}, use) => {
    const path = resolve(`output/抄级对标数据采集器-v${version}`)
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      ...(process.env.CJDB_TEST_CHROMIUM ? { executablePath: process.env.CJDB_TEST_CHROMIUM } : {}),
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`]
    })
    await use(context)
    await context.close()
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent('serviceworker')
    await use(worker)
  },
  extensionId: async ({ worker }, use) => {
    await use(worker.url().split('/')[2])
  }
})
export { expect } from '@playwright/test'
export async function rpc(page: Page, action: string, payload: any = {}) {
  return page.evaluate(
    async ({ action, payload }) =>
      await (globalThis as any).chrome.runtime.sendMessage({
        type: 'cjdb-service',
        action,
        payload
      }),
    { action, payload }
  )
}
export async function article(page: Page) {
  await page.route('https://mp.weixin.qq.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>测试文章</title><style>button{background:red!important;color:red!important}body{font-size:40px}</style></head><body><h1 id="activity-name">如何建立自己的素材库</h1><a id="js_name">创作者周刊</a><div id="publish_time">2026-09-05</div><div id="js_content"><p>这是一篇用于验证采集预览和保存流程的文章。</p></div></body></html>'
    })
  )
  await page.goto('https://mp.weixin.qq.com/s/test-article')
  await page.getByRole('button', { name: '识别并采集当前页面' }).waitFor()
}
export async function mockNotion(worker: Worker) {
  await worker.evaluate(() => {
    const original = globalThis.fetch
    ;(globalThis as any).__calls = []
    globalThis.fetch = async (input: any, init: any) => {
      const url = String(input)
      if (!url.startsWith('https://api.notion.com/')) return original(input, init)
      const path = new URL(url).pathname,
        body = init?.body ? JSON.parse(init.body) : null
      ;(globalThis as any).__calls.push({
        path,
        method: init?.method || 'GET',
        body,
        version: init?.headers?.['Notion-Version']
      })
      const db = '11111111111111111111111111111111',
        id = '22222222222222222222222222222222'
      const source = {
        object: 'data_source',
        created_time: '2026-09-01T00:00:00.000Z',
        id,
        parent: { database_id: db },
        title: [{ plain_text: '测试素材库' }],
        url: 'https://www.notion.so/' + db,
        properties: { 名称: { type: 'title', title: {} } }
      }
      let result: any = {}
      if (path.endsWith('/users/me'))
        result = {
          id: 'bot',
          name: '测试连接',
          bot: { workspace_name: '测试工作区' }
        }
      else if (path.endsWith('/search'))
        result = { results: [source], has_more: false, next_cursor: null }
      else if (path === `/v1/databases/${db}`)
        result = {
          id: db,
          title: [{ plain_text: '测试素材库' }],
          created_time: '2026-09-01T00:00:00.000Z',
          data_sources: [
            { id, name: '测试素材库' },
            { id: '33333333333333333333333333333333', name: '另一个数据源' }
          ]
        }
      else if (path.includes('/data_sources/') && path.endsWith('/query'))
        result = { results: [], has_more: false }
      else if (path.includes('/data_sources/')) result = source
      else if (path === '/v1/pages') result = { id: '44444444444444444444444444444444' }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  })
}
