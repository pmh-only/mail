<script lang="ts">
  import favicon from '$lib/assets/favicon.svg'
  import { dev } from '$app/environment'
  import { page } from '$app/state'
  import { setSimplifiedModeSidebarActionContext } from '$lib/simplified-mode-context'
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
    Users,
    RefreshCw,
    PanelLeft,
    Layers,
    ChevronRight,
    ChevronDown,
    X
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { pathToSlug } from '$lib/mailbox'
  import Composer from '$lib/components/Composer.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { openCompose, openDraft, type DraftRow } from '$lib/composer.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { afterNavigate, goto, invalidateAll } from '$app/navigation'
  import { keyboard } from '$lib/keyboard.svelte'
  import { MAILBOX_STATE_CHANGED_EVENT } from '$lib/mailbox-state'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

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
    data: {
      imapMailboxes: ImapMailbox[]
      unreadCounts: Record<string, number>
      user: { name: string; email: string } | null
      simplifiedView: boolean
    }
    children: import('svelte').Snippet
  }
  type DraftListRow = {
    id: number
    toAddr: string
    subject: string
    updatedAt: string
  }
  type MailboxTreeNode = {
    key: string
    label: string
    slug: string | null
    path: string | null
    icon: typeof Folder
    depth: number
    parentKey: string | null
    children: MailboxTreeNode[]
    selectable: boolean
  }
  type VisibleMailboxRow = {
    key: string
    label: string
    slug: string | null
    path: string | null
    icon: typeof Folder
    depth: number
    selectable: boolean
    hasChildren: boolean
    expanded: boolean
    unreadCount: number
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

  let imapMailboxes = $state<ImapMailbox[]>([])
  let unreadCounts = $state<Record<string, number>>({})
  let expandedMailboxKeys = $state<string[]>([])

  function splitMailboxPath(path: string, delimiter: string) {
    if (!path) return []
    if (!delimiter) return [path]
    return path.split(delimiter).filter(Boolean)
  }

  function buildMailboxTree(mailboxes: ImapMailbox[]) {
    const roots: MailboxTreeNode[] = []
    const nodes = new SvelteMap<string, MailboxTreeNode>()

    for (const mailbox of mailboxes) {
      const segments = splitMailboxPath(mailbox.path, mailbox.delimiter)
      const normalizedSegments = segments.length > 0 ? segments : [mailbox.path]
      let parentKey: string | null = null

      for (const [index, segment] of normalizedSegments.entries()) {
        const key = normalizedSegments.slice(0, index + 1).join(mailbox.delimiter)
        let node = nodes.get(key)

        if (!node) {
          node = {
            key,
            label: segment,
            slug: null,
            path: null,
            icon: Folder,
            depth: index,
            parentKey,
            children: [],
            selectable: false
          }
          nodes.set(key, node)

          if (parentKey) {
            nodes.get(parentKey)?.children.push(node)
          } else {
            roots.push(node)
          }
        }

        if (index === normalizedSegments.length - 1) {
          node.label = mailbox.name || segment
          node.slug = pathToSlug(mailbox.path)
          node.path = mailbox.path
          node.icon = iconForMailbox(mailbox.name || segment)
          node.selectable = true
        }

        parentKey = key
      }
    }

    return { roots, nodes }
  }

  function collectDefaultExpandedKeys(
    tree: ReturnType<typeof buildMailboxTree>,
    mailboxes: ImapMailbox[],
    activeMailboxSlug: string | null
  ) {
    const defaults = new SvelteSet<string>()

    for (const root of tree.roots) {
      if (root.children.length > 0) defaults.add(root.key)
    }

    if (!activeMailboxSlug) return Array.from(defaults)

    const activeMailbox = mailboxes.find(
      (candidate) => pathToSlug(candidate.path) === activeMailboxSlug
    )
    if (!activeMailbox) return Array.from(defaults)

    const segments = splitMailboxPath(activeMailbox.path, activeMailbox.delimiter)
    for (const [index] of segments.entries()) {
      defaults.add(segments.slice(0, index + 1).join(activeMailbox.delimiter))
    }

    return Array.from(defaults)
  }

  function flattenMailboxTree(nodes: MailboxTreeNode[], expandedKeys: Set<string>) {
    const rows: VisibleMailboxRow[] = []

    for (const node of nodes) {
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && expandedKeys.has(node.key)

      rows.push({
        key: node.key,
        label: node.label,
        slug: node.slug,
        path: node.path,
        icon: node.icon,
        depth: node.depth,
        selectable: node.selectable,
        hasChildren,
        expanded,
        unreadCount: node.path ? (unreadCounts[node.path] ?? 0) : 0
      })

      if (expanded) {
        rows.push(...flattenMailboxTree(node.children, expandedKeys))
      }
    }

    return rows
  }

  const mailboxTree = $derived(buildMailboxTree(imapMailboxes))
  const defaultExpandedMailboxKeys = $derived(
    collectDefaultExpandedKeys(mailboxTree, imapMailboxes, mailbox)
  )
  const visibleMailboxRows = $derived(
    flattenMailboxTree(mailboxTree.roots, new SvelteSet(expandedMailboxKeys))
  )
  const selectableMailboxRows = $derived(visibleMailboxRows.filter((row) => row.slug !== null))
  const mailboxes = $derived(
    selectableMailboxRows.map((row) => ({
      label: row.label,
      slug: row.slug ?? '',
      icon: row.icon
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
  let sidebarSimplifiedModeAction = $state<((enabled: boolean) => Promise<void>) | null>(null)
  let simplifiedViewEnabled = $state(false)
  let savingSimplifiedView = $state(false)
  let viewportWidth = $state(1024)
  let syncPollTimer: ReturnType<typeof setTimeout> | null = null

  const isMobile = $derived(viewportWidth < 768)
  const activeMailboxLabel = $derived(
    imapMailboxes.find((candidate) => pathToSlug(candidate.path) === mailbox)?.name ?? 'Mail'
  )

  function toggleMailboxExpanded(key: string) {
    expandedMailboxKeys = expandedMailboxKeys.includes(key)
      ? expandedMailboxKeys.filter((candidate) => candidate !== key)
      : [...expandedMailboxKeys, key]
  }

  $effect(() => {
    simplifiedViewEnabled = data.simplifiedView
  })

  $effect(() => {
    imapMailboxes = data.imapMailboxes
  })

  $effect(() => {
    unreadCounts = data.unreadCounts
  })

  $effect(() => {
    const validKeys = new SvelteSet(mailboxTree.nodes.keys())
    const merged = new SvelteSet(defaultExpandedMailboxKeys)

    for (const key of expandedMailboxKeys) {
      if (validKeys.has(key)) merged.add(key)
    }

    const nextKeys = Array.from(merged)
    if (
      nextKeys.length !== expandedMailboxKeys.length ||
      nextKeys.some((key, index) => expandedMailboxKeys[index] !== key)
    ) {
      expandedMailboxKeys = nextKeys
    }
  })

  function formatRelative(isoString: string): string {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  function formatDateTime(isoString: string | null) {
    if (!isoString) return 'Never'

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(isoString))
  }

  function mailboxDisplayName(path: string | null | undefined) {
    if (!path) return 'Unknown mailbox'
    return imapMailboxes.find((candidate) => candidate.path === path)?.name ?? path
  }

  function syncStatusLabel(summary: SyncStatus) {
    if (!summary.configured) return 'Mail not configured'
    if (summary.hasError) return 'Sync error'
    if (summary.syncing) return 'Syncing'
    return 'Up to date'
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

  function scheduleNextSyncPoll() {
    if (syncPollTimer) {
      clearTimeout(syncPollTimer)
      syncPollTimer = null
    }

    const delayMs = sync?.syncing ? 1000 : 5000
    syncPollTimer = setTimeout(() => {
      void fetchSyncStatus('interval').finally(() => {
        scheduleNextSyncPoll()
      })
    }, delayMs)
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
        draftsError = await readErrorMessage(res, 'Failed to open draft.')
        await fetchDrafts('draft-open-failed')
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

  async function fetchMailboxes(reason = 'unknown') {
    const startedAt = now()
    try {
      const res = await fetch('/api/mailboxes')
      if (!res.ok) return

      const payload = (await res.json()) as {
        mailboxes: ImapMailbox[]
        unreadCounts: Record<string, number>
      }
      if (payload.mailboxes.length > 0) {
        imapMailboxes = payload.mailboxes
      }
      unreadCounts = payload.unreadCounts
    } catch {
      // ignore
    } finally {
      logPerf('fetchMailboxes', {
        reason,
        rows: imapMailboxes.length,
        ms: Math.round(now() - startedAt)
      })
    }
  }

  async function refreshMailboxState(reason = 'unknown') {
    await Promise.all([fetchUnreadCount(reason), fetchMailboxes(reason)])
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
    void refreshMailboxState('mount')
    void fetchSyncStatus('mount').finally(() => {
      scheduleNextSyncPoll()
    })
    void fetchDrafts('mount')
    void registerPush()

    const onMailboxStateChanged = (event: Event) => {
      const reason =
        event instanceof CustomEvent && typeof event.detail?.reason === 'string'
          ? event.detail.reason
          : 'mailbox-state-changed'
      void refreshMailboxState(reason)
      void fetchDrafts(reason)
    }
    window.addEventListener(MAILBOX_STATE_CHANGED_EVENT, onMailboxStateChanged)

    const draftsInterval = setInterval(() => {
      logPerf('interval refresh', { task: 'fetchDrafts', everyMs: 30_000 })
      void fetchDrafts('interval')
    }, 30_000)
    const unreadInterval = setInterval(() => {
      logPerf('interval refresh', { task: 'refreshMailboxState', everyMs: 30_000 })
      void refreshMailboxState('interval')
    }, 30_000)

    return () => {
      if (syncPollTimer) {
        clearTimeout(syncPollTimer)
        syncPollTimer = null
      }
      window.removeEventListener(MAILBOX_STATE_CHANGED_EVENT, onMailboxStateChanged)
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

  async function toggleSimplifiedView() {
    if (savingSimplifiedView) return

    const previousValue = simplifiedViewEnabled
    const nextValue = !previousValue

    simplifiedViewEnabled = nextValue
    savingSimplifiedView = true

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ simplifiedView: nextValue })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update simplified view.'))
      }

      await sidebarSimplifiedModeAction?.(nextValue)
      await invalidateAll()
    } catch (error) {
      simplifiedViewEnabled = previousValue
      draftsError = errorMessageFromUnknown(error, 'Failed to update simplified view.')
    } finally {
      savingSimplifiedView = false
    }
  }

  setSimplifiedModeSidebarActionContext({
    setSidebarSimplifiedModeAction(action) {
      sidebarSimplifiedModeAction = action
    }
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
    <div class="flex min-h-0 flex-1 flex-col overflow-visible p-3 sm:p-4">
      <div class="mb-3 flex shrink-0 items-center justify-between px-1 md:hidden">
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

      <div class="mb-3 shrink-0 px-1">
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

      </div>

      <p
        class="shrink-0 px-3 pt-1 pb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase"
      >
        Mail
      </p>
      <nav bind:this={mailboxNavEl} class="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {#each visibleMailboxRows as row (row.key)}
          {@const selectableIndex = row.slug
            ? mailboxes.findIndex((mb) => mb.slug === row.slug)
            : -1}
          <div
            class={[
              'group flex items-center gap-1 rounded-xl transition',
              row.selectable && mailbox === row.slug
                ? 'bg-white/8 text-white'
                : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200',
              row.selectable &&
              keyboard.panel === 'mailboxes' &&
              selectableIndex >= 0 &&
              keyboard.focusedMailboxIndex === selectableIndex
                ? 'ring-1 ring-blue-500/50 ring-inset'
                : ''
            ]}
            style={`padding-left: ${12 + row.depth * 14}px;`}
          >
            {#if row.selectable && row.slug}
              <a
                href={resolve(`/${row.slug}`)}
                data-mailbox-item
                onclick={() => {
                  mobileNavOpen = false
                  keyboard.panel = 'list'
                }}
                class={[
                  'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-sm transition',
                  mailbox === row.slug ? 'font-medium text-white' : ''
                ]}
              >
                <row.icon size={15} class="shrink-0" />
                <span class="truncate">{row.label}</span>
                {#if row.unreadCount > 0}
                  <span
                    class="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-200"
                  >
                    {row.unreadCount}
                  </span>
                {/if}
                {#if row.hasChildren}
                  <button
                    type="button"
                    class="shrink-0 rounded-md text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
                    aria-label={row.expanded ? `Collapse ${row.label}` : `Expand ${row.label}`}
                    aria-expanded={row.expanded}
                    onclick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggleMailboxExpanded(row.key)
                    }}
                  >
                    {#if row.expanded}
                      <ChevronDown size={14} />
                    {:else}
                      <ChevronRight size={14} />
                    {/if}
                  </button>
                {/if}
              </a>
            {:else}
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm text-zinc-300 transition"
                onclick={() => toggleMailboxExpanded(row.key)}
              >
                <row.icon size={15} class="shrink-0" />
                <span class="truncate">{row.label}</span>
                {#if row.unreadCount > 0}
                  <span
                    class="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-200"
                  >
                    {row.unreadCount}
                  </span>
                {/if}
                {#if row.hasChildren}
                  <span class="shrink-0 text-zinc-500">
                    {#if row.expanded}
                      <ChevronDown size={14} />
                    {:else}
                      <ChevronRight size={14} />
                    {/if}
                  </span>
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      </nav>

      <div class="mt-auto shrink-0 space-y-1 pt-4">
        <button
          type="button"
          onclick={() => void toggleSimplifiedView()}
          disabled={savingSimplifiedView}
          aria-pressed={simplifiedViewEnabled}
          class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-white/4 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span class="flex items-center gap-2.5">
            <Layers size={15} />
            Simplified mode
          </span>
          <span class="relative inline-flex items-center">
            <span
              class={[
                'h-5 w-9 rounded-full transition after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition',
                simplifiedViewEnabled ? 'bg-blue-600 after:translate-x-4' : 'bg-zinc-700'
              ]}
            ></span>
          </span>
        </button>
        <a
          href={resolve('/contacts')}
          onclick={() => (mobileNavOpen = false)}
          class={[
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
            page.url.pathname === '/contacts'
              ? 'bg-white/8 font-medium text-white'
              : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200'
          ]}
        >
          <Users size={15} />
          Contacts
        </a>
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
            <div class="group relative mb-2.5 px-3">
              <div class="flex items-center gap-2">
                {#if !sync.configured}
                  <span class="h-1.5 w-1.5 rounded-full bg-zinc-600"></span>
                  <span class="text-xs text-zinc-600">Mail not configured</span>
                {:else if sync.hasError}
                  <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                  <span class="truncate text-xs text-red-400">Sync error</span>
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

              <div
                class="pointer-events-none absolute bottom-full left-3 z-50 mb-2 hidden w-64 rounded-xl border border-white/8 bg-[#131319] p-3 opacity-0 shadow-2xl shadow-black/30 transition duration-150 group-focus-within:opacity-100 group-hover:opacity-100 md:block"
              >
                <div class="space-y-2">
                  <p
                    class={[
                      'text-sm font-medium',
                      !sync.configured
                        ? 'text-zinc-300'
                        : sync.hasError
                          ? 'text-red-300'
                          : sync.syncing
                            ? 'text-zinc-200'
                            : 'text-zinc-200'
                    ]}
                  >
                    {syncStatusLabel(sync)}
                  </p>

                  <div class="space-y-1 text-xs text-zinc-400">
                    <p class="flex items-start justify-between gap-3">
                      <span class="text-zinc-500">Last sync</span>
                      <span class="text-right text-zinc-300">
                        {formatDateTime(sync.lastSyncedAt)}
                      </span>
                    </p>

                    {#if sync.progress}
                      <p class="flex items-start justify-between gap-3">
                        <span class="text-zinc-500">Mailbox</span>
                        <span class="text-right text-zinc-300">
                          {mailboxDisplayName(sync.progress.mailbox)}
                        </span>
                      </p>
                      <p class="flex items-start justify-between gap-3">
                        <span class="text-zinc-500">Progress</span>
                        <span class="text-right text-zinc-300">
                          {sync.progress.stored}/{sync.progress.total}
                        </span>
                      </p>
                    {/if}

                    {#if sync.hasError && sync.errorMessage}
                      <div class="border-t border-white/8 pt-2">
                        <p class="text-zinc-500">Error</p>
                        <p class="mt-1 break-words text-red-300">{sync.errorMessage}</p>
  </div>
{/if}

<ErrorDialog
  message={draftsError}
  title="Mail error"
  onclose={() => (draftsError = null)}
/>
                  </div>
                </div>
              </div>
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

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
            onclick={() => void openCompose()}
          >
            Compose
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<Composer />
