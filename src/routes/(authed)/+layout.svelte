<script lang="ts">
  import favicon from '$lib/assets/favicon.svg'
  import { dev } from '$app/environment'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import {
    Inbox,
    Send,
    FileText,
    Trash2,
    ArchiveX,
    Archive,
    Folder,
    Pencil,
    Settings,
    BookOpen,
    RefreshCw,
    PanelLeft,
    X
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { pathToSlug } from '$lib/mailbox'
  import Composer from '$lib/components/Composer.svelte'
  import { openCompose, openDraft, type DraftRow } from '$lib/composer.svelte'
  import { afterNavigate, goto } from '$app/navigation'
  import { keyboard } from '$lib/keyboard.svelte'

  type ImapMailbox = { path: string; name: string; delimiter: string }
  type SyncStatus = {
    syncing: boolean
    configured: boolean
    hasError: boolean
    lastSyncedAt: string | null
    errorMessage: string | null
    progress: { mailbox: string; stored: number; total: number } | null
  }
  type Props = {
    data: { imapMailboxes: ImapMailbox[]; user: { name: string; email: string } | null }
    children: import('svelte').Snippet
  }
  type DraftListRow = {
    id: number
    toAddr: string
    subject: string
    updatedAt: string
  }

  let { data, children }: Props = $props()

  const perfPrefix = '[perf-client]'
  const shellInitAt = typeof performance !== 'undefined' ? performance.now() : 0

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function logPerf(message: string, details?: Record<string, unknown>) {
    if (!dev) return

    if (details) {
      console.log(perfPrefix, message, details)
      return
    }

    console.log(perfPrefix, message)
  }

  const mailbox = $derived(page.params.mailbox ?? null)

  function iconForMailbox(name: string) {
    const n = name.toLowerCase()
    if (n.includes('inbox')) return Inbox
    if (n.includes('sent')) return Send
    if (n.includes('draft')) return FileText
    if (n.includes('trash') || n.includes('deleted')) return Trash2
    if (n.includes('junk') || n.includes('spam')) return ArchiveX
    if (n.includes('archive')) return Archive
    return Folder
  }

  const mailboxes = $derived(
    data.imapMailboxes.map((mb) => ({
      label: mb.name,
      slug: pathToSlug(mb.path),
      icon: iconForMailbox(mb.name)
    }))
  )

  function readStorage(key: string, fallback: number): number {
    if (typeof window === 'undefined') return fallback
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw !== null ? Number(raw) : NaN
      return Number.isFinite(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  }

  let sidebarWidth = $state(readStorage('mail:sidebarWidth', 260))
  let resizing = $state(false)
  let sync = $state<SyncStatus | null>(null)
  let refreshing = $state(false)
  let drafts = $state<DraftListRow[]>([])
  let draftsError = $state<string | null>(null)
  let unreadCount = $state(0)
  let mobileNavOpen = $state(false)
  let viewportWidth = $state(1024)

  const isMobile = $derived(viewportWidth < 768)
  const activeMailboxLabel = $derived(
    mailboxes.find((candidate) => candidate.slug === mailbox)?.label ?? 'Mail'
  )

  function formatRelative(isoString: string): string {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  async function fetchSyncStatus(reason = 'unknown') {
    const startedAt = now()
    try {
      const res = await fetch('/api/sync-status')
      if (res.ok) sync = await res.json()
    } catch {
      // ignore
    } finally {
      logPerf('fetchSyncStatus', {
        reason,
        mailbox,
        ms: Math.round(now() - startedAt)
      })
    }
  }

  async function fetchDrafts(reason = 'unknown') {
    const startedAt = now()
    try {
      const res = await fetch('/api/drafts')
      if (res.ok) {
        const data = await res.json()
        drafts = data.drafts as DraftListRow[]
        draftsError = null
      }
    } catch {
      // ignore
    } finally {
      logPerf('fetchDrafts', {
        reason,
        rows: drafts.length,
        ms: Math.round(now() - startedAt)
      })
    }
  }

  async function openDraftById(id: number) {
    try {
      const res = await fetch(`/api/drafts/${id}`)
      if (!res.ok) {
        draftsError = await res.text()
        return
      }

      const data = await res.json()
      draftsError = null
      openDraft(data.draft as DraftRow)
    } catch {
      draftsError = 'Failed to open draft.'
    }
  }

  async function fetchUnreadCount(reason = 'unknown') {
    const startedAt = now()
    try {
      const res = await fetch('/api/unread-count')
      if (res.ok) {
        const data = await res.json()
        unreadCount = data.count as number
        updateFaviconAndTitle(unreadCount)
      }
    } catch {
      // ignore
    } finally {
      logPerf('fetchUnreadCount', {
        reason,
        unreadCount,
        ms: Math.round(now() - startedAt)
      })
    }
  }

  let faviconLinkEl: HTMLLinkElement | null = null
  function updateFaviconAndTitle(count: number) {
    // Update page title
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base

    // Update favicon badge
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw base favicon
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 32, 32)
      if (count > 0) {
        // Draw badge
        const badgeRadius = 9
        ctx.beginPath()
        ctx.arc(24, 8, badgeRadius, 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        // Draw count
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(count > 99 ? '99+' : String(count), 24, 8)
      }
      // Update favicon
      if (!faviconLinkEl) {
        faviconLinkEl = document.querySelector('link[rel="icon"]')
      }
      if (faviconLinkEl) {
        faviconLinkEl.href = canvas.toDataURL()
      }
    }
    img.src = favicon
  }

  async function handleRefresh() {
    if (refreshing) return
    refreshing = true
    await fetchSyncStatus('manual-refresh')
    await new Promise((r) => setTimeout(r, 600))
    refreshing = false
  }

  let mailboxNavEl = $state<HTMLElement | null>(null)

  afterNavigate(() => {
    mobileNavOpen = false
  })

  $effect(() => {
    if (!isMobile && mobileNavOpen) mobileNavOpen = false
  })

  // Keep keyboard state in sync with the mailboxes list
  $effect(() => {
    keyboard.mailboxCount = mailboxes.length
  })

  $effect(() => {
    // Sync focused mailbox index to the current active mailbox on navigation
    const idx = mailboxes.findIndex((mb) => mb.slug === mailbox)
    if (idx >= 0) keyboard.focusedMailboxIndex = idx
  })

  $effect(() => {
    // Register select callback so the keyboard module can trigger navigation
    keyboard.onMailboxSelect = () => {
      const mb = mailboxes[keyboard.focusedMailboxIndex]
      if (mb) void goto(resolve(`/${mb.slug}`))
    }
    return () => {
      keyboard.onMailboxSelect = null
    }
  })

  // Scroll focused mailbox item into view when navigating with arrow keys
  $effect(() => {
    const idx = keyboard.focusedMailboxIndex
    if (keyboard.panel !== 'mailboxes' || !mailboxNavEl) return
    const items = mailboxNavEl.querySelectorAll('[data-mailbox-item]')
    items[idx]?.scrollIntoView({ block: 'nearest' })
  })

  async function registerPush() {
    const startedAt = now()
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const res = await fetch('/api/push/vapid-public-key')
      const { publicKey } = await res.json()
      if (!publicKey) return

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const existing = await reg.pushManager.getSubscription()
      if (existing) return // already subscribed

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON())
      })
    } catch {
      // push is optional
    } finally {
      logPerf('registerPush', { ms: Math.round(now() - startedAt) })
    }
  }

  onMount(() => {
    logPerf('shell hydrated', { mailbox, ms: Math.round(now() - shellInitAt) })
    logPerf('mount background fetch kick-off', { mailbox })
    void fetchSyncStatus('mount')
    void fetchDrafts('mount')
    void fetchUnreadCount('mount')
    void registerPush()

    const syncInterval = setInterval(() => {
      logPerf('interval refresh', { task: 'fetchSyncStatus', everyMs: 5000 })
      void fetchSyncStatus('interval')
    }, 5000)
    const draftsInterval = setInterval(() => {
      logPerf('interval refresh', { task: 'fetchDrafts', everyMs: 30_000 })
      void fetchDrafts('interval')
    }, 30_000)
    const unreadInterval = setInterval(() => {
      logPerf('interval refresh', { task: 'fetchUnreadCount', everyMs: 30_000 })
      void fetchUnreadCount('interval')
    }, 30_000)

    return () => {
      clearInterval(syncInterval)
      clearInterval(draftsInterval)
      clearInterval(unreadInterval)
    }
  })

  function startResize(e: PointerEvent) {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    resizing = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    function onMove(ev: PointerEvent) {
      sidebarWidth = Math.max(150, Math.min(400, startWidth + (ev.clientX - startX)))
    }

    function stop() {
      resizing = false
      localStorage.setItem('mail:sidebarWidth', String(sidebarWidth))
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const userInitials = $derived.by(() => {
    const name = data.user?.name ?? data.user?.email ?? '?'
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  })
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<svelte:window bind:innerWidth={viewportWidth} />

<div
  class="flex h-screen overflow-hidden bg-[#0d0d10] text-zinc-100"
  class:cursor-col-resize={resizing}
  class:select-none={resizing}
>
  {#if isMobile && mobileNavOpen}
    <button
      type="button"
      class="absolute inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
      aria-label="Close navigation"
      onclick={() => (mobileNavOpen = false)}
    ></button>
  {/if}

  <aside
    style={isMobile ? undefined : `width: ${sidebarWidth}px; min-width: ${sidebarWidth}px`}
    class={[
      'flex flex-col bg-[#0a0a0d]',
      isMobile
        ? [
            'absolute inset-y-0 left-0 z-40 w-[85vw] max-w-xs transition-transform duration-200 ease-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          ]
        : 'relative'
    ]}
  >
    <div class="flex flex-1 flex-col overflow-hidden p-3 sm:p-4">
      <div class="mb-3 flex items-center justify-between px-1 md:hidden">
        <p class="text-sm font-semibold text-zinc-300">Navigation</p>
        <button
          type="button"
          class="rounded-lg p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
          aria-label="Close navigation"
          onclick={() => (mobileNavOpen = false)}
        >
          <X size={16} />
        </button>
      </div>

      <div class="mb-3 px-1">
        <button
          type="button"
          onclick={() => {
            mobileNavOpen = false
            void openCompose()
          }}
          class="flex w-full items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          <Pencil size={14} />
          Compose
          {#if drafts.length > 0}
            <span class="ml-auto rounded-full bg-blue-500 px-1.5 py-0.5 text-xs"
              >{drafts.length}</span
            >
          {/if}
        </button>

        <!-- Drafts list -->
        {#if drafts.length > 0}
          <div class="mt-1 rounded-lg border border-white/8 bg-white/3">
            {#each drafts as draft (draft.id)}
              <button
                type="button"
                onclick={() => void openDraftById(draft.id)}
                class="flex w-full items-start gap-2 border-b border-white/6 px-3 py-2 text-left text-xs first:rounded-t-lg last:rounded-b-lg last:border-b-0 hover:bg-white/5"
              >
                <FileText size={12} class="mt-0.5 shrink-0 text-zinc-500" />
                <div class="min-w-0">
                  <p class="truncate text-zinc-300">{draft.subject || '(no subject)'}</p>
                  <p class="truncate text-zinc-600">{draft.toAddr || 'No recipient'}</p>
                </div>
              </button>
            {/each}
          </div>
        {/if}

        {#if draftsError}
          <p class="mt-2 px-1 text-xs text-rose-400">{draftsError}</p>
        {/if}
      </div>

      <p class="px-3 pt-1 pb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
        Mail
      </p>
      <nav bind:this={mailboxNavEl} class="space-y-1.5 overflow-y-auto">
        {#each mailboxes as mb, i (mb.slug)}
          <a
            href={resolve(`/${mb.slug}`)}
            data-mailbox-item
            onclick={() => {
              mobileNavOpen = false
              keyboard.panel = 'list'
            }}
            class={[
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
              mailbox === mb.slug
                ? 'bg-white/8 font-medium text-white'
                : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200',
              keyboard.panel === 'mailboxes' && keyboard.focusedMailboxIndex === i
                ? 'ring-1 ring-blue-500/50 ring-inset'
                : ''
            ]}
          >
            <mb.icon size={15} />
            {mb.label}
          </a>
        {/each}
      </nav>

      <div class="mt-auto space-y-1 pt-4">
        <a
          href={resolve('/settings')}
          onclick={() => (mobileNavOpen = false)}
          class={[
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
            page.url.pathname === '/settings'
              ? 'bg-white/8 font-medium text-white'
              : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200'
          ]}
        >
          <Settings size={15} />
          Settings
        </a>
        <a
          href={resolve('/manual')}
          onclick={() => (mobileNavOpen = false)}
          class={[
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
            page.url.pathname === '/manual'
              ? 'bg-white/8 font-medium text-white'
              : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200'
          ]}
        >
          <BookOpen size={15} />
          Manual
        </a>

        <!-- Footer -->
        <div class="border-t border-white/6 pt-3">
          <!-- Sync status -->
          {#if sync}
            <div class="mb-2.5 flex items-center gap-2 px-3">
              {#if !sync.configured}
                <span class="h-1.5 w-1.5 rounded-full bg-zinc-600"></span>
                <span class="text-xs text-zinc-600">Mail not configured</span>
              {:else if sync.hasError}
                <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                <span class="truncate text-xs text-red-400" title={sync.errorMessage ?? ''}
                  >Sync error</span
                >
              {:else if sync.syncing}
                <span class="relative flex h-1.5 w-1.5 shrink-0">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"
                  ></span>
                  <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                </span>
                {#if sync.progress && sync.progress.total > 0}
                  <span class="truncate text-xs text-zinc-500">
                    {sync.progress.stored}/{sync.progress.total}
                  </span>
                {:else}
                  <span class="text-xs text-zinc-500">Syncing…</span>
                {/if}
              {:else}
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                <span class="text-xs text-zinc-600">
                  {sync.lastSyncedAt ? formatRelative(sync.lastSyncedAt) : 'Never synced'}
                </span>
              {/if}
              <button
                type="button"
                onclick={handleRefresh}
                class={[
                  'ml-auto transition',
                  refreshing ? 'animate-spin text-zinc-400' : 'text-zinc-600 hover:text-zinc-400'
                ]}
                title="Refresh"
              >
                <RefreshCw size={11} />
              </button>
            </div>
          {/if}

          <!-- User -->
          {#if data.user}
            <div class="flex items-center gap-2.5 px-3 py-1">
              <div
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-300"
              >
                {userInitials}
              </div>
              <div class="min-w-0">
                <p class="truncate text-xs font-medium text-zinc-400">
                  {data.user.name || data.user.email}
                </p>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </aside>

  <!-- Resize handle: sidebar ↔ content -->
  <div
    role="separator"
    aria-orientation="vertical"
    tabindex="-1"
    class="group relative z-10 hidden w-2 shrink-0 cursor-col-resize md:block"
    onpointerdown={startResize}
  >
    <div
      class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-white/25"
    ></div>
  </div>

  <div class="min-w-0 flex-1 overflow-hidden">
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex items-center gap-3 bg-[#0b0b0e] px-4 py-3 md:hidden">
        <button
          type="button"
          class="rounded-lg border border-transparent bg-white/3 p-2 text-zinc-200 transition hover:bg-white/6"
          aria-label="Open navigation"
          onclick={() => (mobileNavOpen = true)}
        >
          <PanelLeft size={16} />
        </button>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-white">{activeMailboxLabel}</p>
          {#if sync}
            <p class="truncate text-xs text-zinc-500">
              {#if !sync.configured}
                Mail not configured
              {:else if sync.hasError}
                Sync error
              {:else if sync.syncing}
                Syncing…
              {:else}
                {sync.lastSyncedAt ? `Synced ${formatRelative(sync.lastSyncedAt)}` : 'Never synced'}
              {/if}
            </p>
          {/if}
        </div>

        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          onclick={() => void openCompose()}
        >
          Compose
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<Composer />
