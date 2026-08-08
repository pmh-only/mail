<script lang="ts">
  import { ChevronDown, ListChecks, Sparkles } from 'lucide-svelte'
  import { onMount } from 'svelte'

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
  let container = $state<HTMLDivElement>()

  onMount(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!container?.contains(event.target as Node)) open = false
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  })

  function select(action: () => void) {
    open = false
    action()
  }
</script>

<div bind:this={container} class="relative inline-flex">
  <button
    type="button"
    aria-label="AI thread actions"
    title="AI thread actions"
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
      class="absolute right-0 z-20 mt-1 min-w-48 rounded-lg border border-white/10 bg-[#1a1b22] p-1 shadow-xl"
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
