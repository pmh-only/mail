<script lang="ts">
  import { Check, CheckCheck, CircleX, LoaderCircle } from 'lucide-svelte'
  import { sendStatusLabel, type SendStatus } from '$lib/send-status'

  type Props = {
    status: SendStatus
    openedAt?: Date | string | null
    size?: number
  }

  let { status, openedAt = null, size = 14 }: Props = $props()

  const read = $derived(status === 'sent' && Boolean(openedAt))
  const label = $derived(sendStatusLabel(status, openedAt))
  const tone = $derived(
    status === 'failed'
      ? 'border-rose-400/25 bg-rose-400/10 text-rose-300'
      : status === 'sending'
        ? 'border-amber-400/25 bg-amber-400/10 text-amber-300'
        : read
          ? 'border-sky-400/25 bg-sky-400/10 text-sky-300'
          : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
  )
</script>

<span
  class={['inline-flex shrink-0 items-center justify-center rounded-full border p-1', tone]}
  role="img"
  aria-label={label}
  data-app-tooltip={label}
>
  {#if status === 'sending'}
    <LoaderCircle {size} class="animate-spin" aria-hidden="true" />
  {:else if status === 'failed'}
    <CircleX {size} aria-hidden="true" />
  {:else if read}
    <CheckCheck {size} aria-hidden="true" />
  {:else}
    <Check {size} aria-hidden="true" />
  {/if}
</span>
