<script lang="ts">
  import {
    Archive,
    Trash2,
    ShieldAlert,
    Reply,
    ReplyAll,
    ChevronDown,
    Paperclip,
    Download,
    FileImage
  } from 'lucide-svelte'
  import { goto, invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { openReply, openReplyAll } from '$lib/composer.svelte'
  import { keyboard, setupKeyboardHandler } from '$lib/keyboard.svelte'

  type Message = {
    id: number
    uid: number
    messageId: string
    subject: string | null
    from: string | null
    to: string | null
    preview: string | null
    htmlContent: string | null
    textContent: string | null
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

  // Latest message expanded by default
  let expandedIds = new SvelteSet<number>()
  let acting = $state(false)

  function toggleExpanded(id: number) {
    if (expandedIds.has(id)) expandedIds.delete(id)
    else expandedIds.add(id)
  }

  async function performThreadAction(action: 'archive' | 'trash' | 'spam' | 'inbox') {
    if (acting) return
    acting = true
    try {
      const ids = messages.map((m) => m.id)
      await fetch('/api/messages/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, action })
      })
      await invalidateAll()
      await goto(resolve(`/${page.params.mailbox}`))
    } finally {
      acting = false
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

  const SCROLLBAR_STYLE = `<style>
*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.18) transparent}
*::-webkit-scrollbar{width:6px;height:6px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:999px}
*::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.32)}
:root{padding:12px}
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

  function getMessageAttachments(messageId: string) {
    return attachments.filter((a) => a.messageId === messageId)
  }

  const lastMessage = $derived(messages[messages.length - 1])

  onMount(() => {
    // Expand the latest message by default
    const last = messages[messages.length - 1]
    if (last) expandedIds.add(last.id)

    const prevContext = keyboard.context
    keyboard.context = 'message'

    const teardown = setupKeyboardHandler({
      u: () => goto(resolve(`/${page.params.mailbox}`)),
      r: () => lastMessage && openReply(lastMessage),
      a: () => lastMessage && openReplyAll(lastMessage),
      e: () => void performThreadAction('archive'),
      '#': () => void performThreadAction('trash'),
      Escape: () => goto(resolve(`/${page.params.mailbox}`))
    })

    return () => {
      keyboard.context = prevContext
      teardown()
    }
  })
</script>

<svelte:head>
  <title>{subject} · Thread</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Thread header -->
  <div class="border-b border-white/8 p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-1">
        {#if role === 'archive' || role === 'trash' || role === 'spam'}
          <button
            type="button"
            aria-label="Move to inbox"
            disabled={acting}
            onclick={() => performThreadAction('inbox')}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive size={16} />
          </button>
        {:else}
          <button
            type="button"
            aria-label="Archive thread"
            disabled={acting}
            onclick={() => performThreadAction('archive')}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive size={16} />
          </button>
          <button
            type="button"
            aria-label="Trash thread"
            disabled={acting}
            onclick={() => performThreadAction('trash')}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Mark as spam"
            disabled={acting}
            onclick={() => performThreadAction('spam')}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldAlert size={16} />
          </button>
        {/if}
      </div>

      <div class="flex items-center gap-1">
        {#if lastMessage}
          <button
            type="button"
            aria-label="Reply"
            onclick={() => openReply(lastMessage)}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
          >
            <Reply size={16} />
          </button>
          <button
            type="button"
            aria-label="Reply all"
            onclick={() => openReplyAll(lastMessage)}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
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
  </div>

  <!-- Thread messages accordion -->
  <div class="flex-1 overflow-y-auto">
    <div class="divide-y divide-white/8">
      {#each messages as msg (msg.id)}
        {@const isExpanded = expandedIds.has(msg.id)}
        {@const msgAttachments = getMessageAttachments(msg.messageId)}
        {@const srcdoc = msg.htmlContent ? injectScrollbarStyle(msg.htmlContent) : null}

        <div class="transition-colors {isExpanded ? 'bg-white/2' : 'hover:bg-white/2'}">
          <!-- Collapsed header / toggle -->
          <button
            type="button"
            onclick={() => toggleExpanded(msg.id)}
            class="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
          >
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300"
            >
              {senderInitials(msg.from)}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span
                  class="truncate text-sm {isUnread(msg.flags)
                    ? 'font-semibold text-white'
                    : 'text-zinc-300'}"
                >
                  {senderName(msg.from)}
                </span>
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

            <div class="flex shrink-0 items-center gap-2">
              {#if msgAttachments.length > 0}
                <Paperclip size={13} class="text-zinc-500" />
              {/if}
              <span class="text-xs text-zinc-500">{formatFullDate(msg.receivedAt)}</span>
              <ChevronDown
                size={14}
                class="text-zinc-600 transition-transform {isExpanded ? 'rotate-180' : ''}"
              />
            </div>
          </button>

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="px-4 pb-4 sm:px-5">
              <p class="mb-3 text-xs text-zinc-500">
                To: {msg.to || '—'}
              </p>

              {#if srcdoc}
                <iframe
                  title="Message body"
                  {srcdoc}
                  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  class="min-h-[300px] w-full rounded-lg border border-white/8 bg-white"
                  onload={(e) => {
                    const iframe = e.currentTarget as HTMLIFrameElement
                    const doc = iframe.contentDocument
                    if (doc) {
                      const height = doc.documentElement.scrollHeight
                      if (height > 50) iframe.style.height = `${height + 24}px`
                    }
                  }}
                ></iframe>
              {:else}
                <pre class="font-sans text-sm leading-relaxed whitespace-pre-wrap text-zinc-300">
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
                        class="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2"
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
              <div class="mt-4 flex gap-2">
                <button
                  type="button"
                  onclick={() => openReply(msg)}
                  class="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
                >
                  <Reply size={13} /> Reply
                </button>
                <button
                  type="button"
                  onclick={() => openReplyAll(msg)}
                  class="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/3 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
                >
                  <ReplyAll size={13} /> Reply all
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
