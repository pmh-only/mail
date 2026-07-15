import nodemailer from 'nodemailer'
import type { ComposerAttachment } from '$lib/mail-attachments'

type DraftMessage = {
  id: number
  updatedAt: Date
  toAddr: string
  cc: string
  bcc: string
  subject: string
  html: string
  inReplyTo: string | null
}

function draftIdentityHeaders(id: number, updatedAt: Date) {
  return {
    'X-Pmail-Draft-ID': String(id),
    'X-Pmail-Draft-Version': updatedAt.toISOString()
  }
}

export async function buildDraftMessage(
  draft: DraftMessage,
  from: string,
  attachments: ComposerAttachment[]
) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix'
  })
  const info = await transport.sendMail({
    from,
    to: draft.toAddr || undefined,
    cc: draft.cc || undefined,
    bcc: draft.bcc || undefined,
    subject: draft.subject,
    html: draft.html || undefined,
    inReplyTo: draft.inReplyTo || undefined,
    headers: draftIdentityHeaders(draft.id, draft.updatedAt),
    attachments: attachments.map((attachment) => ({
      filename: attachment.name,
      contentType: attachment.contentType,
      content: Buffer.from(attachment.contentBase64, 'base64')
    }))
  })
  if (!Buffer.isBuffer(info.message)) throw new Error('Failed to build buffered draft message')
  return info.message
}
