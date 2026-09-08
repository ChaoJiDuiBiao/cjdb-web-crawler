import { browser } from 'wxt/browser'
export async function service<T = any>(action: string, payload: unknown = {}): Promise<T> {
  const result = await browser.runtime.sendMessage({
    type: 'cjdb-service',
    action,
    payload: JSON.parse(JSON.stringify(payload))
  })
  if (!result?.ok) throw new Error(result?.error || '扩展连接已断开，请刷新页面后重试。')
  return result.data as T
}
