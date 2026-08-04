import { attachmentContentDisposition } from '$lib/public-attachments'

/**
 * Content type prefixes that are safe to render inline (the browser displays
 * them without executing active content). Anything else is forced to a
 * download attachment disposition to prevent stored XSS via crafted
 * attachments (e.g. text/html or image/svg+xml served inline from the app
 * origin).
 */
const INLINE_SAFE_CONTENT_TYPE_PREFIXES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
  // Browsers render common video containers via <video> without executing
  // active content, so previews keep working. SVG/HTML are intentionally
  // excluded even though they share an `image/` or other prefix.
  'video/'
]

/**
 * Exact content types that are never inline-safe, regardless of prefix. This
 * guards against any future or niche active-content type that could slip past
 * a prefix match (e.g. image/svg+xml is blocked explicitly by the allow-list,
 * but this set documents the known active types).
 */
const NEVER_INLINE_CONTENT_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/xml'
])

/**
 * Returns true when the content type may be rendered inline. Active content
 * types such as text/html, image/svg+xml and application/xhtml+xml are never
 * considered inline-safe and are always served as downloads.
 */
export function isInlineSafeContentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  if (NEVER_INLINE_CONTENT_TYPES.has(normalized)) return false
  return INLINE_SAFE_CONTENT_TYPE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

/**
 * Builds the Content-Disposition header for an attachment. When `inline` is
 * requested and the content type is inline-safe, the disposition is `inline`;
 * otherwise a download `attachment` disposition is returned regardless of the
 * requested mode.
 */
export function inlineAttachmentDisposition(
  inline: boolean,
  contentType: string,
  filename: string
): string {
  if (inline && isInlineSafeContentType(contentType)) return 'inline'
  return attachmentContentDisposition(filename)
}

/**
 * Shared security headers for attachment responses. `nosniff` prevents the
 * browser from sniffing a content type that differs from the declared one,
 * which is essential when serving inline attachments from the app origin.
 */
export const ATTACHMENT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff'
} as const
