export type KeyContext = 'list' | 'message' | 'composer' | 'none'
export type KeyPanel = 'mailboxes' | 'list'

export const keyboard = $state({
  context: 'none' as KeyContext,
  focusedIndex: 0,           // focused row in the message list
  panel: 'list' as KeyPanel, // which visual panel has keyboard focus
  focusedMailboxIndex: 0,    // focused row in the mailbox sidebar
  mailboxCount: 0,           // total mailboxes (set by sidebar)
  onMailboxSelect: null as (() => void) | null
})

type Handler = () => void
type HandlerMap = Record<string, Handler>

// Stack of handler maps — topmost is active; teardown pops back to previous
const handlerStack: HandlerMap[] = []
let handlers: HandlerMap = {}

let chordPending = false
let chordTimer: ReturnType<typeof setTimeout> | null = null

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable ||
    el.closest('[contenteditable="true"]') !== null ||
    el.closest('.ProseMirror') !== null
  )
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableTarget(e.target)) return

  // Composer context: only allow Escape
  if (keyboard.context === 'composer') {
    if (e.key === 'Escape') handlers['Escape']?.()
    return
  }

  // ── Panel switching with ArrowLeft / ArrowRight ──────────────────────────
  if (e.key === 'ArrowLeft') {
    if (keyboard.panel === 'list') {
      keyboard.panel = 'mailboxes'
      e.preventDefault()
      return
    }
    return
  }

  if (e.key === 'ArrowRight') {
    if (keyboard.panel === 'mailboxes') {
      keyboard.panel = 'list'
      e.preventDefault()
      return
    }
    if (keyboard.panel === 'list') {
      handlers['Enter']?.()
      e.preventDefault()
      return
    }
    return
  }

  // ── Mailboxes panel: Up/Down navigate items, Enter selects ───────────────
  if (keyboard.panel === 'mailboxes') {
    if (e.key === 'ArrowUp') {
      keyboard.focusedMailboxIndex = Math.max(0, keyboard.focusedMailboxIndex - 1)
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown') {
      keyboard.focusedMailboxIndex = Math.min(
        keyboard.mailboxCount - 1,
        keyboard.focusedMailboxIndex + 1
      )
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      keyboard.onMailboxSelect?.()
      e.preventDefault()
      return
    }
    // Swallow all other keys while mailboxes panel is focused
    return
  }

  // ── Chord: * then a/n ────────────────────────────────────────────────────
  if (chordPending) {
    clearTimeout(chordTimer!)
    chordPending = false
    const chord = `*${e.key}`
    if (handlers[chord]) {
      e.preventDefault()
      handlers[chord]()
      return
    }
  }

  if (e.key === '*') {
    chordPending = true
    chordTimer = setTimeout(() => {
      chordPending = false
    }, 1000)
    return
  }

  const handler = handlers[e.key]
  if (handler) {
    e.preventDefault()
    handler()
  }
}

let listenerAttached = false

function ensureListener() {
  if (listenerAttached) return
  document.addEventListener('keydown', handleKeyDown)
  listenerAttached = true
}

/**
 * Register keyboard handlers for the current page context.
 * Stacks on top of any previously registered handlers.
 * Returns a teardown function — call it in onMount's return.
 * On teardown the previous handler map is automatically restored.
 */
export function setupKeyboardHandler(newHandlers: HandlerMap): () => void {
  ensureListener()
  handlerStack.push(newHandlers)
  handlers = newHandlers
  return () => {
    const idx = handlerStack.lastIndexOf(newHandlers)
    if (idx >= 0) handlerStack.splice(idx, 1)
    handlers = handlerStack[handlerStack.length - 1] ?? {}
  }
}

