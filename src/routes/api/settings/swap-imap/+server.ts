import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import {
  mailConfig,
  mailboxCatalog,
  mailboxSync,
  mailMessageMailbox,
  mailThreadSummary,
  mailThreadMetadata,
  mailboxNotificationSetting
} from '$lib/server/db/schema'
import { eq, or, ilike, and, not } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '$lib/server/secrets'
import { invalidateConfigCache, normalizeImapServers, normalizeSmtpServers } from '$lib/server/config'
import type { ImapConfig, SmtpConfig } from '$lib/server/config'
import { invalidateAuth } from '$lib/server/auth'

function parseServerArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
    )
  }
  return []
}

export const POST: RequestHandler = async ({ request }) => {
  const { secondaryId } = await request.json().catch(() => ({}))
  if (!secondaryId) {
    return error(400, 'secondaryId is required')
  }

  const [existingConfig] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  if (!existingConfig) {
    return error(404, 'Configuration not found')
  }

  const activeImapServers = normalizeImapServers(existingConfig)
  const activeSmtpServers = normalizeSmtpServers(existingConfig)

  const secondaryImapServers = activeImapServers.filter((s: ImapConfig) => s.id !== 'primary')
  const secondarySmtpServers = activeSmtpServers.filter((s: SmtpConfig) => s.id !== 'primary')

  const targetImapIndex = secondaryImapServers.findIndex((s: ImapConfig) => s.id === secondaryId)
  if (targetImapIndex === -1) {
    return error(404, `Secondary IMAP server with ID ${secondaryId} not found`)
  }

  const targetImap = secondaryImapServers[targetImapIndex]
  const targetImapName = targetImap.name as string

  const targetSmtp = secondarySmtpServers.find(
    (s: SmtpConfig) => s.user === targetImap.user || s.host === targetImap.host
  ) || null

  // Passwords exchange
  let decryptedPrimaryImapPass = ''
  if (existingConfig.imapPassword) {
    try {
      decryptedPrimaryImapPass = decryptSecret(existingConfig.imapPassword)
    } catch (e) {
      console.error('[swap-imap] Decrypting primary IMAP pass failed:', e)
    }
  }

  let decryptedSecondaryImapPass = ''
  if (targetImap.password) {
    try {
      decryptedSecondaryImapPass = decryptSecret(targetImap.password as string)
    } catch (e) {
      console.error('[swap-imap] Decrypting secondary IMAP pass failed:', e)
    }
  }

  let decryptedPrimarySmtpPass = ''
  if (existingConfig.smtpPassword) {
    try {
      decryptedPrimarySmtpPass = decryptSecret(existingConfig.smtpPassword)
    } catch (e) {
      console.error('[swap-imap] Decrypting primary SMTP pass failed:', e)
    }
  }

  let decryptedSecondarySmtpPass = ''
  if (targetSmtp && targetSmtp.password) {
    try {
      decryptedSecondarySmtpPass = decryptSecret(targetSmtp.password as string)
    } catch (e) {
      console.error('[swap-imap] Decrypting secondary SMTP pass failed:', e)
    }
  }

  // Build old primary servers representation
  const oldPrimaryImap = {
    id: `server-${Date.now()}-imap`,
    name: 'Legacy Primary IMAP',
    host: existingConfig.imapHost || '',
    port: existingConfig.imapPort || 993,
    secure: existingConfig.imapSecure ?? true,
    user: existingConfig.imapUser || '',
    password: decryptedPrimaryImapPass ? encryptSecret(decryptedPrimaryImapPass) : '',
    mailbox: existingConfig.imapMailbox || 'INBOX',
    pollSeconds: existingConfig.imapPollSeconds || 15,
    source: 'db'
  }

  const oldPrimarySmtp = existingConfig.smtpHost ? {
    id: `server-${Date.now()}-smtp`,
    name: 'Legacy Primary SMTP',
    host: existingConfig.smtpHost || '',
    port: existingConfig.smtpPort || 587,
    secure: existingConfig.smtpSecure ?? false,
    user: existingConfig.smtpUser || '',
    password: decryptedPrimarySmtpPass ? encryptSecret(decryptedPrimarySmtpPass) : '',
    from: existingConfig.smtpFrom || '',
    source: 'db'
  } : null

  // Overwrite arrays
  const dbImapServers = parseServerArray(existingConfig.imapServers)
  const dbSmtpServers = parseServerArray(existingConfig.smtpServers)

  const dbImapIndex = dbImapServers.findIndex((s) => s.id === targetImap.id)
  const nextImapServers = [...dbImapServers]
  if (dbImapIndex !== -1) {
    nextImapServers[dbImapIndex] = oldPrimaryImap
  } else {
    nextImapServers.push(oldPrimaryImap)
  }

  const nextSmtpServers = [...dbSmtpServers]
  if (targetSmtp) {
    const dbSmtpIndex = dbSmtpServers.findIndex((s) => s.id === targetSmtp.id)
    if (dbSmtpIndex !== -1 && oldPrimarySmtp) {
      nextSmtpServers[dbSmtpIndex] = oldPrimarySmtp
    } else if (oldPrimarySmtp) {
      nextSmtpServers.push(oldPrimarySmtp)
    }
  } else if (oldPrimarySmtp) {
    nextSmtpServers.push(oldPrimarySmtp)
  }

  // Update DB config
  const updatePayload: typeof mailConfig.$inferInsert = {
    id: 1,
    imapHost: (targetImap.host as string) || null,
    imapPort: (targetImap.port as number) || null,
    imapSecure: targetImap.secure === true,
    imapUser: (targetImap.user as string) || null,
    imapPassword: decryptedSecondaryImapPass ? encryptSecret(decryptedSecondaryImapPass) : null,
    imapMailbox: (targetImap.mailbox as string) || 'INBOX',
    imapPollSeconds: (targetImap.pollSeconds as number) || 15,
    imapServers: nextImapServers,
    updatedAt: new Date()
  }

  if (targetSmtp) {
    updatePayload.smtpHost = (targetSmtp.host as string) || null
    updatePayload.smtpPort = (targetSmtp.port as number) || null
    updatePayload.smtpSecure = targetSmtp.secure === true
    updatePayload.smtpUser = (targetSmtp.user as string) || null
    updatePayload.smtpPassword = decryptedSecondarySmtpPass ? encryptSecret(decryptedSecondarySmtpPass) : null
    updatePayload.smtpFrom = (targetSmtp.from as string) || null
    updatePayload.smtpServers = nextSmtpServers
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Update config
      await tx.insert(mailConfig).values(updatePayload).onConflictDoUpdate({
        target: mailConfig.id,
        set: updatePayload
      })

      // 2. Data cleanups for both targeted accounts to prevent duplicate sync issues
      const activeSecondaryNames = nextImapServers.map((s) => s.name as string).filter(Boolean)

      // Helper function to build conditions to target only primary mailboxes (no secondary prefix)
      const buildPrimaryExcludeCondition = (field: any) => {
        if (activeSecondaryNames.length === 0) return undefined
        return and(
          ...activeSecondaryNames.flatMap((name) => [
            not(ilike(field, name)),
            not(ilike(field, `${name}/%`))
          ])
        )
      }

      // Purge A: Cleanup target secondary mailboxes (they will be synced as primary without prefixes)
      if (targetImapName) {
        const prefix = `${targetImapName}/`
        const conditions = [
          ilike(mailboxCatalog.path, targetImapName),
          ilike(mailboxCatalog.path, `${prefix}%`)
        ]
        await tx.delete(mailboxCatalog).where(or(...conditions))
        await tx.delete(mailboxSync).where(
          or(ilike(mailboxSync.mailbox, targetImapName), ilike(mailboxSync.mailbox, `${prefix}%`))
        )
        await tx.delete(mailMessageMailbox).where(
          or(ilike(mailMessageMailbox.mailbox, targetImapName), ilike(mailMessageMailbox.mailbox, `${prefix}%`))
        )
        await tx.delete(mailThreadSummary).where(
          or(ilike(mailThreadSummary.mailbox, targetImapName), ilike(mailThreadSummary.mailbox, `${prefix}%`))
        )
        await tx.delete(mailThreadMetadata).where(
          or(ilike(mailThreadMetadata.mailbox, targetImapName), ilike(mailThreadMetadata.mailbox, `${prefix}%`))
        )
        await tx.delete(mailboxNotificationSetting).where(
          or(ilike(mailboxNotificationSetting.mailbox, targetImapName), ilike(mailboxNotificationSetting.mailbox, `${prefix}%`))
        )
      }

      // Purge B: Cleanup legacy primary mailboxes (they will now be synced under secondary prefix)
      const catalogCond = buildPrimaryExcludeCondition(mailboxCatalog.path)
      if (catalogCond) {
        await tx.delete(mailboxCatalog).where(catalogCond)
      } else {
        await tx.delete(mailboxCatalog)
      }

      const syncCond = buildPrimaryExcludeCondition(mailboxSync.mailbox)
      if (syncCond) {
        await tx.delete(mailboxSync).where(syncCond)
      } else {
        await tx.delete(mailboxSync)
      }

      const msgMailboxCond = buildPrimaryExcludeCondition(mailMessageMailbox.mailbox)
      if (msgMailboxCond) {
        await tx.delete(mailMessageMailbox).where(msgMailboxCond)
      } else {
        await tx.delete(mailMessageMailbox)
      }

      const threadSummaryCond = buildPrimaryExcludeCondition(mailThreadSummary.mailbox)
      if (threadSummaryCond) {
        await tx.delete(mailThreadSummary).where(threadSummaryCond)
      } else {
        await tx.delete(mailThreadSummary)
      }

      const threadMetadataCond = buildPrimaryExcludeCondition(mailThreadMetadata.mailbox)
      if (threadMetadataCond) {
        await tx.delete(mailThreadMetadata).where(threadMetadataCond)
      } else {
        await tx.delete(mailThreadMetadata)
      }

      const notificationCond = buildPrimaryExcludeCondition(mailboxNotificationSetting.mailbox)
      if (notificationCond) {
        await tx.delete(mailboxNotificationSetting).where(notificationCond)
      } else {
        await tx.delete(mailboxNotificationSetting)
      }
    })

    invalidateConfigCache()
    invalidateAuth()

    return json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return error(500, `Failed to swap IMAP servers: ${message}`)
  }
}
