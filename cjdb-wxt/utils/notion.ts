const NOTION_HOST_RE = /(^|\.)notion\.(so|com)$/i
const NOTION_ID_RE = /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{32}/ig

function normalizeNotionId(candidate: string): string | null {
  const compact = candidate.replace(/[\s-]/g, '')
  if (!/^[a-f0-9]{32}$/i.test(compact)) return null
  return compact.toLowerCase()
}

function extractNotionId(text: string): string | null {
  const matches = text.match(NOTION_ID_RE)
  if (!matches?.length) return null
  return normalizeNotionId(matches[matches.length - 1])
}

/**
 * 支持输入纯 Database ID 或 Notion 数据库 URL，统一返回 32 位小写 ID
 */
export function parseNotionDatabaseId(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  const direct = normalizeNotionId(raw)
  if (direct) return direct

  let url: URL
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    url = new URL(withProtocol)
  } catch {
    return null
  }

  if (!NOTION_HOST_RE.test(url.hostname)) return null

  const segments = url.pathname.split('/').filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const id = extractNotionId(decodeURIComponent(segments[i]))
    if (id) return id
  }

  return null
}
