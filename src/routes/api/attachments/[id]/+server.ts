import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { getDemoAttachment, isDemoModeEnabled } from '$lib/server/demo'

export const GET: RequestHandler = async ({ params, url }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return error(400, 'Invalid attachment ID')

  if (isDemoModeEnabled()) {
    const attachment = getDemoAttachment(id)
    if (!attachment) return error(404, 'Attachment not found')

    const inline = url.searchParams.get('inline') === '1'
    const disposition = inline
      ? 'inline'
      : `attachment; filename="${encodeURIComponent(attachment.filename)}"`

    const body = attachment.content.buffer.slice(
      attachment.content.byteOffset,
      attachment.content.byteOffset + attachment.content.byteLength
    )

    return new Response(body as ArrayBuffer, {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Disposition': disposition,
        'Content-Length': String(attachment.size),
        'Cache-Control': 'private, max-age=3600'
      }
    })
  }

  const [attachment] = await db
    .select()
    .from(mailAttachment)
    .where(eq(mailAttachment.id, id))
    .limit(1)

  if (!attachment) return error(404, 'Attachment not found')

  const inline = url.searchParams.get('inline') === '1'
  const disposition = inline
    ? 'inline'
    : `attachment; filename="${encodeURIComponent(attachment.filename)}"`

  const body =
    attachment.content instanceof Buffer
      ? attachment.content.buffer.slice(
          attachment.content.byteOffset,
          attachment.content.byteOffset + attachment.content.byteLength
        )
      : attachment.content

  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': disposition,
      'Content-Length': String(attachment.size),
      'Cache-Control': 'private, max-age=3600'
    }
  })
}
