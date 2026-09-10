import { convert } from 'html-to-text'
import { parseDocument } from 'htmlparser2'
import addressparser from 'nodemailer/lib/addressparser/index.js'

export function outgoingSenderAddress(value: string) {
  const address = addressparser(value, { flatten: true })[0]?.address?.trim()
  if (!address) throw new Error('Invalid SMTP payload: invalid sender address')
  return address
}

export function outgoingListHeaders(from: string) {
  const address = outgoingSenderAddress(from)
  const separator = address.lastIndexOf('@')
  const local = address.slice(0, separator)
  const domain = address.slice(separator + 1)
  const quotedLocal = local.startsWith('"') && local.endsWith('"')
  const validDomain =
    (domain.startsWith('[') && domain.endsWith(']')) ||
    domain
      .split('.')
      .every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'))
  if (
    separator <= 0 ||
    !domain ||
    (!quotedLocal && (local.includes('@') || local.startsWith('.') || local.endsWith('.'))) ||
    (!quotedLocal && local.includes('..')) ||
    !validDomain
  ) {
    throw new Error('Invalid SMTP payload: invalid sender address')
  }
  const mailtoAddress = `${encodeURIComponent(local)}@${encodeURIComponent(domain)}`
  return { 'List-Unsubscribe': `<mailto:${mailtoAddress}>` }
}

export function outgoingMessageBody(value: string | null | undefined) {
  const fragment = value?.trim()
  if (!fragment) return {}

  const hasHtmlElement = parseDocument(fragment).children.some(
    (node) => 'name' in node && node.name.toLowerCase() === 'html'
  )
  const html = hasHtmlElement
    ? fragment
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`
  const text = convert(html, { wordwrap: 120 }).trim() || ' '
  return { html, text }
}
