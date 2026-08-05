import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ComposerAttachment } from '$lib/mail-attachments'
import type { PublicAttachmentLink } from '$lib/public-attachments'
import { db } from './db'
import { publicAttachment } from './db/schema'
import {
  commitDemoPublicAttachments,
  deleteDemoPublicAttachments,
  getDemoPublicAttachment,
  isDemoModeEnabled,
  registerDemoPublicAttachment,
  uncommitDemoPublicAttachments
} from './demo'
import {
  assertPublicAttachmentFile,
  deletePublicAttachmentFile,
  writePublicAttachmentFile
} from './public-attachment-files'
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'

const PUBLIC_ATTACHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PUBLIC_ATTACHMENT_TOTAL_BYTES =
  Number(process.env.PUBLIC_ATTACHMENT_TOTAL_BYTES) || 2 * 1024 ** 3

type PublicAttachmentMetadata = {
  filename: string
  contentType: string
  size: number
}

export async function registerPublicAttachment(
  token: string,
  attachment: PublicAttachmentMetadata
) {
  if (isDemoModeEnabled()) {
    registerDemoPublicAttachment(token, attachment)
    return
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('public_attachment_quota'))`)
    const [usage] = await tx
      .select({ bytes: sql<number>`coalesce(sum(${publicAttachment.size}), 0)` })
      .from(publicAttachment)
      .where(and(isNull(publicAttachment.revokedAt), gt(publicAttachment.expiresAt, new Date())))
    if (Number(usage?.bytes ?? 0) + attachment.size > PUBLIC_ATTACHMENT_TOTAL_BYTES) {
      throw new Error('Public attachment storage quota exceeded')
    }
    await tx.insert(publicAttachment).values({
      token,
      ...attachment,
      content: null,
      expiresAt: new Date(Date.now() + PUBLIC_ATTACHMENT_TTL_MS)
    })
  })
}

async function getPublicAttachmentMetadata(token: string) {
  if (isDemoModeEnabled()) return getDemoPublicAttachment(token)
  return (
    await db
      .select()
      .from(publicAttachment)
      .where(
        and(
          eq(publicAttachment.token, token),
          gt(publicAttachment.expiresAt, new Date()),
          isNull(publicAttachment.revokedAt)
        )
      )
      .limit(1)
  )[0]
}

async function storeLegacyPublicAttachment(
  attachment: Extract<ComposerAttachment, { deliveryMode: 'public' }>
) {
  if (!attachment.contentBase64) throw new Error('Public attachment content is missing')
  const token = randomUUID()
  const metadata = {
    filename: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size
  }
  const content = Buffer.from(attachment.contentBase64, 'base64')

  try {
    await registerPublicAttachment(token, metadata)
    await writePublicAttachmentFile(token, Readable.toWeb(Readable.from(content)), content.length)
  } catch (error) {
    await deletePublicAttachmentFile(token)
    throw error
  }
  return token
}

export async function storePublicAttachments(
  attachments: Extract<ComposerAttachment, { deliveryMode: 'public' }>[]
): Promise<PublicAttachmentLink[]> {
  const links: PublicAttachmentLink[] = []
  const createdTokens: string[] = []
  try {
    for (const attachment of attachments) {
      const token = attachment.token ?? (await storeLegacyPublicAttachment(attachment))
      createdTokens.push(...(attachment.token ? [] : [token]))
      const stored = await getPublicAttachmentMetadata(token)
      if (
        !stored ||
        stored.filename !== attachment.name ||
        stored.contentType !== attachment.contentType ||
        stored.size !== attachment.size
      ) {
        throw new Error(`Uploaded public attachment is unavailable: ${attachment.name}`)
      }
      if (!stored.content) await assertPublicAttachmentFile(token, attachment.size)
      links.push({
        token,
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size
      })
    }
    return links
  } catch (error) {
    await deletePublicAttachments(createdTokens)
    throw error
  }
}

export async function commitPublicAttachments(tokens: string[]) {
  if (tokens.length === 0) return []
  if (isDemoModeEnabled()) {
    return commitDemoPublicAttachments(tokens)
  }
  return (
    await db
      .update(publicAttachment)
      .set({ committedAt: new Date() })
      .where(and(inArray(publicAttachment.token, tokens), isNull(publicAttachment.committedAt)))
      .returning({ token: publicAttachment.token })
  ).map((attachment) => attachment.token)
}

export async function uncommitPublicAttachments(tokens: string[]) {
  if (tokens.length === 0) return
  if (isDemoModeEnabled()) {
    uncommitDemoPublicAttachments(tokens)
    return
  }
  await db
    .update(publicAttachment)
    .set({ committedAt: null })
    .where(inArray(publicAttachment.token, tokens))
}

export async function deletePublicAttachments(tokens: string[]) {
  if (tokens.length === 0) return
  const deletedTokens = isDemoModeEnabled()
    ? deleteDemoPublicAttachments(tokens)
    : (
        await db
          .delete(publicAttachment)
          .where(and(inArray(publicAttachment.token, tokens), isNull(publicAttachment.committedAt)))
          .returning({ token: publicAttachment.token })
      ).map((attachment) => attachment.token)
  await Promise.all(deletedTokens.map(deletePublicAttachmentFile))
}

export async function cleanupStalePublicAttachments() {
  if (isDemoModeEnabled()) return 0
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await db
    .delete(publicAttachment)
    .where(and(isNull(publicAttachment.committedAt), lt(publicAttachment.createdAt, cutoff)))
    .returning({ token: publicAttachment.token })
  await Promise.all(rows.map(({ token }) => deletePublicAttachmentFile(token)))
  return rows.length
}
