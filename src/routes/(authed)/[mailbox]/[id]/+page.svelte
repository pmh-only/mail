<script lang="ts">
  import {
    Archive,
    Trash2,
    ShieldAlert,
    Reply,
    ReplyAll,
    Forward,
    Share2,
    Check,
    Info,
    Mail,
    Paperclip,
    Download,
    FileText,
    FileVideo,
    FileImage,
    X,
    ChevronLeft,
    ChevronRight,
    Languages,
    Clock,
    Sparkles,
    WifiOff
  } from 'lucide-svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import AttachmentSummary from '$lib/components/AttachmentSummary.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { onMount } from 'svelte'
  import { SvelteDate } from 'svelte/reactivity'
  import { openReply, openReplyAll, openForward } from '$lib/composer.svelte'
  import { setupKeyboardHandler } from '$lib/keyboard.svelte'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'
  import {
    normalizeAllowedSenders,
    normalizeSenderAddress,
    prepareRemoteContent
  } from '$lib/remote-content'
  import { scoreAttachmentSafety, type AttachmentSafetyScore } from '$lib/mail-attachments'
  import { saveOfflineMessage } from '$lib/offline-cache'
  import { toast } from 'svelte-sonner'

  type DensityPreference = 'comfortable' | 'compact' | 'condensed'

  type Message = {
    id: number
    uid: number
    messageId: string
    mailbox: string
    subject: string | null
    from: string | null
    to: string | null
    cc: string | null
    replyTo: string | null
    preview: string | null
    htmlContent: string | null
    textContent: string | null
    tracingCodeCount: number
    inReplyTo: string | null
    references: string | null
    flags: string[]
    receivedAt: string | null
    snoozedUntil: string | null
  }

  type Attachment = {
    id: number
    filename: string
    contentType: string
    size: number
  }

  type Props = {
    data: {
      message: Message
      mailboxRole: 'inbox' | 'archive' | 'trash' | 'spam' | null
      attachments: Attachment[]
      density: DensityPreference
      translationTargetLanguage: string
      remoteContent: {
        blockRemoteContent: boolean
        allowedSenders: string[]
      }
      user?: { name: string; email: string } | null
    }
  }

  let { data }: Props = $props()

  const role = $derived(data.mailboxRole)
  const density = $derived(data.density ?? 'comfortable')
  const translationTargetLanguage = $derived(data.translationTargetLanguage || 'Korean')
  const messageHeaderClass = $derived(
    density === 'condensed'
      ? 'mail-content-header p-3 sm:p-4 md:border-b md:border-white/8'
      : 'mail-content-header p-4 sm:p-5 md:border-b md:border-white/8'
  )
  const messageMetaClass = $derived(
    density === 'condensed'
      ? 'mt-1 space-y-0.5 text-xs text-zinc-500'
      : 'mt-2 space-y-1 text-xs text-zinc-500'
  )
  const messageBodyClass = $derived(
    density === 'condensed'
      ? 'space-y-3 p-3 text-[14px] leading-6 text-zinc-200 sm:p-4'
      : 'space-y-5 p-4 text-[15px] leading-7 text-zinc-200 sm:p-5 sm:leading-8'
  )
  const messageSectionClass = $derived(
    density === 'condensed'
      ? 'border-b border-white/8 bg-[#101116] p-3 sm:p-4'
      : 'border-b border-white/8 bg-[#101116] p-4 sm:p-5'
  )
  const attachmentsClass = $derived(
    density === 'condensed'
      ? 'p-3 sm:p-4 md:border-t md:border-white/8'
      : 'p-4 sm:p-5 md:border-t md:border-white/8'
  )

  let acting = $state(false)
  let sharing = $state(false)
  let shareCopied = $state(false)
  let metadataOpen = $state(false)
  let translating = $state(false)
  let draftingReply = $state(false)
  let translationText = $state<string | null>(null)
  let translatedHtmlSegments = $state<string[] | null>(null)
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
  let showRemoteContent = $state(false)
  let trustingRemoteSender = $state(false)
  let allowedRemoteSenders = $state<string[]>([])
  let translationResolvedCount = $state(0)
  let translationSegmentCount = $state(0)
  let activeMessageId = $state<number | null>(null)
  let translationAbortController: AbortController | null = null
  let translationRequestId = 0
  let messageFrame = $state<HTMLIFrameElement | undefined>(undefined)
  let online = $state(true)

  const offlineUserKey = $derived(data.user?.email ?? null)

  type TranslationStreamPayload = {
    translations?: string[]
    resolved?: number
    done?: boolean
    error?: string
  }

  type HtmlTranslationSegment = { text: string }

  type FrameTranslationSegment = {
    node: Text
    prefix: string
    text: string
    suffix: string
  }

  type HtmlTranslationPlan = {
    segments: HtmlTranslationSegment[]
  }

  function messageFrameTranslationSegments() {
    const doc = messageFrame?.contentDocument
    const root = doc?.body ?? doc?.documentElement
    if (!root || !doc) return []

    const segments: FrameTranslationSegment[] = []
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest('script, style, noscript, template, svg, math')) {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    })

    let current = walker.nextNode()
    while (current) {
      const node = current as Text
      const { prefix, text, suffix } = splitTextNodeValue(node.nodeValue ?? '')
      if (text) segments.push({ node, prefix, text, suffix })
      current = walker.nextNode()
    }

    return segments
  }

  function syncMessageFrameHeight(frame = messageFrame) {
    const doc = frame?.contentDocument
    if (!doc || !frame) return
    frame.style.height = '400px'
    const height = Math.max(400, doc.documentElement.scrollHeight)
    frame.style.height = `${height}px`
  }

  function resetMessageViewport() {
    messageContentScrolled = false
    messageToolbarHovered = false
    scrollContainer?.scrollTo({ top: 0 })
    if (messageFrame) messageFrame.style.height = '400px'
  }

  function applyTranslationsToMessageFrame(translations: string[] | null) {
    const segments = messageFrameTranslationSegments()
    if (segments.length === 0) return

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const next = translations?.[index] ?? segment.text
      segment.node.nodeValue = `${segment.prefix}${next}${segment.suffix}`
    }

    syncMessageFrameHeight()
  }

  function resetTranslationState() {
    translating = false
    translationText = null
    translatedHtmlSegments = null
    translationResolvedCount = 0
    translationSegmentCount = 0
    applyTranslationsToMessageFrame(null)
  }

  function cancelTranslation() {
    translationRequestId += 1
    translationAbortController?.abort()
    translationAbortController = null
    resetTranslationState()
  }

  $effect(() => {
    allowedRemoteSenders = data.remoteContent.allowedSenders
  })

  $effect(() => {
    if (activeMessageId === null) {
      activeMessageId = data.message.id
      return
    }

    if (data.message.id === activeMessageId) return

    activeMessageId = data.message.id
    resetMessageViewport()
    cancelTranslation()
  })

  function gotoMailbox() {
    return goto(resolve(`/${page.params.mailbox}`), { noScroll: true, keepFocus: true })
  }

  function splitTextNodeValue(value: string) {
    const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/)
    return {
      prefix: match?.[1] ?? '',
      text: match?.[2] ?? value.trim(),
      suffix: match?.[3] ?? ''
    }
  }

  function createHtmlTranslationPlan(html: string): HtmlTranslationPlan {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const root = doc.body ?? doc.documentElement
    const segments: HtmlTranslationSegment[] = []
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest('script, style, noscript, template, svg, math')) {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    })

    let current = walker.nextNode()
    while (current) {
      const node = current as Text
      const { text } = splitTextNodeValue(node.nodeValue ?? '')
      if (text) segments.push({ text })
      current = walker.nextNode()
    }

    return { segments }
  }

  function applyMessageTranslations(plan: HtmlTranslationPlan | null, translations: string[]) {
    if (plan) {
      translatedHtmlSegments = translations
      applyTranslationsToMessageFrame(translations)
      return
    }

    translationText = translations[0] ?? null
  }

  async function readJsonLines(
    response: Response,
    onEvent: (payload: TranslationStreamPayload) => void
  ) {
    if (!response.body) {
      onEvent((await response.json()) as TranslationStreamPayload)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        onEvent(JSON.parse(trimmed) as TranslationStreamPayload)
      }
    }

    buffer += decoder.decode()
    const trimmed = buffer.trim()
    if (trimmed) onEvent(JSON.parse(trimmed) as TranslationStreamPayload)
  }

  async function shareMessage() {
    if (sharing) return
    sharing = true
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.message.id })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to create share link.'))
      }

      const { url } = await res.json()
      await navigator.clipboard.writeText(url)
      shareCopied = true
      toast('Share link copied')
      setTimeout(() => {
        shareCopied = false
      }, 2000)
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to create share link.')
    } finally {
      sharing = false
    }
  }

  async function markUnread() {
    if (acting) return
    acting = true
    try {
      const res = await trackAppLoading(() =>
        fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [data.message.id], action: 'mark_unread' })
        })
      )
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to mark message unread.'))
      }

      notifyMailboxStateChanged('message-action:mark-unread')
      toast('Message marked as unread')
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark message unread.')
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
      title: 'Snooze message',
      inputLabel: 'Snooze until',
      inputValue: defaultSnoozeInputValue(),
      inputType: 'datetime-local',
      confirmLabel: 'Snooze'
    })
    if (value === null || typeof value === 'boolean') return null

    const trimmed = value.trim()
    const date = trimmed ? new Date(trimmed) : null
    if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      errorDialogMessage = 'Choose a future date and time to snooze this message.'
      return null
    }

    return date
  }

  async function snoozeMessage() {
    if (acting) return
    const snoozedUntil = await promptForSnoozeDate()
    if (!snoozedUntil) return

    acting = true
    try {
      const res = await trackAppLoading(() =>
        fetch(`/api/messages/${data.message.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'snooze', snoozedUntil: snoozedUntil.toISOString() })
        })
      )
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to snooze message.'))
      }

      notifyMailboxStateChanged('message-action:snooze')
      toast('Message snoozed')
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to snooze message.')
    } finally {
      acting = false
    }
  }

  async function translateMessage() {
    if (translating) return
    const requestId = ++translationRequestId
    const messageId = data.message.id
    const controller = new AbortController()
    const htmlPlan = data.message.htmlContent
      ? createHtmlTranslationPlan(data.message.htmlContent)
      : null
    const textSegments = htmlPlan?.segments.map((segment) => segment.text) ?? [
      data.message.textContent || data.message.preview || ''
    ]

    if (textSegments.length === 0) {
      errorDialogMessage = 'No text found to translate.'
      return
    }

    translationAbortController = controller
    translating = true
    translationResolvedCount = 0
    translationSegmentCount = textSegments.length
    translatedHtmlSegments = null
    translationText = null
    applyTranslationsToMessageFrame(null)
    try {
      const res = await trackAppLoading(() =>
        fetch('/api/ai/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: messageId,
            targetLanguage: translationTargetLanguage,
            format: htmlPlan ? 'html' : 'text',
            segments: textSegments,
            stream: true
          }),
          signal: controller.signal
        })
      )

      if (requestId !== translationRequestId || data.message.id !== messageId) return

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Translation failed.'))
      }

      await readJsonLines(res, (payload) => {
        if (requestId !== translationRequestId || data.message.id !== messageId) return
        if (payload.error) throw new Error(payload.error)

        const translations = payload.translations ?? []
        if (translations.length !== textSegments.length) {
          throw new Error('Translation response did not match the source text.')
        }

        translationResolvedCount = Math.min(
          payload.resolved ?? translations.length,
          textSegments.length
        )
        applyMessageTranslations(htmlPlan, translations)
      })
    } catch (error) {
      if (controller.signal.aborted) return
      if (requestId !== translationRequestId || data.message.id !== messageId) return
      errorDialogMessage = errorMessageFromUnknown(error, 'Translation failed.')
      if (!translationText) translationText = null
      if (!translatedHtmlSegments) translatedHtmlSegments = null
    } finally {
      if (requestId === translationRequestId) {
        translationAbortController = null
        translating = false
      }
    }
  }

  async function generateReplyDraft(replyAll = false) {
    if (draftingReply) return
    draftingReply = true

    try {
      const response = await fetch('/api/ai/reply-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mailbox: page.params.mailbox ?? 'inbox',
          messageId: data.message.id,
          replyAll
        })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to generate reply draft.'))
      }

      const draft = (await response.json()) as { html?: string }
      if (!draft.html) throw new Error('Reply draft was empty.')

      if (replyAll) {
        openReplyAll(message, draft.html)
      } else {
        openReply(message, draft.html)
      }
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to generate reply draft.')
    } finally {
      draftingReply = false
    }
  }

  async function performAction(action: 'archive' | 'trash' | 'spam' | 'inbox') {
    if (acting) return
    acting = true
    try {
      const res = await trackAppLoading(() =>
        fetch(`/api/messages/${data.message.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        })
      )
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to ${action} message.`))
      }

      notifyMailboxStateChanged(`message-action:${action}`)
      toast(`Message moved to ${action}`)
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, `Failed to ${action} message.`)
    } finally {
      acting = false
    }
  }

  const message = $derived(data.message)

  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

  function formatFullDate(value: string | null | undefined) {
    if (!value) return 'Unknown'
    return fullDateFormatter.format(new Date(value))
  }

  function senderLabel(from: string | null | undefined) {
    if (!from) return 'Unknown sender'
    return from
  }

  function senderName(from: string | null | undefined) {
    const label = senderLabel(from)
    return label.split('<')[0]?.trim() || label
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

  function subjectLabel(subject: string | null | undefined) {
    if (!subject) return '(no subject)'
    return subject
  }

  function hasValue(value: string | null | undefined) {
    return Boolean(value && value.trim())
  }

  function compactAddress(value: string | null | undefined) {
    return value?.trim() || ''
  }

  function metadataRows(msg: Message) {
    return [
      { label: 'From', value: msg.from },
      { label: 'To', value: msg.to },
      { label: 'Cc', value: msg.cc },
      { label: 'Reply-To', value: msg.replyTo },
      { label: 'Mailbox', value: msg.mailbox },
      { label: 'Message-ID', value: msg.messageId },
      { label: 'UID', value: String(msg.uid) },
      { label: 'Received', value: formatFullDate(msg.receivedAt) },
      { label: 'In-Reply-To', value: msg.inReplyTo },
      { label: 'References', value: msg.references },
      { label: 'Flags', value: msg.flags.join(', ') || '—' }
    ].filter((row) => hasValue(row.value))
  }

  function bodyText(msg: Message) {
    if (translationText) return translationText
    return msg.textContent || msg.preview || 'No message body available.'
  }

  const SCROLLBAR_STYLE = `<style>
*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.18) transparent}
*::-webkit-scrollbar{width:6px;height:6px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:999px}
*::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.32)}
:root {
	padding: 12px;
}
</style>`

  const LINK_SCRIPT =
    `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href&&a.protocol!=='javascript:'){e.preventDefault();window.open(a.href,'_blank','noopener,noreferrer');}});</scr` +
    `ipt>`

  function injectScrollbarStyle(html: string): string {
    const headClose = html.indexOf('</head>')
    if (headClose !== -1)
      return html.slice(0, headClose) + SCROLLBAR_STYLE + LINK_SCRIPT + html.slice(headClose)
    return SCROLLBAR_STYLE + LINK_SCRIPT + html
  }

  const remoteContentSettings = $derived({
    blockRemoteContent: data.remoteContent.blockRemoteContent,
    allowedSenders: allowedRemoteSenders
  })

  const remoteContentBody = $derived.by(() => {
    const html = message.htmlContent
    if (!html) return { html: '', blockedCount: 0 }
    return prepareRemoteContent(html, message.from, remoteContentSettings, showRemoteContent)
  })

  const srcdoc = $derived.by(() => {
    const html = message.htmlContent
    if (!html) return null
    return injectScrollbarStyle(remoteContentBody.html)
  })

  const remoteContentSender = $derived(normalizeSenderAddress(message.from))

  async function trustRemoteContentSender() {
    if (!remoteContentSender || trustingRemoteSender) return
    trustingRemoteSender = true
    try {
      const nextAllowedSenders = normalizeAllowedSenders([
        ...allowedRemoteSenders,
        remoteContentSender
      ])
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
      showRemoteContent = true
      toast('Sender trusted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to trust sender.')
    } finally {
      trustingRemoteSender = false
    }
  }

  const attachments = $derived(data.attachments)

  async function cacheOpenedMessage() {
    if (!offlineUserKey) return
    await saveOfflineMessage({
      userKey: offlineUserKey,
      message: data.message,
      mailboxRole: data.mailboxRole,
      attachments: data.attachments
    })
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

  function isImage(contentType: string) {
    return contentType.startsWith('image/')
  }

  function isPdf(contentType: string) {
    return contentType === 'application/pdf'
  }

  function isVideo(contentType: string) {
    return contentType.startsWith('video/')
  }

  function isPreviewable(contentType: string) {
    return isImage(contentType) || isPdf(contentType) || isVideo(contentType)
  }

  function attachmentIcon(contentType: string) {
    if (isImage(contentType)) return FileImage
    if (isPdf(contentType)) return FileText
    if (isVideo(contentType)) return FileVideo
    return FileImage
  }

  // Preview lightbox state
  let previewIndex = $state<number | null>(null)

  let scrollContainer = $state<HTMLDivElement | undefined>(undefined)
  let messageContentScrolled = $state(false)
  let messageToolbarHovered = $state(false)
  const messageToolbarExpanded = $derived(!messageContentScrolled || messageToolbarHovered)

  function scrollEmail(amount: number) {
    scrollContainer?.scrollBy({ top: amount, behavior: 'smooth' })
  }

  function handleMessageScroll(event: Event) {
    messageContentScrolled = (event.currentTarget as HTMLDivElement).scrollTop > 48
  }

  const previewableAttachments = $derived(attachments.filter((a) => isPreviewable(a.contentType)))

  function openPreview(att: (typeof attachments)[0]) {
    const idx = previewableAttachments.findIndex((a) => a.id === att.id)
    if (idx >= 0) previewIndex = idx
  }

  function closePreview() {
    previewIndex = null
  }

  function prevPreview() {
    if (previewIndex === null) return
    previewIndex =
      (previewIndex - 1 + previewableAttachments.length) % previewableAttachments.length
  }

  function nextPreview() {
    if (previewIndex === null) return
    previewIndex = (previewIndex + 1) % previewableAttachments.length
  }

  function onPreviewKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closePreview()
    else if (e.key === 'ArrowLeft') prevPreview()
    else if (e.key === 'ArrowRight') nextPreview()
  }

  onMount(() => {
    online = navigator.onLine
    void cacheOpenedMessage()

    const updateOnline = () => {
      online = navigator.onLine
    }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)

    setTimeout(() => notifyMailboxStateChanged('message-opened'), 0)

    const teardown = setupKeyboardHandler('message', {
      u: () => gotoMailbox(),
      r: () => openReply(message),
      a: () => openReplyAll(message),
      f: () => openForward(message),
      e: () => void performAction('archive'),
      '#': () => void performAction('trash'),
      Escape: () => gotoMailbox(),
      ArrowLeft: () => gotoMailbox(),
      ArrowDown: () => scrollEmail(60),
      ArrowUp: () => scrollEmail(-60)
    })

    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      teardown()
    }
  })
</script>

<svelte:head>
  <title>{subjectLabel(message.subject)} · Inbox</title>
</svelte:head>

<div
  bind:this={scrollContainer}
  class="flex h-full flex-col overflow-y-auto"
  onscroll={handleMessageScroll}
>
  <div
    class={[messageHeaderClass, 'sticky top-0 z-30 bg-[#101116]/95 backdrop-blur-xl'].join(' ')}
    role="presentation"
    onmouseenter={() => (messageToolbarHovered = true)}
    onmouseleave={() => (messageToolbarHovered = false)}
  >
    <div
      class={[
        'mail-actions-summary flex min-w-0 items-center justify-between gap-3',
        messageToolbarExpanded && 'is-hidden'
      ].join(' ')}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-zinc-200"
        >
          {senderInitials(message.from)}
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-white">{subjectLabel(message.subject)}</p>
          <p class="truncate text-xs text-zinc-500">{senderName(message.from)}</p>
        </div>
      </div>
      <p class="hidden shrink-0 text-xs text-zinc-600 sm:block">Hover for actions</p>
    </div>
    {#if !online && messageToolbarExpanded}
      <div
        class="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-400/8 px-3 py-1.5 text-xs text-amber-200"
      >
        <WifiOff size={13} />
        <span>Offline</span>
      </div>
    {/if}
    <div
      class={[
        'mail-actions-toolbar flex flex-wrap items-center justify-between gap-3',
        messageToolbarExpanded && 'is-visible'
      ].join(' ')}
    >
      <div class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onclick={() => gotoMailbox()}
          class="inline-flex items-center gap-2 rounded-lg border border-transparent bg-white/3 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/6 md:hidden"
        >
          <ChevronLeft size={16} />
          Back to list
        </button>
        {#if role === 'archive'}
          <div class="group relative">
            <button
              type="button"
              aria-label="Move to inbox"
              disabled={acting}
              onclick={() => performAction('inbox')}
              class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <Archive size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Move to inbox
            </span>
          </div>
        {:else if role === 'trash'}
          <div class="group relative">
            <button
              type="button"
              aria-label="Restore"
              disabled={acting}
              onclick={() => performAction('inbox')}
              class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <Trash2 size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Restore
            </span>
          </div>
        {:else if role === 'spam'}
          <div class="group relative">
            <button
              type="button"
              aria-label="Not spam"
              disabled={acting}
              onclick={() => performAction('inbox')}
              class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <ShieldAlert size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Not spam
            </span>
          </div>
        {:else}
          <div class="group relative">
            <button
              type="button"
              aria-label="Archive"
              disabled={acting}
              onclick={() => performAction('archive')}
              class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <Archive size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Archive
            </span>
          </div>
          <div class="group relative">
            <button
              type="button"
              aria-label="Delete"
              disabled={acting}
              onclick={() => performAction('trash')}
              class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <Trash2 size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Delete
            </span>
          </div>
        {/if}
        <button
          type="button"
          aria-label="Reply"
          onclick={() => openReply(message)}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
        >
          <Reply size={16} />
        </button>
        <button
          type="button"
          aria-label="Reply all"
          onclick={() => openReplyAll(message)}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
        >
          <ReplyAll size={16} />
        </button>
        <button
          type="button"
          aria-label="Draft reply with AI"
          disabled={draftingReply}
          onclick={() => void generateReplyDraft()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:hidden"
        >
          <Sparkles size={16} class={draftingReply ? 'animate-pulse' : ''} />
        </button>
        <button
          type="button"
          aria-label="Forward"
          onclick={() => openForward(message)}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
        >
          <Forward size={16} />
        </button>
        <button
          type="button"
          aria-label="View metadata"
          onclick={() => (metadataOpen = true)}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden"
        >
          <Info size={16} />
        </button>
        <button
          type="button"
          aria-label="Translate"
          disabled={translating}
          onclick={() => void translateMessage()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:hidden"
        >
          <Languages size={16} />
        </button>
        {#if role !== 'archive' && role !== 'trash' && role !== 'spam'}
          <button
            type="button"
            aria-label="Spam"
            disabled={acting}
            onclick={() => performAction('spam')}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <ShieldAlert size={16} />
          </button>
        {/if}
        <button
          type="button"
          aria-label="Mark unread"
          disabled={acting}
          onclick={() => void markUnread()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
        >
          <Mail size={16} />
        </button>
        <button
          type="button"
          aria-label="Snooze"
          disabled={acting}
          onclick={() => void snoozeMessage()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
        >
          <Clock size={16} />
        </button>
        <button
          type="button"
          aria-label={shareCopied ? 'Copied' : 'Share'}
          disabled={sharing}
          onclick={() => void shareMessage()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
        >
          {#if shareCopied}
            <Check size={16} class="text-emerald-400" />
          {:else}
            <Share2 size={16} />
          {/if}
        </button>
      </div>

      <div class="hidden flex-wrap items-center gap-1 md:flex md:justify-end">
        <div class="group relative">
          <button
            type="button"
            aria-label="Reply"
            onclick={() => openReply(message)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <Reply size={16} />
          </button>
          <span
            class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Reply
          </span>
        </div>
        <div class="group relative">
          <button
            type="button"
            aria-label="Reply all"
            onclick={() => openReplyAll(message)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <ReplyAll size={16} />
          </button>
          <span
            class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Reply all
          </span>
        </div>
        <div class="group relative">
          <button
            type="button"
            aria-label="Draft reply with AI"
            disabled={draftingReply}
            onclick={() => void generateReplyDraft()}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
          >
            <Sparkles size={16} class={draftingReply ? 'animate-pulse' : ''} />
          </button>
          <span
            class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            AI reply draft
          </span>
        </div>
        <div class="group relative">
          <button
            type="button"
            aria-label="Forward"
            onclick={() => openForward(message)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <Forward size={16} />
          </button>
          <span
            class="pointer-events-none absolute top-full right-0 mt-2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Forward
          </span>
        </div>
        <div class="group relative">
          <button
            type="button"
            aria-label="View metadata"
            onclick={() => (metadataOpen = true)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <Info size={16} />
          </button>
          <span
            class="pointer-events-none absolute top-full right-0 mt-2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Metadata
          </span>
        </div>
        <div class="group relative">
          <button
            type="button"
            aria-label="Translate"
            disabled={translating}
            onclick={() => void translateMessage()}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
          >
            <Languages size={16} />
          </button>
          <span
            class="pointer-events-none absolute top-full right-0 mt-2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Translate
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class={messageHeaderClass}>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 gap-3">
        <div
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-zinc-200"
        >
          {senderInitials(message.from)}
        </div>

        <div class="min-w-0">
          <h2 class="truncate text-xl font-semibold text-white">
            {subjectLabel(message.subject)}
          </h2>
          <div class="mt-1 flex min-w-0 items-center gap-2">
            <p class="truncate text-sm font-medium text-zinc-200">{senderName(message.from)}</p>
            {#if senderAddress(message.from)}
              <p class="truncate text-sm text-zinc-500">&lt;{senderAddress(message.from)}&gt;</p>
            {/if}
          </div>
          <div class={messageMetaClass}>
            {#if compactAddress(message.to)}
              <p class="truncate">
                <span class="mr-1 font-medium text-zinc-400">To</span>
                <span>{compactAddress(message.to)}</span>
              </p>
            {/if}
            {#if compactAddress(message.cc)}
              <p class="truncate">
                <span class="mr-1 font-medium text-zinc-400">Cc</span>
                <span>{compactAddress(message.cc)}</span>
              </p>
            {/if}
            {#if compactAddress(message.replyTo)}
              <p class="truncate">
                <span class="mr-1 font-medium text-zinc-400">Reply-To</span>
                <span>{compactAddress(message.replyTo)}</span>
              </p>
            {/if}
          </div>
        </div>
      </div>

      <p class="hidden text-sm text-zinc-500 sm:block sm:shrink-0 sm:text-right">
        {formatFullDate(message.receivedAt)}
      </p>
    </div>
  </div>

  <div class="flex flex-col">
    {#if translationText || translatedHtmlSegments || translating}
      <section class={messageSectionClass}>
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <Languages size={15} class="shrink-0 text-sky-300" />
            <p class="truncate text-sm font-semibold text-white">
              {translatedHtmlSegments
                ? `Translated email body (${translationTargetLanguage})`
                : `${translationTargetLanguage} translation`}
            </p>
          </div>
          {#if translationText || translatedHtmlSegments}
            <button
              type="button"
              onclick={() => cancelTranslation()}
              class="shrink-0 text-xs text-zinc-500 transition hover:text-zinc-300"
            >
              Show original
            </button>
          {/if}
        </div>

        {#if translating}
          <p class="mt-3 text-sm text-zinc-500">
            {#if translationResolvedCount > 0}
              Translating… {translationResolvedCount}/{translationSegmentCount} segments applied.
            {:else}
              Translating…
            {/if}
          </p>
        {:else if translationText || translatedHtmlSegments}
          <p class="mt-3 text-sm text-zinc-500">Translated content is shown in the email body.</p>
        {/if}
      </section>
    {/if}

    {#if message.tracingCodeCount > 0}
      <section class="border-b border-rose-500/20 bg-rose-500/10 p-4 sm:p-5">
        <div class="flex items-start gap-3">
          <ShieldAlert size={18} class="mt-0.5 shrink-0 text-rose-200" />
          <div>
            <p class="text-sm font-semibold text-rose-100">Tracing code detected</p>
            <p class="mt-1 text-sm text-rose-100/70">
              {message.tracingCodeCount} tracing code{message.tracingCodeCount === 1 ? '' : 's'} found
              in this email's HTML content.
            </p>
          </div>
        </div>
      </section>
    {/if}

    {#if remoteContentBody.blockedCount > 0}
      <section class="border-b border-amber-500/20 bg-amber-500/10 p-4 sm:p-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-semibold text-amber-100">Remote content blocked</p>
            <p class="mt-1 text-sm text-amber-100/70">
              {remoteContentBody.blockedCount} external resource{remoteContentBody.blockedCount ===
              1
                ? ''
                : 's'} were blocked to protect your privacy.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              onclick={() => (showRemoteContent = true)}
              class="rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-sm font-medium text-amber-50 transition hover:bg-amber-300/20"
            >
              Show this time
            </button>
            {#if remoteContentSender}
              <button
                type="button"
                disabled={trustingRemoteSender}
                onclick={() => void trustRemoteContentSender()}
                class="rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-200 disabled:opacity-60"
              >
                {trustingRemoteSender ? 'Saving...' : 'Always trust sender'}
              </button>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    {#if srcdoc}
      <iframe
        bind:this={messageFrame}
        title={`Email body for ${subjectLabel(message.subject)}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"
        {srcdoc}
        class="block min-h-[400px] w-full bg-white"
        onload={(e) => {
          const iframe = e.currentTarget as HTMLIFrameElement
          syncMessageFrameHeight(iframe)

          applyTranslationsToMessageFrame(translatedHtmlSegments)
        }}
      ></iframe>
    {:else}
      <div class={messageBodyClass}>
        {#each bodyText(message)
          .split(/\n{2,}/)
          .filter(Boolean) as paragraph, index (`${message.id}-${index}`)}
          <p>{paragraph}</p>
        {/each}
      </div>
    {/if}

    {#if attachments.length > 0}
      <div class={attachmentsClass}>
        <div class="mb-3 flex items-center gap-2">
          <Paperclip size={14} class="text-zinc-500" />
          <span class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
          </span>
        </div>
        <div class="flex flex-wrap gap-3">
          {#each attachments as att (att.id)}
            {@const safety = attachmentSafety(att)}
            <div
              class="group relative flex w-full flex-col overflow-hidden rounded-xl border border-transparent bg-white/3 transition hover:border-white/20 sm:w-40 md:border-white/10"
            >
              {#if isImage(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="block h-40 w-full overflow-hidden bg-black/20 focus:outline-none sm:h-32"
                  title="Click to preview"
                >
                  <img
                    src="/api/attachments/{att.id}?inline=1"
                    alt={att.filename}
                    class="h-full w-full object-contain object-center transition group-hover:scale-105"
                  />
                </button>
              {:else if isPdf(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="flex h-40 w-full min-w-0 flex-col items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 focus:outline-none sm:h-32"
                  title="Click to preview"
                >
                  <FileText size={36} />
                  <span class="text-xs">Preview PDF</span>
                </button>
              {:else if isVideo(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="flex h-40 w-full flex-col items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 focus:outline-none sm:h-32"
                  title="Click to preview"
                >
                  <FileVideo size={36} />
                  <span class="text-xs">Play video</span>
                </button>
              {:else}
                {@const Icon = attachmentIcon(att.contentType)}
                <div
                  class="flex h-40 w-full flex-col items-center justify-center gap-2 text-zinc-600 sm:h-32"
                >
                  <Icon size={36} />
                </div>
              {/if}
              <div class="flex items-center gap-2 px-2.5 py-2 md:border-t md:border-white/8">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium text-zinc-200">{att.filename}</p>
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
                  download={att.filename}
                  onclick={(event) => confirmHighRiskDownload(event, att)}
                  class="shrink-0 text-zinc-600 hover:text-zinc-300"
                  title="Download"
                >
                  <Download size={13} />
                </a>
              </div>
              <AttachmentSummary attachment={att} />
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if metadataOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget) metadataOpen = false
      }}
    >
      <div
        class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0d0d10]"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h3 class="text-base font-semibold text-white">Message Metadata</h3>
            <p class="mt-1 text-sm text-zinc-500">{subjectLabel(message.subject)}</p>
          </div>
          <button
            type="button"
            aria-label="Close metadata"
            onclick={() => (metadataOpen = false)}
            class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
          >
            <X size={16} />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <dl class="space-y-3">
            {#each metadataRows(message) as row (row.label)}
              <div
                class="grid gap-1 border-b border-white/6 py-2 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-4"
              >
                <dt class="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  {row.label}
                </dt>
                <dd class="min-w-0 text-sm break-all text-zinc-200">{row.value}</dd>
              </div>
            {/each}
          </dl>

          <div class="mt-6 space-y-4">
            <details class="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <summary class="cursor-pointer text-sm font-medium text-zinc-200">
                HTML Source
              </summary>
              <pre
                class="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-white/6 bg-black/20 p-3 text-xs leading-6 whitespace-pre-wrap text-zinc-300">{message.htmlContent ||
                  'No HTML content available.'}</pre>
            </details>

            <details class="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <summary class="cursor-pointer text-sm font-medium text-zinc-200">
                Text Source
              </summary>
              <pre
                class="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-white/6 bg-black/20 p-3 text-xs leading-6 whitespace-pre-wrap text-zinc-300">{message.textContent ||
                  'No text content available.'}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Preview lightbox -->
{#if previewIndex !== null}
  {@const att = previewableAttachments[previewIndex]}
  {@const safety = attachmentSafety(att)}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Attachment preview"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
    onclick={(e) => {
      if (e.target === e.currentTarget) closePreview()
    }}
    onkeydown={onPreviewKeydown}
    tabindex="-1"
  >
    <!-- Close -->
    <button
      type="button"
      onclick={closePreview}
      class="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      aria-label="Close"
    >
      <X size={18} />
    </button>

    <!-- Prev / Next -->
    {#if previewableAttachments.length > 1}
      <button
        type="button"
        onclick={prevPreview}
        class="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Previous"
      >
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        onclick={nextPreview}
        class="absolute right-14 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Next"
      >
        <ChevronRight size={20} />
      </button>
    {/if}

    <!-- Content -->
    <div class="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3">
      {#if isImage(att.contentType)}
        <img
          src="/api/attachments/{att.id}?inline=1"
          alt={att.filename}
          class="max-h-[80vh] max-w-[85vw] rounded-lg object-contain object-center shadow-2xl"
        />
      {:else if isPdf(att.contentType)}
        <iframe
          src="/api/attachments/{att.id}?inline=1"
          title={att.filename}
          class="h-[80vh] w-[80vw] rounded-lg bg-white"
        ></iframe>
      {:else if isVideo(att.contentType)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src="/api/attachments/{att.id}?inline=1"
          controls
          autoplay
          class="max-h-[80vh] max-w-[85vw] rounded-lg shadow-2xl"
        ></video>
      {/if}
      <div class="flex flex-wrap items-center justify-center gap-3 px-4 text-center sm:px-0">
        <p class="text-sm text-zinc-300">{att.filename}</p>
        <span class="text-xs text-zinc-600">{formatBytes(att.size)}</span>
        {#if safety.level !== 'low'}
          <span
            class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${attachmentSafetyClass(safety)}`}
            title={safety.reasons.join('; ')}
          >
            <ShieldAlert size={12} />
            {safety.label}
          </span>
        {/if}
        <a
          href={resolve(`/api/attachments/${att.id}`)}
          download={att.filename}
          onclick={(event) => confirmHighRiskDownload(event, att)}
          class="flex items-center gap-1 text-xs text-zinc-400 hover:text-white"
        >
          <Download size={13} /> Download
        </a>
      </div>
    </div>
  </div>
{/if}

<ErrorDialog
  message={errorDialogMessage}
  title="Message error"
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
