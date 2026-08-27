export const MAILBOX_PRIVACY_MODES = ['only-text', 'style-included', 'full-featured'] as const
export const SHARE_PRIVACY_MODES = ['only-text', 'style-included'] as const

export type MailboxPrivacyMode = (typeof MAILBOX_PRIVACY_MODES)[number]
export type SharePrivacyMode = (typeof SHARE_PRIVACY_MODES)[number]

export function normalizeMailboxPrivacyMode(
  value: unknown,
  legacyBlockRemoteContent: unknown = true
): MailboxPrivacyMode {
  if (MAILBOX_PRIVACY_MODES.includes(value as MailboxPrivacyMode)) {
    return value as MailboxPrivacyMode
  }
  return legacyBlockRemoteContent === false ? 'full-featured' : 'style-included'
}

export function normalizeSharePrivacyMode(value: unknown): SharePrivacyMode {
  return SHARE_PRIVACY_MODES.includes(value as SharePrivacyMode)
    ? (value as SharePrivacyMode)
    : 'style-included'
}
