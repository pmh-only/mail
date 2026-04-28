<script lang="ts">
  import { resolve } from '$app/paths'
  import { Download, FileImage, FileText, FileVideo, Paperclip } from 'lucide-svelte'

  type Attachment = {
    id: number
    filename: string
    contentType: string
    size: number
  }

  type Props = {
    data: {
      token: string
      subject: string
      from: string
      to: string
      preview: string
      textContent: string
      htmlContent: string | null
      receivedAt: string | null
      attachments: Attachment[]
    }
  }

  let { data }: Props = $props()

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

  const ogDescription = $derived(data.preview.slice(0, 200))

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

  const srcdoc = $derived(data.htmlContent ? injectScrollbarStyle(data.htmlContent) : null)

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

  function attachmentIcon(contentType: string) {
    if (isImage(contentType)) return FileImage
    if (isPdf(contentType)) return FileText
    if (isVideo(contentType)) return FileVideo
    return FileImage
  }

  function attachmentUrl(id: number, inline = false) {
    return resolve(`/share/${data.token}/attachments/${id}${inline ? '?inline=1' : ''}`)
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
    <!-- Header -->
    <div class="border-white/8 pb-6">
      <h1 class="text-2xl font-semibold text-white">
        {data.subject || '(no subject)'}
      </h1>

      <div class="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-zinc-200"
        >
          {senderInitials(data.from)}
        </div>

        <div class="min-w-0">
          <p class="font-medium text-zinc-200">{senderName(data.from)}</p>
          <p class="text-sm text-zinc-500">{data.from}</p>
        </div>

        <p class="text-sm text-zinc-500 sm:ml-auto sm:shrink-0 sm:text-right">
          {formatFullDate(data.receivedAt)}
        </p>
      </div>
    </div>

    <!-- Body -->
    {#if srcdoc}
      <div class="flex grow overflow-hidden rounded border border-white/8 bg-white">
        <iframe
          title={`Email body for ${data.subject}`}
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
          {srcdoc}
          class="block w-full grow"
        ></iframe>
      </div>
    {:else}
      <div class="space-y-5 text-[15px] leading-8 text-zinc-200">
        {#each (data.textContent || data.preview || 'No message body available.')
          .split(/\n{2,}/)
          .filter(Boolean) as paragraph, i (i)}
          <p>{paragraph}</p>
        {/each}
      </div>
    {/if}

    {#if data.attachments.length > 0}
      <div class="mt-4 border-t border-white/8 pt-4">
        <div class="mb-3 flex items-center gap-2">
          <Paperclip size={14} class="text-zinc-500" />
          <span class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {data.attachments.length} attachment{data.attachments.length === 1 ? '' : 's'}
          </span>
        </div>

        <div class="flex flex-wrap gap-3">
          {#each data.attachments as att (att.id)}
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
                </div>
                <a
                  href={resolve(`/share/${data.token}/attachments/${att.id}`)}
                  download={att.filename || 'attachment'}
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
</div>
