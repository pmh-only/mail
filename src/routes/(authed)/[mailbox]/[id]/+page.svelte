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
    Paperclip,
    Download,
    FileText,
    FileVideo,
    FileImage,
    X,
    ChevronLeft,
    ChevronRight
  } from 'lucide-svelte'
  import { goto, invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { getSimplifiedModeContext } from '$lib/simplified-mode-context'
  import { onMount } from 'svelte'
  import { openReply, openReplyAll, openForward } from '$lib/composer.svelte'
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
    filename: string
    contentType: string
    size: number
  }

  type Props = {
    data: {
      message: Message
      mailboxRole: 'inbox' | 'archive' | 'trash' | 'spam' | null
      attachments: Attachment[]
    }
  }

  let { data }: Props = $props()

  const role = $derived(data.mailboxRole)
  const simplifiedViewEnabled = $derived(Boolean(page.data.simplifiedView))
  const { openSimplifiedMode } = getSimplifiedModeContext()

  let acting = $state(false)
  let sharing = $state(false)
  let shareCopied = $state(false)

  async function shareMessage() {
    if (sharing) return
    sharing = true
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.message.id })
      })
      if (res.ok) {
        const { url } = await res.json()
        await navigator.clipboard.writeText(url)
        shareCopied = true
        setTimeout(() => {
          shareCopied = false
        }, 2000)
      }
    } finally {
      sharing = false
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
      if (res.ok) {
        await trackAppLoading(() => invalidateAll())
        await goto(resolve(`/${page.params.mailbox}`))
      }
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

  function senderInitials(from: string | null | undefined) {
    const words = senderName(from).split(/\s+/).filter(Boolean).slice(0, 2)
    return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || 'NA'
  }

  function subjectLabel(subject: string | null | undefined) {
    if (!subject) return '(no subject)'
    return subject
  }

  function bodyText(msg: Message) {
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

  const srcdoc = $derived(message.htmlContent ? injectScrollbarStyle(message.htmlContent) : null)

  const attachments = $derived(data.attachments)

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
    const prevContext = keyboard.context
    keyboard.context = 'message'

    const teardown = setupKeyboardHandler({
      u: () => goto(resolve(`/${page.params.mailbox}`)),
      r: () => openReply(message),
      a: () => openReplyAll(message),
      f: () => openForward(message),
      e: () => void performAction('archive'),
      '#': () => void performAction('trash'),
      Escape: () => goto(resolve(`/${page.params.mailbox}`))
    })

    return () => {
      keyboard.context = prevContext
      teardown()
    }
  })
</script>

<svelte:head>
  <title>{subjectLabel(message.subject)} · Inbox</title>
</svelte:head>

<div class="flex h-full flex-col">
  <div class="border-b border-white/8 p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-1">
        {#if role === 'archive'}
          <div class="group relative">
            <button
              type="button"
              aria-label="Move to inbox"
              disabled={acting}
              onclick={() => performAction('inbox')}
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
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
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
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
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
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
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
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
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Delete
            </span>
          </div>
          <div class="group relative">
            <button
              type="button"
              aria-label="Move to spam"
              disabled={acting}
              onclick={() => performAction('spam')}
              class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldAlert size={16} />
            </button>
            <span
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs whitespace-nowrap text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Move to spam
            </span>
          </div>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-1">
        {#if simplifiedViewEnabled}
          <button
            type="button"
            onclick={() => void openSimplifiedMode()}
            class="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/6"
          >
            Simplified mode
          </button>
        {/if}
        <div class="group relative">
          <button
            type="button"
            aria-label="Reply"
            onclick={() => openReply(message)}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
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
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
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
            aria-label="Forward"
            onclick={() => openForward(message)}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
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
            aria-label="Share"
            disabled={sharing}
            onclick={shareMessage}
            class="rounded-lg border border-white/8 bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {#if shareCopied}
              <Check size={16} class="text-emerald-400" />
            {:else}
              <Share2 size={16} />
            {/if}
          </button>
          <span
            class="pointer-events-none absolute top-full right-0 mt-2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
          >
            {shareCopied ? 'Copied!' : 'Share'}
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="border-b border-white/8 p-4 sm:p-5">
    <div class="flex items-start justify-between gap-4">
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
          <p class="mt-1 truncate text-sm font-medium text-zinc-200">
            {senderName(message.from)}
          </p>
          <p class="mt-1 text-sm text-zinc-500">
            Reply-To: {senderLabel(message.from)}
          </p>
        </div>
      </div>

      <p class="shrink-0 text-sm text-zinc-500">
        {formatFullDate(message.receivedAt)}
      </p>
    </div>
  </div>

  <div class="flex flex-1 flex-col overflow-y-auto">
    {#if srcdoc}
      <iframe
        title={`Email body for ${subjectLabel(message.subject)}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"
        {srcdoc}
        class="block min-h-[400px] w-full bg-white"
        onload={(e) => {
          const iframe = e.currentTarget as HTMLIFrameElement
          const doc = iframe.contentDocument
          if (doc) {
            const h = doc.documentElement.scrollHeight
            if (h > 50) iframe.style.height = `${h}px`
          }
        }}
      ></iframe>
    {:else}
      <div class="space-y-6 p-4 text-[15px] leading-8 text-zinc-200">
        {#each bodyText(message)
          .split(/\n{2,}/)
          .filter(Boolean) as paragraph, index (`${message.id}-${index}`)}
          <p>{paragraph}</p>
        {/each}
      </div>
    {/if}

    {#if attachments.length > 0}
      <div class="border-t border-white/8 p-4 sm:p-5">
        <div class="mb-3 flex items-center gap-2">
          <Paperclip size={14} class="text-zinc-500" />
          <span class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
          </span>
        </div>
        <div class="flex flex-wrap gap-3">
          {#each attachments as att (att.id)}
            <div
              class="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/3 transition hover:border-white/20"
            >
              {#if isImage(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="block h-32 w-40 overflow-hidden focus:outline-none"
                  title="Click to preview"
                >
                  <img
                    src="/api/attachments/{att.id}?inline=1"
                    alt={att.filename}
                    class="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </button>
              {:else if isPdf(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="flex h-32 w-full min-w-40 flex-col items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 focus:outline-none"
                  title="Click to preview"
                >
                  <FileText size={36} />
                  <span class="text-xs">Preview PDF</span>
                </button>
              {:else if isVideo(att.contentType)}
                <button
                  type="button"
                  onclick={() => openPreview(att)}
                  class="flex h-32 w-40 flex-col items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 focus:outline-none"
                  title="Click to preview"
                >
                  <FileVideo size={36} />
                  <span class="text-xs">Play video</span>
                </button>
              {:else}
                {@const Icon = attachmentIcon(att.contentType)}
                <div
                  class="flex h-32 w-40 flex-col items-center justify-center gap-2 text-zinc-600"
                >
                  <Icon size={36} />
                </div>
              {/if}
              <div class="flex items-center gap-2 border-t border-white/8 px-2.5 py-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium text-zinc-200">{att.filename}</p>
                  <p class="text-xs text-zinc-500">{formatBytes(att.size)}</p>
                </div>
                <a
                  href={resolve(`/api/attachments/${att.id}`)}
                  download={att.filename}
                  class="shrink-0 text-zinc-600 hover:text-zinc-300"
                  title="Download"
                >
                  <Download size={13} />
                </a>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Preview lightbox -->
{#if previewIndex !== null}
  {@const att = previewableAttachments[previewIndex]}
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
          class="max-h-[80vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
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
      <div class="flex items-center gap-3">
        <p class="text-sm text-zinc-300">{att.filename}</p>
        <span class="text-xs text-zinc-600">{formatBytes(att.size)}</span>
        <a
          href={resolve(`/api/attachments/${att.id}`)}
          download={att.filename}
          class="flex items-center gap-1 text-xs text-zinc-400 hover:text-white"
        >
          <Download size={13} /> Download
        </a>
      </div>
    </div>
  </div>
{/if}
