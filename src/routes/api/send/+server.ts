import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { parseComposerAttachments } from '$lib/mail-attachments'
import { appendPublicAttachmentLinks } from '$lib/public-attachments'
import { normalizeRecipientList, validateRecipientFields } from '$lib/recipients'
import { getSmtpConfig, getSmtpConfigs, getUndoSendSeconds } from '$lib/server/config'
import { isDemoModeEnabled, sendDemoMessage } from '$lib/server/demo'
import { scheduleSmtpSend } from '$lib/server/smtp-operations'
import type { OpenPgpSigningMethod } from '$lib/server/openpgp-message'
import {
  discoverEncryptionKeyCandidates,
  getEncryptionKeysForAddresses,
  getOpenPgpKeyForAddress
} from '$lib/server/openpgp-keys'
import { outgoingSenderAddress } from '$lib/server/outgoing-message'
import { parseAddressFields } from '$lib/server/contacts'
import {
  commitPublicAttachments,
  deletePublicAttachments,
  storePublicAttachments,
  uncommitPublicAttachments
} from '$lib/server/public-attachments'

const OPENPGP_SIGNING_METHODS = new Set<OpenPgpSigningMethod>([
  'none',
  'cleartext',
  'detached',
  'pgp-mime'
])

function sendValidationError(message: string, details?: unknown) {
  return json({ error: { code: 'SEND_VALIDATION_ERROR', message, details } }, { status: 400 })
}

export const POST: RequestHandler = async ({ request, url }) => {
  const {
    to,
    cc,
    bcc,
    subject,
    html,
    inReplyTo,
    smtpServerId,
    fromName,
    sendAt,
    attachments: rawAttachments,
    openPgpSigning,
    openPgpEncrypt,
    attachPublicKey
  } = await request.json()
  if (!subject) {
    return sendValidationError('Missing required fields: subject')
  }

  const recipientValidation = validateRecipientFields({ to, cc, bcc })
  if (recipientValidation.errors.length > 0) {
    return sendValidationError(
      recipientValidation.errors.map((issue) => issue.message).join('\n'),
      recipientValidation.errors
    )
  }

  const normalizedTo = normalizeRecipientList(to)
  const normalizedCc = normalizeRecipientList(cc)
  const normalizedBcc = normalizeRecipientList(bcc)

  const parsedAttachments = parseComposerAttachments(rawAttachments)
  if (!parsedAttachments.ok) {
    return error(400, parsedAttachments.error)
  }
  const signingMethod: OpenPgpSigningMethod = OPENPGP_SIGNING_METHODS.has(openPgpSigning)
    ? openPgpSigning
    : 'none'
  const useOpenPgp = signingMethod !== 'none' || openPgpEncrypt === true || attachPublicKey === true
  const inlineAttachments = parsedAttachments.attachments.filter(
    (attachment) => attachment.deliveryMode === 'mail'
  )
  const linkedAttachments = parsedAttachments.attachments.filter(
    (attachment) => attachment.deliveryMode === 'public'
  )

  if (isDemoModeEnabled()) {
    if (useOpenPgp) return error(400, 'OpenPGP is unavailable in demo mode')
  }

  const selectedSmtpServerId = typeof smtpServerId === 'string' ? smtpServerId.trim() || null : null
  if (useOpenPgp) {
    const smtpConfig = selectedSmtpServerId
      ? (await getSmtpConfigs()).find((config) => config.id === selectedSmtpServerId)
      : await getSmtpConfig()
    if (!smtpConfig || 'missing' in smtpConfig) {
      return sendValidationError('The selected SMTP sender is unavailable')
    }
    const senderAddress = outgoingSenderAddress(smtpConfig.from)
    if (!(await getOpenPgpKeyForAddress(senderAddress))) {
      return sendValidationError(`No OpenPGP private key matches ${senderAddress}`)
    }
    if (openPgpEncrypt === true) {
      const recipientEmails = parseAddressFields([normalizedTo, normalizedCc, normalizedBcc]).map(
        (recipient) => recipient.email
      )
      const encryption = await getEncryptionKeysForAddresses(recipientEmails)
      if (encryption.missing.length > 0) {
        const candidates = await discoverEncryptionKeyCandidates(encryption.missing)
        return json(
          {
            error: `Missing confirmed OpenPGP public keys for ${encryption.missing.join(', ')}`,
            keyConfirmations: candidates
          },
          { status: 409 }
        )
      }
    }
  }

  const hasExplicitSendAt = typeof sendAt === 'string' && sendAt.length > 0
  const undoSendSeconds = hasExplicitSendAt ? 0 : await getUndoSendSeconds()
  const availableAt = hasExplicitSendAt
    ? new Date(sendAt)
    : new Date(Date.now() + undoSendSeconds * 1000)
  if (Number.isNaN(availableAt.getTime())) {
    return error(400, 'Invalid sendAt value')
  }

  const publicAttachments = await storePublicAttachments(linkedAttachments)
  const newlyStoredPublicAttachmentTokens = publicAttachments
    .filter((_attachment, index) => !linkedAttachments[index].token)
    .map((attachment) => attachment.token)
  const deliveryHtml = appendPublicAttachmentLinks(html, url.origin, publicAttachments)
  const publicAttachmentTokens = publicAttachments.map((attachment) => attachment.token)
  const newlyCommittedPublicAttachmentTokens = await commitPublicAttachments(publicAttachmentTokens)

  if (isDemoModeEnabled()) {
    try {
      await sendDemoMessage({
        to: normalizedTo,
        cc: normalizedCc,
        bcc: normalizedBcc,
        subject,
        html: deliveryHtml ?? undefined,
        inReplyTo,
        fromName: typeof fromName === 'string' ? fromName.trim() : null,
        attachments: inlineAttachments
      })
    } catch (sendError) {
      await uncommitPublicAttachments(newlyCommittedPublicAttachmentTokens)
      await deletePublicAttachments(newlyStoredPublicAttachmentTokens)
      throw sendError
    }
    return json({
      success: true,
      demo: true,
      publicAttachmentCount: publicAttachments.length
    })
  }

  let jobId: number | null
  try {
    jobId = await scheduleSmtpSend(
      {
        to: normalizedTo,
        cc: normalizedCc || null,
        bcc: normalizedBcc || null,
        subject,
        html: deliveryHtml,
        inReplyTo: inReplyTo || null,
        smtpServerId: selectedSmtpServerId,
        fromName: typeof fromName === 'string' ? fromName.trim() || null : null,
        attachments: inlineAttachments,
        openPgpSigning: signingMethod,
        openPgpEncrypt: openPgpEncrypt === true,
        attachPublicKey: attachPublicKey === true
      },
      availableAt
    )
  } catch (sendError) {
    await uncommitPublicAttachments(newlyCommittedPublicAttachmentTokens)
    await deletePublicAttachments(newlyStoredPublicAttachmentTokens)
    throw sendError
  }

  return json({
    success: true,
    accepted: true,
    jobId,
    sendAt: availableAt.toISOString(),
    undoable: undoSendSeconds > 0,
    undoSendSeconds,
    publicAttachmentCount: publicAttachments.length
  })
}
