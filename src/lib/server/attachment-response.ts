import { attachmentContentDisposition } from '$lib/public-attachments'

/**
 * Content types that are safe to render inline (browser displays them without
 * executing active content). Anything else is forced to a download attachment
 * disposition to prevent stored XSS via crafted attachments (e.g. text/html or
 * image/svg+xml served inline from the app origin).
 */
const INLINE_SAFE_CONTENT_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf'
])

/**
 * Returns true when the content type may be rendered inline. Active content
 * types such as text/html, image/svg+xml and application/xhtml+xml are never
 * considered inline-safe and are always served as downloads.
 */
export function isInlineSafeContentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  return INLINE_SAFE_CONTENT_TYPES.has(normalized)
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
