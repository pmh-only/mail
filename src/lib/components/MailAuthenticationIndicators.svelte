<script lang="ts">
  import {
    mailAuthenticationStatusLabel,
    mailAuthenticationSummary
  } from '$lib/mail-authentication'

  type Props = {
    spfStatus?: string | null
    dkimStatus?: string | null
    dmarcStatus?: string | null
    authenticationTrusted?: boolean
    compact?: boolean
  }

  let {
    spfStatus = null,
    dkimStatus = null,
    dmarcStatus = null,
    authenticationTrusted = false,
    compact = false
  }: Props = $props()

  const checks = $derived([
    { label: 'SPF', status: spfStatus },
    { label: 'DKIM', status: dkimStatus },
    { label: 'DMARC', status: dmarcStatus }
  ])
  const summary = $derived(mailAuthenticationSummary(checks.map((check) => check.status)))
  const componentId = $props.id()
  const tooltipId = `${componentId}-mail-authentication-tooltip`

  function tone(status: string) {
    if (status === 'pass') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    if (status === 'fail') return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
    return 'border-white/8 bg-white/3 text-zinc-400'
  }
</script>

<div class="group relative inline-flex">
  <button
    type="button"
    class={[
      'inline-flex items-center rounded-full border font-medium uppercase',
      compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
      !authenticationTrusted && 'border-dashed',
      tone(summary)
    ]}
    aria-label={`Email authentication ${summary}`}
    aria-describedby={tooltipId}
  >
    {summary}
  </button>
  <div
    id={tooltipId}
    role="tooltip"
    class="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-48 rounded-md border border-white/10 bg-zinc-800 p-2 text-xs font-normal text-zinc-200 normal-case shadow-xl group-hover:block"
  >
    <dl class="space-y-1">
      {#each checks as check (check.label)}
        <div class="flex items-center justify-between gap-4">
          <dt class="font-medium text-zinc-400">{check.label}</dt>
          <dd class="uppercase">{mailAuthenticationStatusLabel(check.status)}</dd>
        </div>
      {/each}
    </dl>
    <p class="mt-2 border-t border-white/10 pt-2 text-zinc-400">
      {authenticationTrusted
        ? 'Reported by a trusted receiving service'
        : 'Not reported by a trusted receiving service'}
    </p>
  </div>
</div>
