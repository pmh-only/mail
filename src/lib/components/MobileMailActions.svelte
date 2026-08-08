<script module lang="ts">
  export type MobileMailAction = {
    label: string
    icon: typeof import('lucide-svelte')['MoreHorizontal']
    onSelect: () => void
    disabled?: boolean
    iconClass?: string
    group?: string
  }
</script>

<script lang="ts">
  import { MoreHorizontal } from 'lucide-svelte'
  import { dismissOnOutside } from '$lib/dismiss-on-outside'

  let { actions }: { actions: MobileMailAction[] } = $props()
  let open = $state(false)

  function select(action: MobileMailAction) {
    open = false
    action.onSelect()
  }
</script>

<div
  class="relative inline-flex md:hidden"
  use:dismissOnOutside={{ enabled: open, onDismiss: () => (open = false) }}
>
  <button
    type="button"
    aria-label="Mail actions"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
    class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
  >
    <MoreHorizontal size={16} />
  </button>
  {#if open}
    <div
      role="menu"
      aria-label="Mail actions"
      class="app-popover absolute top-full right-0 z-[100] mt-1 max-h-[min(70vh,32rem)] min-w-52 overflow-y-auto rounded-lg border border-white/10 p-1 shadow-xl"
    >
      {#each actions as action, index (action.label)}
        {#if index > 0 && action.group !== actions[index - 1]?.group}
          <div class="my-1 border-t border-white/8"></div>
        {/if}
        <button
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onclick={() => select(action)}
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <action.icon size={14} class={action.iconClass} />
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
