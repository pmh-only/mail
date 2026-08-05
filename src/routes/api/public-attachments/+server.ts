import { randomUUID } from 'node:crypto'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  deletePublicAttachmentFile,
  MAX_PUBLIC_ATTACHMENT_SIZE,
  writePublicAttachmentFile
} from '$lib/server/public-attachment-files'
import { deletePublicAttachments, registerPublicAttachment } from '$lib/server/public-attachments'

function decodedFilename(value: string | null) {
  if (!value) return ''
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return ''
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const filename = decodedFilename(request.headers.get('x-attachment-name'))
  const size = Number(request.headers.get('x-attachment-size'))
  const contentType = request.headers.get('content-type')?.trim() || 'application/octet-stream'

  if (!filename || filename.length > 1024) return error(400, 'Invalid attachment filename')
  if (!Number.isInteger(size) || size < 0 || size > MAX_PUBLIC_ATTACHMENT_SIZE) {
    return error(413, `Public attachments must be at most ${MAX_PUBLIC_ATTACHMENT_SIZE} bytes`)
  }
  if (!request.body) return error(400, 'Attachment content is required')

  const token = randomUUID()
  try {
    await registerPublicAttachment(token, { filename, contentType, size })
    await writePublicAttachmentFile(token, request.body, size)
  } catch (uploadError) {
    await deletePublicAttachments([token])
    await deletePublicAttachmentFile(token)
    const message = uploadError instanceof Error ? uploadError.message : 'Attachment upload failed'
    if (message.includes('declared') || message.includes('declaration')) return error(400, message)
    throw uploadError
  }

  return json({ token, name: filename, contentType, size }, { status: 201 })
}
