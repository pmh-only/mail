import { DomUtils, parseDocument } from 'htmlparser2'

type HtmlNode = {
  type: string
  name?: string
  attribs?: Record<string, string>
  children?: HtmlNode[]
}

export type RemoteContentSettings = {
  blockRemoteContent: boolean
  allowedSenders: string[]
}

export type RemoteContentResult = {
  html: string
  blockedCount: number
}

export type RemoteContentMessagePermission = {
  messageId: number
  allowedMessageIds: ReadonlySet<number>
}

const REMOTE_URL_PATTERN = /^(?:https?:)?\/\//i
const URL_ATTRS = new Set(['src', 'poster', 'background', 'data'])
const HREF_URL_TAGS = new Set(['link', 'base', 'image', 'use'])

function isRemoteUrl(value: string) {
  return REMOTE_URL_PATTERN.test(value.trim())
}

export function normalizeSenderAddress(value: string | null | undefined) {
  if (!value) return ''
  const match = value.match(/<([^>]+)>/)
  const address = (match?.[1] ?? value).trim().toLowerCase()
  return address.includes('@') ? address : ''
}

export function normalizeAllowedSenders(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : (value ?? '').split(/[\n,]/)
  return Array.from(
    new Set(values.map((item) => item.trim().toLowerCase()).filter((item) => item.includes('@')))
  ).sort()
}

export function isRemoteContentAllowedForSender(
  sender: string | null | undefined,
  settings: RemoteContentSettings
) {
  if (!settings.blockRemoteContent) return true
  const address = normalizeSenderAddress(sender)
  return Boolean(address && settings.allowedSenders.includes(address))
}

export function sanitizeRemoteContent(html: string): RemoteContentResult {
  let blockedCount = 0
  const document = parseDocument(html)

  const visit = (node: HtmlNode) => {
    const tagName = (node.name ?? '').toLowerCase()
    if (node.type === 'style' || tagName === 'style') {
      blockedCount += 1
      DomUtils.removeElement(node as Parameters<typeof DomUtils.removeElement>[0])
      return
    }
    if (node.type !== 'tag') return
    const attributes = node.attribs ?? {}
    if (tagName === 'meta' && attributes['http-equiv']?.toLowerCase() === 'refresh') {
      blockedCount += 1
      DomUtils.removeElement(node as Parameters<typeof DomUtils.removeElement>[0])
      return
    }

    for (const [rawName, value] of Object.entries(attributes)) {
      const name = rawName.toLowerCase()
      if (name === 'style' || name === 'srcset') {
        blockedCount += 1
        delete attributes[rawName]
        continue
      }
      const isHref = (name === 'href' || name === 'xlink:href') && HREF_URL_TAGS.has(tagName)
      if ((URL_ATTRS.has(name) || isHref) && isRemoteUrl(value)) {
        blockedCount += 1
        delete attributes[rawName]
        attributes[`data-remote-content-blocked-${name.replace(':', '-')}`] = value
      }
    }
    for (const child of [...(node.children ?? [])]) visit(child)
  }

  for (const child of [...(document.children as unknown as HtmlNode[])]) visit(child)
  return { html: DomUtils.getInnerHTML(document), blockedCount }
}

export function prepareRemoteContent(
  html: string,
  sender: string | null | undefined,
  settings: RemoteContentSettings,
  messagePermission?: RemoteContentMessagePermission
): RemoteContentResult {
  if (
    messagePermission?.allowedMessageIds.has(messagePermission.messageId) ||
    isRemoteContentAllowedForSender(sender, settings)
  ) {
    return { html, blockedCount: 0 }
  }

  return sanitizeRemoteContent(html)
}
