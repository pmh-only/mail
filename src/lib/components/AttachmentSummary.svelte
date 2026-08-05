<script lang="ts">
  import { page } from '$app/state'
  import { Sparkles } from 'lucide-svelte'
  import { readErrorMessage } from '$lib/http'

  type Attachment = {
    id: number
    filename: string
    contentType: string
  }

  type SummaryResponse = {
    summary: string
    cached: boolean
  }

  let { attachment, compact = false }: { attachment: Attachment; compact?: boolean } = $props()

  let loading = $state(false)
  let summary = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)
  let cached = $state(false)

  function isTextLike(contentType: string, filename: string) {
    const type = contentType.split(';', 1)[0].trim().toLowerCase()
    const lowerName = filename.toLowerCase()
    return (
      type.startsWith('text/') ||
      [
        'application/json',
        'application/ld+json',
        'application/xml',
        'application/yaml',
        'application/x-yaml'
      ].includes(type) ||
      [
        '.csv',
        '.ics',
        '.json',
        '.log',
        '.md',
        '.markdown',
        '.txt',
        '.tsv',
        '.xml',
        '.yaml',
        '.yml'
      ].some((extension) => lowerName.endsWith(extension))
    )
  }

  async function summarize() {
    loading = true
    errorMessage = null

    try {
      const response = await fetch(`/api/ai/attachments/${attachment.id}/summary`, {
        method: 'POST'
      })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to summarize attachment.'))
      const data = (await response.json()) as SummaryResponse
      summary = data.summary
      cached = data.cached
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to summarize attachment.'
    } finally {
      loading = false
    }
  }

  const supported = $derived(
    Boolean(page.data.hasOpenAiKey) && isTextLike(attachment.contentType, attachment.filename)
  )
</script>

{#if supported}
  <div class={compact ? 'mt-2 w-full' : 'border-t border-white/8 px-2.5 py-2'}>
    <button
      type="button"
      onclick={summarize}
      disabled={loading}
      class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/4 px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:cursor-wait disabled:opacity-60"
    >
      <Sparkles size={12} />
      {loading ? 'Summarizing...' : summary ? 'Refresh summary' : 'Summarize'}
    </button>
    {#if summary}
      <div
        class="mt-2 rounded-lg border border-white/8 bg-black/20 p-2 text-xs leading-relaxed whitespace-pre-wrap text-zinc-300"
      >
        {summary}
        {#if cached}
          <span class="mt-1 block text-[11px] text-zinc-500">Cached result</span>
        {/if}
      </div>
    {/if}
    {#if errorMessage}
      <p class="mt-2 text-xs text-red-300">{errorMessage}</p>
    {/if}
  </div>
{/if}
