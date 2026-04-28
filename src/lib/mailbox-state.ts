export const MAILBOX_STATE_CHANGED_EVENT = 'pmail:mailbox-state-changed'

export function notifyMailboxStateChanged(reason: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MAILBOX_STATE_CHANGED_EVENT, { detail: { reason } }))
}
