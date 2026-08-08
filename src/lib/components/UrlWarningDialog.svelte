<script lang="ts">
  import { ExternalLink, ShieldAlert, X } from 'lucide-svelte'
  import { onMount } from 'svelte'

  type Props = {
    url: string
    oncancel: () => void
    oncontinue: () => void
  }

  let { url, oncancel, oncontinue }: Props = $props()
  let dialog: HTMLDialogElement
  let goBackButton: HTMLButtonElement

  const destination = $derived.by(() => {
    try {
      const parsed = new URL(url)
      return parsed.hostname || parsed.protocol.slice(0, -1)
    } catch {
      return url
    }
  })

  onMount(() => {
    dialog.showModal()
    goBackButton.focus()

    return () => dialog.close()
  })
</script>

<dialog
  bind:this={dialog}
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="url-warning-title"
  aria-describedby="url-warning-description"
  class="m-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-2xl border border-amber-300/20 bg-zinc-950 p-0 text-left shadow-2xl shadow-black/50 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
  oncancel={(event) => {
    event.preventDefault()
    oncancel()
  }}
  onkeydown={(event) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      oncancel()
    }
  }}
  onclick={(event) => {
    if (event.target === event.currentTarget) oncancel()
  }}
>
  <div class="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-6">
    <div class="flex min-w-0 items-start gap-3">
      <div class="rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-amber-200">
        <ShieldAlert size={20} />
      </div>
      <div class="min-w-0">
        <p class="text-xs font-medium tracking-[0.16em] text-amber-300 uppercase">External link</p>
        <h2 id="url-warning-title" class="mt-1 text-lg font-semibold text-zinc-100">
          Check this link before opening
        </h2>
      </div>
    </div>
    <button
      type="button"
      aria-label="Close URL warning"
      onclick={oncancel}
      class="shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
    >
      <X size={17} />
    </button>
  </div>

  <div class="px-5 py-5 sm:px-6">
    <p id="url-warning-description" class="text-sm leading-6 text-zinc-400">
      This link came from an email. Make sure you trust the destination before continuing.
    </p>

    <div class="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
      <p class="text-xs font-medium tracking-wide text-zinc-500 uppercase">Destination</p>
      <p class="mt-1 truncate text-base font-semibold text-zinc-100" data-app-tooltip={destination}>
        {destination}
      </p>
      <p class="mt-2 max-h-24 overflow-y-auto font-mono text-xs leading-5 break-all text-zinc-400">
        {url}
      </p>
    </div>
  </div>

  <div
    class="flex flex-col-reverse gap-2 border-t border-white/8 px-5 py-4 sm:flex-row sm:justify-end sm:px-6"
  >
    <button
      bind:this={goBackButton}
      type="button"
      onclick={oncancel}
      class="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
    >
      Go back
    </button>
    <button
      type="button"
      onclick={oncontinue}
      class="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200"
    >
      Open link
      <ExternalLink size={15} />
    </button>
  </div>
</dialog>
