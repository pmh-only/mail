<script lang="ts">
  import { AlertTriangle, X } from 'lucide-svelte'

  type Props = {
    message: string | null
    title?: string
    onclose?: () => void
  }

  let { message, title = 'Something went wrong', onclose }: Props = $props()

  function close() {
    onclose?.()
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (message && event.key === 'Escape') close()
  }}
/>

{#if message}
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) close()
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="w-full max-w-md rounded-2xl border border-white/10 bg-[#15161b] p-5 shadow-2xl shadow-black/50"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300"
        >
          <AlertTriangle size={18} />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-white">{title}</h2>
              <p class="mt-2 text-sm leading-6 whitespace-pre-wrap text-zinc-300">{message}</p>
            </div>

            <button
              type="button"
              aria-label="Close error dialog"
              onclick={close}
              class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
            >
              <X size={14} />
            </button>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              onclick={close}
              class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
