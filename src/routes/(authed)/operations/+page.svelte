<script lang="ts">
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    DatabaseZap,
    Loader2,
    MailCheck,
    RefreshCw,
    Send,
    ServerCog,
    XCircle
  } from 'lucide-svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'

  type OperationCounts = {
    pending: number
    running: number
    done: number
    failed: number
    other: number
    total: number
  }

  type OperationError = {
    channel: 'imap' | 'smtp'
    id: number
    type: string
    status: string
    mailbox: string | null
    uid: number | null
    attemptCount: number
    lastError: string | null
    updatedAt: string | null
    availableAt: string | null
  }

  type OperationHealth = {
    generatedAt: string
    worker: {
      status: 'online' | 'stale' | 'unknown'
      heartbeatAt: string | null
      heartbeatAgeMs: number | null
      isSyncing: boolean
      activeMailbox: string | null
      activeStored: number
      activeTotal: number
      lastRunStartedAt: string | null
      lastRunFinishedAt: string | null
      lastError: string | null
    }
    operations: {
      imap: OperationCounts
      smtp: OperationCounts
    }
    recentErrors: OperationError[]
  }

  const REFRESH_MS = 10_000
  const statusSegments = [
    { key: 'pending', label: 'Pending', class: 'bg-amber-400' },
    { key: 'running', label: 'Running', class: 'bg-blue-400' },
    { key: 'failed', label: 'Failed', class: 'bg-red-500' },
    { key: 'done', label: 'Done', class: 'bg-emerald-400' },
    { key: 'other', label: 'Other', class: 'bg-zinc-500' }
  ] as const

  let health = $state<OperationHealth | null>(null)
  let loading = $state(true)
  let refreshing = $state(false)
  let errorMessage = $state<string | null>(null)
  let autoRefresh = $state(true)
  let retryingOperation = $state<string | null>(null)
  let deletingOperation = $state<string | null>(null)
  let resyncing = $state(false)

  const totalOperations = $derived(
    (health?.operations.imap.total ?? 0) + (health?.operations.smtp.total ?? 0)
  )
  const waitingOperations = $derived(
    (health?.operations.imap.pending ?? 0) + (health?.operations.smtp.pending ?? 0)
  )
  const runningOperations = $derived(
    (health?.operations.imap.running ?? 0) + (health?.operations.smtp.running ?? 0)
  )
  const failedOperations = $derived(
    (health?.operations.imap.failed ?? 0) + (health?.operations.smtp.failed ?? 0)
  )
  const completionRate = $derived(
    totalOperations > 0
      ? Math.round(
          (((health?.operations.imap.done ?? 0) + (health?.operations.smtp.done ?? 0)) /
            totalOperations) *
            100
        )
      : 100
  )
  const syncPercent = $derived(
    health?.worker.activeTotal
      ? Math.min(100, Math.round((health.worker.activeStored / health.worker.activeTotal) * 100))
      : health?.worker.isSyncing
        ? 0
        : 100
  )
  const healthScore = $derived.by(() => {
    if (!health) return 0
    let score = 100
    if (health.worker.status === 'stale') score -= 35
    if (health.worker.status === 'unknown') score -= 25
    if (failedOperations > 0) score -= Math.min(35, failedOperations * 8)
    if (waitingOperations > 20) score -= 10
    if (health.worker.lastError) score -= 15
    return Math.max(0, score)
  })

  function numberFormat(value: number) {
    return new Intl.NumberFormat().format(value)
  }

  function formatDate(value: string | null) {
    if (!value) return 'Never'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  }

  function formatDuration(ms: number | null) {
    if (ms === null) return 'No heartbeat'
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
    return `${Math.round(ms / 3_600_000)}h ago`
  }

  function statusTone(status: OperationHealth['worker']['status']) {
    if (status === 'online') return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
    if (status === 'stale') return 'text-amber-300 bg-amber-400/10 border-amber-400/20'
    return 'text-zinc-300 bg-zinc-400/10 border-zinc-400/20'
  }

  function segmentWidth(counts: OperationCounts, key: keyof OperationCounts) {
    if (key === 'total') return 0
    if (counts.total === 0) return 0
    return Math.max(2, (counts[key] / counts.total) * 100)
  }

  async function loadHealth(reason: 'initial' | 'manual' | 'auto' = 'manual') {
    if (reason === 'initial') loading = true
    else refreshing = true

    try {
      const response = await fetch('/api/operation-health')
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load operation health.'))
      }

      health = (await response.json()) as OperationHealth
      errorMessage = null
    } catch (error) {
      errorMessage = errorMessageFromUnknown(error, 'Failed to load operation health.')
    } finally {
      loading = false
      refreshing = false
    }
  }

  async function retryOperation(operation: OperationError) {
    retryingOperation = `${operation.channel}-${operation.id}`
    try {
      const response = await fetch('/api/operation-health/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: operation.channel, id: operation.id })
      })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to retry operation.'))
      await loadHealth('manual')
      toast('Operation scheduled for retry')
    } catch (error) {
      errorMessage = errorMessageFromUnknown(error, 'Failed to retry operation.')
    } finally {
      retryingOperation = null
    }
  }

  async function deleteOperation(operation: OperationError) {
    deletingOperation = `${operation.channel}-${operation.id}`
    try {
      const response = await fetch('/api/operation-health/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: operation.channel, id: operation.id })
      })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to delete operation.'))
      await loadHealth('manual')
      toast('Operation deleted successfully')
    } catch (error) {
      errorMessage = errorMessageFromUnknown(error, 'Failed to delete operation.')
    } finally {
      deletingOperation = null
    }
  }

  async function resyncMailboxes() {
    resyncing = true
    try {
      const response = await fetch('/api/resync', { method: 'POST' })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to request resync.'))
      await loadHealth('manual')
      toast('Mailbox resync requested')
    } catch (error) {
      errorMessage = errorMessageFromUnknown(error, 'Failed to request resync.')
    } finally {
      resyncing = false
    }
  }

  onMount(() => {
    void loadHealth('initial')
    const interval = window.setInterval(() => {
      if (autoRefresh) void loadHealth('auto')
    }, REFRESH_MS)

    return () => window.clearInterval(interval)
  })
</script>

<svelte:head>
  <title>Operations · Mail</title>
</svelte:head>

<div
  class="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_38%),radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.08),transparent_28%)] p-4 sm:p-6 lg:p-10"
>
  <div class="mx-auto max-w-7xl space-y-6">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div
          class="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-200"
        >
          <ServerCog size={14} />
          Operations
        </div>
        <h1 class="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Operations</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Live view of concurrent IMAP actions, SMTP sends, mailbox sync, and recent retry failures.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={() => (autoRefresh = !autoRefresh)}
          aria-pressed={autoRefresh}
          class={[
            'rounded-xl border px-3 py-2 text-sm transition',
            autoRefresh
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
          ]}
        >
          Auto refresh {autoRefresh ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onclick={() => void loadHealth('manual')}
          disabled={refreshing}
          class="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={15} class={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type="button"
          onclick={() => void resyncMailboxes()}
          disabled={resyncing}
          class="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <DatabaseZap size={15} class={resyncing ? 'animate-pulse' : ''} />
          Resync mailboxes
        </button>
      </div>
    </header>

    {#if errorMessage}
      <div class="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
        {errorMessage}
      </div>
    {/if}

    {#if loading}
      <div
        class="flex min-h-80 items-center justify-center rounded-3xl border border-white/8 bg-white/[0.03]"
      >
        <div class="flex items-center gap-3 text-zinc-300">
          <Loader2 class="animate-spin" size={20} />
          Loading operation telemetry...
        </div>
      </div>
    {:else if health}
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium tracking-widest text-zinc-500 uppercase">
                Health score
              </p>
              <p class="mt-3 text-4xl font-semibold text-white">{healthScore}</p>
            </div>
            <div class="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
              <Activity size={22} />
            </div>
          </div>
          <div class="mt-5 h-2 overflow-hidden rounded-full bg-white/8">
            <div
              class="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400 transition-all"
              style={`width: ${healthScore}%`}
            ></div>
          </div>
        </div>

        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium tracking-widest text-zinc-500 uppercase">Worker</p>
              <p class="mt-3 text-2xl font-semibold text-white capitalize">
                {health.worker.status}
              </p>
            </div>
            <div class={['rounded-2xl border p-3', statusTone(health.worker.status)]}>
              <ServerCog size={22} />
            </div>
          </div>
          <p class="mt-4 text-sm text-zinc-400">
            Last heartbeat {formatDuration(health.worker.heartbeatAgeMs)}
          </p>
        </div>

        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium tracking-widest text-zinc-500 uppercase">Running now</p>
              <p class="mt-3 text-4xl font-semibold text-white">
                {numberFormat(runningOperations)}
              </p>
            </div>
            <div class="rounded-2xl bg-blue-400/10 p-3 text-blue-300">
              <Clock3 size={22} />
            </div>
          </div>
          <p class="mt-4 text-sm text-zinc-400">
            Operations run concurrently; {numberFormat(waitingOperations)} waiting to start.
          </p>
        </div>

        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium tracking-widest text-zinc-500 uppercase">
                Failed operations
              </p>
              <p class="mt-3 text-4xl font-semibold text-white">
                {numberFormat(failedOperations)}
              </p>
            </div>
            <div class="rounded-2xl bg-red-400/10 p-3 text-red-300">
              <AlertTriangle size={22} />
            </div>
          </div>
          <p class="mt-4 text-sm text-zinc-400">Operations with exhausted or permanent failures.</p>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-white">Operation activity</h2>
              <p class="text-sm text-zinc-400">Lifecycle totals for parallel IMAP and SMTP work.</p>
            </div>
            <div
              class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300"
            >
              {completionRate}% complete
            </div>
          </div>

          <div class="mt-6 grid gap-4 lg:grid-cols-2">
            {#each [{ name: 'IMAP actions', icon: MailCheck, counts: health.operations.imap }, { name: 'SMTP sends', icon: Send, counts: health.operations.smtp }] as operation (operation.name)}
              <div class="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <div class="rounded-xl bg-white/8 p-2 text-zinc-200">
                      <operation.icon size={18} />
                    </div>
                    <div>
                      <h3 class="font-medium text-white">{operation.name}</h3>
                      <p class="text-xs text-zinc-500">
                        {numberFormat(operation.counts.total)} total operations
                      </p>
                    </div>
                  </div>
                </div>

                <div class="mt-5 flex h-3 overflow-hidden rounded-full bg-white/8">
                  {#each statusSegments as segment (segment.key)}
                    {@const width = segmentWidth(operation.counts, segment.key)}
                    {#if width > 0}
                      <div class={segment.class} style={`width: ${width}%`}></div>
                    {/if}
                  {/each}
                </div>

                <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {#each statusSegments as segment (segment.key)}
                    <div>
                      <div class="flex items-center gap-1.5">
                        <span class={['h-2 w-2 rounded-full', segment.class]}></span>
                        <span class="text-xs text-zinc-500">{segment.label}</span>
                      </div>
                      <p class="mt-1 text-lg font-semibold text-white">
                        {numberFormat(operation.counts[segment.key])}
                      </p>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div
          class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-white">Sync progress</h2>
              <p class="text-sm text-zinc-400">
                {health.worker.isSyncing ? 'Mailbox sync is running.' : 'No active mailbox sync.'}
              </p>
            </div>
            {#if health.worker.isSyncing}
              <Loader2 class="animate-spin text-blue-300" size={20} />
            {:else}
              <CheckCircle2 class="text-emerald-300" size={20} />
            {/if}
          </div>

          <div class="mt-7 flex justify-center">
            <div
              class="grid h-48 w-48 place-items-center rounded-full"
              style={`background: conic-gradient(rgb(59 130 246) ${syncPercent * 3.6}deg, rgb(39 39 42) 0deg)`}
            >
              <div class="grid h-36 w-36 place-items-center rounded-full bg-zinc-950 text-center">
                <div>
                  <p class="text-4xl font-semibold text-white">{syncPercent}%</p>
                  <p class="mt-1 text-xs text-zinc-500">current sync</p>
                </div>
              </div>
            </div>
          </div>

          <dl class="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-xl bg-white/[0.04] p-3">
              <dt class="text-zinc-500">Mailbox</dt>
              <dd class="mt-1 truncate text-white">{health.worker.activeMailbox ?? 'None'}</dd>
            </div>
            <div class="rounded-xl bg-white/[0.04] p-3">
              <dt class="text-zinc-500">Stored</dt>
              <dd class="mt-1 text-white">
                {numberFormat(health.worker.activeStored)} / {numberFormat(
                  health.worker.activeTotal
                )}
              </dd>
            </div>
            <div class="rounded-xl bg-white/[0.04] p-3">
              <dt class="text-zinc-500">Last started</dt>
              <dd class="mt-1 text-white">{formatDate(health.worker.lastRunStartedAt)}</dd>
            </div>
            <div class="rounded-xl bg-white/[0.04] p-3">
              <dt class="text-zinc-500">Last finished</dt>
              <dd class="mt-1 text-white">{formatDate(health.worker.lastRunFinishedAt)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        class="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl shadow-black/20"
      >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-white">Recent operation errors</h2>
            <p class="text-sm text-zinc-400">
              Latest operations that reported retry or failure details.
            </p>
          </div>
          <div class="text-xs text-zinc-500">Updated {formatDate(health.generatedAt)}</div>
        </div>

        {#if health.worker.lastError}
          <div
            class="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100"
          >
            <div class="mb-1 flex items-center gap-2 font-medium">
              <XCircle size={16} />
              Worker error
            </div>
            {health.worker.lastError}
          </div>
        {/if}

        {#if health.recentErrors.length === 0}
          <div
            class="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-6 text-center text-emerald-100"
          >
            <CheckCircle2 class="mx-auto mb-3" size={26} />
            No operation errors recorded.
          </div>
        {:else}
          <div class="mt-5 overflow-hidden rounded-2xl border border-white/8">
            {#each health.recentErrors as operation (operation.channel + '-' + operation.id)}
              <article class="border-b border-white/6 bg-white/[0.02] p-4 last:border-b-0">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class={[
                          'rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase',
                          operation.channel === 'imap'
                            ? 'bg-blue-400/10 text-blue-200'
                            : 'bg-purple-400/10 text-purple-200'
                        ]}
                      >
                        {operation.channel}
                      </span>
                      <span class="text-sm font-medium text-white"
                        >#{operation.id} {operation.type}</span
                      >
                      <span class="text-xs text-zinc-500">attempt {operation.attemptCount}</span>
                      <span class="text-xs text-zinc-500">{formatDate(operation.updatedAt)}</span>
                    </div>
                    <p class="mt-2 text-sm leading-6 break-words text-zinc-300">
                      {operation.lastError ?? 'Unknown error'}
                    </p>
                  </div>
                  <div
                    class="w-72 shrink-0 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-zinc-400"
                  >
                    {#if operation.mailbox}
                      <div class="truncate" data-app-tooltip={operation.mailbox}>
                        Mailbox: <span class="text-zinc-200">{operation.mailbox}</span>
                      </div>
                    {/if}
                    {#if operation.uid}
                      <div>UID: <span class="text-zinc-200">{operation.uid}</span></div>
                    {/if}
                    <div>Status: <span class="text-zinc-200">{operation.status}</span></div>
                    <div class="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onclick={() => void retryOperation(operation)}
                        disabled={retryingOperation === `${operation.channel}-${operation.id}`}
                        class="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        {retryingOperation === `${operation.channel}-${operation.id}`
                          ? 'Retrying...'
                          : 'Retry operation'}
                      </button>
                      <button
                        type="button"
                        onclick={() => void deleteOperation(operation)}
                        disabled={deletingOperation === `${operation.channel}-${operation.id}`}
                        class="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingOperation === `${operation.channel}-${operation.id}`
                          ? 'Deleting...'
                          : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="grid gap-4 md:grid-cols-3">
        <div class="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <DatabaseZap class="mb-3 text-blue-300" size={22} />
          <h3 class="font-medium text-white">Parallel IMAP actions</h3>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            Read, unread, move, flag, and draft actions start independently after local updates.
          </p>
        </div>
        <div class="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <Send class="mb-3 text-purple-300" size={22} />
          <h3 class="font-medium text-white">Parallel SMTP sends</h3>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            Every ready message sends independently while retaining undo-send and retry support.
          </p>
        </div>
        <div class="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <ServerCog class="mb-3 text-emerald-300" size={22} />
          <h3 class="font-medium text-white">Worker heartbeat</h3>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            Heartbeats run independently from mail I/O, so slow operations cannot hide worker
            availability.
          </p>
        </div>
      </section>
    {/if}
  </div>
</div>
