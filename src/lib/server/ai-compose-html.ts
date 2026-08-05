import { parseDocument } from 'htmlparser2'

type HtmlNode = {
  type: string
  data?: string
  name?: string
  attribs?: Record<string, string>
  children?: HtmlNode[]
}

const ALLOWED_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'a'])
const DROP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'textarea'
])
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function escapeText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string) {
  return escapeText(value).replaceAll('"', '&quot;')
}

function safeHref(value: string | undefined) {
  if (!value || value.startsWith('//')) return null
  try {
    const url = new URL(value)
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? value : null
  } catch {
    return null
  }
}

function renderNode(node: HtmlNode): string {
  if (node.type === 'text') return escapeText(node.data ?? '')
  const tag = (node.name ?? '').toLowerCase()
  if (DROP_CONTENT_TAGS.has(tag) || node.type === 'script' || node.type === 'style') return ''
  const content = (node.children ?? []).map(renderNode).join('')
  if (node.type !== 'tag' || !ALLOWED_TAGS.has(tag)) return content
  if (tag === 'br') return '<br>'
  if (tag === 'a') {
    const href = safeHref(node.attribs?.href)
    return href ? `<a href="${escapeAttribute(href)}">${content}</a>` : content
  }
  return `<${tag}>${content}</${tag}>`
}

export function sanitizeAiComposeHtml(value: string) {
  return (parseDocument(value).children as unknown as HtmlNode[]).map(renderNode).join('').trim()
}

export function aiComposePreviewText(html: string) {
  const document = parseDocument(html)
  const readText = (node: HtmlNode): string => {
    if (node.type === 'text') return node.data ?? ''
    const separator = node.type === 'tag' && ['p', 'li', 'br'].includes(node.name ?? '') ? '\n' : ''
    return `${(node.children ?? []).map(readText).join('')}${separator}`
  }
  return (document.children as unknown as HtmlNode[])
    .map(readText)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
