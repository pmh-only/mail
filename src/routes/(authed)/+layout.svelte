<script lang="ts">
  import favicon from '$lib/assets/favicon.svg'
  import { dev } from '$app/environment'
  import { page } from '$app/state'
  import { setSimplifiedModeSidebarActionContext } from '$lib/simplified-mode-context'
  import { onMount, untrack } from 'svelte'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import {
    Inbox,
    Send,
    FileText,
    Trash2,
    ArchiveX,
    Archive,
    Folder,
    Briefcase,
    Pencil,
    Settings,
    BookOpen,
    Users,
    ServerCog,
    RefreshCw,
    PanelLeft,
    Layers,
    Bookmark,
    CircleHelp,
    ShieldCheck,
    ChevronRight,
    ChevronDown,
    BellRing,
    Braces,
    CheckCheck,
    X
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { pathToSlug } from '$lib/mailbox'
  import Composer from '$lib/components/Composer.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import ShortcutHelpOverlay from '$lib/components/ShortcutHelpOverlay.svelte'
  import { openCompose, openDraft, type DraftRow } from '$lib/composer.svelte'
  import { parseMailtoUrl, registerMailtoProtocolHandler } from '$lib/mailto'
  import { parseShareTarget } from '$lib/web-share'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { afterNavigate, goto, invalidateAll, replaceState } from '$app/navigation'
  import { keyboard } from '$lib/keyboard.svelte'
  import { MAILBOX_STATE_CHANGED_EVENT } from '$lib/mailbox-state'
  import { clearOfflineCache } from '$lib/offline-cache'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { toast } from 'svelte-sonner'
  import { pushNotifications } from '$lib/push-notifications.svelte'
  import type { ComposedMailboxIcon } from '$lib/composed-mailbox'

  type ImapMailbox = { path: string; name: string; delimiter: string }
  type SidebarMailbox = ImapMailbox & { icon?: typeof Folder }
  type ComposedMailbox = {
    id: number
    name: string
    slug: string
    icon: ComposedMailboxIcon
    mailboxPaths: string[]
  }
  type SavedSearch = { id: number; name: string; query: string }
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
      composedMailboxes: ComposedMailbox[]
      unreadCounts: Record<string, number>
      savedSearches: SavedSearch[]
      user: { name: string; email: string } | null
      simplifiedView: boolean
      mailboxPreferences: { order: string[]; hidden: string[]; collapsedAccounts: string[] }
      secondaryNames: string[]
      sidebarWidth: number
      demoMode: boolean
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

  const composedMailboxIcons: Record<ComposedMailboxIcon, typeof Folder> = {
    layers: Layers,
    inbox: Inbox,
    folder: Folder,
    archive: Archive,
    spam: ArchiveX,
    drafts: FileText,
    sent: Send,
    bookmark: Bookmark,
    briefcase: Briefcase
  }

  let imapMailboxes = $state<ImapMailbox[]>([])
  let composedMailboxes = $state<ComposedMailbox[]>([])
  let unreadCounts = $state<Record<string, number>>({})
  let expandedMailboxKeys = $state<string[]>([])
  let mailboxExpansionInitialized = $state(false)
  let mailboxExpandedForSlug = $state<string | null>(null)

  function splitMailboxPath(path: string, delimiter: string) {
    if (!path) return []
    if (!delimiter) return [path]
    return path.split(delimiter).filter(Boolean)
  }

  function buildMailboxTree(mailboxes: SidebarMailbox[]) {
    const roots: MailboxTreeNode[] = []
    const nodes = new SvelteMap<string, MailboxTreeNode>()
    const secondaryNamesLower = (data.secondaryNames || []).map((name) => name.toLowerCase())

    for (const mailbox of mailboxes) {
      if (!mailbox.path) continue

      const pathLower = mailbox.path.toLowerCase()
      // Skip the root secondary folder node (e.g. 'Gmail') itself
      if (secondaryNamesLower.includes(pathLower)) {
        continue
      }

      const segments = splitMailboxPath(mailbox.path, mailbox.delimiter)
      let normalizedSegments = segments.length > 0 ? segments : [mailbox.path]

      // Strip the secondary prefix name segment to flatten its representation under the header
      let isSecondary = false
      if (normalizedSegments.length > 0) {
        const firstSegLower = normalizedSegments[0].toLowerCase()
        if (secondaryNamesLower.includes(firstSegLower)) {
          normalizedSegments = normalizedSegments.slice(1)
          isSecondary = true
        }
      }

      if (normalizedSegments.length === 0) continue

      let parentKey: string | null = null

      for (const [index, segment] of normalizedSegments.entries()) {
        const prefix = isSecondary ? segments[0] + mailbox.delimiter : ''
        const key = prefix + normalizedSegments.slice(0, index + 1).join(mailbox.delimiter)
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
          node.icon = mailbox.icon ?? iconForMailbox(mailbox.name || segment)
          node.selectable = true
        }

        parentKey = key
      }
    }

    return { roots, nodes }
  }

  function collectDefaultExpandedKeys(
    tree: ReturnType<typeof buildMailboxTree>,
    mailboxes: SidebarMailbox[],
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

  function collectActiveMailboxAncestorKeys(
    mailboxes: SidebarMailbox[],
    activeMailboxSlug: string | null
  ) {
    if (!activeMailboxSlug) return []

    const activeMailbox = mailboxes.find(
      (candidate) => pathToSlug(candidate.path) === activeMailboxSlug
    )
    if (!activeMailbox) return []

    const segments = splitMailboxPath(activeMailbox.path, activeMailbox.delimiter)
    return segments.map((_, index) => segments.slice(0, index + 1).join(activeMailbox.delimiter))
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

  let mailboxOrder = $state(untrack(() => [...data.mailboxPreferences.order]))
  const sidebarMailboxes = $derived.by(() => {
    const hidden = new SvelteSet(data.mailboxPreferences.hidden)
    const order = new SvelteMap(mailboxOrder.map((key, index) => [key, index]))
    return [
      ...imapMailboxes,
      ...composedMailboxes
        .filter((item) => !hidden.has(item.slug))
        .map((item) => ({
          path: item.slug,
          name: item.name,
          delimiter: '/',
          icon: composedMailboxIcons[item.icon]
        }))
    ].sort((left, right) => {
      const leftOrder = order.get(left.path) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = order.get(right.path) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
    })
  })
  const mailboxTree = $derived(buildMailboxTree(sidebarMailboxes))
  const defaultExpandedMailboxKeys = $derived(
    collectDefaultExpandedKeys(mailboxTree, sidebarMailboxes, mailbox)
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

  // Keep SSR's initial width while the effect below syncs later load data.
  // svelte-ignore state_referenced_locally
  let sidebarWidth = $state(data.sidebarWidth)
  $effect(() => {
    sidebarWidth = data.sidebarWidth
  })
  let resizing = $state(false)
  let sync = $state<SyncStatus | null>(null)
  let syncStatusHovered = $state(false)
  let refreshing = $state(false)
  let drafts = $state<DraftListRow[]>([])
  let draftsError = $state<string | null>(null)
  let pushNoticeError = $state<string | null>(null)
  let pushNoticeSettingUp = $state(false)
  let savedSearches = $state<SavedSearch[]>([])
  let smartFolderError = $state<string | null>(null)
  type ModalState = {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    inputLabel?: string
    inputValue?: string
    resolve: (value: string | boolean | null) => void
  }
  let actionModal = $state<ModalState | null>(null)
  let unreadCount = $state(0)
  let mobileNavOpen = $state(false)
  let utilityNavOpen = $state(false)
  let shortcutHelpOpen = $state(false)
  let sidebarSimplifiedModeAction = $state<((enabled: boolean) => Promise<void>) | null>(null)
  let simplifiedViewEnabled = $state(false)
  let savingSimplifiedView = $state(false)
  let viewportWidth = $state(1024)
  let syncPollTimer: ReturnType<typeof setTimeout> | null = null
  let offlineCacheClearedForSignedOut = false

  const isMobile = $derived(viewportWidth < 768)
  const activeMailboxLabel = $derived(
    composedMailboxes.find((candidate) => candidate.slug === mailbox)?.name ??
      imapMailboxes.find((candidate) => pathToSlug(candidate.path) === mailbox)?.name ??
      'Mail'
  )
  const utilityNavActive = $derived(
    page.url.pathname.startsWith('/settings') ||
      ['/contacts', '/operations', '/audit-log', '/manual', '/api-docs'].includes(page.url.pathname)
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
    composedMailboxes = data.composedMailboxes
  })

  $effect(() => {
    unreadCounts = data.unreadCounts
  })

  $effect(() => {
    savedSearches = data.savedSearches
  })

  $effect(() => {
    if (data.user) {
      offlineCacheClearedForSignedOut = false
      return
    }

    if (offlineCacheClearedForSignedOut) return
    offlineCacheClearedForSignedOut = true
    void clearOfflineCache()
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_OFFLINE_CACHE' })
  })

  $effect(() => {
    const validKeys = new SvelteSet(mailboxTree.nodes.keys())
    const validExpandedKeys = expandedMailboxKeys.filter((key) => validKeys.has(key))

    if (!mailboxExpansionInitialized && validKeys.size > 0) {
      expandedMailboxKeys = defaultExpandedMailboxKeys.filter((key) => validKeys.has(key))
      mailboxExpansionInitialized = true
      mailboxExpandedForSlug = mailbox
      return
    }

    const merged = new SvelteSet(validExpandedKeys)

    if (mailbox !== mailboxExpandedForSlug) {
      for (const key of collectActiveMailboxAncestorKeys(sidebarMailboxes, mailbox)) {
        if (validKeys.has(key)) merged.add(key)
      }
      mailboxExpandedForSlug = mailbox
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

  async function fetchSavedSearches() {
    try {
      const res = await fetch('/api/saved-searches')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load smart folders.'))
      const payload = (await res.json()) as { searches: SavedSearch[] }
      savedSearches = payload.searches
      smartFolderError = null
    } catch (error) {
      smartFolderError = errorMessageFromUnknown(error, 'Failed to load smart folders.')
    }
  }

  async function deleteSmartFolder(savedSearch: SavedSearch) {
    const confirmed = await requestModal({
      title: 'Delete smart folder',
      message: `Delete smart folder "${savedSearch.name}"?`,
      confirmLabel: 'Delete',
      tone: 'danger'
    })
    if (!confirmed) return

    const previousSearches = savedSearches
    savedSearches = savedSearches.filter((candidate) => candidate.id !== savedSearch.id)

    try {
      const res = await fetch(`/api/saved-searches/${savedSearch.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to delete smart folder.'))
      window.dispatchEvent(new CustomEvent('mail:saved-searches-changed'))
      toast('Smart folder deleted')
    } catch (error) {
      savedSearches = previousSearches
      smartFolderError = errorMessageFromUnknown(error, 'Failed to delete smart folder.')
    }
  }

  function requestModal(options: Omit<ModalState, 'resolve'>) {
    return new Promise<string | boolean | null>((resolve) => {
      actionModal = { ...options, resolve }
    })
  }

  function closeActionModal(value: string | boolean | null) {
    actionModal?.resolve(value)
    actionModal = null
  }

  async function renameSmartFolder(savedSearch: SavedSearch) {
    const name = String(
      (await requestModal({
        title: 'Rename smart folder',
        inputLabel: 'Name',
        inputValue: savedSearch.name,
        confirmLabel: 'Rename'
      })) ?? ''
    ).trim()
    if (!name || name === savedSearch.name) return

    const previousSearches = savedSearches
    savedSearches = savedSearches.map((candidate) =>
      candidate.id === savedSearch.id ? { ...candidate, name } : candidate
    )
    try {
      const res = await fetch(`/api/saved-searches/${savedSearch.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to rename smart folder.'))
      window.dispatchEvent(new CustomEvent('mail:saved-searches-changed'))
      toast('Smart folder renamed')
    } catch (error) {
      savedSearches = previousSearches
      smartFolderError = errorMessageFromUnknown(error, 'Failed to rename smart folder.')
    }
  }

  type MailboxContextMenuState = {
    row: VisibleMailboxRow
    x: number
    y: number
  } | null

  let mailboxContextMenu = $state<MailboxContextMenuState>(null)
  let markingMailboxRead = $state(false)

  function openMailboxContextMenu(event: MouseEvent, row: VisibleMailboxRow) {
    event.preventDefault()
    event.stopPropagation()
    if (!row.slug && !row.path) return

    const menuWidth = 192
    const menuHeight = 50
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    let x = event.clientX
    let y = event.clientY

    if (x + menuWidth > windowWidth) {
      x = Math.max(10, windowWidth - menuWidth - 10)
    }
    if (y + menuHeight > windowHeight) {
      y = Math.max(10, windowHeight - menuHeight - 10)
    }

    mailboxContextMenu = { row, x, y }
  }

  function closeMailboxContextMenu() {
    mailboxContextMenu = null
  }

  async function markMailboxAllRead(row: VisibleMailboxRow) {
    const mailboxTarget = row.slug || row.path
    if (!mailboxTarget) return
    closeMailboxContextMenu()

    const nextUnreadCounts = { ...unreadCounts }
    if (row.path) nextUnreadCounts[row.path] = 0
    if (row.slug) nextUnreadCounts[row.slug] = 0
    unreadCounts = nextUnreadCounts
    window.dispatchEvent(new CustomEvent(MAILBOX_STATE_CHANGED_EVENT))

    markingMailboxRead = true
    try {
      const res = await fetch('/api/mailboxes/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mailbox: mailboxTarget })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to mark mailbox as read.'))
      }
      const { count } = (await res.json()) as { count: number }
      if (count > 0) {
        toast.success(`Marked ${count} message${count === 1 ? '' : 's'} as read in "${row.label}"`)
      } else {
        toast.info(`No unread messages in "${row.label}"`)
      }
      await refreshMailboxState('mark-read')
      window.dispatchEvent(new CustomEvent(MAILBOX_STATE_CHANGED_EVENT))
      await invalidateAll()
    } catch (err) {
      smartFolderError = errorMessageFromUnknown(err, 'Failed to mark mailbox as read.')
      await refreshMailboxState('mark-read-error')
    } finally {
      markingMailboxRead = false
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
        composedMailboxes: ComposedMailbox[]
        unreadCounts: Record<string, number>
      }
      if (payload.mailboxes.length > 0) {
        imapMailboxes = payload.mailboxes
      }
      composedMailboxes = payload.composedMailboxes ?? []
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
  function updateAppBadge(count: number) {
    if (!('setAppBadge' in navigator)) return
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }

  function updateFaviconAndTitle(count: number) {
    updateAppBadge(count)
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

  afterNavigate(({ to }) => {
    mobileNavOpen = false
    utilityNavOpen = false

    const url = to?.url
    if (!url) return
    const mailto = url.searchParams.get('mailto')
    const sharedFields = parseShareTarget(url)
    if (!mailto && !sharedFields) return

    const fields = mailto ? parseMailtoUrl(mailto) : sharedFields
    if (fields) void openCompose(fields)
    queueMicrotask(() => replaceState(resolve('/inbox'), page.state))
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
    keyboard.shortcutHelpOpen = shortcutHelpOpen
  })

  $effect(() => {
    keyboard.onShortcutHelp = () => {
      shortcutHelpOpen = !shortcutHelpOpen
    }
    return () => {
      keyboard.onShortcutHelp = null
      keyboard.shortcutHelpOpen = false
    }
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

  async function enablePushFromNotice() {
    pushNoticeError = null
    pushNoticeSettingUp = true
    try {
      if (pushNotifications.status === 'server-unconfigured') {
        const response = await fetch('/api/push/generate-vapid', { method: 'POST' })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to generate VAPID keys.'))
        }
        await pushNotifications.refresh(true)
      }

      const enabled = await pushNotifications.enable()
      if (enabled) toast('Push notifications enabled')
    } catch (error) {
      pushNoticeError = errorMessageFromUnknown(error, 'Failed to enable notifications.')
    } finally {
      pushNoticeSettingUp = false
    }
  }

  onMount(() => {
    registerMailtoProtocolHandler(
      navigator,
      `${window.location.origin}${resolve('/inbox')}?mailto=%s`
    )

    logPerf('shell hydrated', { mailbox, ms: Math.round(now() - shellInitAt) })
    logPerf('mount background fetch kick-off', { mailbox })
    void refreshMailboxState('mount')
    void fetchSyncStatus('mount').finally(() => {
      scheduleNextSyncPoll()
    })
    void fetchDrafts('mount')
    if (data.demoMode) pushNotifications.disable()
    else void pushNotifications.refresh()

    const onSavedSearchesChanged = () => {
      void fetchSavedSearches()
    }
    window.addEventListener('mail:saved-searches-changed', onSavedSearchesChanged)

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
      window.removeEventListener('mail:saved-searches-changed', onSavedSearchesChanged)
      clearInterval(draftsInterval)
      clearInterval(unreadInterval)
      navigator.clearAppBadge?.().catch(() => {})
    }
  })

  function getMailboxServer(path: string | null | undefined, secondaryNames: string[]): string {
    if (!path) return 'Primary'
    const firstSegment = path.split('/')[0].toLowerCase()
    const lowerSecondaryNames = (secondaryNames || []).map((name) => name.toLowerCase())
    const matchedIdx = lowerSecondaryNames.indexOf(firstSegment)
    if (matchedIdx !== -1) {
      return secondaryNames[matchedIdx]
    }
    return 'Primary'
  }

  let collapsedAccounts = $state(
    new SvelteSet(untrack(() => data.mailboxPreferences.collapsedAccounts))
  )
  let collapsedAccountsSave = Promise.resolve()

  function toggleAccountCollapsed(accountName: string) {
    const previous = new SvelteSet(collapsedAccounts)
    if (collapsedAccounts.has(accountName)) {
      collapsedAccounts.delete(accountName)
    } else {
      collapsedAccounts.add(accountName)
    }

    const next = Array.from(collapsedAccounts)
    collapsedAccountsSave = collapsedAccountsSave.then(async () => {
      try {
        const response = await fetch('/api/settings/mailbox-preferences', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preferences: { collapsedAccounts: next } })
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to save account state.'))
        }
      } catch (error) {
        const current = Array.from(collapsedAccounts)
        if (current.length === next.length && current.every((value) => next.includes(value))) {
          collapsedAccounts = previous
        }
        toast.error(errorMessageFromUnknown(error, 'Failed to save account state.'))
      }
    })
  }

  let draggingMailboxPath = $state<string | null>(null)
  let dragOverMailboxPath = $state<string | null>(null)
  let dragOverDirection = $state<'above' | 'below' | null>(null)

  function handleDragOver(e: DragEvent, targetPath: string) {
    if (!draggingMailboxPath || draggingMailboxPath === targetPath) return
    e.preventDefault()

    dragOverMailboxPath = targetPath
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mouseY = e.clientY - rect.top
    const threshold = rect.height / 2

    if (mouseY < threshold) {
      dragOverDirection = 'above'
    } else {
      dragOverDirection = 'below'
    }
  }

  async function handleMailboxDrop(targetPath: string) {
    if (!draggingMailboxPath || draggingMailboxPath === targetPath) return

    const paths = sidebarMailboxes.map((mb) => mb.path)
    const dragIdx = paths.indexOf(draggingMailboxPath)
    const dropIdx = paths.indexOf(targetPath)

    if (dragIdx === -1 || dropIdx === -1) return

    const filteredPaths = paths.filter((p) => p !== draggingMailboxPath)
    let insertIdx = filteredPaths.indexOf(targetPath)
    if (dragOverDirection === 'below') {
      insertIdx += 1
    }
    filteredPaths.splice(insertIdx, 0, draggingMailboxPath)

    const currentOrder = mailboxOrder
    const basePaths = Array.from(new Set([...currentOrder, ...paths]))
    const filteredBase = basePaths.filter((p) => p !== draggingMailboxPath)
    let insertIdxBase = filteredBase.indexOf(targetPath)
    if (dragOverDirection === 'below') {
      insertIdxBase += 1
    }
    filteredBase.splice(insertIdxBase, 0, draggingMailboxPath)

    const nextPreferences = {
      order: filteredBase,
      hidden: data.mailboxPreferences?.hidden || []
    }

    try {
      const res = await fetch('/api/settings/mailbox-preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: nextPreferences })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to save order.'))
      }

      mailboxOrder = filteredBase
      toast.success('Mailbox order updated')
    } catch (err) {
      toast.error('Failed to update mailbox order')
      console.error(err)
    } finally {
      draggingMailboxPath = null
      dragOverMailboxPath = null
      dragOverDirection = null
    }
  }

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
      void fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sidebarWidth })
      })
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
      toast(nextValue ? 'Simplified view enabled' : 'Simplified view disabled')
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
  class="app-shell flex h-screen overflow-hidden text-zinc-100"
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
      'app-sidebar flex flex-col',
      isMobile
        ? [
            'absolute inset-y-0 left-0 z-40 w-[85vw] max-w-xs transition-transform duration-200 ease-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          ]
        : 'relative z-30'
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

      <nav bind:this={mailboxNavEl} class="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {#each visibleMailboxRows as row, index (row.key)}
          {@const selectableIndex = row.slug
            ? mailboxes.findIndex((mb) => mb.slug === row.slug)
            : -1}
          {@const currentServer = getMailboxServer(row.path, data.secondaryNames)}
          {@const prevServer =
            index > 0
              ? getMailboxServer(visibleMailboxRows[index - 1].path, data.secondaryNames)
              : null}

          {#if index === 0 || currentServer !== prevServer}
            {#if index > 0}
              <div class="my-2 border-t border-white/5"></div>
            {/if}
            <button
              type="button"
              onclick={() => toggleAccountCollapsed(currentServer)}
              aria-expanded={!collapsedAccounts.has(currentServer)}
              class="flex w-full items-center gap-1.5 px-3 pt-2 pb-1 text-left text-[10px] font-bold tracking-wider text-zinc-500 uppercase select-none hover:text-zinc-300"
            >
              {#if collapsedAccounts.has(currentServer)}
                <ChevronRight size={10} class="text-zinc-600" />
              {:else}
                <ChevronDown size={10} class="text-zinc-600" />
              {/if}
              {currentServer === 'Primary' ? 'Primary Account' : currentServer}
            </button>
          {/if}

          {#if !collapsedAccounts.has(currentServer)}
            <div
              role="listitem"
              draggable="true"
              ondragstart={(e) => {
                if (row.path) {
                  draggingMailboxPath = row.path
                  e.dataTransfer?.setData('text/plain', row.path)
                }
              }}
              ondragover={(e) => {
                if (row.path) {
                  handleDragOver(e, row.path)
                }
              }}
              ondragleave={() => {
                dragOverMailboxPath = null
                dragOverDirection = null
              }}
              ondrop={(e) => {
                e.preventDefault()
                if (row.path) {
                  void handleMailboxDrop(row.path)
                }
              }}
              oncontextmenu={(event) => {
                if (row.selectable && (row.slug || row.path)) {
                  openMailboxContextMenu(event, row)
                }
              }}
              class={[
                'group relative flex items-center gap-1 rounded-xl transition-all duration-75',
                row.selectable && mailbox === row.slug
                  ? 'bg-white/8 text-white'
                  : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200',
                dragOverMailboxPath === row.path && dragOverDirection === 'above'
                  ? 'shadow-[inset_0_2px_0_0_#10b981]'
                  : '',
                dragOverMailboxPath === row.path && dragOverDirection === 'below'
                  ? 'shadow-[inset_0_-2px_0_0_#10b981]'
                  : '',
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
          {/if}
        {/each}

        {#if savedSearches.length > 0}
          <div class="pt-3">
            <p class="px-3 pb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
              Smart folders
            </p>
            <div class="space-y-1">
              {#each savedSearches as savedSearch (savedSearch.id)}
                {@const href = resolve(`/inbox?q=${encodeURIComponent(savedSearch.query)}`)}
                {@const activeSmartFolder = page.url.searchParams.get('q') === savedSearch.query}
                <div
                  class={[
                    'group flex items-center gap-1 rounded-xl transition',
                    activeSmartFolder
                      ? 'bg-white/8 text-white'
                      : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200'
                  ]}
                >
                  <a
                    {href}
                    title={savedSearch.query}
                    onclick={() => {
                      mobileNavOpen = false
                      keyboard.panel = 'list'
                    }}
                    class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition"
                  >
                    <Bookmark size={15} class="shrink-0" />
                    <span class="truncate">{savedSearch.name}</span>
                  </a>
                  <button
                    type="button"
                    class="rounded-lg p-1.5 text-zinc-600 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-white/8 hover:text-zinc-200"
                    aria-label={`Rename smart folder ${savedSearch.name}`}
                    onclick={() => void renameSmartFolder(savedSearch)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    class="mr-1 rounded-lg p-1.5 text-zinc-600 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-white/8 hover:text-red-300"
                    aria-label={`Delete smart folder ${savedSearch.name}`}
                    onclick={() => void deleteSmartFolder(savedSearch)}
                  >
                    <X size={13} />
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
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
        <div class="relative">
          <button
            type="button"
            onclick={() => (utilityNavOpen = !utilityNavOpen)}
            aria-expanded={utilityNavOpen}
            aria-haspopup="menu"
            class={[
              'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition',
              utilityNavActive
                ? 'bg-white/8 font-medium text-white'
                : 'text-zinc-400 hover:bg-white/4 hover:text-zinc-200'
            ]}
          >
            <span class="flex items-center gap-2.5">
              <Settings size={15} />
              Menu
            </span>
            <ChevronDown
              size={14}
              class={utilityNavOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </button>

          {#if utilityNavOpen}
            <button
              type="button"
              class="fixed inset-0 z-20 cursor-default"
              aria-label="Close menu"
              onclick={() => (utilityNavOpen = false)}
            ></button>
            <div
              role="menu"
              class="app-popover absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-2xl border border-white/10 p-1.5 shadow-2xl ring-1 shadow-black/50 ring-black/20 backdrop-blur-xl"
            >
              <a
                href={resolve('/contacts')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname === '/contacts'
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <Users size={14} />
                Contacts
              </a>
              <a
                href={resolve('/settings/ai-features')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname.startsWith('/settings')
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <Settings size={14} />
                Settings
              </a>
              <a
                href={resolve('/operations')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname === '/operations'
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <ServerCog size={14} />
                Operations
              </a>
              <a
                href={resolve('/audit-log')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname === '/audit-log'
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <ShieldCheck size={14} />
                Audit log
              </a>
              <a
                href={resolve('/api-docs')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname === '/api-docs'
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <Braces size={14} />
                API docs
              </a>
              <a
                href={resolve('/manual')}
                role="menuitem"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                }}
                class={[
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                  page.url.pathname === '/manual'
                    ? 'bg-white/8 font-medium text-white'
                    : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
                ]}
              >
                <BookOpen size={14} />
                Manual
              </a>
              <button
                type="button"
                role="menuitem"
                aria-keyshortcuts="?"
                onclick={() => {
                  mobileNavOpen = false
                  utilityNavOpen = false
                  shortcutHelpOpen = true
                }}
                class="flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-white/6 hover:text-zinc-100"
              >
                <span class="flex items-center gap-2.5">
                  <CircleHelp size={14} />
                  Shortcuts
                </span>
                <kbd
                  class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500"
                  >?</kbd
                >
              </button>
            </div>
          {/if}
        </div>

        <!-- Footer -->
        <div class="border-t border-white/6 pt-3">
          <!-- Sync status -->
          {#if sync}
            <div
              class="relative mb-2.5 px-3"
              role="group"
              aria-label="Sync status"
              onmouseenter={() => (syncStatusHovered = true)}
              onmouseleave={() => (syncStatusHovered = false)}
            >
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
                class={[
                  'pointer-events-none absolute bottom-full left-3 z-[80] mb-2 hidden w-64 rounded-xl border border-white/8 bg-[#131319] p-3 shadow-2xl shadow-black/30 transition duration-150 md:block',
                  syncStatusHovered
                    ? 'visible translate-y-0 opacity-100'
                    : 'invisible translate-y-1 opacity-0'
                ]}
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
      <div class="app-mobile-header flex items-center gap-3 px-4 py-3 md:hidden">
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

      {#if pushNotifications.status === 'unconfigured' || pushNotifications.status === 'blocked' || pushNotifications.status === 'server-unconfigured' || pushNotifications.status === 'error'}
        <div
          role="status"
          aria-live="polite"
          class="border-y border-amber-400/20 bg-amber-500/10 px-4 py-2.5 sm:px-6"
        >
          <div
            class="mx-auto flex max-w-6xl flex-col items-stretch gap-3 sm:flex-row sm:items-center"
          >
            <div class="flex min-w-0 flex-1 items-start gap-3">
              <BellRing size={17} class="mt-0.5 shrink-0 text-amber-300" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-amber-100">
                  {pushNotifications.status === 'blocked'
                    ? 'Browser notifications are blocked.'
                    : pushNotifications.status === 'server-unconfigured'
                      ? 'Push notifications need server setup.'
                      : pushNotifications.status === 'error'
                        ? 'Notification setup could not be checked.'
                        : 'Get notified when new mail arrives.'}
                </p>
                <p class="mt-0.5 text-xs text-amber-100/70">
                  {pushNoticeError ??
                    (pushNotifications.status === 'blocked'
                      ? 'Allow notifications in this browser’s site settings, then reload.'
                      : pushNotifications.status === 'server-unconfigured'
                        ? 'Set up push notifications for the server and this browser.'
                        : pushNotifications.status === 'error'
                          ? 'Check the connection and try again.'
                          : 'Set up this browser to receive push notifications.')}
                </p>
              </div>
            </div>

            {#if pushNotifications.status === 'unconfigured' || pushNotifications.status === 'server-unconfigured'}
              <button
                type="button"
                onclick={() => void enablePushFromNotice()}
                disabled={pushNoticeSettingUp || pushNotifications.configuring}
                class="self-start rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-200 disabled:opacity-50 sm:self-auto"
              >
                {pushNoticeSettingUp || pushNotifications.configuring ? 'Setting up…' : 'Set up'}
              </button>
            {:else if pushNotifications.status === 'error'}
              <button
                type="button"
                onclick={() => {
                  pushNoticeError = null
                  void pushNotifications.refresh()
                }}
                class="self-start rounded-lg border border-amber-300/30 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-300/10 sm:self-auto"
              >
                Retry
              </button>
            {:else}
              <a
                href={resolve('/settings/notifications')}
                class="self-start rounded-lg border border-amber-300/30 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-300/10 sm:self-auto"
              >
                Review setup
              </a>
            {/if}
          </div>
        </div>
      {/if}

      <div class="min-h-0 flex-1 overflow-hidden">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<Composer />
<ShortcutHelpOverlay open={shortcutHelpOpen} onclose={() => (shortcutHelpOpen = false)} />

<ErrorDialog message={draftsError} title="Mail error" onclose={() => (draftsError = null)} />
<ErrorDialog
  message={smartFolderError}
  title="Smart folder error"
  onclose={() => (smartFolderError = null)}
/>

{#if actionModal}
  <ActionModal
    title={actionModal.title}
    message={actionModal.message}
    confirmLabel={actionModal.confirmLabel}
    cancelLabel={actionModal.cancelLabel}
    tone={actionModal.tone}
    inputLabel={actionModal.inputLabel}
    inputValue={actionModal.inputValue}
    onconfirm={(value) => closeActionModal(value ?? true)}
    oncancel={() => closeActionModal(null)}
  />
{/if}

{#if mailboxContextMenu}
  {@const activeMenu = mailboxContextMenu}
  <div
    class="fixed inset-0 z-50 bg-transparent"
    role="presentation"
    onclick={closeMailboxContextMenu}
    onkeydown={(e) => e.key === 'Escape' && closeMailboxContextMenu()}
    oncontextmenu={(event) => {
      event.preventDefault()
      closeMailboxContextMenu()
    }}
  >
    <div
      class="fixed z-50 min-w-48 rounded-xl border border-white/10 bg-zinc-900/95 p-1 text-sm text-zinc-200 shadow-2xl backdrop-blur-xl transition"
      style={`left:${activeMenu.x}px;top:${activeMenu.y}px;`}
      role="menu"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      oncontextmenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => void markMailboxAllRead(activeMenu.row)}
        disabled={markingMailboxRead}
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 transition hover:bg-white/8 disabled:opacity-50"
      >
        <CheckCheck size={14} class="shrink-0 text-emerald-400" />
        <span>Mark all as read</span>
      </button>
    </div>
  </div>
{/if}
