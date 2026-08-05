<script lang="ts">
  import { resolve } from '$app/paths'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import { Download, FileImage, FileText, FileVideo, Paperclip, ShieldAlert } from 'lucide-svelte'
  import { scoreAttachmentSafety, type AttachmentSafetyScore } from '$lib/mail-attachments'
  import { interceptMailContentLinks } from '$lib/mail-content-links'
  import { sanitizeRemoteContent } from '$lib/remote-content'

  type SharedMessage = {
    messageId: string
    subject: string
    from: string
    to: string
    preview: string
    textContent: string
    htmlContent: string | null
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
      token: string
      subject: string
      messages: SharedMessage[]
      attachments: Attachment[]
    }
  }

  let { data }: Props = $props()

  let actionModal = $state<{
    title: string
    message?: string
    confirmLabel?: string
    tone?: 'default' | 'danger'
    resolve: (value: boolean | null) => void
  } | null>(null)

  function requestConfirm(options: Omit<NonNullable<typeof actionModal>, 'resolve'>) {
    return new Promise<boolean | null>((resolve) => {
      actionModal = { ...options, resolve }
    })
  }

  function closeActionModal(value: boolean | null) {
    actionModal?.resolve(value)
    actionModal = null
  }

  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

  function formatFullDate(value: string | null) {
    if (!value) return 'Unknown'
    return fullDateFormatter.format(new Date(value))
  }

  function senderName(from: string) {
    return from.split('<')[0]?.trim() || from
  }

  function senderInitials(from: string) {
    const words = senderName(from).split(/\s+/).filter(Boolean).slice(0, 2)
    return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || 'NA'
  }

  const ogDescription = $derived(data.messages[0]?.preview?.slice(0, 200) || 'Shared email')

  const SCROLLBAR_STYLE = `<style>
*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.18) transparent}
*::-webkit-scrollbar{width:6px;height:6px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:999px}
*::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.32)}
:root{padding:12px}
</style>`

  function injectScrollbarStyle(html: string): string {
    const sanitized = sanitizeRemoteContent(html).html
    const headClose = sanitized.indexOf('</head>')
    if (headClose !== -1)
      return sanitized.slice(0, headClose) + SCROLLBAR_STYLE + sanitized.slice(headClose)
    return SCROLLBAR_STYLE + sanitized
  }

  function setupEmailIframe(iframe: HTMLIFrameElement) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) return
      interceptMailContentLinks(doc, (url) => window.open(url, '_blank', 'noopener,noreferrer'))
      const height = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0)
      if (height > 50) {
        iframe.style.height = `${height + 24}px`
      }
    } catch {
      // Ignore cross-origin errors if any
    }
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
    const confirmed = await requestConfirm({
      title: 'Download risky attachment?',
      message: `This attachment has traits often abused in phishing or unsafe downloads. Only download it if you expected it.${reasonText}`,
      confirmLabel: 'Download',
      tone: 'danger'
    })
    if (confirmed) window.location.href = attachmentUrl(att.id)
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

  function attachmentIcon(contentType: string) {
    if (isImage(contentType)) return FileImage
    if (isPdf(contentType)) return FileText
    if (isVideo(contentType)) return FileVideo
    return FileImage
  }

  function attachmentUrl(id: number, inline = false) {
    return resolve(`/share/${data.token}/attachments/${id}${inline ? '?inline=1' : ''}`)
  }

  function getMessageAttachments(messageId: string) {
    return data.attachments.filter((att) => att.messageId === messageId)
  }
</script>

<svelte:head>
  <title>{data.subject || '(no subject)'}</title>
  <meta name="description" content={ogDescription} />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content={data.subject || '(no subject)'} />
  <meta property="og:description" content={ogDescription} />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={data.subject || '(no subject)'} />
  <meta name="twitter:description" content={ogDescription} />
</svelte:head>

<div class="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
  <div class="mx-auto flex w-full max-w-3xl grow flex-col p-4 sm:p-6">
    {#if data.messages.length === 1}
      {@const msg = data.messages[0]}
      {@const srcdoc = msg.htmlContent ? injectScrollbarStyle(msg.htmlContent) : null}
      {@const msgAtts = getMessageAttachments(msg.messageId)}

      <!-- Single Message Header -->
      <div class="border-white/8 pb-6">
        <h1 class="text-2xl font-semibold text-white">
          {msg.subject || '(no subject)'}
        </h1>

        <div class="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-zinc-200"
          >
            {senderInitials(msg.from)}
          </div>

          <div class="min-w-0">
            <p class="font-medium text-zinc-200">{senderName(msg.from)}</p>
            <p class="text-sm text-zinc-500">{msg.from}</p>
          </div>

          <p class="text-sm text-zinc-500 sm:ml-auto sm:shrink-0 sm:text-right">
            {formatFullDate(msg.receivedAt)}
          </p>
        </div>
      </div>

      <!-- Single Message Body -->
      {#if srcdoc}
        <div class="flex grow overflow-hidden rounded border border-white/8 bg-white">
          <iframe
            title={`Email body for ${msg.subject}`}
            sandbox="allow-same-origin"
            {srcdoc}
            class="block w-full grow"
            onload={(e) => setupEmailIframe(e.currentTarget as HTMLIFrameElement)}
          ></iframe>
        </div>
      {:else}
        <div class="space-y-5 text-[15px] leading-8 text-zinc-200">
          {#each (msg.textContent || msg.preview || 'No message body available.')
            .split(/\n{2,}/)
            .filter(Boolean) as paragraph, i (i)}
            <p>{paragraph}</p>
          {/each}
        </div>
      {/if}

      <!-- Single Message Attachments -->
      {#if msgAtts.length > 0}
        <div class="mt-4 border-t border-white/8 pt-4">
          <div class="mb-3 flex items-center gap-2">
            <Paperclip size={14} class="text-zinc-500" />
            <span class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {msgAtts.length} attachment{msgAtts.length === 1 ? '' : 's'}
            </span>
          </div>

          <div class="flex flex-wrap gap-3">
            {#each msgAtts as att (att.id)}
              {@const safety = attachmentSafety(att)}
              <div
                class="group relative flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/3 transition hover:border-white/20 sm:w-40"
              >
                {#if isImage(att.contentType)}
                  <a
                    href={resolve(`/share/${data.token}/attachments/${att.id}?inline=1`)}
                    target="_blank"
                    rel="noreferrer"
                    class="block h-40 w-full overflow-hidden bg-black/20 sm:h-32"
                    title="Open image"
                  >
                    <img
                      src={attachmentUrl(att.id, true)}
                      alt={att.filename || 'Attachment'}
                      class="h-full w-full object-contain object-center transition group-hover:scale-105"
                    />
                  </a>
                {:else}
                  {@const Icon = attachmentIcon(att.contentType)}
                  <div
                    class="flex h-40 w-full flex-col items-center justify-center gap-2 text-zinc-500 sm:h-32"
                  >
                    <Icon size={36} />
                    {#if isPdf(att.contentType)}
                      <span class="text-xs">PDF</span>
                    {:else if isVideo(att.contentType)}
                      <span class="text-xs">Video</span>
                    {/if}
                  </div>
                {/if}

                <div class="flex items-center gap-2 border-t border-white/8 px-2.5 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium text-zinc-200">
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
                    href={resolve(`/share/${data.token}/attachments/${att.id}`)}
                    download={att.filename || 'attachment'}
                    onclick={(event) => confirmHighRiskDownload(event, att)}
                    class="shrink-0 text-zinc-500 hover:text-zinc-300"
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
    {:else}
      <!-- Multi-message Thread Header -->
      <div class="border-b border-white/8 pb-6">
        <h1 class="text-2xl font-semibold text-white">
          {data.subject || '(no subject)'}
        </h1>
        <p class="mt-1 text-xs text-zinc-400">
          Shared Thread ({data.messages.length} messages)
        </p>
      </div>

      <!-- Multi-message Thread List -->
      <div class="mt-6 space-y-8">
        {#each data.messages as msg (msg.messageId)}
          {@const messageAtts = getMessageAttachments(msg.messageId)}
          {@const srcdoc = msg.htmlContent ? injectScrollbarStyle(msg.htmlContent) : null}

          <div class="rounded-xl border border-white/8 bg-white/2 p-5 sm:p-6">
            <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-zinc-200"
              >
                {senderInitials(msg.from)}
              </div>

              <div class="min-w-0">
                <p class="font-medium text-zinc-200">{senderName(msg.from)}</p>
                <p class="text-xs text-zinc-500">{msg.from}</p>
              </div>

              <p class="text-xs text-zinc-500 sm:ml-auto sm:shrink-0 sm:text-right">
                {formatFullDate(msg.receivedAt)}
              </p>
            </div>

            <!-- Message Body -->
            <div class="mt-4">
              {#if srcdoc}
                <div class="flex h-96 overflow-hidden rounded border border-white/8 bg-white">
                  <iframe
                    title={`Email body for ${msg.subject}`}
                    sandbox="allow-same-origin"
                    {srcdoc}
                    class="block h-full w-full"
                    onload={(e) => setupEmailIframe(e.currentTarget as HTMLIFrameElement)}
                  ></iframe>
                </div>
              {:else}
                <div class="space-y-4 text-[15px] leading-7 text-zinc-200">
                  {#each (msg.textContent || msg.preview || 'No message body available.')
                    .split(/\n{2,}/)
                    .filter(Boolean) as paragraph, i (i)}
                    <p>{paragraph}</p>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Attachments -->
            {#if messageAtts.length > 0}
              <div class="mt-4 border-t border-white/8 pt-4">
                <div class="mb-3 flex items-center gap-2">
                  <Paperclip size={14} class="text-zinc-500" />
                  <span class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {messageAtts.length} attachment{messageAtts.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div class="flex flex-wrap gap-3">
                  {#each messageAtts as att (att.id)}
                    {@const safety = attachmentSafety(att)}
                    <div
                      class="group relative flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/3 transition hover:border-white/20 sm:w-40"
                    >
                      {#if isImage(att.contentType)}
                        <a
                          href={resolve(`/share/${data.token}/attachments/${att.id}?inline=1`)}
                          target="_blank"
                          rel="noreferrer"
                          class="block h-40 w-full overflow-hidden bg-black/20 sm:h-32"
                          title="Open image"
                        >
                          <img
                            src={attachmentUrl(att.id, true)}
                            alt={att.filename || 'Attachment'}
                            class="h-full w-full object-contain object-center transition group-hover:scale-105"
                          />
                        </a>
                      {:else}
                        {@const Icon = attachmentIcon(att.contentType)}
                        <div
                          class="flex h-40 w-full flex-col items-center justify-center gap-2 text-zinc-500 sm:h-32"
                        >
                          <Icon size={36} />
                          {#if isPdf(att.contentType)}
                            <span class="text-xs">PDF</span>
                          {:else if isVideo(att.contentType)}
                            <span class="text-xs">Video</span>
                          {/if}
                        </div>
                      {/if}

                      <div class="flex items-center gap-2 border-t border-white/8 px-2.5 py-2">
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-xs font-medium text-zinc-200">
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
                          href={resolve(`/share/${data.token}/attachments/${att.id}`)}
                          download={att.filename || 'attachment'}
                          onclick={(event) => confirmHighRiskDownload(event, att)}
                          class="shrink-0 text-zinc-500 hover:text-zinc-300"
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
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if actionModal}
  <ActionModal
    title={actionModal.title}
    message={actionModal.message}
    confirmLabel={actionModal.confirmLabel}
    tone={actionModal.tone}
    onconfirm={() => closeActionModal(true)}
    oncancel={() => closeActionModal(null)}
  />
{/if}
