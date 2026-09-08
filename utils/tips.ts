/**
 * 进度提示
 * - showPanelTip: Background 通过 tabs.sendMessage 推送到指定 tab 的 Content，由 listener 调用 CJDB_TipsDisplay
 */
import { MessageTypes } from '@/types'

export function showPanelTip(msg: string, tabId?: number) {
  if (tabId == null) return
  browser.tabs
    .sendMessage(tabId, { type: MessageTypes.ShowPanelTip, message: msg })
    .catch(() => {})
}
