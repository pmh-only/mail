<script lang="ts">
  import { ChevronDown, Reply, ReplyAll, Sparkles } from 'lucide-svelte'
  import { dismissOnOutside } from '$lib/dismiss-on-outside'
  import { shouldOpenPopoverAbove } from '$lib/popover'
  import { tick } from 'svelte'

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
  let openAbove = $state(false)
  let buttonElement = $state<HTMLButtonElement>()
  let menuElement = $state<HTMLDivElement>()

  function toggleMenu() {
    if (open) {
      open = false
      return
    }

    openAbove = false
    open = true
    void tick().then(() => {
      if (!open || !buttonElement || !menuElement) return
      const buttonRect = buttonElement.getBoundingClientRect()
      const menuRect = menuElement.getBoundingClientRect()
      openAbove = shouldOpenPopoverAbove(buttonRect, menuRect.height, window.innerHeight)
    })
  }

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
    bind:this={buttonElement}
    type="button"
    aria-label="Reply options"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggleMenu}
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
      bind:this={menuElement}
      role="menu"
      aria-label="Reply options"
      class={[
        'app-popover absolute z-[100] min-w-40 rounded-lg border border-white/10 p-1 shadow-xl',
        openAbove ? 'bottom-full mb-1' : 'top-full mt-1',
        iconOnly ? 'right-0' : 'left-0'
      ]}
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
