import { DomUtils, parseDocument } from 'htmlparser2'
import type { SharePrivacyMode } from './privacy-mode'
import { sanitizeRemoteContent, STYLE_ONLY_CSP_META } from './remote-content'

const FULL_FEATURED_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data: blob:; style-src 'unsafe-inline' http: https:; font-src http: https: data:; base-uri 'none'; form-action 'none'">`

export function prepareSharedMessageHtml(html: string, mode: SharePrivacyMode): string | null {
  if (mode === 'only-text') return null
  if (mode === 'style-included') {
    return (
      STYLE_ONLY_CSP_META +
      sanitizeRemoteContent(html, { includeStyles: true, blockImages: true }).html
    )
  }
  const document = parseDocument(html)
  for (const element of DomUtils.getElementsByTagName('*', document)) {
    if (
      mode === 'full-featured-link-deducted' &&
      (element.name === 'a' || element.name === 'area')
    ) {
      delete element.attribs.href
      delete element.attribs['xlink:href']
      delete element.attribs.ping
    }
    if (
      element.name === 'meta' &&
      element.attribs['http-equiv']?.trim().toLowerCase() === 'refresh'
    ) {
      DomUtils.removeElement(element)
    }
  }
  return FULL_FEATURED_CSP_META + DomUtils.getInnerHTML(document)
}
