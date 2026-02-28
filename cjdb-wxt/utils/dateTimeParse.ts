/**
 * 时间解析 - 基于 chrono-node
 * 支持：昨天 18:59、今天 18:59、X分钟前、X小时前、X天前、MM-DD
 */
import { zh } from 'chrono-node'

/**
 * 解析时间文本为 Date，支持中文相对时间
 */
export function parseDateTime(text: string, refDate = new Date()): Date | null {
  if (!text || !text.trim()) return null

  const trimmed = text.trim()

  const parsed = zh.hans.parseDate(trimmed, refDate)
  if (parsed) return parsed

  const fallback = parseRelativeAgo(trimmed)
  if (fallback) return fallback

  const mmdd = trimmed.match(/^(\d{1,2})-(\d{1,2})\b/)
  if (mmdd) {
    const month = parseInt(mmdd[1], 10) - 1
    const day = parseInt(mmdd[2], 10)
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(refDate.getFullYear(), month, day)
      if (d > refDate) d.setFullYear(refDate.getFullYear() - 1)
      return d
    }
  }

  return null
}

function parseRelativeAgo(text: string): Date | null {
  const now = new Date()
  if (text.includes('分钟前')) {
    const m = text.match(/(\d+)\s*分钟前/)
    const minutes = m ? parseInt(m[1], 10) : parseInt(text) || 0
    return new Date(now.getTime() - minutes * 60 * 1000)
  }
  if (text.includes('小时前')) {
    const m = text.match(/(\d+)\s*小时前/)
    const hours = m ? parseInt(m[1], 10) : parseInt(text) || 0
    return new Date(now.getTime() - hours * 60 * 60 * 1000)
  }
  if (text.includes('天前')) {
    const m = text.match(/(\d+)\s*天前/)
    const days = m ? parseInt(m[1], 10) : parseInt(text) || 0
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  }
  if (text.includes('周前') || text.includes('星期前')) {
    const m = text.match(/(\d+)\s*(?:周|星期)前/)
    const weeks = m ? parseInt(m[1], 10) : parseInt(text) || 0
    return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000)
  }
  return null
}

/**
 * 格式化为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
