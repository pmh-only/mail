import type { ComposerAttachment } from '$lib/mail-attachments'

export type ComposerMode = 'compose' | 'reply' | 'reply-all' | 'forward'
export type OpenPgpSigningMethod = 'none' | 'cleartext' | 'detached' | 'pgp-mime'
export type ComposeFields = {
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body?: string
}

export type ComposerMessage = {
  id: number
  messageId?: string
  from: string | null
  to: string | null
  subject: string | null
  htmlContent: string | null
  textContent: string | null
  receivedAt: string | null
}

export type DraftRow = {
  id: number
  toAddr: string
  cc: string
  bcc: string
  subject: string
  html: string
  attachments: ComposerAttachment[]
  inReplyTo: string | null
  smtpServerId?: string | null
  fromName?: string | null
  openPgpSigning?: OpenPgpSigningMethod
  openPgpEncrypt?: boolean
  attachPublicKey?: boolean
  updatedAt: string
}

export type SignatureProfile = {
  id: number
  name: string
  html: string
  isDefault: boolean
}

export type ComposerSmtpServer = {
  id: string
  name: string
  from: string
}

type ComposerState = {
  open: boolean
  minimized: boolean
  fullscreen: boolean
  mode: ComposerMode
  to: string
  cc: string
  bcc: string
  subject: string
  initialHtml: string
  attachments: ComposerAttachment[]
  inReplyTo: string | null
  draftId: number | null
  lastSavedAt: number
  signatureProfiles: SignatureProfile[]
  selectedSignatureId: number | null
  currentSignatureHtml: string
  smtpServers: ComposerSmtpServer[]
  selectedSmtpServerId: string
  fromName: string
  openPgpSigning: OpenPgpSigningMethod
  openPgpEncrypt: boolean
  attachPublicKey: boolean
  openPgpAvailable: boolean
}

export const composer = $state<ComposerState>({
  open: false,
  minimized: false,
  fullscreen: false,
  mode: 'compose' as ComposerMode,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  initialHtml: '',
  attachments: [],
  inReplyTo: null as string | null,
  draftId: null as number | null,
  lastSavedAt: 0,
  signatureProfiles: [],
  selectedSignatureId: null,
  currentSignatureHtml: '',
  smtpServers: [],
  selectedSmtpServerId: '',
  fromName: '',
  openPgpSigning: 'none',
  openPgpEncrypt: false,
  attachPublicKey: false,
  openPgpAvailable: false
})

type ComposerSettings = {
  signatures: SignatureProfile[]
  smtpServers: ComposerSmtpServer[]
}

// Cached composer settings — fetched once from the server, invalidated on settings save
let cachedSettings: ComposerSettings | null = null
let composerInvocation = 0

export function invalidateSignatureCache() {
  cachedSettings = null
}

async function fetchComposerSettings(): Promise<ComposerSettings> {
  if (cachedSettings !== null) return cachedSettings
  try {
    const res = await fetch('/api/settings')
    if (res.ok) {
      const data = await res.json()
      const profiles = Array.isArray(data.signatureProfiles)
        ? (data.signatureProfiles as SignatureProfile[])
        : []
      const legacySignature = (data.signature as string) ?? ''
      const signatures =
        profiles.length > 0
          ? profiles
          : legacySignature
            ? [{ id: 0, name: 'Default', html: legacySignature, isDefault: true }]
            : []
      const smtpServers = Array.isArray(data.smtpServers)
        ? (data.smtpServers as Array<{ id?: unknown; name?: unknown; from?: unknown }>).flatMap(
            (server) => {
              const id = typeof server.id === 'string' ? server.id.trim() : ''
              const name = typeof server.name === 'string' ? server.name.trim() : ''
              const from = typeof server.from === 'string' ? server.from.trim() : ''
              return id && from ? [{ id, name: name || id, from }] : []
            }
          )
        : []
      cachedSettings = { signatures, smtpServers }
    } else {
      cachedSettings = { signatures: [], smtpServers: [] }
    }
  } catch {
    cachedSettings = { signatures: [], smtpServers: [] }
  }
  return cachedSettings
}

function defaultSignature(profiles: SignatureProfile[]) {
  return profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null
}

function plainTextToHtml(value: string) {
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

  return `<p>${escaped.replaceAll(/\r?\n/g, '<br>')}</p>`
}

function extractEmail(addr: string | null): string {
  if (!addr) return ''
  const match = addr.match(/<([^>]+)>/)
  return match ? match[1] : addr.trim()
}

function extractName(addr: string | null): string {
  if (!addr) return ''
  const name = addr.split('<')[0]?.trim()
  return name || addr
}

function formatQuoteDate(date: string | null): string {
  if (!date) return ''
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(date))
}

function buildReplyQuote(msg: ComposerMessage): string {
  const date = formatQuoteDate(msg.receivedAt)
  const name = extractName(msg.from)
  const email = extractEmail(msg.from)
  const label = name && name !== email ? `${name} &lt;${email}&gt;` : `&lt;${email}&gt;`
  const body = msg.htmlContent
    ? msg.htmlContent
    : `<p>${(msg.textContent ?? '').replace(/\n/g, '<br>')}</p>`
  return `<p></p><blockquote data-type="quote"><p>On ${date}, ${label} wrote:</p>${body}</blockquote>`
}

function buildReplyBody(
  msg: ComposerMessage,
  draftHtml: string | undefined,
  signatureHtml: string
): string {
  const body = draftHtml?.trim() ? draftHtml : ''
  const signedBody = `${body}${signatureHtml ? `<p></p>${signatureHtml}` : ''}`
  if (!signedBody) return buildReplyQuote(msg)
  return `${signedBody}${buildReplyQuote(msg).replace(/^<p><\/p>/, '')}`
}

function buildForwardBody(msg: ComposerMessage): string {
  const date = formatQuoteDate(msg.receivedAt)
  const body = msg.htmlContent
    ? msg.htmlContent
    : `<p>${(msg.textContent ?? '').replace(/\n/g, '<br>')}</p>`
  return `<p></p>
<p>---------- Forwarded message ----------</p>
<p><strong>From:</strong> ${msg.from ?? ''}</p>
<p><strong>Date:</strong> ${date}</p>
<p><strong>Subject:</strong> ${msg.subject ?? ''}</p>
<p><strong>To:</strong> ${msg.to ?? ''}</p>
<p></p>
${body}`
}

export async function openCompose(fields: ComposeFields = {}) {
  const invocation = ++composerInvocation
  const { signatures, smtpServers } = await fetchComposerSettings()
  if (invocation !== composerInvocation) return
  const signature = defaultSignature(signatures)
  const body = fields.body ? plainTextToHtml(fields.body) : ''
  composer.mode = 'compose'
  composer.to = fields.to ?? ''
  composer.cc = fields.cc ?? ''
  composer.bcc = fields.bcc ?? ''
  composer.subject = fields.subject ?? ''
  composer.initialHtml = `${body}${signature?.html ? `<p></p>${signature.html}` : ''}`
  composer.attachments = []
  composer.inReplyTo = null
  composer.draftId = null
  composer.lastSavedAt = 0
  composer.signatureProfiles = signatures
  composer.selectedSignatureId = signature?.id ?? null
  composer.currentSignatureHtml = signature?.html ?? ''
  composer.smtpServers = smtpServers
  composer.selectedSmtpServerId = smtpServers[0]?.id ?? ''
  composer.fromName = ''
  composer.openPgpSigning = 'none'
  composer.openPgpEncrypt = false
  composer.attachPublicKey = false
  composer.minimized = false
  composer.fullscreen = false
  composer.open = true
}

export async function openReply(msg: ComposerMessage, draftHtml?: string) {
  const invocation = ++composerInvocation
  const { signatures } = await fetchComposerSettings()
  if (invocation !== composerInvocation) return
  const signature = defaultSignature(signatures)
  composer.mode = 'reply'
  composer.to = msg.from ?? ''
  composer.cc = ''
  composer.bcc = ''
  composer.subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject ?? ''}`
  composer.initialHtml = buildReplyBody(msg, draftHtml, signature?.html ?? '')
  composer.attachments = []
  composer.inReplyTo = msg.messageId ?? null
  composer.draftId = null
  composer.lastSavedAt = 0
  composer.signatureProfiles = signatures
  composer.selectedSignatureId = signature?.id ?? null
  composer.currentSignatureHtml = signature?.html ?? ''
  composer.fromName = ''
  composer.openPgpSigning = 'none'
  composer.openPgpEncrypt = false
  composer.attachPublicKey = false
  composer.minimized = false
  composer.fullscreen = false
  composer.open = true
}

export async function openReplyAll(msg: ComposerMessage, draftHtml?: string) {
  const invocation = ++composerInvocation
  const { signatures } = await fetchComposerSettings()
  if (invocation !== composerInvocation) return
  const signature = defaultSignature(signatures)
  const fromEmail = extractEmail(msg.from)
  const toAddrs = (msg.to ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => extractEmail(a) !== fromEmail)
  composer.mode = 'reply-all'
  composer.to = msg.from ?? ''
  composer.cc = toAddrs.join(', ')
  composer.bcc = ''
  composer.subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject ?? ''}`
  composer.initialHtml = buildReplyBody(msg, draftHtml, signature?.html ?? '')
  composer.attachments = []
  composer.inReplyTo = msg.messageId ?? null
  composer.draftId = null
  composer.lastSavedAt = 0
  composer.signatureProfiles = signatures
  composer.selectedSignatureId = signature?.id ?? null
  composer.currentSignatureHtml = signature?.html ?? ''
  composer.fromName = ''
  composer.openPgpSigning = 'none'
  composer.openPgpEncrypt = false
  composer.attachPublicKey = false
  composer.minimized = false
  composer.fullscreen = false
  composer.open = true
}

export async function openForward(msg: ComposerMessage) {
  const invocation = ++composerInvocation
  const { signatures } = await fetchComposerSettings()
  if (invocation !== composerInvocation) return
  const signature = defaultSignature(signatures)
  composer.mode = 'forward'
  composer.to = ''
  composer.cc = ''
  composer.bcc = ''
  composer.subject = msg.subject?.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject ?? ''}`
  composer.initialHtml = `${signature?.html ? `<p></p>${signature.html}` : ''}${buildForwardBody(msg)}`
  composer.attachments = []
  composer.inReplyTo = null
  composer.draftId = null
  composer.lastSavedAt = 0
  composer.signatureProfiles = signatures
  composer.selectedSignatureId = signature?.id ?? null
  composer.currentSignatureHtml = signature?.html ?? ''
  composer.fromName = ''
  composer.openPgpSigning = 'none'
  composer.openPgpEncrypt = false
  composer.attachPublicKey = false
  composer.minimized = false
  composer.fullscreen = false
  composer.open = true
}

export function openDraft(draft: DraftRow) {
  composerInvocation++
  composer.mode = 'compose'
  composer.to = draft.toAddr
  composer.cc = draft.cc
  composer.bcc = draft.bcc
  composer.subject = draft.subject
  composer.initialHtml = draft.html // signature already embedded in saved html
  composer.attachments = draft.attachments
  composer.inReplyTo = draft.inReplyTo
  composer.draftId = draft.id
  composer.lastSavedAt = Date.parse(draft.updatedAt)
  composer.signatureProfiles = []
  composer.selectedSignatureId = null
  composer.currentSignatureHtml = ''
  composer.selectedSmtpServerId = draft.smtpServerId ?? composer.smtpServers[0]?.id ?? ''
  composer.fromName = draft.fromName ?? ''
  composer.openPgpSigning = draft.openPgpSigning ?? 'none'
  composer.openPgpEncrypt = draft.openPgpEncrypt ?? false
  composer.attachPublicKey = draft.attachPublicKey ?? false
  composer.minimized = false
  composer.fullscreen = false
  composer.open = true
}

export function closeComposer() {
  composerInvocation++
  composer.fullscreen = false
  composer.open = false
  composer.attachments = []
  composer.draftId = null
}
