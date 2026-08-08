<script lang="ts">
  import {
    Archive,
    Trash2,
    ShieldAlert,
    ChevronDown,
    ChevronLeft,
    Paperclip,
    Download,
    FileImage,
    X,
    StickyNote,
    Share2,
    Copy,
    Check,
    CheckSquare,
    Square,
    Reply,
    ReplyAll,
    Sparkles,
    ListChecks,
    Mail,
    Star,
    Pin,
    Clock
  } from 'lucide-svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import AttachmentSummary from '$lib/components/AttachmentSummary.svelte'
  import MarkActions from '$lib/components/MarkActions.svelte'
  import ReplyActions from '$lib/components/ReplyActions.svelte'
  import ThreadAiActions from '$lib/components/ThreadAiActions.svelte'
  import MobileMailActions, {
    type MobileMailAction
  } from '$lib/components/MobileMailActions.svelte'
  import OpenPgpIndicator from '$lib/components/OpenPgpIndicator.svelte'
  import RawMessageDialog from '$lib/components/RawMessageDialog.svelte'
  import SendStatusIndicator from '$lib/components/SendStatusIndicator.svelte'
  import UrlWarningDialog from '$lib/components/UrlWarningDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { onMount, tick } from 'svelte'
  import { SvelteDate, SvelteSet } from 'svelte/reactivity'
  import { openReply, openReplyAll } from '$lib/composer.svelte'
  import { setupKeyboardHandler } from '$lib/keyboard.svelte'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'
  import { sendStatusLabel } from '$lib/send-status'
  import { encodeThreadId } from '$lib/thread-url'
  import {
    normalizeAllowedSenders,
    normalizeSenderAddress,
    prepareRemoteContent
  } from '$lib/remote-content'
  import { scoreAttachmentSafety, type AttachmentSafetyScore } from '$lib/mail-attachments'
  import { interceptMailContentLinks } from '$lib/mail-content-links'
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
    spfStatus: string | null
    dkimStatus: string | null
    dmarcStatus: string | null
    authenticationTrusted: boolean
    openPgpSigned: boolean
    openPgpSignatureStatus: string | null
    openPgpSigner: string | null
    openPgpFingerprint: string | null
    openPgpEncrypted: boolean
    openPgpDecrypted: boolean
    openPgpError: string | null
    rawSourceAvailable: boolean
    flags: string[]
    receivedAt: string | null
    snoozedUntil: string | null
    threadDepth: number
    sendStatus: 'sending' | 'failed' | 'sent' | null
    smtpJobId: number | null
    openedAt: string | null
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
      mailboxPaths: string[]
      composedMailbox: { id: number; name: string; slug: string; mailboxPaths: string[] } | null
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
  let liveOpenedAtByJob = $state<Record<number, string>>({})
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
  let rawMessage = $state<Message | null>(null)
  let scrollToLatestPending = $state(false)
  let threadSummary = $state<string | null>(null)
  let summarizingThread = $state(false)
  let threadSummaryAbort = $state<AbortController | null>(null)
  let showRemoteContentIds = $state(new SvelteSet<number>())
  let trustingRemoteSenderId = $state<number | null>(null)

  let showShareModal = $state(false)
  let selectedShareMessageIds = $state<string[]>([])
  let generatingShareUrl = $state(false)
  let generatedShareUrl = $state<string | null>(null)
  let copiedShareUrl = $state(false)

  function openThreadShareModal() {
    selectedShareMessageIds = messages.map((m) => m.messageId)
    generatedShareUrl = null
    copiedShareUrl = false
    showShareModal = true
  }

  function closeThreadShareModal() {
    showShareModal = false
    generatedShareUrl = null
    copiedShareUrl = false
  }

  function selectAllShareMessages() {
    selectedShareMessageIds = messages.map((m) => m.messageId)
    generatedShareUrl = null
  }

  function deselectAllShareMessages() {
    selectedShareMessageIds = []
    generatedShareUrl = null
  }

  const allShareMessagesSelected = $derived(
    selectedShareMessageIds.length === messages.length && messages.length > 0
  )

  function toggleSelectAllShareMessages() {
    if (allShareMessagesSelected) {
      selectedShareMessageIds = []
    } else {
      selectedShareMessageIds = messages.map((m) => m.messageId)
    }
    generatedShareUrl = null
  }

  function toggleShareMessage(messageId: string) {
    if (selectedShareMessageIds.includes(messageId)) {
      selectedShareMessageIds = selectedShareMessageIds.filter((id) => id !== messageId)
    } else {
      selectedShareMessageIds = [...selectedShareMessageIds, messageId]
    }
    generatedShareUrl = null
  }

  async function createThreadShareLink() {
    if (selectedShareMessageIds.length === 0 || generatingShareUrl) return
    generatingShareUrl = true
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageIds: selectedShareMessageIds })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to create thread share link.'))
      }

      const payload = (await response.json()) as { url: string }
      generatedShareUrl = payload.url
      copiedShareUrl = false
      toast('Thread share link generated')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to create thread share link.')
    } finally {
      generatingShareUrl = false
    }
  }

  async function copyShareLink() {
    if (!generatedShareUrl) return
    try {
      await navigator.clipboard.writeText(generatedShareUrl)
      copiedShareUrl = true
      toast('Share link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }
  let allowedRemoteSenders = $state<string[]>([])
  let draftingReplyMessageId = $state<number | null>(null)
  let threadActions = $state<ThreadActionItem[] | null>(null)
  let extractingThreadActions = $state(false)
  let activeAiPanel = $state<'summary' | 'actions' | null>(null)
  let threadMetadata = $state({ starred: false, pinned: false })
  let pendingUrl = $state<string | null>(null)

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
          body: JSON.stringify({ ids: [message.id], action: 'mark_read', mailbox: data.mailbox })
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
      const ids = messages.filter((m) => data.mailboxPaths.includes(m.mailbox)).map((m) => m.id)
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, action, mailbox: data.mailbox, threaded: true })
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
          body: JSON.stringify({
            ids,
            action: 'mark_unread',
            mailbox: data.mailbox,
            threaded: true
          })
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
      const ids = messages.filter((m) => data.mailboxPaths.includes(m.mailbox)).map((m) => m.id)
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids,
            action: 'snooze',
            snoozedUntil: snoozedUntil.toISOString(),
            mailbox: data.mailbox,
            threaded: true
          })
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

  function openedAtFor(message: Message) {
    return message.smtpJobId
      ? (liveOpenedAtByJob[message.smtpJobId] ?? message.openedAt)
      : message.openedAt
  }

  async function refreshReadStatuses() {
    const jobs = messages.filter(
      (message) => message.sendStatus === 'sent' && message.smtpJobId && !openedAtFor(message)
    )
    if (jobs.length === 0) return

    const updates = await Promise.all(
      jobs.map(async (message) => {
        try {
          const response = await fetch(`/api/send/${message.smtpJobId}`)
          if (!response.ok) return null
          const payload = (await response.json()) as { openedAt?: string | null }
          return payload.openedAt && message.smtpJobId
            ? ([message.smtpJobId, payload.openedAt] as const)
            : null
        } catch {
          return null
        }
      })
    )
    const opened = updates.filter((update): update is readonly [number, string] => update !== null)
    if (opened.length > 0)
      liveOpenedAtByJob = { ...liveOpenedAtByJob, ...Object.fromEntries(opened) }
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

  function injectScrollbarStyle(html: string): string {
    const headClose = html.indexOf('</head>')
    if (headClose !== -1) return html.slice(0, headClose) + SCROLLBAR_STYLE + html.slice(headClose)
    return SCROLLBAR_STYLE + html
  }

  const remoteContentSettings = $derived({
    blockRemoteContent: data.remoteContent.blockRemoteContent,
    allowedSenders: allowedRemoteSenders
  })

  function remoteContentForMessage(msg: Message) {
    return prepareRemoteContent(msg.htmlContent ?? '', msg.from, remoteContentSettings, {
      messageId: msg.id,
      allowedMessageIds: showRemoteContentIds
    })
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
      toast('Sender trusted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to trust sender.')
    } finally {
      trustingRemoteSenderId = null
    }
  }

  function setupEmailIframe(iframe: HTMLIFrameElement) {
    const doc = iframe.contentDocument
    if (!doc) return

    interceptMailContentLinks(doc, (url) => (pendingUrl = url))

    const height = doc.documentElement.scrollHeight
    if (height > 50) iframe.style.height = `${height + 24}px`
  }

  function openPendingUrl() {
    if (!pendingUrl) return
    window.open(pendingUrl, '_blank', 'noopener,noreferrer')
    pendingUrl = null
  }

  function getMessageAttachments(messageId: string) {
    return attachments.filter((a) => a.messageId === messageId)
  }

  const lastMessage = $derived(messages[messages.length - 1])
  const mobileActions = $derived.by(() => {
    const actions: MobileMailAction[] = []

    if (role === 'archive' || role === 'trash') {
      actions.push({
        label: 'Move to inbox',
        icon: Archive,
        onSelect: () => void performThreadAction('inbox'),
        disabled: acting,
        group: 'mailbox'
      })
    } else if (role === 'spam') {
      actions.push({
        label: 'Not spam',
        icon: ShieldAlert,
        iconClass: 'text-amber-400',
        onSelect: () => void performThreadAction('inbox'),
        disabled: acting,
        group: 'mailbox'
      })
    } else {
      actions.push(
        {
          label: 'Archive thread',
          icon: Archive,
          onSelect: () => void performThreadAction('archive'),
          disabled: acting,
          group: 'mailbox'
        },
        {
          label: 'Trash thread',
          icon: Trash2,
          iconClass: 'text-rose-400',
          onSelect: () => void performThreadAction('trash'),
          disabled: acting,
          group: 'mailbox'
        },
        {
          label: 'Mark as spam',
          icon: ShieldAlert,
          iconClass: 'text-amber-400',
          onSelect: () => void performThreadAction('spam'),
          disabled: acting,
          group: 'mailbox'
        }
      )
    }

    if (page.data.hasOpenAiKey) {
      actions.push(
        {
          label: summarizingThread ? 'Summarizing...' : 'Summarize thread',
          icon: Sparkles,
          iconClass: 'text-sky-300',
          onSelect: () => void summarizeThread(),
          disabled: summarizingThread,
          group: 'thread'
        },
        {
          label: extractingThreadActions ? 'Extracting...' : 'Extract thread actions',
          icon: ListChecks,
          iconClass: 'text-emerald-300',
          onSelect: () => void extractThreadActions(),
          disabled: extractingThreadActions,
          group: 'thread'
        }
      )
    }
    actions.push({
      label: 'Share thread',
      icon: Share2,
      iconClass: 'text-sky-300',
      onSelect: openThreadShareModal,
      group: 'thread'
    })

    if (lastMessage) {
      actions.push(
        {
          label: 'Reply',
          icon: Reply,
          onSelect: () => openReply(lastMessage),
          group: 'respond'
        },
        {
          label: 'Reply all',
          icon: ReplyAll,
          onSelect: () => openReplyAll(lastMessage),
          group: 'respond'
        }
      )
      if (page.data.hasOpenAiKey) {
        actions.push({
          label: draftingReplyMessageId === lastMessage.id ? 'Drafting...' : 'AI reply draft',
          icon: Sparkles,
          iconClass: 'text-sky-300',
          onSelect: () => void generateReplyDraft(lastMessage),
          disabled: draftingReplyMessageId === lastMessage.id,
          group: 'respond'
        })
      }
      actions.push(
        {
          label: 'Mark as unread',
          icon: Mail,
          onSelect: () => void markThreadUnread(),
          disabled: acting,
          group: 'mark'
        },
        {
          label: threadMetadata.starred ? 'Mark as unstarred' : 'Mark as starred',
          icon: Star,
          iconClass: threadMetadata.starred ? 'text-amber-300' : '',
          onSelect: () => void toggleThreadMetadata('starred'),
          disabled: acting,
          group: 'mark'
        },
        {
          label: threadMetadata.pinned ? 'Mark as unpinned' : 'Mark as pinned',
          icon: Pin,
          iconClass: threadMetadata.pinned ? 'text-sky-300' : '',
          onSelect: () => void toggleThreadMetadata('pinned'),
          disabled: acting,
          group: 'mark'
        },
        {
          label: 'Snooze',
          icon: Clock,
          onSelect: () => void snoozeThread(),
          disabled: acting,
          group: 'mark'
        }
      )
    }

    return actions
  })

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

  async function markOpenedThreadRead() {
    const ids = messages
      .filter((message) => !message.flags.includes('\\Seen'))
      .map((message) => message.id)
    if (ids.length === 0) return
    const response = await fetch('/api/messages/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, action: 'mark_read', mailbox: page.params.mailbox })
    })
    if (!response.ok) return
    for (const message of messages) {
      if (ids.includes(message.id)) message.flags = [...message.flags, '\\Seen']
    }
  }

  onMount(() => {
    void markOpenedThreadRead()
    setTimeout(() => notifyMailboxStateChanged('thread-opened'), 0)
    void refreshReadStatuses()
    const readStatusInterval = setInterval(() => void refreshReadStatuses(), 10_000)

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

    return () => {
      clearInterval(readStatusInterval)
      teardown()
    }
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
        <div class="hidden md:contents">
        {#if role === 'archive' || role === 'trash'}
          <button
            type="button"
            aria-label="Move to inbox"
            data-app-tooltip="Move to inbox"
            disabled={acting}
            onclick={() => performThreadAction('inbox')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Archive size={16} />
          </button>
        {:else if role === 'spam'}
          <button
            type="button"
            aria-label="Not spam"
            data-app-tooltip="Not spam"
            disabled={acting}
            onclick={() => performThreadAction('inbox')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <ShieldAlert size={16} />
          </button>
        {:else}
          <button
            type="button"
            aria-label="Archive thread"
            data-app-tooltip="Archive thread"
            disabled={acting}
            onclick={() => performThreadAction('archive')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Archive size={16} />
          </button>
          <button
            type="button"
            aria-label="Trash thread"
            data-app-tooltip="Trash thread"
            disabled={acting}
            onclick={() => performThreadAction('trash')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Mark as spam"
            data-app-tooltip="Mark as spam"
            disabled={acting}
            onclick={() => performThreadAction('spam')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <ShieldAlert size={16} />
          </button>
        {/if}
        {#if page.data.hasOpenAiKey}
          <ThreadAiActions
            onSummarize={() => void summarizeThread()}
            onExtractActions={() => void extractThreadActions()}
            summarizing={summarizingThread}
            extracting={extractingThreadActions}
          />
        {/if}
        <button
          type="button"
          aria-label="Share thread"
          data-app-tooltip="Share thread"
          onclick={() => openThreadShareModal()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 md:border-white/8"
        >
          <Share2 size={16} />
        </button>
        </div>
      </div>

      <MobileMailActions actions={mobileActions} />
      <div class="hidden flex-wrap items-center gap-1 md:flex md:justify-end">
        {#if lastMessage}
          <ReplyActions
            onReply={() => openReply(lastMessage)}
            onReplyAll={() => openReplyAll(lastMessage)}
            onAiReply={() => void generateReplyDraft(lastMessage)}
            aiEnabled={page.data.hasOpenAiKey}
            drafting={draftingReplyMessageId === lastMessage.id}
            iconOnly
          />
          <MarkActions
            onMarkUnread={() => void markThreadUnread()}
            onToggleStar={() => void toggleThreadMetadata('starred')}
            onTogglePin={() => void toggleThreadMetadata('pinned')}
            onSnooze={() => void snoozeThread()}
            starred={threadMetadata.starred}
            pinned={threadMetadata.pinned}
            disabled={acting}
          />
        {/if}
      </div>
    </div>

    <div class="mt-3 flex min-w-0 items-center gap-2">
      <h1 class="truncate text-lg font-semibold text-white">{subject}</h1>
      {#if lastMessage.sendStatus}
        <SendStatusIndicator status={lastMessage.sendStatus} openedAt={openedAtFor(lastMessage)} />
      {/if}
    </div>
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
                  {#if msg.sendStatus}
                    <SendStatusIndicator
                      status={msg.sendStatus}
                      openedAt={openedAtFor(msg)}
                      size={12}
                    />
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
              <ChevronDown
                size={14}
                class="text-zinc-600 transition-transform {isExpanded ? 'rotate-180' : ''}"
              />
            </div>
          </div>

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="px-4 pb-4 sm:px-5">
              {#if msg.sendStatus}
                <div class="mb-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <p
                    class={[
                      'text-sm font-semibold',
                      msg.sendStatus === 'failed'
                        ? 'text-rose-300'
                        : msg.sendStatus === 'sent'
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                    ]}
                  >
                    {sendStatusLabel(msg.sendStatus, openedAtFor(msg))}
                  </p>
                  {#if msg.sendStatus === 'sent'}
                    <p class="mt-1 text-sm text-zinc-400">
                      {openedAtFor(msg)
                        ? `A recipient's mail client loaded the tracking image on ${formatFullDate(openedAtFor(msg))}.`
                        : 'The tracking image has not been loaded yet.'}
                    </p>
                  {/if}
                </div>
              {/if}
              <div class="mb-3">
                <div class="flex flex-wrap gap-2">
                  <OpenPgpIndicator
                    signed={msg.openPgpSigned}
                    signatureStatus={msg.openPgpSignatureStatus}
                    signer={msg.openPgpSigner}
                    fingerprint={msg.openPgpFingerprint}
                    encrypted={msg.openPgpEncrypted}
                    decrypted={msg.openPgpDecrypted}
                    error={msg.openPgpError}
                    compact
                  />
                </div>
              </div>
              {#if remoteContentBody.blockedCount > 0}
                <div
                  class="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100 backdrop-blur-xl"
                >
                  <p class="min-w-0 flex-1 truncate text-amber-100/80">
                    <span class="font-semibold text-amber-100">Remote content blocked.</span>
                    {remoteContentBody.blockedCount} external resource{remoteContentBody.blockedCount ===
                    1
                      ? ''
                      : 's'} blocked to protect your privacy.
                  </p>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onclick={() => showRemoteContentIds.add(msg.id)}
                      class="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-xs font-medium text-amber-50 transition hover:bg-amber-300/20"
                    >
                      Show this time
                    </button>
                    {#if normalizeSenderAddress(msg.from)}
                      <button
                        type="button"
                        disabled={trustingRemoteSenderId !== null}
                        onclick={() => void trustRemoteContentSender(msg)}
                        class="rounded-md bg-amber-300 px-2 py-1 text-xs font-medium text-zinc-950 transition hover:bg-amber-200 disabled:opacity-60"
                      >
                        {trustingRemoteSenderId === msg.id ? 'Saving...' : 'Always trust sender'}
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}

              {#if srcdoc}
                <iframe
                  title="Message body"
                  {srcdoc}
                  sandbox="allow-same-origin"
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
                        <div class="flex flex-wrap items-center gap-2">
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
                                data-app-tooltip={safety.reasons.join('; ')}
                              >
                                <ShieldAlert size={10} />
                                {safety.label}
                              </span>
                            {/if}
                          </div>
                          <AttachmentSummary attachment={att} compact iconOnly />
                          <a
                            href={resolve(`/api/attachments/${att.id}`)}
                            download={att.filename || 'attachment'}
                            onclick={(event) => confirmHighRiskDownload(event, att)}
                            class="shrink-0 text-zinc-500 transition hover:text-zinc-300"
                            aria-label="Download {att.filename}"
                          >
                            <Download size={14} />
                          </a>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Per-message reply -->
              <div class="mt-4 flex flex-wrap gap-2">
                <ReplyActions
                  onReply={() => openReply(msg)}
                  onReplyAll={() => openReplyAll(msg)}
                  onAiReply={() => void generateReplyDraft(msg)}
                  aiEnabled={page.data.hasOpenAiKey}
                  drafting={draftingReplyMessageId === msg.id}
                />
              </div>
            </div>
          {/if}
        </div>
      {/each}

      <div
        class={[
          'rounded-2xl bg-white/2 transition-colors md:rounded-none md:bg-transparent',
          notesExpanded ? 'bg-white/4 md:bg-white/2' : 'hover:bg-white/4 md:hover:bg-white/2'
        ].join(' ')}
      >
        <div class="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"
          >
            <StickyNote size={14} class={hasSavedNote ? 'text-amber-300' : 'text-zinc-500'} />
          </div>

          <button
            type="button"
            onclick={toggleNotesCollapsed}
            aria-expanded={notesExpanded}
            disabled={noteDirty}
            data-app-tooltip={noteDirty
              ? 'Save or clear changes before collapsing notes'
              : undefined}
            class="min-w-0 flex-1 text-left disabled:cursor-default"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-zinc-300">Private note</span>
                <span class="truncate text-xs text-zinc-500">Only visible to you</span>
              </div>
              {#if !notesExpanded}
                <p class="mt-0.5 truncate text-xs text-zinc-500">
                  {savedNoteBody || 'Add a private note to this thread'}
                </p>
              {/if}
            </div>
          </button>

          <div class="flex shrink-0 items-center gap-1.5">
            {#if noteDirty}
              <span class="text-xs text-amber-300">Unsaved</span>
            {:else if savedNoteUpdatedAt}
              <span class="text-xs text-zinc-500">{formatFullDate(savedNoteUpdatedAt)}</span>
            {/if}
            <ChevronDown
              size={14}
              class="text-zinc-600 transition-transform {notesExpanded ? 'rotate-180' : ''}"
            />
          </div>
        </div>

        {#if notesExpanded}
          <div class="px-4 pb-4 sm:px-5">
            <textarea
              bind:value={noteDraft}
              rows="4"
              maxlength="10000"
              placeholder="Add a private note for this thread. It stays in this mail app and is never sent."
              class="w-full resize-y rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm leading-6 text-zinc-200 transition outline-none placeholder:text-zinc-600 backdrop-blur-xl focus:border-amber-300/40 focus:ring-2 focus:ring-amber-300/10"
            ></textarea>
            <div class="mt-3 flex items-center justify-between gap-3">
              <p class="text-xs text-zinc-500">Private to this mail app and never sent.</p>
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
        {/if}
      </div>
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
      class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0d0d10]/85 backdrop-blur-xl"
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

{#if rawMessage}
  <RawMessageDialog
    messageId={rawMessage.id}
    subject={rawMessage.subject}
    onclose={() => (rawMessage = null)}
  />
{/if}

{#if pendingUrl}
  <UrlWarningDialog
    url={pendingUrl}
    oncancel={() => (pendingUrl = null)}
    oncontinue={openPendingUrl}
  />
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

{#if showShareModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
    <div
      class="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/85 shadow-2xl backdrop-blur-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-white/8 px-6 py-4">
        <div class="flex items-center gap-2">
          <Share2 size={18} class="text-sky-400" />
          <h2 class="text-lg font-semibold text-white">Share Thread</h2>
        </div>
        <button
          type="button"
          onclick={closeThreadShareModal}
          class="rounded-lg p-1.5 text-zinc-400 hover:bg-white/6 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <p class="text-sm text-zinc-400">
          Select messages from this thread to include in the public share link.
        </p>

        <!-- Selection Controls: Master Checkbox Header -->
        <div class="mt-4 flex items-center justify-between border-b border-white/8 px-1 pb-3">
          <label class="flex cursor-pointer items-center gap-3 select-none">
            <input
              type="checkbox"
              checked={allShareMessagesSelected}
              onchange={toggleSelectAllShareMessages}
              class="h-4 w-4 cursor-pointer rounded border-white/20 bg-white/5 text-sky-500 focus:ring-sky-500"
            />
            <span class="text-xs font-semibold text-zinc-200">
              전체 선택 ({selectedShareMessageIds.length}/{messages.length})
            </span>
          </label>
        </div>

        <!-- Message List -->
        <div class="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
          {#each messages as msg (msg.messageId)}
            {@const isSelected = selectedShareMessageIds.includes(msg.messageId)}
            <div
              role="button"
              tabindex="0"
              onclick={() => toggleShareMessage(msg.messageId)}
              onkeydown={(e) => e.key === 'Enter' && toggleShareMessage(msg.messageId)}
              class={[
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition',
                isSelected
                  ? 'border-sky-500/30 bg-sky-500/10 text-white'
                  : 'border-white/5 bg-white/2 text-zinc-400 hover:border-white/10 hover:bg-white/4'
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={isSelected}
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onchange={() => toggleShareMessage(msg.messageId)}
                class="h-4 w-4 rounded border-white/20 bg-white/5 text-sky-500 focus:ring-sky-500"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-xs font-medium text-zinc-200">
                    {senderName(msg.from)}
                  </p>
                  <span class="text-[11px] text-zinc-500">
                    {formatFullDate(msg.receivedAt)}
                  </span>
                </div>
                <p class="mt-0.5 truncate text-xs text-zinc-400">
                  {msg.preview || msg.subject || '(no content)'}
                </p>
              </div>
            </div>
          {/each}
        </div>

        <!-- Generated URL result -->
        {#if generatedShareUrl}
          <div class="mt-5 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5">
            <label for="share-link-input" class="block text-xs font-medium text-sky-300"
              >Public Share Link</label
            >
            <div class="mt-1.5 flex items-center gap-2">
              <input
                id="share-link-input"
                type="text"
                readonly
                value={generatedShareUrl}
                class="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-zinc-200 backdrop-blur-xl focus:outline-none"
              />
              <button
                type="button"
                onclick={copyShareLink}
                class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500"
              >
                {#if copiedShareUrl}
                  <Check size={14} />
                  Copied!
                {:else}
                  <Copy size={14} />
                  복사
                {/if}
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer Actions -->
      <div class="flex items-center justify-end gap-3 border-t border-white/8 bg-white/2 px-6 py-4">
        <button
          type="button"
          onclick={closeThreadShareModal}
          class="rounded-lg px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-white/6 hover:text-white"
        >
          Close
        </button>
        <button
          type="button"
          disabled={selectedShareMessageIds.length === 0 || generatingShareUrl}
          onclick={createThreadShareLink}
          class="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if generatingShareUrl}
            Generating...
          {:else}
            공유 링크 생성 ({selectedShareMessageIds.length})
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
