<script lang="ts">
  import { Clock, Code2, Info, Mail, MoreHorizontal, Pin, Star } from 'lucide-svelte'
  import { dismissOnOutside } from '$lib/dismiss-on-outside'

  let {
    onMarkUnread,
    onToggleStar,
    onTogglePin,
    onSnooze,
    onViewRaw,
    onViewMetadata,
    rawSourceAvailable = false,
    starred,
    pinned,
    disabled = false
  }: {
    onMarkUnread: () => void
    onToggleStar: () => void
    onTogglePin: () => void
    onSnooze?: () => void
    onViewRaw?: () => void
    onViewMetadata?: () => void
    rawSourceAvailable?: boolean
    starred: boolean
    pinned: boolean
    disabled?: boolean
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
    aria-label="Other actions"
    data-app-tooltip="Other actions"
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={disabled}
    onclick={() => (open = !open)}
    onkeydown={(event) => event.key === 'Escape' && (open = false)}
    class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
  >
    <MoreHorizontal size={16} />
  </button>
  {#if open}
    <div
      role="menu"
      aria-label="Other actions"
      class="app-popover absolute top-full right-0 z-[100] mt-1 min-w-44 rounded-lg border border-white/10 p-1 shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => select(onMarkUnread)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
      >
        <Mail size={14} /> Mark as unread
      </button>
      <button
        type="button"
        role="menuitem"
        onclick={() => select(onToggleStar)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
      >
        <Star size={14} fill={starred ? 'currentColor' : 'none'} class={starred ? 'text-amber-300' : ''} />
        {starred ? 'Mark as unstarred' : 'Mark as starred'}
      </button>
      <button
        type="button"
        role="menuitem"
        onclick={() => select(onTogglePin)}
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
      >
        <Pin size={14} fill={pinned ? 'currentColor' : 'none'} class={pinned ? 'text-sky-300' : ''} />
        {pinned ? 'Mark as unpinned' : 'Mark as pinned'}
      </button>
      {#if onSnooze || onViewRaw || onViewMetadata}
        <div class="my-1 border-t border-white/8"></div>
      {/if}
      {#if onSnooze}
        <button
          type="button"
          role="menuitem"
          onclick={() => select(onSnooze)}
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
        >
          <Clock size={14} /> Snooze
        </button>
      {/if}
      {#if onViewRaw}
        <button
          type="button"
          role="menuitem"
          disabled={!rawSourceAvailable}
          onclick={() => rawSourceAvailable && select(onViewRaw)}
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Code2 size={14} /> {rawSourceAvailable ? 'View raw message' : 'Raw unavailable'}
        </button>
      {/if}
      {#if onViewMetadata}
        <button
          type="button"
          role="menuitem"
          onclick={() => select(onViewMetadata)}
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white"
        >
          <Info size={14} /> View metadata
        </button>
      {/if}
    </div>
  {/if}
</div>
