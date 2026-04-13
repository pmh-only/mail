export type ComposerAttachment = {
  name: string
  contentType: string
  size: number
  contentBase64: string
}

export const MAX_ATTACHMENT_COUNT = 10
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export type ComposerAttachmentSummary = Omit<ComposerAttachment, 'contentBase64'>

export function attachmentSignature(attachments: ComposerAttachment[]): string {
  return attachments
    .map((attachment) =>
      [
        attachment.name,
        attachment.contentType,
        String(attachment.size),
        attachment.contentBase64
      ].join(':')
    )
    .join('|')
}

export function summarizeAttachments(
  attachments: ComposerAttachment[]
): ComposerAttachmentSummary[] {
  return attachments.map(({ name, contentType, size }) => ({ name, contentType, size }))
}

function getDecodedBase64Size(contentBase64: string): number {
  const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
  return (contentBase64.length / 4) * 3 - padding
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
  let totalSize = 0

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
    const contentType =
      typeof record.contentType === 'string' && record.contentType.trim()
        ? record.contentType.trim()
        : 'application/octet-stream'

    if (!name) return { ok: false, error: 'Attachment name is required' }
    if (!Number.isInteger(sizeNumber) || sizeNumber < 0) {
      return { ok: false, error: `Invalid size for attachment ${name}` }
    }
    if (!contentBase64) {
      return { ok: false, error: `Attachment content is required for ${name}` }
    }
    if (contentBase64.length % 4 !== 0 || !BASE64_PATTERN.test(contentBase64)) {
      return { ok: false, error: `Attachment content is not valid base64 for ${name}` }
    }
    if (getDecodedBase64Size(contentBase64) !== sizeNumber) {
      return { ok: false, error: `Attachment size mismatch for ${name}` }
    }
    if (sizeNumber > MAX_ATTACHMENT_SIZE_BYTES) {
      return {
        ok: false,
        error: `Attachment ${name} exceeds the ${MAX_ATTACHMENT_SIZE_BYTES} byte limit`
      }
    }

    totalSize += sizeNumber
    if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      return {
        ok: false,
        error: `Total attachment size exceeds ${MAX_TOTAL_ATTACHMENT_SIZE_BYTES} bytes`
      }
    }

    attachments.push({
      name,
      contentType,
      size: sizeNumber,
      contentBase64
    })
  }

  return { ok: true, attachments }
}
