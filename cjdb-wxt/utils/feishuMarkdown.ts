import type { FeishuRuntimeBlock, FeishuRuntimeDoc, FeishuRuntimeOp } from '@/utils/feishuRuntime'

const TEXT_BLOCK_TYPES = new Set([
  'text',
  'callout_text',
  'page'
])

const CONTAINER_BLOCK_TYPES = new Set([
  'page',
  'grid',
  'column',
  'quote',
  'sheet',
  'bac_inline_sheet',
  'chat_card',
  'jira',
  'whiteboard',
  'diagram',
  'isv',
  'sheet_filter'
])

function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

function normalizeInlineText(text: string): string {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
}

function trimTrailingBreaks(text: string): string {
  return text.replace(/\n+$/g, '')
}

function applyInlineMarks(text: string, attributes?: Record<string, any>): string {
  if (!text) return ''
  let out = text
  const link = attributes?.link || attributes?.a?.href || attributes?.href
  const code = !!(attributes?.inlineCode || attributes?.code)
  const bold = !!(attributes?.bold || attributes?.strong)
  const italic = !!(attributes?.italic || attributes?.em)
  const strike = !!(attributes?.strike || attributes?.strikethrough)

  if (code) {
    out = `\`${out.replace(/`/g, '\\`')}\``
  } else {
    if (bold) out = `**${out}**`
    if (italic) out = `*${out}*`
    if (strike) out = `~~${out}~~`
  }

  if (link && typeof link === 'string' && link.trim()) {
    out = `[${out}](${link.trim()})`
  }

  return out
}

function inlineMarkdownFromOps(ops?: FeishuRuntimeOp[], fallbackText = ''): string {
  if (!Array.isArray(ops) || ops.length === 0) {
    return trimTrailingBreaks(normalizeInlineText(fallbackText))
  }

  const chunks: string[] = []
  for (const op of ops) {
    const insert = normalizeInlineText(op?.insert || '')
    if (!insert) continue

    const parts = insert.split('\n')
    parts.forEach((part, index) => {
      if (part) {
        const escaped = escapeMarkdown(part)
        chunks.push(applyInlineMarks(escaped, op.attributes))
      }
      if (index < parts.length - 1) {
        chunks.push('  \n')
      }
    })
  }

  return trimTrailingBreaks(chunks.join('').trim())
}

function markdownFromBlockText(block: FeishuRuntimeBlock): string {
  return inlineMarkdownFromOps(block.ops, block.allText || '')
}

function fencedCode(block: FeishuRuntimeBlock): string {
  const language = String(block.language || '').trim()
  const content = trimTrailingBreaks(normalizeInlineText(block.allText || markdownFromBlockText(block)))
  return `\`\`\`${language}\n${content}\n\`\`\``
}

function imageMarkdown(block: FeishuRuntimeBlock): string {
  const alt = escapeMarkdown(String(block.title || block.allText || 'image').trim() || 'image')
  const url = block.url?.trim() || (block.imageToken ? `feishu-image://${block.imageToken}` : '')
  return url ? `![${alt}](${url})` : `![${alt}]()`
}

function fileMarkdown(block: FeishuRuntimeBlock): string {
  const title = escapeMarkdown(String(block.title || block.allText || 'file').trim() || 'file')
  const url = block.url?.trim() || (block.fileToken ? `feishu-file://${block.fileToken}` : '')
  return url ? `[${title}](${url})` : title
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function renderBlocks(blocks: FeishuRuntimeBlock[], indent = ''): string[] {
  const out: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const rendered = renderBlock(blocks[i], i + 1, indent)
    if (rendered) out.push(rendered)
  }
  return out
}

function renderListBlock(block: FeishuRuntimeBlock, marker: string, indent: string): string {
  const text = markdownFromBlockText(block)
  const lines: string[] = []

  if (text) {
    lines.push(`${indent}${marker} ${text}`)
  } else {
    lines.push(`${indent}${marker}`)
  }

  const children = renderBlocks(block.children || [], `${indent}  `)
  if (children.length > 0) {
    lines.push(children.join('\n'))
  }

  return lines.join('\n')
}

function renderQuoteBlock(block: FeishuRuntimeBlock): string {
  const own = markdownFromBlockText(block)
  const children = renderBlocks(block.children || [])
  const body = [own, ...children].filter(Boolean).join('\n\n')
  return body ? prefixLines(body, '> ') : ''
}

function renderHeading(block: FeishuRuntimeBlock, depth: number): string {
  const text = markdownFromBlockText(block)
  return text ? `${'#'.repeat(depth)} ${text}` : ''
}

function renderBlock(block: FeishuRuntimeBlock | null | undefined, index: number, indent = ''): string {
  if (!block) return ''

  const type = String(block.type || '').toLowerCase()
  if (!type) return ''

  if (type === 'page' || CONTAINER_BLOCK_TYPES.has(type)) {
    return renderBlocks(block.children || [], indent).join('\n\n')
  }

  const headingMatch = type.match(/^heading([1-6])$/)
  if (headingMatch) {
    const heading = renderHeading(block, parseInt(headingMatch[1], 10))
    const children = renderBlocks(block.children || [], indent).join('\n\n')
    return [heading, children].filter(Boolean).join('\n\n')
  }

  if (TEXT_BLOCK_TYPES.has(type)) {
    const paragraph = markdownFromBlockText(block)
    const children = renderBlocks(block.children || [], indent).join('\n\n')
    return [paragraph, children].filter(Boolean).join('\n\n')
  }

  if (type === 'quote_container') {
    return renderQuoteBlock(block)
  }

  if (type === 'bullet') {
    return renderListBlock(block, '-', indent)
  }

  if (type === 'ordered') {
    const marker = block.seq?.trim() || `${index}.`
    return renderListBlock(block, marker, indent)
  }

  if (type === 'todo') {
    return renderListBlock(block, block.done ? '- [x]' : '- [ ]', indent)
  }

  if (type === 'divider') {
    return `${indent}---`
  }

  if (type === 'code' || type === 'codeblock' || type === 'code_block') {
    return fencedCode(block)
  }

  if (type === 'image') {
    return imageMarkdown(block)
  }

  if (type === 'file') {
    return fileMarkdown(block)
  }

  if (type === 'iframe' || type === 'embed' || type === 'bookmark') {
    const url = block.url?.trim()
    return url ? url : markdownFromBlockText(block)
  }

  const fallback = markdownFromBlockText(block)
  const children = renderBlocks(block.children || [], indent).join('\n\n')
  return [fallback, children].filter(Boolean).join('\n\n')
}

export function feishuRuntimeDocToMarkdown(doc: FeishuRuntimeDoc): string {
  const parts = renderBlocks(doc.root?.children || [])
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function feishuRuntimeDocToText(doc: FeishuRuntimeDoc): string {
  const markdown = feishuRuntimeDocToMarkdown(doc)
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~>#-]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
