<script lang="ts">
  import { Check, Code2, Copy, Download, LoaderCircle, X } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { readErrorMessage } from '$lib/http'

  type Props = {
    messageId: number
    subject?: string | null
    onclose: () => void
  }

  let { messageId, subject = null, onclose }: Props = $props()
  let source = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)
  let loading = $state(true)
  let copied = $state(false)
  let copyError = $state<string | null>(null)
  let dialogElement = $state<HTMLDivElement | null>(null)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const controller = new AbortController()
    source = null
    errorMessage = null
    loading = true

    void fetch(`/api/messages/${messageId}/raw`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(await readErrorMessage(response, 'Raw source unavailable.'))
        source = await response.text()
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          errorMessage = error instanceof Error ? error.message : 'Raw source unavailable.'
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    queueMicrotask(() => dialogElement?.focus())
    return () => {
      if (copyTimer) clearTimeout(copyTimer)
      previousFocus?.focus()
    }
  })

  async function copySource() {
    if (!source) return
    try {
      await navigator.clipboard.writeText(source)
      copyError = null
      copied = true
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copied = false), 1500)
    } catch {
      copied = false
      copyError = 'Could not copy the raw source.'
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      onclose()
      return
    }
    if (event.key !== 'Tab' || !dialogElement) return

    const focusable = [
      ...dialogElement.querySelectorAll<HTMLElement>('button, [href], [tabindex]')
    ].filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
    if (focusable.length === 0) {
      event.preventDefault()
      dialogElement.focus()
      return
    }

    const first = focusable[0]
    const last = focusable.at(-1) as HTMLElement
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogElement)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
</script>

<svelte:document onkeydowncapture={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose()
  }}
>
  <div
    bind:this={dialogElement}
    role="dialog"
    aria-modal="true"
    aria-labelledby="raw-message-title"
    tabindex="-1"
    class="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0d0d10]/85 shadow-2xl shadow-black/40 backdrop-blur-xl"
  >
    <div
      class="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5 sm:py-4"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <Code2 size={16} class="shrink-0 text-sky-300" />
          <h3 id="raw-message-title" class="text-base font-semibold text-white">
            Raw message source
          </h3>
        </div>
        <p class="mt-1 truncate text-xs text-zinc-500">
          {subject || '(no subject)'} · decoded preview
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        {#if source}
          <a
            href={resolve(`/api/messages/${messageId}/raw`)}
            download={`message-${messageId}.eml`}
            class="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/3 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-white/6 hover:text-white"
          >
            <Download size={13} /> Download .eml
          </a>
          <button
            type="button"
            onclick={() => void copySource()}
            class="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/3 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-white/6 hover:text-white"
          >
            {#if copied}<Check size={13} class="text-emerald-300" />{:else}<Copy size={13} />{/if}
            {copied ? 'Copied' : 'Copy text'}
          </button>
        {/if}
        <button
          type="button"
          aria-label="Close raw message"
          onclick={onclose}
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8"
        >
          <X size={16} />
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
      {#if loading}
        <div
          role="status"
          class="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-400"
        >
          <LoaderCircle size={16} class="animate-spin" /> Loading raw source...
        </div>
      {:else if errorMessage}
        <div
          role="alert"
          class="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100"
        >
          {errorMessage}
        </div>
      {:else}
        <pre
          class="min-w-max rounded-lg border border-white/6 bg-black/30 p-4 font-mono text-xs leading-5 whitespace-pre text-zinc-300">{source}</pre>
      {/if}
      <p class="sr-only" aria-live="polite">{copied ? 'Raw source copied.' : copyError}</p>
    </div>
  </div>
</div>
