type ComposerAttachmentMetadata = {
  name: string
  contentType: string
  size: number
}

export type ComposerAttachment = ComposerAttachmentMetadata &
  (
    | { deliveryMode: 'mail'; contentBase64: string; token?: never }
    | { deliveryMode: 'public'; contentBase64?: string; token?: string }
  )

export type AttachmentDeliveryMode = 'mail' | 'public'

export type AttachmentSafetyInput = {
  filename?: string | null
  contentType?: string | null
  size?: number | null
}

export type AttachmentSafetyLevel = 'low' | 'medium' | 'high'

export type AttachmentSafetyScore = {
  level: AttachmentSafetyLevel
  label: string
  reasons: string[]
}

export const MAX_ATTACHMENT_COUNT = 10
const LEGACY_PUBLIC_LINK_THRESHOLD_BYTES = 5 * 1024 * 1024

const HIGH_RISK_EXTENSIONS = new Set([
  'app',
  'bat',
  'cmd',
  'com',
  'cpl',
  'exe',
  'hta',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'pif',
  'ps1',
  'psm1',
  'reg',
  'scr',
  'vbe',
  'vbs',
  'wsf'
])

const MACRO_OFFICE_EXTENSIONS = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'pptm', 'potm', 'ppam'])
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'iso', 'rar', 'tar', 'zip'])
const COMMON_DECOY_EXTENSIONS = new Set([
  'doc',
  'docx',
  'gif',
  'jpeg',
  'jpg',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'txt',
  'xls',
  'xlsx'
])

const EXTENSION_MIME_PREFIXES: Record<string, string[]> = {
  gif: ['image/gif'],
  jpeg: ['image/jpeg'],
  jpg: ['image/jpeg'],
  pdf: ['application/pdf'],
  png: ['image/png'],
  svg: ['image/svg+xml'],
  txt: ['text/'],
  webp: ['image/webp']
}

export type ComposerAttachmentSummary = Omit<ComposerAttachment, 'contentBase64'>

function filenameParts(filename: string): string[] {
  return filename
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

function addReason(reasons: string[], reason: string) {
  reasons.push(reason)
}

export function scoreAttachmentSafety(attachment: AttachmentSafetyInput): AttachmentSafetyScore {
  const filename = attachment.filename?.trim() ?? ''
  const contentType = attachment.contentType?.trim().toLowerCase() ?? ''
  const parts = filenameParts(filename)
  const extension = parts.at(-1) ?? ''
  const previousExtension = parts.at(-2) ?? ''
  const reasons: string[] = []
  let severity = 0

  if (HIGH_RISK_EXTENSIONS.has(extension)) {
    severity = Math.max(severity, 2)
    addReason(reasons, 'Executable or script-like file extension')
  } else if (MACRO_OFFICE_EXTENSIONS.has(extension)) {
    severity = Math.max(severity, 2)
    addReason(reasons, 'Macro-enabled Office document')
  } else if (ARCHIVE_EXTENSIONS.has(extension)) {
    severity = Math.max(severity, 1)
    addReason(reasons, 'Archive files can hide their contents until opened')
  }

  if (parts.length >= 3 && COMMON_DECOY_EXTENSIONS.has(previousExtension)) {
    severity = Math.max(severity, HIGH_RISK_EXTENSIONS.has(extension) ? 2 : 1)
    addReason(reasons, 'Filename uses a double extension')
  }

  if (/\p{C}/u.test(filename)) {
    severity = Math.max(severity, 2)
    addReason(reasons, 'Filename contains hidden control characters')
  }

  if (!extension && contentType === 'application/octet-stream') {
    severity = Math.max(severity, 1)
    addReason(reasons, 'File type is not identified')
  }

  const expectedMimePrefixes = EXTENSION_MIME_PREFIXES[extension]
  if (
    expectedMimePrefixes &&
    contentType &&
    !expectedMimePrefixes.some((prefix) => contentType.startsWith(prefix))
  ) {
    severity = Math.max(severity, 1)
    addReason(reasons, 'Filename extension and MIME type do not match')
  }

  if (typeof attachment.size === 'number') {
    if (attachment.size === 0) {
      severity = Math.max(severity, 1)
      addReason(reasons, 'Attachment is empty')
    } else if (
      attachment.size > 25 * 1024 * 1024 &&
      (HIGH_RISK_EXTENSIONS.has(extension) || MACRO_OFFICE_EXTENSIONS.has(extension))
    ) {
      severity = Math.max(severity, 2)
      addReason(reasons, 'Unusually large executable or macro-enabled attachment')
    }
  }

  if (severity >= 2) return { level: 'high', label: 'High-risk attachment', reasons }
  if (severity === 1) return { level: 'medium', label: 'Review attachment', reasons }
  return { level: 'low', label: 'No attachment warning', reasons }
}

export function attachmentSignature(attachments: ComposerAttachment[]): string {
  return attachments
    .map((attachment) =>
      [
        attachment.name,
        attachment.contentType,
        String(attachment.size),
        attachment.contentBase64 ?? attachment.token ?? '',
        attachment.deliveryMode
      ].join(':')
    )
    .join('|')
}

export function summarizeAttachments(
  attachments: ComposerAttachment[]
): ComposerAttachmentSummary[] {
  return attachments.map(({ name, contentType, size, deliveryMode }) => ({
    name,
    contentType,
    size,
    deliveryMode
  }))
}

function getDecodedBase64Size(contentBase64: string): number {
  const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
  return (contentBase64.length / 4) * 3 - padding
}

function isValidBase64(contentBase64: string) {
  if (contentBase64.length % 4 !== 0) return false
  const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
  const contentLength = contentBase64.length - padding

  for (let index = 0; index < contentLength; index += 1) {
    const code = contentBase64.charCodeAt(index)
    const valid =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47
    if (!valid) return false
  }
  return true
}

export function parseComposerAttachments(
  input: unknown
): { ok: true; attachments: ComposerAttachment[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, attachments: [] }
  if (!Array.isArray(input)) return { ok: false, error: 'Attachments must be an array' }
  if (input.length > MAX_ATTACHMENT_COUNT) {
    return { ok: false, error: `Too many attachments (max ${MAX_ATTACHMENT_COUNT})` }
  }

  const attachments: ComposerAttachment[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Each attachment must be an object' }
    }

    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const size = record.size
    const sizeNumber = typeof size === 'number' ? size : Number.NaN
    const contentBase64 =
      typeof record.contentBase64 === 'string' ? record.contentBase64.replace(/\s+/g, '') : ''
    const token = typeof record.token === 'string' ? record.token.trim() : ''
    const contentType =
      typeof record.contentType === 'string' && record.contentType.trim()
        ? record.contentType.trim()
        : 'application/octet-stream'
    if (!name) return { ok: false, error: 'Attachment name is required' }
    if (!Number.isInteger(sizeNumber) || sizeNumber < 0) {
      return { ok: false, error: `Invalid size for attachment ${name}` }
    }
    let deliveryMode: AttachmentDeliveryMode
    if (record.deliveryMode == null) {
      deliveryMode = sizeNumber > LEGACY_PUBLIC_LINK_THRESHOLD_BYTES ? 'public' : 'mail'
    } else if (record.deliveryMode === 'mail' || record.deliveryMode === 'public') {
      deliveryMode = record.deliveryMode
    } else {
      return { ok: false, error: `Invalid delivery mode for attachment ${name}` }
    }
    if (deliveryMode === 'public' && token) {
      attachments.push({ name, contentType, size: sizeNumber, token, deliveryMode })
      continue
    }
    if (!contentBase64) {
      return { ok: false, error: `Attachment content is required for ${name}` }
    }
    if (!isValidBase64(contentBase64)) {
      return { ok: false, error: `Attachment content is not valid base64 for ${name}` }
    }
    if (getDecodedBase64Size(contentBase64) !== sizeNumber) {
      return { ok: false, error: `Attachment size mismatch for ${name}` }
    }
    attachments.push({
      name,
      contentType,
      size: sizeNumber,
      contentBase64,
      deliveryMode
    })
  }

  return { ok: true, attachments }
}
