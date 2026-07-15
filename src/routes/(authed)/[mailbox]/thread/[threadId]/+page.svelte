<script lang="ts">
  import {
    Archive,
    Trash2,
    ShieldAlert,
    Mail,
    Reply,
    ReplyAll,
    ChevronDown,
    ChevronLeft,
    Paperclip,
    Download,
    FileImage,
    FileText,
    ListChecks,
    Sparkles,
    X,
    Clock,
    Ban,
    Star,
    Pin,
    StickyNote
  } from 'lucide-svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import AttachmentSummary from '$lib/components/AttachmentSummary.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { onMount, tick } from 'svelte'
  import { SvelteDate, SvelteSet } from 'svelte/reactivity'
  import { openReply, openReplyAll } from '$lib/composer.svelte'
  import { setupKeyboardHandler } from '$lib/keyboard.svelte'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'
  import { encodeThreadId } from '$lib/thread-url'
  import {
    normalizeAllowedSenders,
    normalizeSenderAddress,
    prepareRemoteContent
  } from '$lib/remote-content'
  import { scoreAttachmentSafety, type AttachmentSafetyScore } from '$lib/mail-attachments'
  import { toast } from 'svelte-sonner'

  type Message = {
    id: number
    uid: number
    messageId: string
    mailbox: string
    subject: string | null
    from: string | null
    to: string | null
    cc: string | null
    preview: string | null
    htmlContent: string | null
    textContent: string | null
    inReplyTo: string | null
    references: string | null
    flags: string[]
    receivedAt: string | null
    snoozedUntil: string | null
    threadDepth: number
  }

  type Attachment = {
    id: number
    messageId: string
    filename: string
    contentType: string
    size: number
  }

  type ThreadActionItem = {
    title: string
    description: string | null
    owner: string | null
    dueDate: string | null
    priority: 'low' | 'medium' | 'high'
    sourceMessageId: string | null
  }

  type ThreadNote = {
    threadKey: string
    body: string
    createdAt: string
    updatedAt: string
  }

  type Props = {
    data: {
      threadId: string
      mailbox: string
      messages: Message[]
      attachments: Attachment[]
      threadNote: ThreadNote | null
      mailboxRole: 'inbox' | 'archive' | 'trash' | 'spam' | null
      remoteContent: {
        blockRemoteContent: boolean
        allowedSenders: string[]
      }
      metadata: { starred: boolean; pinned: boolean }
    }
  }

  let { data }: Props = $props()

  const messages = $derived(data.messages)
  const attachments = $derived(data.attachments)
  const role = $derived(data.mailboxRole)
  const subject = $derived(messages[0]?.subject ?? '(no subject)')
  const defaultExpandedId = $derived(
    messages.reduce<Message | null>(
      (latest, message) =>
        !latest || (message.receivedAt ?? '') > (latest.receivedAt ?? '') ? message : latest,
      null
    )?.id ?? null
  )

  // Latest message expanded by default
  let expandedIds = $state(new SvelteSet<number>())
  let collapsedDefaultIds = $state(new SvelteSet<number>())
  let initializedThreadId = $state<string | null>(null)
  let acting = $state(false)
  let errorDialogMessage = $state<string | null>(null)
  let actionModal = $state<{
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    inputLabel?: string
    inputValue?: string
    inputType?: string
    resolve: (value: string | boolean | null) => void
  } | null>(null)
  let metadataMessage = $state<Message | null>(null)
  let scrollToLatestPending = $state(false)
  let threadSummary = $state<string | null>(null)
  let summarizingThread = $state(false)
  let threadSummaryAbort = $state<AbortController | null>(null)
  let showRemoteContentIds = $state(new SvelteSet<number>())
  let trustingRemoteSenderId = $state<number | null>(null)
  let allowedRemoteSenders = $state<string[]>([])
  let draftingReplyMessageId = $state<number | null>(null)
  let threadActions = $state<ThreadActionItem[] | null>(null)
  let extractingThreadActions = $state(false)
  let activeAiPanel = $state<'summary' | 'actions' | null>(null)
  let threadMetadata = $state({ starred: false, pinned: false })

  $effect(() => {
    threadMetadata = data.metadata
  })
  let noteDraft = $state('')
  let savedNoteBody = $state('')
  let savedNoteUpdatedAt = $state<string | null>(null)
  let savingNote = $state(false)
  let notesCollapsed = $state(false)

  function gotoMailbox() {
    return goto(resolve(`/${page.params.mailbox}`), { noScroll: true, keepFocus: true })
  }

  function toggleExpanded(message: Message) {
    if (isMessageExpanded(message.id)) {
      expandedIds.delete(message.id)
      collapsedDefaultIds.add(message.id)
    } else {
      collapsedDefaultIds.delete(message.id)
      expandedIds.add(message.id)
      if (!message.flags.includes('\\Seen')) {
        message.flags.push('\\Seen')
        void fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [message.id], action: 'mark_read' })
        }).then(() => notifyMailboxStateChanged('thread-message-opened'))
      }
    }
  }

  function isMessageExpanded(id: number) {
    return expandedIds.has(id) || (id === defaultExpandedId && !collapsedDefaultIds.has(id))
  }

  async function performThreadAction(action: 'archive' | 'trash' | 'spam' | 'inbox') {
    if (acting) return
    acting = true
    try {
      const ids = messages.filter((m) => m.mailbox === data.mailbox).map((m) => m.id)
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, action })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Failed to ${action} thread.`))
        }
      })
      notifyMailboxStateChanged(`thread-action:${action}`)
      toast(`Thread moved to ${action}`)
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, `Failed to ${action} thread.`)
    } finally {
      acting = false
    }
  }

  async function markThreadUnread() {
    if (acting) return
    acting = true
    try {
      const ids = messages.map((m) => m.id)
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, action: 'mark_unread' })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to mark thread unread.'))
        }
      })
      notifyMailboxStateChanged('thread-action:mark-unread')
      toast('Thread marked as unread')
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark thread unread.')
    } finally {
      acting = false
    }
  }

  function defaultSnoozeInputValue() {
    const date = new SvelteDate(Date.now() + 60 * 60 * 1000)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }

  function requestModal(options: Omit<NonNullable<typeof actionModal>, 'resolve'>) {
    return new Promise<string | boolean | null>((resolve) => {
      actionModal = { ...options, resolve }
    })
  }

  function closeActionModal(value: string | boolean | null) {
    actionModal?.resolve(value)
    actionModal = null
  }

  async function promptForSnoozeDate() {
    const value = await requestModal({
      title: 'Snooze thread',
      inputLabel: 'Snooze until',
      inputValue: defaultSnoozeInputValue(),
      inputType: 'datetime-local',
      confirmLabel: 'Snooze'
    })
    if (value === null || typeof value === 'boolean') return null

    const trimmed = value.trim()
    const date = trimmed ? new Date(trimmed) : null
    if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      errorDialogMessage = 'Choose a future date and time to snooze this thread.'
      return null
    }

    return date
  }

  async function snoozeThread() {
    if (acting) return
    const snoozedUntil = await promptForSnoozeDate()
    if (!snoozedUntil) return

    acting = true
    try {
      const ids = messages.filter((m) => m.mailbox === data.mailbox).map((m) => m.id)
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, action: 'snooze', snoozedUntil: snoozedUntil.toISOString() })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to snooze thread.'))
        }
      })
      notifyMailboxStateChanged('thread-action:snooze')
      toast('Thread snoozed')
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to snooze thread.')
    } finally {
      acting = false
    }
  }

  async function blockSender(msg: Message) {
    if (acting || !msg.from) return
    acting = true
    try {
      const response = await fetch('/api/sender-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'block', sender: msg.from })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to block sender.'))
      }

      const ids = messages.filter((m) => m.mailbox === data.mailbox).map((m) => m.id)
      const trashResponse = await fetch('/api/messages/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, action: 'trash' })
      })

      if (!trashResponse.ok) {
        throw new Error(await readErrorMessage(trashResponse, 'Sender blocked, but trash failed.'))
      }

      notifyMailboxStateChanged('thread-action:block-sender')
      toast('Sender blocked and thread moved to trash')
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to block sender.')
    } finally {
      acting = false
    }
  }

  async function toggleThreadMetadata(field: 'starred' | 'pinned') {
    if (acting) return
    const nextValue = !threadMetadata[field]
    threadMetadata = { ...threadMetadata, [field]: nextValue }

    try {
      const response = await fetch(
        resolve(`/api/threads/${encodeThreadId(data.threadId)}/metadata`),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mailbox: page.params.mailbox, [field]: nextValue })
        }
      )

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update thread metadata.'))
      }

      const payload = (await response.json()) as {
        metadata: { starred: boolean; pinned: boolean }
      }
      threadMetadata = payload.metadata
      notifyMailboxStateChanged('thread-metadata')
      toast(
        field === 'starred'
          ? nextValue
            ? 'Thread starred'
            : 'Thread unstarred'
          : nextValue
            ? 'Thread pinned'
            : 'Thread unpinned'
      )
    } catch (error) {
      threadMetadata = { ...threadMetadata, [field]: !nextValue }
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update thread metadata.')
    }
  }

  async function readTextStream(response: Response, onChunk: (chunk: string) => void) {
    if (!response.body) {
      onChunk(await response.text())
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      onChunk(decoder.decode(value, { stream: true }))
    }

    const rest = decoder.decode()
    if (rest) onChunk(rest)
  }

  async function summarizeThread() {
    if (summarizingThread) return

    threadSummaryAbort?.abort()
    threadSummaryAbort = new AbortController()
    summarizingThread = true
    threadSummary = ''
    activeAiPanel = 'summary'

    try {
      const params = new URLSearchParams({
        mailbox: page.params.mailbox ?? 'inbox',
        threadId: data.threadId
      })
      const response = await fetch(`/api/ai/thread-summary?${params.toString()}`, {
        signal: threadSummaryAbort.signal
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to summarize thread.'))
      }

      await readTextStream(response, (chunk) => {
        threadSummary = `${threadSummary ?? ''}${chunk}`
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to summarize thread.')
      threadSummary = null
    } finally {
      summarizingThread = false
      threadSummaryAbort = null
    }
  }

  async function generateReplyDraft(msg: Message, replyAll = false) {
    if (draftingReplyMessageId !== null) return
    draftingReplyMessageId = msg.id

    try {
      const response = await fetch('/api/ai/reply-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mailbox: page.params.mailbox ?? 'inbox',
          threadId: data.threadId,
          messageId: msg.id,
          replyAll
        })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to generate reply draft.'))
      }

      const draft = (await response.json()) as { html?: string }
      if (!draft.html) throw new Error('Reply draft was empty.')

      if (replyAll) {
        openReplyAll(msg, draft.html)
      } else {
        openReply(msg, draft.html)
      }
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to generate reply draft.')
    } finally {
      draftingReplyMessageId = null
    }
  }

  async function extractThreadActions() {
    if (extractingThreadActions) return

    extractingThreadActions = true
    threadActions = null
    activeAiPanel = 'actions'

    try {
      const params = new URLSearchParams({
        mailbox: page.params.mailbox ?? 'inbox',
        threadId: data.threadId
      })
      const response = await fetch(`/api/ai/thread-actions?${params.toString()}`)

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to extract thread actions.'))
      }

      const result = (await response.json()) as { actions?: ThreadActionItem[] }
      threadActions = Array.isArray(result.actions) ? result.actions : []
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to extract thread actions.')
      threadActions = null
    } finally {
      extractingThreadActions = false
    }
  }

  const hasSavedNote = $derived(savedNoteBody.trim().length > 0)
  const noteDirty = $derived(noteDraft.trim() !== savedNoteBody.trim())
  const notesExpanded = $derived(!notesCollapsed || noteDirty)

  function toggleNotesCollapsed() {
    if (noteDirty) return
    notesCollapsed = !notesCollapsed
  }

  async function saveNote() {
    if (savingNote) return
    savingNote = true

    try {
      const response = await fetch(resolve(`/api/threads/${encodeThreadId(data.threadId)}/note`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: noteDraft })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to save thread note.'))
      }

      const payload = (await response.json()) as { note: ThreadNote | null }
      savedNoteBody = payload.note?.body ?? ''
      savedNoteUpdatedAt = payload.note?.updatedAt ?? null
      noteDraft = savedNoteBody
      notifyMailboxStateChanged('thread-note-saved')
      toast(savedNoteBody ? 'Thread note saved' : 'Thread note cleared')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to save thread note.')
    } finally {
      savingNote = false
    }
  }

  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

  function formatFullDate(value: string | null | undefined) {
    if (!value) return ''
    return fullDateFormatter.format(new Date(value))
  }

  function senderName(from: string | null | undefined) {
    if (!from) return 'Unknown'
    return from.split('<')[0]?.trim() || from
  }

  function senderAddress(from: string | null | undefined) {
    if (!from) return ''
    const match = from.match(/<([^>]+)>/)
    return match?.[1]?.trim() ?? ''
  }

  function senderInitials(from: string | null | undefined) {
    const words = senderName(from).split(/\s+/).filter(Boolean).slice(0, 2)
    return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || 'NA'
  }

  function isUnread(flags: string[]) {
    return !flags.includes('\\Seen')
  }

  function isImage(contentType: string) {
    return contentType.startsWith('image/')
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function priorityTone(priority: ThreadActionItem['priority']) {
    if (priority === 'high') return 'border-rose-400/30 bg-rose-400/10 text-rose-200'
    if (priority === 'low') return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
    return 'border-sky-400/30 bg-sky-400/10 text-sky-200'
  }

  function attachmentSafety(att: Attachment) {
    return scoreAttachmentSafety(att)
  }

  function attachmentSafetyClass(safety: AttachmentSafetyScore) {
    return safety.level === 'high'
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
      : 'border-white/10 bg-white/5 text-zinc-300'
  }

  async function confirmHighRiskDownload(event: MouseEvent, att: Attachment) {
    const safety = attachmentSafety(att)
    if (safety.level !== 'high') return

    event.preventDefault()
    const reasonText = safety.reasons.length ? `\n\n${safety.reasons.join('\n')}` : ''
    const confirmed = await requestModal({
      title: 'Download risky attachment?',
      message: `This attachment has traits often abused in phishing or unsafe downloads. Only download it if you expected it.${reasonText}`,
      confirmLabel: 'Download',
      tone: 'danger'
    })
    if (confirmed) window.location.href = resolve(`/api/attachments/${att.id}`)
  }

  function hasValue(value: string | null | undefined) {
    return Boolean(value && value.trim())
  }

  function detailRows(msg: Message) {
    return [
      { label: 'From', value: msg.from },
      { label: 'To', value: msg.to },
      { label: 'Cc', value: msg.cc },
      { label: 'Mailbox', value: msg.mailbox },
      { label: 'Message-ID', value: msg.messageId },
      { label: 'UID', value: String(msg.uid) },
      { label: 'In-Reply-To', value: msg.inReplyTo },
      { label: 'References', value: msg.references }
    ].filter((row) => hasValue(row.value))
  }

  const SCROLLBAR_STYLE = `<style>
*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.18) transparent}
*::-webkit-scrollbar{width:6px;height:6px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:999px}
*::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.32)}
:root{padding:12px}
</style>`

  const LINK_TARGET_BASE = '<base target="_blank">'
  const OPENABLE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

  function injectScrollbarStyle(html: string): string {
    const headClose = html.indexOf('</head>')
    if (headClose !== -1)
      return html.slice(0, headClose) + LINK_TARGET_BASE + SCROLLBAR_STYLE + html.slice(headClose)
    return LINK_TARGET_BASE + SCROLLBAR_STYLE + html
  }

  const remoteContentSettings = $derived({
    blockRemoteContent: data.remoteContent.blockRemoteContent,
    allowedSenders: allowedRemoteSenders
  })

  function remoteContentForMessage(msg: Message) {
    return prepareRemoteContent(
      msg.htmlContent ?? '',
      msg.from,
      remoteContentSettings,
      showRemoteContentIds.has(msg.id)
    )
  }

  async function trustRemoteContentSender(msg: Message) {
    const sender = normalizeSenderAddress(msg.from)
    if (!sender || trustingRemoteSenderId !== null) return
    trustingRemoteSenderId = msg.id
    try {
      const nextAllowedSenders = normalizeAllowedSenders([...allowedRemoteSenders, sender])
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          remoteContent: {
            blockRemoteContent: data.remoteContent.blockRemoteContent,
            allowedSenders: nextAllowedSenders
          }
        })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to trust sender.'))
      }

      allowedRemoteSenders = nextAllowedSenders
      showRemoteContentIds.add(msg.id)
      toast('Sender trusted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to trust sender.')
    } finally {
      trustingRemoteSenderId = null
    }
  }

  function closestEmailLink(target: EventTarget | null) {
    if (!target || typeof target !== 'object') return null

    const candidate = target as {
      closest?: (selector: string) => Element | null
      parentElement?: { closest?: (selector: string) => Element | null }
    }

    return (candidate.closest?.('a[href]') ??
      candidate.parentElement?.closest?.('a[href]') ??
      null) as HTMLAnchorElement | null
  }

  function openEmailLinkInNewWindow(event: MouseEvent) {
    const anchor = closestEmailLink(event.target)
    const rawHref = anchor?.getAttribute('href')?.trim()
    if (!anchor || !rawHref || rawHref.startsWith('#')) return

    let url: URL
    try {
      url = new URL(rawHref, anchor.ownerDocument?.baseURI ?? window.location.href)
    } catch {
      return
    }

    if (!OPENABLE_LINK_PROTOCOLS.has(url.protocol)) return

    event.preventDefault()
    event.stopPropagation()
    window.open(url.href, '_blank', 'noopener,noreferrer')
  }

  function retargetEmailLinks(doc: Document) {
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const rawHref = anchor.getAttribute('href')?.trim()
      if (!rawHref || rawHref.startsWith('#')) continue

      try {
        const url = new URL(rawHref, doc.baseURI)
        if (!OPENABLE_LINK_PROTOCOLS.has(url.protocol)) continue
      } catch {
        continue
      }

      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }

  function setupEmailIframe(iframe: HTMLIFrameElement) {
    const doc = iframe.contentDocument
    if (!doc) return

    retargetEmailLinks(doc)
    doc.addEventListener('click', openEmailLinkInNewWindow)

    const height = doc.documentElement.scrollHeight
    if (height > 50) iframe.style.height = `${height + 24}px`
  }

  function getMessageAttachments(messageId: string) {
    return attachments.filter((a) => a.messageId === messageId)
  }

  const lastMessage = $derived(messages[messages.length - 1])

  let scrollContainer = $state<HTMLDivElement | undefined>(undefined)

  function scrollThreadToBottom() {
    const container = scrollContainer
    if (!container) return

    container.scrollTop = container.scrollHeight
  }

  function nextFrame() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  async function settleThreadScrollAtBottom() {
    scrollToLatestPending = true

    await tick()
    scrollThreadToBottom()
    await nextFrame()
    scrollThreadToBottom()

    window.setTimeout(() => {
      scrollThreadToBottom()
      scrollToLatestPending = false
    }, 150)
  }

  $effect(() => {
    allowedRemoteSenders = data.remoteContent.allowedSenders
  })

  $effect(() => {
    if (initializedThreadId === data.threadId) return

    expandedIds = new SvelteSet<number>()
    collapsedDefaultIds = new SvelteSet<number>()
    threadSummaryAbort?.abort()
    threadSummaryAbort = null
    threadSummary = null
    summarizingThread = false
    showRemoteContentIds = new SvelteSet<number>()
    threadActions = null
    extractingThreadActions = false
    activeAiPanel = null
    noteDraft = data.threadNote?.body ?? ''
    savedNoteBody = data.threadNote?.body ?? ''
    savedNoteUpdatedAt = data.threadNote?.updatedAt ?? null
    savingNote = false
    notesCollapsed = !data.threadNote?.body?.trim()
    initializedThreadId = data.threadId
    void settleThreadScrollAtBottom()
  })

  onMount(() => {
    setTimeout(() => notifyMailboxStateChanged('thread-opened'), 0)

    const teardown = setupKeyboardHandler('message', {
      u: () => gotoMailbox(),
      r: () => lastMessage && openReply(lastMessage),
      a: () => lastMessage && openReplyAll(lastMessage),
      e: () => void performThreadAction('archive'),
      '#': () => void performThreadAction('trash'),
      Escape: () => gotoMailbox(),
      ArrowLeft: () => gotoMailbox(),
      ArrowDown: () => scrollContainer?.scrollBy({ top: 60, behavior: 'smooth' }),
      ArrowUp: () => scrollContainer?.scrollBy({ top: -60, behavior: 'smooth' })
    })

    return teardown
  })
</script>

<svelte:head>
  <title>{subject} · Thread</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Thread header -->
  <div class="p-4 sm:p-5 md:border-b md:border-white/8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onclick={() => gotoMailbox()}
          class="inline-flex items-center gap-2 rounded-lg border border-transparent bg-white/3 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/6 md:hidden"
        >
          <ChevronLeft size={16} />
          Back to list
        </button>
        {#if role === 'archive' || role === 'trash' || role === 'spam'}
          <button
            type="button"
            aria-label="Move to inbox"
            disabled={acting}
            onclick={() => performThreadAction('inbox')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Archive size={16} />
          </button>
        {:else}
          <button
            type="button"
            aria-label="Archive thread"
            disabled={acting}
            onclick={() => performThreadAction('archive')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Archive size={16} />
          </button>
          <button
            type="button"
            aria-label="Trash thread"
            disabled={acting}
            onclick={() => performThreadAction('trash')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Mark as spam"
            disabled={acting}
            onclick={() => performThreadAction('spam')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <ShieldAlert size={16} />
          </button>
        {/if}
        <button
          type="button"
          aria-label="Mark thread unread"
          disabled={acting}
          onclick={() => markThreadUnread()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
        >
          <Mail size={16} />
        </button>
        {#if lastMessage}
          <button
            type="button"
            aria-label="Block sender"
            disabled={acting || !lastMessage.from}
            onclick={() => blockSender(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Ban size={16} />
          </button>
        {/if}
        <button
          type="button"
          aria-label={threadMetadata.starred ? 'Unstar thread' : 'Star thread'}
          title={threadMetadata.starred ? 'Unstar thread' : 'Star thread'}
          disabled={acting}
          onclick={() => toggleThreadMetadata('starred')}
          class={[
            'rounded-lg border border-transparent bg-white/3 p-2 transition hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8',
            threadMetadata.starred ? 'text-amber-300' : 'text-zinc-400 hover:text-zinc-200'
          ]}
        >
          <Star size={16} fill={threadMetadata.starred ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          aria-label={threadMetadata.pinned ? 'Unpin thread' : 'Pin thread'}
          title={threadMetadata.pinned ? 'Unpin thread' : 'Pin thread'}
          disabled={acting}
          onclick={() => toggleThreadMetadata('pinned')}
          class={[
            'rounded-lg border border-transparent bg-white/3 p-2 transition hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8',
            threadMetadata.pinned ? 'text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
          ]}
        >
          <Pin size={16} fill={threadMetadata.pinned ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          aria-label="Summarize thread"
          disabled={summarizingThread}
          onclick={() => summarizeThread()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
        >
          <Sparkles size={16} class={summarizingThread ? 'animate-pulse' : ''} />
        </button>
        <button
          type="button"
          aria-label="Snooze thread"
          disabled={acting}
          onclick={() => snoozeThread()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
        >
          <Clock size={16} />
        </button>
        <button
          type="button"
          aria-label="Extract thread actions"
          disabled={extractingThreadActions}
          onclick={() => extractThreadActions()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-emerald-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
        >
          <ListChecks size={16} class={extractingThreadActions ? 'animate-pulse' : ''} />
        </button>
        <span
          class={[
            'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs',
            hasSavedNote
              ? 'border-amber-300/20 bg-amber-400/10 text-amber-200'
              : 'border-white/8 bg-white/3 text-zinc-500'
          ].join(' ')}
          title={hasSavedNote ? 'Thread has a private note' : 'No private note yet'}
        >
          <StickyNote size={13} />
          Note
        </span>
        {#if lastMessage}
          <button
            type="button"
            aria-label="Reply"
            onclick={() => openReply(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
          >
            <Reply size={16} />
          </button>
          <button
            type="button"
            aria-label="Reply all"
            onclick={() => openReplyAll(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
          >
            <ReplyAll size={16} />
          </button>
          <button
            type="button"
            aria-label="Draft reply with AI"
            disabled={draftingReplyMessageId !== null}
            onclick={() => void generateReplyDraft(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:hidden"
          >
            <Sparkles
              size={16}
              class={draftingReplyMessageId === lastMessage.id ? 'animate-pulse' : ''}
            />
          </button>
        {/if}
      </div>

      <div class="hidden flex-wrap items-center gap-1 md:flex md:justify-end">
        {#if lastMessage}
          <button
            type="button"
            aria-label="Reply"
            onclick={() => openReply(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <Reply size={16} />
          </button>
          <button
            type="button"
            aria-label="Reply all"
            onclick={() => openReplyAll(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <ReplyAll size={16} />
          </button>
          <button
            type="button"
            aria-label="Draft reply with AI"
            disabled={draftingReplyMessageId !== null}
            onclick={() => void generateReplyDraft(lastMessage)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
          >
            <Sparkles
              size={16}
              class={draftingReplyMessageId === lastMessage.id ? 'animate-pulse' : ''}
            />
          </button>
        {/if}
      </div>
    </div>

    <h1 class="mt-3 text-lg font-semibold text-white">{subject}</h1>
    <p class="mt-0.5 text-sm text-zinc-500">
      {messages.length} message{messages.length === 1 ? '' : 's'}
    </p>
    {#if activeAiPanel || threadSummary !== null || threadActions !== null}
      <div class="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="flex items-center gap-1 rounded-lg bg-black/20 p-1">
            <button
              type="button"
              onclick={() => (activeAiPanel = 'summary')}
              class="rounded-md px-2 py-1 text-xs font-medium transition {activeAiPanel ===
              'summary'
                ? 'bg-white/10 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'}"
            >
              Summary
            </button>
            <button
              type="button"
              onclick={() => (activeAiPanel = 'actions')}
              class="rounded-md px-2 py-1 text-xs font-medium transition {activeAiPanel ===
              'actions'
                ? 'bg-white/10 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'}"
            >
              Actions
            </button>
          </div>
          {#if activeAiPanel === 'summary' && summarizingThread}
            <p class="text-xs text-sky-300">Summarizing...</p>
          {:else if activeAiPanel === 'actions' && extractingThreadActions}
            <p class="text-xs text-emerald-300">Extracting...</p>
          {/if}
        </div>
        {#if activeAiPanel === 'actions'}
          {#if extractingThreadActions && threadActions === null}
            <p class="text-sm text-zinc-400">Finding action items...</p>
          {:else if threadActions && threadActions.length > 0}
            <div class="space-y-2">
              {#each threadActions as action, index (`${action.title}-${index}`)}
                <div class="rounded-lg border border-white/8 bg-black/15 p-3">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <p class="text-sm font-medium text-zinc-100">{action.title}</p>
                    <span
                      class="rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize {priorityTone(
                        action.priority
                      )}"
                    >
                      {action.priority}
                    </span>
                  </div>
                  {#if action.description}
                    <p class="mt-1 text-sm leading-5 text-zinc-400">{action.description}</p>
                  {/if}
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {#if action.owner}
                      <span>Owner: {action.owner}</span>
                    {/if}
                    {#if action.dueDate}
                      <span>Due: {action.dueDate}</span>
                    {/if}
                    {#if action.sourceMessageId}
                      <span class="truncate">Source: {action.sourceMessageId}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-zinc-400">No explicit action items found in this thread.</p>
          {/if}
        {:else}
          <p class="text-sm leading-6 whitespace-pre-wrap text-zinc-200">
            {threadSummary || 'Generating summary...'}
          </p>
        {/if}
      </div>
    {/if}
    <div class="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2 {notesExpanded ? 'mb-2' : ''}">
        <button
          type="button"
          onclick={toggleNotesCollapsed}
          aria-expanded={notesExpanded}
          class="flex items-center gap-2 rounded-md text-left transition hover:text-zinc-200 disabled:cursor-default disabled:hover:text-inherit"
          disabled={noteDirty}
          title={noteDirty ? 'Save or clear changes before collapsing notes' : undefined}
        >
          <StickyNote size={14} class={hasSavedNote ? 'text-amber-300' : 'text-zinc-500'} />
          <p class="text-xs font-medium tracking-wide text-zinc-400 uppercase">Private Notes</p>
          <ChevronDown
            size={13}
            class="text-zinc-600 transition-transform {notesExpanded ? 'rotate-180' : ''}"
          />
        </button>
        <div class="flex items-center gap-2">
          {#if savedNoteUpdatedAt && !noteDirty}
            <p class="text-xs text-zinc-500">Saved {formatFullDate(savedNoteUpdatedAt)}</p>
          {:else if noteDirty}
            <p class="text-xs text-amber-300">Unsaved changes</p>
          {/if}
          <button
            type="button"
            disabled={savingNote || !noteDirty}
            onclick={() => saveNote()}
            class="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingNote ? 'Saving...' : noteDraft.trim() ? 'Save note' : 'Clear note'}
          </button>
        </div>
      </div>
      {#if notesExpanded}
        <textarea
          bind:value={noteDraft}
          rows="3"
          maxlength="10000"
          placeholder="Add a private note for this thread. It stays in this mail app and is never sent."
          class="w-full resize-y rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm leading-6 text-zinc-200 transition outline-none placeholder:text-zinc-600 focus:border-amber-300/40 focus:ring-2 focus:ring-amber-300/10"
        ></textarea>
      {/if}
    </div>
  </div>

  <!-- Thread messages accordion -->
  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto">
    <div class="space-y-2 p-2 md:space-y-0 md:divide-y md:divide-white/8 md:p-0">
      {#each messages as msg (msg.id)}
        {@const isExpanded = isMessageExpanded(msg.id)}
        {@const msgAttachments = getMessageAttachments(msg.messageId)}
        {@const remoteContentBody = remoteContentForMessage(msg)}
        {@const srcdoc = msg.htmlContent ? injectScrollbarStyle(remoteContentBody.html) : null}

        <div
          style:margin-left={`${Math.min(msg.threadDepth, 4) * 1.25}rem`}
          class={[
            'rounded-2xl bg-white/2 transition-colors md:rounded-none md:bg-transparent',
            isExpanded ? 'bg-white/4 md:bg-white/2' : 'hover:bg-white/4 md:hover:bg-white/2'
          ].join(' ')}
        >
          <!-- Collapsed header / toggle -->
          <div class="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300"
            >
              {senderInitials(msg.from)}
            </div>

            <button
              type="button"
              onclick={() => toggleExpanded(msg)}
              class="min-w-0 flex-1 text-left"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span
                    class="truncate text-sm {isUnread(msg.flags)
                      ? 'font-semibold text-white'
                      : 'text-zinc-300'}"
                  >
                    {senderName(msg.from)}
                  </span>
                  {#if senderAddress(msg.from)}
                    <span class="truncate text-xs text-zinc-500"
                      >&lt;{senderAddress(msg.from)}&gt;</span
                    >
                  {/if}
                  {#if isUnread(msg.flags)}
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"></span>
                  {/if}
                </div>
                {#if !isExpanded}
                  <p class="mt-0.5 truncate text-xs text-zinc-500">
                    {msg.preview || msg.textContent?.slice(0, 120) || ''}
                  </p>
                {/if}
              </div>
            </button>

            <div class="flex shrink-0 items-center gap-1.5">
              {#if msgAttachments.length > 0}
                <Paperclip size={13} class="text-zinc-500" />
              {/if}
              <span class="text-xs text-zinc-500">{formatFullDate(msg.receivedAt)}</span>
              <button
                type="button"
                aria-label="View metadata"
                onclick={() => (metadataMessage = msg)}
                class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
              >
                <FileText size={14} />
              </button>
              <ChevronDown
                size={14}
                class="text-zinc-600 transition-transform {isExpanded ? 'rotate-180' : ''}"
              />
            </div>
          </div>

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="px-4 pb-4 sm:px-5">
              {#if remoteContentBody.blockedCount > 0}
                <div
                  class="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100"
                >
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      {remoteContentBody.blockedCount} external resource{remoteContentBody.blockedCount ===
                      1
                        ? ''
                        : 's'} blocked to protect your privacy.
                    </p>
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onclick={() => showRemoteContentIds.add(msg.id)}
                        class="rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-medium text-amber-50 transition hover:bg-amber-300/20"
                      >
                        Show this time
                      </button>
                      {#if normalizeSenderAddress(msg.from)}
                        <button
                          type="button"
                          disabled={trustingRemoteSenderId !== null}
                          onclick={() => void trustRemoteContentSender(msg)}
                          class="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-amber-200 disabled:opacity-60"
                        >
                          {trustingRemoteSenderId === msg.id ? 'Saving...' : 'Always trust sender'}
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}

              {#if srcdoc}
                <iframe
                  title="Message body"
                  {srcdoc}
                  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  class="min-h-[300px] w-full rounded-lg border border-white/8 bg-white"
                  onload={(e) => {
                    const iframe = e.currentTarget as HTMLIFrameElement
                    setupEmailIframe(iframe)
                    if (scrollToLatestPending && msg.id === defaultExpandedId) {
                      scrollThreadToBottom()
                    }
                  }}
                ></iframe>
              {:else}
                <pre
                  class="overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-zinc-300">
                  {msg.textContent || msg.preview || 'No message body available.'}
                </pre>
              {/if}

              {#if msgAttachments.length > 0}
                <div class="mt-4 space-y-2">
                  <p class="text-xs font-medium text-zinc-400">
                    {msgAttachments.length} attachment{msgAttachments.length === 1 ? '' : 's'}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {#each msgAttachments as att (att.id)}
                      {@const safety = attachmentSafety(att)}
                      <div
                        class="flex max-w-full flex-col rounded-lg border border-transparent bg-white/3 px-3 py-2 md:border-white/8"
                      >
                        <div class="flex items-center gap-2">
                          {#if isImage(att.contentType)}
                            <FileImage size={14} class="shrink-0 text-zinc-400" />
                          {:else}
                            <Paperclip size={14} class="shrink-0 text-zinc-400" />
                          {/if}
                          <div class="min-w-0">
                            <p class="max-w-[160px] truncate text-xs font-medium text-zinc-200">
                              {att.filename || 'Attachment'}
                            </p>
                            <p class="text-xs text-zinc-500">{formatBytes(att.size)}</p>
                            {#if safety.level !== 'low'}
                              <span
                                class={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${attachmentSafetyClass(safety)}`}
                                title={safety.reasons.join('; ')}
                              >
                                <ShieldAlert size={10} />
                                {safety.label}
                              </span>
                            {/if}
                          </div>
                          <a
                            href={resolve(`/api/attachments/${att.id}`)}
                            download={att.filename || 'attachment'}
                            onclick={(event) => confirmHighRiskDownload(event, att)}
                            class="ml-1 shrink-0 text-zinc-500 transition hover:text-zinc-300"
                            aria-label="Download {att.filename}"
                          >
                            <Download size={14} />
                          </a>
                        </div>
                        <AttachmentSummary attachment={att} compact />
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Per-message reply -->
              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => openReply(msg)}
                  class="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
                >
                  <Reply size={13} /> Reply
                </button>
                <button
                  type="button"
                  onclick={() => openReplyAll(msg)}
                  class="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
                >
                  <ReplyAll size={13} /> Reply all
                </button>
                <button
                  type="button"
                  disabled={draftingReplyMessageId !== null}
                  onclick={() => void generateReplyDraft(msg)}
                  class="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
                >
                  <Sparkles
                    size={13}
                    class={draftingReplyMessageId === msg.id ? 'animate-pulse' : ''}
                  />
                  {draftingReplyMessageId === msg.id ? 'Drafting...' : 'AI draft'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if metadataMessage}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) metadataMessage = null
    }}
  >
    <div
      class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0d0d10]"
    >
      <div class="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <h3 class="text-base font-semibold text-white">Message Metadata</h3>
          <p class="mt-1 text-sm text-zinc-500">{metadataMessage.subject ?? '(no subject)'}</p>
        </div>
        <button
          type="button"
          aria-label="Close metadata"
          onclick={() => (metadataMessage = null)}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
        >
          <X size={16} />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <dl class="space-y-3">
          {#each [...detailRows(metadataMessage), { label: 'Received', value: formatFullDate(metadataMessage.receivedAt) }, { label: 'Flags', value: metadataMessage.flags.join(', ') || '—' }] as row (row.label)}
            <div
              class="grid gap-1 border-b border-white/6 py-2 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-4"
            >
              <dt class="text-xs font-medium tracking-wide text-zinc-500 uppercase">{row.label}</dt>
              <dd class="min-w-0 text-sm break-all text-zinc-200">{row.value}</dd>
            </div>
          {/each}
        </dl>

        <div class="mt-6 space-y-4">
          <details class="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <summary class="cursor-pointer text-sm font-medium text-zinc-200">HTML Source</summary>
            <pre
              class="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-white/6 bg-black/20 p-3 text-xs leading-6 whitespace-pre-wrap text-zinc-300">{metadataMessage.htmlContent ||
                'No HTML content available.'}</pre>
          </details>

          <details class="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <summary class="cursor-pointer text-sm font-medium text-zinc-200">Text Source</summary>
            <pre
              class="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-white/6 bg-black/20 p-3 text-xs leading-6 whitespace-pre-wrap text-zinc-300">{metadataMessage.textContent ||
                'No text content available.'}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
{/if}

<ErrorDialog
  message={errorDialogMessage}
  title="Thread error"
  onclose={() => (errorDialogMessage = null)}
/>

{#if actionModal}
  <ActionModal
    title={actionModal.title}
    message={actionModal.message}
    confirmLabel={actionModal.confirmLabel}
    cancelLabel={actionModal.cancelLabel}
    tone={actionModal.tone}
    inputLabel={actionModal.inputLabel}
    inputValue={actionModal.inputValue}
    inputType={actionModal.inputType}
    onconfirm={(value) => closeActionModal(value ?? true)}
    oncancel={() => closeActionModal(null)}
  />
{/if}
