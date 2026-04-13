import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import nodemailer from 'nodemailer'
import { getSmtpConfig } from '$lib/server/config'
import { parseComposerAttachments } from '$lib/mail-attachments'
import { withRetry } from '$lib/server/retry'

export const POST: RequestHandler = async ({ request }) => {
  const smtpConfig = await getSmtpConfig()
  if ('missing' in smtpConfig) {
    return error(500, `Missing SMTP config: ${smtpConfig.missing.join(', ')}`)
  }

  const {
    to,
    cc,
    bcc,
    subject,
    html,
    inReplyTo,
    attachments: rawAttachments
  } = await request.json()
  if (!to || !subject) {
    return error(400, 'Missing required fields: to, subject')
  }

  const parsedAttachments = parseComposerAttachments(rawAttachments)
  if (!parsedAttachments.ok) {
    return error(400, parsedAttachments.error)
  }

  const attachments = parsedAttachments.attachments.map((attachment) => {
    const content = Buffer.from(attachment.contentBase64, 'base64')
    if (content.byteLength !== attachment.size) {
      throw error(400, `Attachment size mismatch for ${attachment.name}`)
    }

    return {
      filename: attachment.name,
      contentType: attachment.contentType,
      content,
      size: attachment.size
    }
  })

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password
    }
  })

  try {
    await withRetry(
      () =>
        transporter.sendMail({
          from: smtpConfig.from,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          html,
          inReplyTo: inReplyTo || undefined,
          attachments: attachments.length > 0 ? attachments : undefined
        }),
      { label: 'smtp sendMail', maxAttempts: 3, baseDelayMs: 1000 }
    )
    return json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return error(500, `Failed to send: ${message}`)
  }
}
