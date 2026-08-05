import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { attachmentContentDisposition } from '$lib/public-attachments'
import { db } from '$lib/server/db'
import { publicAttachment } from '$lib/server/db/schema'
import { getDemoPublicAttachment, isDemoModeEnabled } from '$lib/server/demo'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Readable } from 'node:stream'
import { publicAttachmentFile } from '$lib/server/public-attachment-files'

export const GET: RequestHandler = async ({ params }) => {
  const attachment = isDemoModeEnabled()
    ? getDemoPublicAttachment(params.token)
    : (
        await db
          .select()
          .from(publicAttachment)
          .where(
            and(
              eq(publicAttachment.token, params.token),
              gt(publicAttachment.expiresAt, new Date()),
              isNull(publicAttachment.revokedAt)
            )
          )
          .limit(1)
      )[0]

  if (!attachment) return error(404, 'Attachment not found')

  const filename = 'filename' in attachment ? attachment.filename : ''
  let body: BodyInit
  if (attachment.content) {
    body = new Uint8Array(attachment.content)
  } else {
    try {
      const stored = await publicAttachmentFile(params.token, attachment.size)
      body = Readable.toWeb(stored.stream) as ReadableStream<Uint8Array>
    } catch (fileError) {
      const code = (fileError as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return error(404, 'Attachment file not found')
      throw fileError
    }
  }

  return new Response(body, {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': attachmentContentDisposition(filename),
      'Content-Length': String(attachment.size),
      'Cache-Control': 'private, max-age=3600',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}
