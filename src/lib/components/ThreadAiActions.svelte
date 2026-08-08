<script lang="ts">
  import { ChevronDown, ListChecks, Sparkles } from 'lucide-svelte'
  import { dismissOnOutside } from '$lib/dismiss-on-outside'

  let {
    onSummarize,
    onExtractActions,
    summarizing = false,
    extracting = false
  }: {
    onSummarize: () => void
    onExtractActions: () => void
    summarizing?: boolean
    extracting?: boolean
  } = $props()

  let open = $state(false)

  function select(action: () => void) {
    open = false
    action()
  }
</script>

<div
  class="relative inline-flex"
  use:dismissOnOutside={{ enabled: open, onDismiss: () => (open = false) }}
>
  <button
    type="button"
    aria-label="AI thread actions"
    data-app-tooltip="AI thread actions"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
    onkeydown={(event) => event.key === 'Escape' && (open = false)}
    class="flex items-center gap-1 rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-sky-300 md:border-white/8"
  >
    <Sparkles size={16} class={summarizing || extracting ? 'animate-pulse' : ''} />
    <ChevronDown size={12} />
  </button>
  {#if open}
    <div
      role="menu"
      aria-label="AI thread actions"
      class="app-popover absolute top-full right-0 z-[100] mt-1 min-w-48 rounded-lg border border-white/10 p-1 shadow-xl md:right-auto md:left-0"
    >
      <button
        type="button"
        role="menuitem"
        disabled={summarizing}
        onclick={() => select(onSummarize)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-sky-300 transition hover:bg-white/8 disabled:cursor-wait disabled:opacity-60"
      >
        <Sparkles size={14} class={summarizing ? 'animate-pulse' : ''} />
        {summarizing ? 'Summarizing...' : 'Summarize thread'}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={extracting}
        onclick={() => select(onExtractActions)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-emerald-300 transition hover:bg-white/8 disabled:cursor-wait disabled:opacity-60"
      >
        <ListChecks size={14} class={extracting ? 'animate-pulse' : ''} />
        {extracting ? 'Extracting...' : 'Extract thread actions'}
      </button>
    </div>
  {/if}
</div>
