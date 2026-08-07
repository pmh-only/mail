<script lang="ts">
  type Props = {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    inputLabel?: string
    inputValue?: string
    inputType?: string
    onconfirm: (value?: string) => void
    oncancel: () => void
  }

  let {
    title,
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'default',
    inputLabel,
    inputValue = '',
    inputType = 'text',
    onconfirm,
    oncancel
  }: Props = $props()

  let value = $state('')

  $effect(() => {
    value = inputValue
  })
</script>

<div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
  <div
    class="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl"
  >
    <h2 class="text-base font-semibold text-zinc-100">{title}</h2>
    {#if message}
      <p class="mt-2 text-sm leading-6 whitespace-pre-line text-zinc-400">{message}</p>
    {/if}
    {#if inputLabel}
      <label class="mt-4 block text-sm text-zinc-300">
        <span class="mb-1 block text-xs font-medium text-zinc-500">{inputLabel}</span>
        <input
          bind:value
          type={inputType}
          class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 transition outline-none placeholder:text-zinc-600 focus:border-blue-500"
          onkeydown={(event) => {
            if (event.key === 'Enter') onconfirm(value)
            if (event.key === 'Escape') oncancel()
          }}
        />
      </label>
    {/if}
    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
        onclick={oncancel}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        class={[
          'rounded-xl px-4 py-2 text-sm font-medium text-white transition',
          tone === 'danger' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500'
        ]}
        onclick={() => onconfirm(inputLabel ? value : undefined)}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
