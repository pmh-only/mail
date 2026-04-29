<script lang="ts">
  import {
    Archive,
    Trash2,
    ShieldAlert,
    Mail,
    Reply,
    ReplyAll,
    Scissors,
    ChevronDown,
    ChevronLeft,
    Paperclip,
    Download,
    FileImage,
    FileText,
    Sparkles,
    X
  } from 'lucide-svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { onMount, tick } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { openReply, openReplyAll } from '$lib/composer.svelte'
  import { setupKeyboardHandler } from '$lib/keyboard.svelte'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'

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
  }

  type Attachment = {
    id: number
    messageId: string
    filename: string
    contentType: string
    size: number
  }

  type Props = {
    data: {
      threadId: string
      mailbox: string
      messages: Message[]
      attachments: Attachment[]
      mailboxRole: 'inbox' | 'archive' | 'trash' | 'spam' | null
    }
  }

  let { data }: Props = $props()

  const messages = $derived(data.messages)
  const attachments = $derived(data.attachments)
  const role = $derived(data.mailboxRole)
  const subject = $derived(messages[0]?.subject ?? '(no subject)')
  const defaultExpandedId = $derived(messages[messages.length - 1]?.id ?? null)

  // Latest message expanded by default
  let expandedIds = $state(new SvelteSet<number>())
  let collapsedDefaultIds = $state(new SvelteSet<number>())
  let initializedThreadId = $state<string | null>(null)
  let acting = $state(false)
  let splittingId = $state<number | null>(null)
  let errorDialogMessage = $state<string | null>(null)
  let metadataMessage = $state<Message | null>(null)
  let scrollToLatestPending = $state(false)
  let threadSummary = $state<string | null>(null)
  let summarizingThread = $state(false)
  let threadSummaryAbort = $state<AbortController | null>(null)

  function gotoMailbox() {
    return goto(resolve(`/${page.params.mailbox}`), { noScroll: true, keepFocus: true })
  }

  function toggleExpanded(id: number) {
    if (isMessageExpanded(id)) {
      expandedIds.delete(id)
      collapsedDefaultIds.add(id)
    } else {
      collapsedDefaultIds.delete(id)
      expandedIds.add(id)
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
      await gotoMailbox()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark thread unread.')
    } finally {
      acting = false
    }
  }

  async function splitThreadFrom(msg: Message) {
    if (splittingId !== null) return
    splittingId = msg.id
    try {
      const response = await trackAppLoading(() =>
        fetch(resolve(`/api/threads/${encodeURIComponent(data.threadId)}/split`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mailbox: page.params.mailbox, messageId: msg.id })
        })
      )

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to split thread.'))
      }

      const result = (await response.json()) as { threadKey: string }
      await goto(
        resolve(`/${page.params.mailbox}/thread/${encodeURIComponent(result.threadKey)}`),
        {
          noScroll: true,
          keepFocus: true
        }
      )
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to split thread.')
    } finally {
      splittingId = null
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
    if (initializedThreadId === data.threadId) return

    expandedIds = new SvelteSet<number>()
    collapsedDefaultIds = new SvelteSet<number>()
    threadSummaryAbort?.abort()
    threadSummaryAbort = null
    threadSummary = null
    summarizingThread = false
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
        <button
          type="button"
          aria-label="Summarize thread"
          disabled={summarizingThread}
          onclick={() => summarizeThread()}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 disabled:cursor-wait disabled:opacity-60 md:border-white/8"
        >
          <Sparkles size={16} class={summarizingThread ? 'animate-pulse' : ''} />
        </button>
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
        {/if}
      </div>
    </div>

    <h1 class="mt-3 text-lg font-semibold text-white">{subject}</h1>
    <p class="mt-0.5 text-sm text-zinc-500">
      {messages.length} message{messages.length === 1 ? '' : 's'}
    </p>
    {#if threadSummary !== null}
      <div class="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
        <div class="mb-2 flex items-center justify-between gap-3">
          <p class="text-xs font-medium tracking-wide text-zinc-400 uppercase">Thread Summary</p>
          {#if summarizingThread}
            <p class="text-xs text-sky-300">Summarizing...</p>
          {/if}
        </div>
        <p class="text-sm leading-6 whitespace-pre-wrap text-zinc-200">
          {threadSummary || 'Generating summary...'}
        </p>
      </div>
    {/if}
  </div>

  <!-- Thread messages accordion -->
  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto">
    <div class="space-y-2 p-2 md:space-y-0 md:divide-y md:divide-white/8 md:p-0">
      {#each messages as msg, index (msg.id)}
        {@const isExpanded = isMessageExpanded(msg.id)}
        {@const msgAttachments = getMessageAttachments(msg.messageId)}
        {@const srcdoc = msg.htmlContent ? injectScrollbarStyle(msg.htmlContent) : null}

        <div
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
              onclick={() => toggleExpanded(msg.id)}
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

<ErrorDialog
  message={errorDialogMessage}
  title="Thread error"
  onclose={() => (errorDialogMessage = null)}
/>

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
                      <div
                        class="flex items-center gap-2 rounded-lg border border-transparent bg-white/3 px-3 py-2 md:border-white/8"
                      >
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
                        </div>
                        <a
                          href={resolve(`/api/attachments/${att.id}`)}
                          download={att.filename || 'attachment'}
                          class="ml-1 shrink-0 text-zinc-500 transition hover:text-zinc-300"
                          aria-label="Download {att.filename}"
                        >
                          <Download size={14} />
                        </a>
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
                {#if index > 0}
                  <button
                    type="button"
                    disabled={splittingId !== null}
                    onclick={() => splitThreadFrom(msg)}
                    class="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
                  >
                    <Scissors size={13} />
                    {splittingId === msg.id ? 'Splitting...' : 'Split from here'}
                  </button>
                {/if}
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
