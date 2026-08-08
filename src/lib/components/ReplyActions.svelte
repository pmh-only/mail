<script lang="ts">
  import { ChevronDown, Reply, ReplyAll, Sparkles } from 'lucide-svelte'
  import { onMount } from 'svelte'

  let {
    onReply,
    onReplyAll,
    onAiReply,
    aiEnabled = false,
    drafting = false,
    iconOnly = false
  }: {
    onReply: () => void
    onReplyAll: () => void
    onAiReply: () => void
    aiEnabled?: boolean
    drafting?: boolean
    iconOnly?: boolean
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
    aria-label="Reply options"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
    onkeydown={(event) => event.key === 'Escape' && (open = false)}
    class={[
      'flex items-center gap-1.5 rounded-lg border border-transparent bg-white/3 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:border-white/8',
      iconOnly ? 'p-2' : 'px-3 py-1.5 text-xs'
    ].join(' ')}
  >
    <Reply size={iconOnly ? 16 : 13} />
    {#if !iconOnly}<span>Reply</span>{/if}
    <ChevronDown size={iconOnly ? 13 : 12} />
  </button>
  {#if open}
    <div
      role="menu"
      class="absolute right-0 z-20 mt-1 min-w-40 rounded-lg border border-white/10 bg-[#1a1b22] p-1 shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => select(onReply)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
      >
        <Reply size={14} /> Reply
      </button>
      <button
        type="button"
        role="menuitem"
        onclick={() => select(onReplyAll)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
      >
        <ReplyAll size={14} /> Reply all
      </button>
      {#if aiEnabled}
        <button
          type="button"
          role="menuitem"
          disabled={drafting}
          onclick={() => select(onAiReply)}
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-sky-300 transition hover:bg-white/8 disabled:cursor-wait disabled:opacity-60"
        >
          <Sparkles size={14} class={drafting ? 'animate-pulse' : ''} />
          {drafting ? 'Drafting...' : 'AI reply draft'}
        </button>
      {/if}
    </div>
  {/if}
</div>
