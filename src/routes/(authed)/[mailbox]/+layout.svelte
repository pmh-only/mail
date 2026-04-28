<script lang="ts">
  import { dev } from '$app/environment'
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { pathToSlug } from '$lib/mailbox'
  import { getSimplifiedModeSidebarActionContext } from '$lib/simplified-mode-context'
  import { page } from '$app/state'
  import { onMount, tick, untrack } from 'svelte'
  import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity'
  import {
    RefreshCw,
    CheckSquare,
    Square,
    Archive,
    Trash2,
    MailOpen,
    ShieldAlert,
    X,
    ChevronLeft,
    ChevronRight,
    Search
  } from 'lucide-svelte'
  import { openCompose } from '$lib/composer.svelte'
  import { keyboard, setupKeyboardHandler } from '$lib/keyboard.svelte'

  type SyncData = {
    mailbox: string
    configured: boolean
    skipped: boolean
    syncing?: boolean
    fetchedCount: number
    storedCount: number
    lastSyncedAt: string | null
    lastError: string | null
    reason?: string
  }

  type Message = {
    id: number
    messageId?: string
    uid: number
    subject: string | null
    from: string | null
    to: string | null
    preview: string | null
    flags: string[]
    receivedAt: string | null
    mailbox?: string
    threadId?: string | null
    threadCount?: number
  }

  let threadedMode = $state(false)

  type ImapMailbox = {
    path: string
    name: string
    delimiter: string
  }

  type Props = {
    data: {
      sync: SyncData
      imapMailboxes: ImapMailbox[]
      simplifiedView: boolean
      compactMode: boolean
    }
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()
  const { setSidebarSimplifiedModeAction } = getSimplifiedModeSidebarActionContext()

  const perfPrefix = '[perf-client]'

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

  const sync = $derived(data.sync)
  const mailbox = $derived(page.params.mailbox ?? 'inbox')
  const simplifiedViewEnabled = $derived(data.simplifiedView)
  const compactModeEnabled = $derived(data.compactMode)
  const isMailboxRoot = $derived(!page.params.id && !page.params.threadId)

  function readRouteListSeed() {
    if (page.params.id || page.params.threadId) return null

    const seed = page.data as {
      messages?: Message[]
      hasMore?: boolean
      pageSize?: number
      total?: number
    }

    if (!Array.isArray(seed.messages)) return null
    if (typeof seed.hasMore !== 'boolean') return null
    if (typeof seed.pageSize !== 'number') return null
    if (typeof seed.total !== 'number') return null

    return {
      messages: seed.messages,
      hasMore: seed.hasMore,
      pageSize: seed.pageSize,
      total: seed.total
    }
  }

  const routeListSeed = $derived.by(() => {
    if (!isMailboxRoot) return null

    return readRouteListSeed()
  })
  const initialRouteListSeed = readRouteListSeed()
  const selectedMessageId: number | null = $derived.by(() => {
    const id = page.params.id
    if (!id) return null

    const parsed = Number(id)
    return Number.isNaN(parsed) ? null : parsed
  })

  const refreshIntervalMs = $derived.by(() => {
    if (!sync.configured) return 60_000
    if (sync.lastError) return 15_000
    return 15_000
  })

  let messages = $state<Message[]>(initialRouteListSeed?.messages ?? [])
  let hasMore = $state(initialRouteListSeed?.hasMore ?? false)
  let isLoadingMore = $state(false)
  let isRefreshingList = $state(initialRouteListSeed === null)
  let loadMoreError = $state<string | null>(null)
  let searchQuery = $state('')
  let mobileSearchOpen = $state(false)
  let activeFilter = $state<'all' | 'unread'>('all')
  let sentinel = $state<HTMLDivElement | null>(null)
  let loadedCount = initialRouteListSeed?.messages.length ?? 0
  let totalCount = $state(initialRouteListSeed?.total ?? 0)
  let lastKnownPageSize = initialRouteListSeed?.pageSize ?? 50
  let listRequestId = 0
  let listSyncKey = ''
  let loadedMailbox = ''

  let searchResults = $state<Message[]>([])
  let searchTotalCount = $state(0)
  let isSearching = $state(false)
  let searchRequestId = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let pendingMailboxNavigationScrollTop: number | null = null
  let viewportHeight = $state(768)

  // Bulk selection
  let selectedIds = new SvelteSet<number>()
  const selectionMode = $derived(selectedIds.size > 0)
  let bulkActionPending = $state(false)

  type ContextMenuAction = 'open' | 'archive' | 'trash' | 'spam' | 'inbox' | 'mark_read'

  type ContextMenuState = {
    message: Message
    index: number
    x: number
    y: number
  } | null

  let contextMenu = $state<ContextMenuState>(null)

  const isSearchMode = $derived(searchQuery.trim().length > 0)

  const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const folderDisplayName = $derived.by(() => {
    const match = data.imapMailboxes.find((mb) => pathToSlug(mb.path) === mailbox)
    return match?.name ?? mailbox
  })

  const visibleMessages = $derived.by(() => {
    return messages.filter((message) => {
      if (activeFilter === 'unread' && !isUnread(message.flags)) return false
      return true
    })
  })

  // Message rows shown in the current view (for keyboard navigation)
  const listMessages = $derived(isSearchMode ? searchResults : visibleMessages)

  // Row elements for scrollIntoView
  let rowEls = $state<Map<number, HTMLElement>>(new Map())
  let listViewport: HTMLDivElement | null = null
  let listScrollRestoreId = 0
  let viewportWidth = $state(1024)
  let simplifiedCardIndex = $state(0)
  let simplifiedDragOffsetX = $state(0)
  let simplifiedDragPointerId = $state<number | null>(null)
  let simplifiedDragging = $state(false)
  let simplifiedDragStartX = 0
  let simplifiedDragLastX = 0
  let simplifiedDragLastAt = 0
  let simplifiedDragVelocityX = $state(0)
  let simplifiedSwipeAnimating = $state(false)
  let simplifiedModeOverride = $state<boolean | null>(null)
  let lastSimplifiedModeKey = ''
  const simplifiedMode = $derived(simplifiedModeOverride ?? data.simplifiedView)
  const showSimplifiedMailboxView = $derived(
    simplifiedViewEnabled && isMailboxRoot && simplifiedMode
  )
  const simplifiedCards = $derived(listMessages)
  const simplifiedDisplayedTotal = $derived.by(() => {
    if (isSearchMode) return searchTotalCount
    if (activeFilter === 'unread') return simplifiedCards.length
    return totalCount
  })
  const activeSimplifiedMessage = $derived(simplifiedCards[simplifiedCardIndex] ?? null)
  const canShowPreviousCard = $derived(simplifiedCardIndex > 0)
  const canShowNextCard = $derived(simplifiedCardIndex < simplifiedCards.length - 1)
  const simplifiedCardWidthEstimate = $derived.by(() => {
    if (viewportWidth >= 1024) {
      return Math.min(Math.max(viewportWidth - 160, 360), 800)
    }

    return Math.min(Math.max(viewportWidth - 64, 280), 672)
  })
  const simplifiedSwipeProgress = $derived(
    Math.min(Math.abs(simplifiedDragOffsetX) / (simplifiedCardWidthEstimate * 0.35), 1)
  )

  $effect(() => {
    const query = searchQuery.trim()

    if (searchTimer !== null) {
      clearTimeout(searchTimer)
      searchTimer = null
    }

    if (!query) {
      searchResults = []
      searchTotalCount = 0
      isSearching = false
      return
    }

    isSearching = true
    const requestId = ++searchRequestId

    searchTimer = setTimeout(async () => {
      try {
        const response = await trackAppLoading(() =>
          fetch(`/api/messages?q=${encodeURIComponent(query)}&limit=50`)
        )
        if (!response.ok) throw new Error('Search failed')

        const payload = (await response.json()) as { messages: Message[]; total: number }

        if (requestId !== searchRequestId) return
        searchResults = payload.messages
        searchTotalCount = payload.total
      } catch {
        if (requestId !== searchRequestId) return
        searchResults = []
        searchTotalCount = 0
      } finally {
        if (requestId === searchRequestId) {
          isSearching = false
        }
      }
    }, 300)
  })

  // Scroll focused row into view when keyboard.focusedIndex changes
  $effect(() => {
    const idx = keyboard.focusedIndex
    const msg = untrack(() => listMessages[idx])
    if (!msg) return
    const el = untrack(() => rowEls.get(msg.id))
    el?.scrollIntoView({ block: 'nearest' })
  })

  $effect(() => {
    const nextModeKey = `${mailbox}:${simplifiedViewEnabled ? '1' : '0'}`
    if (nextModeKey === lastSimplifiedModeKey) return

    lastSimplifiedModeKey = nextModeKey
    simplifiedModeOverride = null
    simplifiedCardIndex = 0
    simplifiedDragOffsetX = 0
    simplifiedDragging = false
    simplifiedDragPointerId = null
    simplifiedDragVelocityX = 0
    simplifiedSwipeAnimating = false
  })

  $effect(() => {
    if (!showSimplifiedMailboxView) {
      simplifiedDragOffsetX = 0
      simplifiedDragging = false
      simplifiedDragPointerId = null
      simplifiedDragVelocityX = 0
      simplifiedSwipeAnimating = false
      return
    }

    if (simplifiedCards.length === 0) {
      simplifiedCardIndex = 0
      return
    }

    if (simplifiedCardIndex > simplifiedCards.length - 1) {
      simplifiedCardIndex = simplifiedCards.length - 1
    }
  })

  $effect(() => {
    if (!showSimplifiedMailboxView || isSearchMode || isLoadingMore || !hasMore) return
    if (simplifiedCards.length === 0) return

    const remainingCards = simplifiedCards.length - simplifiedCardIndex - 1
    if (remainingCards > 2) return

    void loadMoreMessages()
  })

  function formatRelativeTime(value: string | null | undefined) {
    if (!value) return 'Unknown'

    const diffMs = new Date(value).getTime() - Date.now()
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour
    const month = 30 * day
    const year = 365 * day

    if (Math.abs(diffMs) >= year) return relativeFormatter.format(Math.round(diffMs / year), 'year')
    if (Math.abs(diffMs) >= month)
      return relativeFormatter.format(Math.round(diffMs / month), 'month')
    if (Math.abs(diffMs) >= day) return relativeFormatter.format(Math.round(diffMs / day), 'day')
    if (Math.abs(diffMs) >= hour) return relativeFormatter.format(Math.round(diffMs / hour), 'hour')
    return relativeFormatter.format(Math.round(diffMs / minute), 'minute')
  }

  function isUnread(flags: string[] = []) {
    return !flags.includes('\\Seen')
  }

  function senderLabel(from: string | null | undefined) {
    if (!from) return 'Unknown sender'
    return from
  }

  function senderName(from: string | null | undefined) {
    const label = senderLabel(from)
    return label.split('<')[0]?.trim() || label
  }

  function subjectLabel(subject: string | null | undefined) {
    if (!subject) return '(no subject)'
    return subject
  }

  function previewLabel(preview: string | null | undefined) {
    return preview || 'No preview available.'
  }

  function mailboxLabel(mailboxPath: string | undefined) {
    if (!mailboxPath) return ''
    const match = data.imapMailboxes.find((mb) => mb.path === mailboxPath)
    return match?.name ?? mailboxPath
  }

  function messagesUrl(offset: number, limit: number) {
    const params = new SvelteURLSearchParams({
      offset: String(offset),
      limit: String(limit),
      mailbox
    })
    if (threadedMode) params.set('threaded', '1')
    return `/api/messages?${params}`
  }

  function currentWindowSize() {
    return Math.max(loadedCount, messages.length, lastKnownPageSize)
  }

  function captureListScrollTop() {
    return listViewport?.scrollTop ?? null
  }

  function restoreListScrollTop(scrollTop: number | null) {
    if (scrollTop === null) return

    const restoreId = ++listScrollRestoreId

    void tick().then(() => {
      if (restoreId !== listScrollRestoreId || !listViewport) return

      const maxScrollTop = Math.max(listViewport.scrollHeight - listViewport.clientHeight, 0)
      listViewport.scrollTop = Math.min(scrollTop, maxScrollTop)
    })
  }

  function isCurrentMailboxPath(pathname: string) {
    const prefix = resolve(`/${mailbox}`)
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }

  function applyListSeed(
    seed: { messages: Message[]; hasMore: boolean; pageSize: number; total: number },
    reason = 'unknown'
  ) {
    const startedAt = now()
    const scrollTop = captureListScrollTop()
    loadedMailbox = mailbox
    lastKnownPageSize = seed.pageSize
    isRefreshingList = false
    messages = seed.messages
    hasMore = seed.hasMore
    loadedCount = seed.messages.length
    totalCount = seed.total
    loadMoreError = null
    restoreListScrollTop(scrollTop)
    logPerf('applyListSeed', {
      reason,
      mailbox,
      loadedCount,
      rows: messages.length,
      threadedMode: untrack(() => threadedMode),
      ms: Math.round(now() - startedAt)
    })
  }

  async function refreshVisibleListWindow(reason = 'unknown') {
    const startedAt = now()
    const requestMailbox = mailbox
    const limit = currentWindowSize()
    const requestId = ++listRequestId
    const scrollTop = captureListScrollTop()
    isRefreshingList = true

    try {
      const response = await trackAppLoading(() => fetch(messagesUrl(0, limit)))
      if (!response.ok) throw new Error('Failed to refresh message list.')

      const payload = (await response.json()) as {
        messages: Message[]
        hasMore: boolean
        total: number
      }

      if (requestId !== listRequestId) return

      loadedMailbox = requestMailbox
      messages = payload.messages
      hasMore = payload.hasMore
      loadedCount = payload.messages.length
      totalCount = payload.total
      loadMoreError = null
      restoreListScrollTop(scrollTop)
    } catch {
      if (requestId !== listRequestId) return
      loadMoreError = 'Failed to refresh message list.'
    } finally {
      if (requestId === listRequestId) {
        isRefreshingList = false
      }
      logPerf('refreshVisibleListWindow', {
        reason,
        mailbox: requestMailbox,
        limit,
        loadedCount,
        rows: messages.length,
        threadedMode,
        ms: Math.round(now() - startedAt)
      })
    }
  }

  async function loadMoreMessages() {
    if (isLoadingMore || !hasMore) return

    const startedAt = now()
    const offset = messages.length
    isLoadingMore = true
    loadMoreError = null

    try {
      const response = await trackAppLoading(() => fetch(messagesUrl(offset, lastKnownPageSize)))
      if (!response.ok) throw new Error('Failed to load more messages.')

      const payload = (await response.json()) as {
        messages: Message[]
        hasMore: boolean
        total: number
      }

      messages = [...messages, ...payload.messages]
      hasMore = payload.hasMore
      loadedCount = messages.length
      totalCount = payload.total
    } catch (error) {
      loadMoreError = error instanceof Error ? error.message : 'Failed to load more messages.'
    } finally {
      logPerf('loadMoreMessages', {
        mailbox,
        offset,
        limit: lastKnownPageSize,
        loadedCount,
        rows: messages.length,
        ms: Math.round(now() - startedAt)
      })
      isLoadingMore = false
    }
  }

  function selectMessage(message: Message) {
    closeContextMenu()
    if (!message.flags.includes('\\Seen')) {
      const scrollTop = captureListScrollTop()
      messages = messages.map((m) =>
        m.id === message.id ? { ...m, flags: [...m.flags, '\\Seen'] } : m
      )
      restoreListScrollTop(scrollTop)
    }
    if (threadedMode && message.threadId) {
      goto(resolve(`/${mailbox}/thread/${encodeURIComponent(message.threadId)}`), {
        noScroll: true,
        keepFocus: true
      })
    } else {
      goto(resolve(`/${mailbox}/${message.id}`), { noScroll: true, keepFocus: true })
    }
  }

  function showPreviousSimplifiedCard() {
    if (simplifiedSwipeAnimating || !canShowPreviousCard) {
      simplifiedDragOffsetX = 0
      return
    }

    simplifiedCardIndex -= 1
    simplifiedDragOffsetX = 0
    simplifiedDragVelocityX = 0
  }

  function showNextSimplifiedCard() {
    if (simplifiedSwipeAnimating || !canShowNextCard) {
      simplifiedDragOffsetX = 0
      return
    }

    simplifiedCardIndex += 1
    simplifiedDragOffsetX = 0
    simplifiedDragVelocityX = 0
  }

  function openSimplifiedMessage() {
    const message = activeSimplifiedMessage
    if (message) selectMessage(message)
  }

  function enableSimplifiedMode() {
    clearSelection()
    simplifiedCardIndex = 0
    simplifiedDragOffsetX = 0
    simplifiedModeOverride = true
  }

  async function applySidebarSimplifiedMode(enabled: boolean) {
    if (enabled) {
      if (showSimplifiedMailboxView) return
      enableSimplifiedMode()
      await goto(resolve(`/${mailbox}`))
      return
    }

    if (showSimplifiedMailboxView) {
      disableSimplifiedMode()
    }
  }

  function disableSimplifiedMode() {
    clearSelection()
    simplifiedDragOffsetX = 0
    simplifiedModeOverride = false
  }

  $effect(() => {
    setSidebarSimplifiedModeAction(applySidebarSimplifiedMode)

    return () => {
      setSidebarSimplifiedModeAction(null)
    }
  })

  function shouldStartSimplifiedCardDrag(event: PointerEvent) {
    const target = event.target

    if (!(target instanceof Element)) return true

    return !target.closest(
      'button, a, input, select, textarea, summary, details, [contenteditable="true"], [role="button"]'
    )
  }

  function handleSimplifiedCardPointerDown(event: PointerEvent) {
    if (!activeSimplifiedMessage || simplifiedCards.length <= 1) return
    if (!shouldStartSimplifiedCardDrag(event)) return

    const card = event.currentTarget as HTMLElement
    simplifiedDragPointerId = event.pointerId
    simplifiedDragging = true
    simplifiedSwipeAnimating = false
    simplifiedDragStartX = event.clientX
    simplifiedDragLastX = event.clientX
    simplifiedDragLastAt = event.timeStamp
    simplifiedDragVelocityX = 0
    simplifiedDragOffsetX = 0
    card.setPointerCapture(event.pointerId)
  }

  function applySimplifiedDragResistance(deltaX: number) {
    const swipingPastStart = deltaX > 0 && !canShowPreviousCard
    const swipingPastEnd = deltaX < 0 && !canShowNextCard
    const resistance = swipingPastStart || swipingPastEnd ? 0.22 : 0.9
    const softened = Math.sign(deltaX) * Math.pow(Math.abs(deltaX), 0.92)
    return softened * resistance
  }

  function handleSimplifiedCardPointerMove(event: PointerEvent) {
    if (!simplifiedDragging || simplifiedDragPointerId !== event.pointerId) return
    const deltaX = event.clientX - simplifiedDragStartX
    simplifiedDragOffsetX = applySimplifiedDragResistance(deltaX)

    const elapsed = Math.max(event.timeStamp - simplifiedDragLastAt, 1)
    simplifiedDragVelocityX = (event.clientX - simplifiedDragLastX) / elapsed
    simplifiedDragLastX = event.clientX
    simplifiedDragLastAt = event.timeStamp
  }

  function animateSimplifiedCardSwipe(direction: 'previous' | 'next') {
    if (simplifiedSwipeAnimating) return

    const movingToPrevious = direction === 'previous'
    if (movingToPrevious && !canShowPreviousCard) {
      simplifiedDragOffsetX = 0
      simplifiedDragVelocityX = 0
      return
    }
    if (!movingToPrevious && !canShowNextCard) {
      simplifiedDragOffsetX = 0
      simplifiedDragVelocityX = 0
      return
    }

    simplifiedSwipeAnimating = true
    simplifiedDragOffsetX =
      (movingToPrevious ? 1 : -1) * Math.max(simplifiedCardWidthEstimate * 1.08, 320)
    simplifiedDragVelocityX = 0

    window.setTimeout(() => {
      if (movingToPrevious) {
        simplifiedCardIndex -= 1
      } else {
        simplifiedCardIndex += 1
      }

      simplifiedDragOffsetX = 0
      simplifiedSwipeAnimating = false
    }, 180)
  }

  function finishSimplifiedCardDrag() {
    const swipeThreshold = simplifiedCardWidthEstimate * 0.18
    const swipeVelocityThreshold = 0.45
    const movingNext = simplifiedDragOffsetX < 0
    const canAdvanceByDistance = Math.abs(simplifiedDragOffsetX) >= swipeThreshold
    const canAdvanceByVelocity = Math.abs(simplifiedDragVelocityX) >= swipeVelocityThreshold

    if ((canAdvanceByDistance || canAdvanceByVelocity) && movingNext) {
      animateSimplifiedCardSwipe('next')
    } else if (canAdvanceByDistance || canAdvanceByVelocity) {
      animateSimplifiedCardSwipe('previous')
    } else {
      simplifiedDragOffsetX = 0
      simplifiedDragVelocityX = 0
    }

    simplifiedDragging = false
    simplifiedDragPointerId = null
  }

  function handleSimplifiedCardPointerUp(event: PointerEvent) {
    if (simplifiedDragPointerId !== event.pointerId) return

    const card = event.currentTarget as HTMLElement
    if (card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture(event.pointerId)
    }

    finishSimplifiedCardDrag()
  }

  function handleSimplifiedCardPointerCancel(event: PointerEvent) {
    if (simplifiedDragPointerId !== event.pointerId) return

    const card = event.currentTarget as HTMLElement
    if (card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture(event.pointerId)
    }

    simplifiedDragOffsetX = 0
    simplifiedDragging = false
    simplifiedDragPointerId = null
    simplifiedDragVelocityX = 0
    simplifiedSwipeAnimating = false
  }

  function simplifiedCardTransform(offset: number) {
    const progress = simplifiedSwipeProgress

    if (offset === 0) {
      const rotate = simplifiedDragOffsetX / 36
      return `translate3d(${simplifiedDragOffsetX}px, 0, 0) rotate(${rotate}deg) scale(1)`
    }

    const directionLift = offset === 1 ? 10 : 6
    const directionScale = offset === 1 ? 0.045 : 0.03
    const directionOpacity = offset === 1 ? 0.16 : 0.08
    const xParallax = simplifiedDragOffsetX * (offset === 1 ? 0.1 : 0.05)
    const y = offset * 14 - progress * directionLift
    const scale = 1 - offset * 0.04 + progress * directionScale
    const opacity = 1 - offset * 0.18 + progress * directionOpacity

    return `translate3d(${xParallax}px, ${y}px, 0) scale(${scale})`
  }

  function simplifiedCardOpacity(offset: number) {
    if (offset === 0) return 1
    const progress = simplifiedSwipeProgress
    return 1 - offset * 0.18 + progress * (offset === 1 ? 0.16 : 0.08)
  }

  let lastSelectedIndex: number | null = null

  function toggleSelection(id: number, index: number, shiftKey = false) {
    const list = isSearchMode ? searchResults : visibleMessages

    if (shiftKey && lastSelectedIndex !== null) {
      const lo = Math.min(lastSelectedIndex, index)
      const hi = Math.max(lastSelectedIndex, index)
      for (let i = lo; i <= hi; i++) {
        if (list[i]) selectedIds.add(list[i].id)
      }
    } else {
      if (selectedIds.has(id)) selectedIds.delete(id)
      else selectedIds.add(id)
      lastSelectedIndex = index
    }
  }

  function selectAll() {
    selectedIds.clear()
    for (const message of listMessages) {
      selectedIds.add(message.id)
    }
  }

  function clearSelection() {
    selectedIds.clear()
  }

  function inferMailboxRole(mailboxPath: string | undefined) {
    if (!mailboxPath) return null
    const value = mailboxPath.toLowerCase()
    if (/\binbox\b/.test(value)) return 'inbox'
    if (/\b(archive|all[\s._-]?mail)\b/.test(value)) return 'archive'
    if (/\b(trash|deleted[\s._-]?(items|messages)?)\b/.test(value)) return 'trash'
    if (/\b(spam|junk([\s._-]?email)?)\b/.test(value)) return 'spam'
    return null
  }

  function closeContextMenu() {
    contextMenu = null
  }

  function openContextMenu(event: MouseEvent, message: Message, index: number) {
    event.preventDefault()
    event.stopPropagation()
    keyboard.focusedIndex = index

    const menuWidth = 208
    const menuHeight = 224
    const padding = 12
    const nextX = Math.min(event.clientX, Math.max(padding, viewportWidth - menuWidth - padding))
    const nextY = Math.min(event.clientY, Math.max(padding, viewportHeight - menuHeight - padding))

    contextMenu = { message, index, x: nextX, y: nextY }
  }

  function contextMenuItems(message: Message): Array<{ action: ContextMenuAction; label: string }> {
    const role = inferMailboxRole(message.mailbox ?? page.params.mailbox)
    const items: Array<{ action: ContextMenuAction; label: string }> = [
      { action: 'open', label: 'Open' }
    ]

    if (role === 'archive' || role === 'trash' || role === 'spam') {
      items.push({ action: 'inbox', label: 'Move to inbox' })
    } else {
      items.push({ action: 'archive', label: 'Archive' })
      items.push({ action: 'trash', label: 'Move to trash' })
      items.push({ action: 'spam', label: 'Move to spam' })
    }

    if (isUnread(message.flags)) {
      items.push({ action: 'mark_read', label: 'Mark as read' })
    }

    return items
  }

  function updateMessageFlags(id: number, updater: (flags: string[]) => string[]) {
    messages = messages.map((message) =>
      message.id === id ? { ...message, flags: updater(message.flags) } : message
    )
    searchResults = searchResults.map((message) =>
      message.id === id ? { ...message, flags: updater(message.flags) } : message
    )
  }

  async function bulkAction(action: string) {
    if (bulkActionPending || selectedIds.size === 0) return
    bulkActionPending = true
    try {
      await trackAppLoading(async () => {
        await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [...selectedIds], action })
        })

        clearSelection()
        await refreshVisibleListWindow(`bulk-action:${action}`)
      })
    } finally {
      bulkActionPending = false
    }
  }

  $effect(() => {
    const seed = routeListSeed
    const nextKey = seed
      ? `root:${mailbox}:${seed.pageSize}:${seed.hasMore ? 1 : 0}:${seed.messages.length}:${seed.messages[0]?.id ?? ''}:${seed.messages[seed.messages.length - 1]?.id ?? ''}`
      : `detail:${mailbox}`

    if (nextKey === listSyncKey) return
    listSyncKey = nextKey

    if (seed && !untrack(() => threadedMode)) {
      applyListSeed(seed, 'route-seed')
      return
    }

    if (!seed && loadedMailbox === mailbox && messages.length > 0) {
      return
    }

    messages = []
    hasMore = false
    loadedCount = 0
    totalCount = 0
    loadMoreError = null

    if (seed) {
      lastKnownPageSize = seed.pageSize
    }

    void refreshVisibleListWindow(seed ? 'route-threaded-reload' : 'detail-hydration-reload')
  })

  async function toggleThreadedMode() {
    const startedAt = now()
    threadedMode = !threadedMode
    messages = []
    hasMore = false
    loadedCount = 0
    totalCount = 0
    loadMoreError = null
    await refreshVisibleListWindow('toggle-threaded-reload')

    logPerf('toggleThreadedMode', {
      mailbox,
      threadedMode,
      rows: messages.length,
      ms: Math.round(now() - startedAt)
    })
  }

  onMount(() => {
    keyboard.panel = 'list'

    const intervalMs = refreshIntervalMs
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const startedAt = now()
        logPerf('visibility interval refreshVisibleListWindow', { mailbox, intervalMs })
        void refreshVisibleListWindow('visibility-interval').finally(() => {
          logPerf('visibility interval refreshVisibleListWindow done', {
            mailbox,
            intervalMs,
            ms: Math.round(now() - startedAt)
          })
        })
      }
    }, intervalMs)

    const teardown = setupKeyboardHandler('list', {
      j: () => {
        keyboard.focusedIndex = Math.min(keyboard.focusedIndex + 1, listMessages.length - 1)
      },
      ArrowDown: () => {
        keyboard.focusedIndex = Math.min(keyboard.focusedIndex + 1, listMessages.length - 1)
      },
      k: () => {
        keyboard.focusedIndex = Math.max(keyboard.focusedIndex - 1, 0)
      },
      ArrowUp: () => {
        keyboard.focusedIndex = Math.max(keyboard.focusedIndex - 1, 0)
      },
      Enter: () => {
        const msg = listMessages[keyboard.focusedIndex]
        if (msg) selectMessage(msg)
      },
      o: () => {
        const msg = listMessages[keyboard.focusedIndex]
        if (msg) selectMessage(msg)
      },
      e: () => {
        if (selectionMode) void bulkAction('archive')
        else {
          const msg = listMessages[keyboard.focusedIndex]
          if (msg) void archiveMessage(msg.id)
        }
      },
      '#': () => {
        if (selectionMode) void bulkAction('trash')
        else {
          const msg = listMessages[keyboard.focusedIndex]
          if (msg) void trashMessage(msg.id)
        }
      },
      c: () => void openCompose(),
      x: () => {
        const msg = listMessages[keyboard.focusedIndex]
        if (msg) toggleSelection(msg.id, keyboard.focusedIndex)
      },
      '*a': () => selectAll(),
      '*n': () => clearSelection(),
      Escape: () => {
        if (contextMenu) closeContextMenu()
        else clearSelection()
      }
    })

    return () => {
      clearInterval(interval)
      teardown()
    }
  })

  async function archiveMessage(id: number) {
    closeContextMenu()
    await trackAppLoading(async () => {
      await fetch(`/api/messages/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'archive' })
      })

      await refreshVisibleListWindow('archive-message')
    })
  }

  async function trashMessage(id: number) {
    closeContextMenu()
    await trackAppLoading(async () => {
      await fetch(`/api/messages/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'trash' })
      })

      await refreshVisibleListWindow('trash-message')
    })
  }

  async function moveMessageAction(id: number, action: 'archive' | 'trash' | 'spam' | 'inbox') {
    closeContextMenu()
    await trackAppLoading(async () => {
      await fetch(`/api/messages/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      })

      await refreshVisibleListWindow(`message-action:${action}`)
    })
  }

  async function markMessageRead(id: number) {
    closeContextMenu()
    updateMessageFlags(id, (flags) => (flags.includes('\\Seen') ? flags : [...flags, '\\Seen']))

    await trackAppLoading(async () => {
      await fetch('/api/messages/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id], action: 'mark_read' })
      })

      await refreshVisibleListWindow('message-action:mark-read')
    })
  }

  async function runContextMenuAction(action: ContextMenuAction, message: Message) {
    if (action === 'open') {
      selectMessage(message)
      return
    }

    if (action === 'mark_read') {
      await markMessageRead(message.id)
      return
    }

    await moveMessageAction(message.id, action)
  }

  $effect(() => {
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreMessages()
        }
      },
      { rootMargin: '200px 0px' }
    )

    observer.observe(sentinel)

    return () => observer.disconnect()
  })

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

  let listWidth = $state(readStorage('mail:listWidth', 440))
  let resizing = $state(false)
  let refreshing = $state(false)

  const isDesktop = $derived(viewportWidth >= 768)

  async function handleRefresh() {
    if (refreshing) return
    const startedAt = now()
    refreshing = true
    await refreshVisibleListWindow('manual-refresh')
    await new Promise((r) => setTimeout(r, 600))
    refreshing = false
    logPerf('manual refresh', {
      mailbox,
      loadedCount,
      rows: messages.length,
      ms: Math.round(now() - startedAt)
    })
  }

  function startResize(e: PointerEvent) {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    resizing = true
    const startX = e.clientX
    const startWidth = listWidth

    function onMove(ev: PointerEvent) {
      listWidth = Math.max(240, Math.min(700, startWidth + (ev.clientX - startX)))
    }

    function stop() {
      resizing = false
      localStorage.setItem('mail:listWidth', String(listWidth))
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  // Derived so Svelte tracks keyboard.focusedIndex as a reactive dependency
  const focusedIndex = $derived(keyboard.focusedIndex)

  const selectedMessageRowClass = 'bg-white/14 shadow-[inset_3px_0_0_rgba(56,189,248,0.95)]'

  function messageRowClass(message: Message, index: number) {
    const isFocused = focusedIndex === index && !isSearchMode
    const isSelected = selectedMessageId === message.id
    return [
      'block w-full rounded-2xl bg-white/2 py-4 pr-4 pl-9 text-left transition sm:pr-5 sm:pl-10 md:rounded-none md:border-b md:border-white/8 md:bg-transparent',
      isSelected ? selectedMessageRowClass : isFocused ? 'bg-white/4' : 'hover:bg-white/3'
    ].join(' ')
  }

  // Svelte action to track row elements for scroll-into-view
  function registerRow(el: HTMLElement, params: { id: number; map: Map<number, HTMLElement> }) {
    params.map.set(params.id, el)
    return {
      destroy() {
        params.map.delete(params.id)
      }
    }
  }

  function registerListViewport(el: HTMLDivElement) {
    listViewport = el
    return () => {
      if (listViewport === el) listViewport = null
    }
  }

  beforeNavigate((navigation) => {
    closeContextMenu()
    if (!listViewport || navigation.willUnload) return

    const fromPath = navigation.from?.url.pathname
    const toPath = navigation.to?.url.pathname

    if (!fromPath || !toPath) return
    if (!isCurrentMailboxPath(fromPath) || !isCurrentMailboxPath(toPath)) return

    pendingMailboxNavigationScrollTop = listViewport.scrollTop
  })

  afterNavigate(() => {
    if (pendingMailboxNavigationScrollTop === null) return

    const scrollTop = pendingMailboxNavigationScrollTop
    pendingMailboxNavigationScrollTop = null
    restoreListScrollTop(scrollTop)
  })
</script>

<svelte:head>
  <title>{folderDisplayName}</title>
</svelte:head>

<svelte:window
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
  onscroll={closeContextMenu}
  onkeydown={(event) => {
    if (event.key === 'Escape') closeContextMenu()
  }}
/>

{#if showSimplifiedMailboxView}
  <section class="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#0d0d10]">
    <div class="p-4 sm:p-5 md:border-b md:border-white/8">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-white sm:text-base">{folderDisplayName}</p>
          <p class="mt-1 text-xs text-zinc-500 sm:text-sm">{totalCount} messages</p>
        </div>

        <div class="flex justify-end overflow-x-auto">
          <div class="inline-flex min-w-max items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onclick={() => (mobileSearchOpen = !mobileSearchOpen)}
              class={[
                'rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden',
                mobileSearchOpen || searchQuery.trim().length > 0 ? 'text-zinc-200' : ''
              ]}
              aria-label={mobileSearchOpen || searchQuery.trim().length > 0
                ? 'Hide search'
                : 'Show search'}
              aria-pressed={mobileSearchOpen || searchQuery.trim().length > 0}
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              onclick={handleRefresh}
              class={[
                'transition',
                refreshing ? 'animate-spin text-zinc-400' : 'text-zinc-600 hover:text-zinc-400'
              ]}
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
            <div
              class="shrink-0 rounded-xl border border-transparent bg-white/3 p-1 text-xs md:border-white/8 md:text-sm"
            >
              <button
                type="button"
                class={[
                  'rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'all' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'all')}
              >
                <span class="sm:hidden">All</span>
                <span class="hidden sm:inline">All mail</span>
              </button>
              <button
                type="button"
                class={[
                  'rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'unread' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'unread')}
              >
                Unread
              </button>
            </div>
          </div>
        </div>
      </div>

      <p class="mt-3 hidden text-sm text-zinc-500 sm:block">
        Swipe through recent mail or open the current card.
      </p>

      {#if isDesktop || mobileSearchOpen || searchQuery.trim().length > 0}
        <label class="mt-3 block md:mt-4">
          <span class="sr-only">Search messages</span>
          <input
            bind:value={searchQuery}
            type="search"
            placeholder="Search"
            class="w-full rounded-xl border border-transparent bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-white/8 md:border-white/8"
          />
        </label>
      {/if}
    </div>

    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 select-none sm:p-6"
    >
      {#if isSearchMode && isSearching}
        <div class="text-center">
          <p class="text-sm text-zinc-500">Searching…</p>
        </div>
      {:else if simplifiedCards.length === 0}
        <div
          class="max-w-md rounded-4xl border border-white/8 bg-white/3 p-8 text-center shadow-2xl shadow-black/20"
        >
          <p class="text-lg font-semibold text-white">
            {isSearchMode ? 'No results' : 'No messages found'}
          </p>
          <p class="mt-2 text-sm text-zinc-500">
            {isSearchMode ? 'No messages matched your search.' : 'Wait for the next sync.'}
          </p>
        </div>
      {:else}
        <div class="flex w-full max-w-lg flex-col items-center gap-6">
          <div class="relative h-108 w-full max-w-xl lg:h-[34rem] lg:max-w-2xl">
            {#each simplifiedCards.slice(simplifiedCardIndex, simplifiedCardIndex + 3) as message, offset (message.id)}
              <article
                class={[
                  'absolute inset-0 overflow-hidden rounded-3xl border border-white/10 bg-[#131319] p-6 text-left shadow-2xl shadow-black/30 lg:p-7',
                  offset === 0
                    ? [
                        'cursor-grab touch-pan-y will-change-transform active:cursor-grabbing',
                        simplifiedDragging
                          ? 'duration-0'
                          : 'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                      ]
                    : 'pointer-events-none'
                ]}
                style={`transform: ${simplifiedCardTransform(offset)}; opacity: ${simplifiedCardOpacity(offset)}; z-index: ${10 - offset};`}
                onpointerdown={offset === 0 ? handleSimplifiedCardPointerDown : undefined}
                onpointermove={offset === 0 ? handleSimplifiedCardPointerMove : undefined}
                onpointerup={offset === 0 ? handleSimplifiedCardPointerUp : undefined}
                onpointercancel={offset === 0 ? handleSimplifiedCardPointerCancel : undefined}
              >
                <div class="flex h-full flex-col">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="truncate text-sm font-medium text-zinc-300">
                          {senderName(message.from)}
                        </p>
                        {#if isUnread(message.flags)}
                          <span class="h-2 w-2 shrink-0 rounded-full bg-sky-400"></span>
                          <span class="text-xs font-medium text-sky-300">Unread</span>
                        {/if}
                      </div>

                      <h2
                        class="mt-4 line-clamp-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
                      >
                        {subjectLabel(message.subject)}
                      </h2>
                    </div>

                    <p class="shrink-0 text-sm text-zinc-500">
                      {formatRelativeTime(message.receivedAt)}
                    </p>
                  </div>

                  <p class="mt-6 line-clamp-8 text-base leading-7 text-zinc-400 lg:line-clamp-10">
                    {previewLabel(message.preview)}
                  </p>

                  <div class="mt-auto flex flex-wrap items-center justify-end gap-3 pt-6">
                    <button
                      type="button"
                      onclick={offset === 0 ? openSimplifiedMessage : undefined}
                      class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                    >
                      Open message
                    </button>
                  </div>
                </div>
              </article>
            {/each}
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              onclick={showPreviousSimplifiedCard}
              disabled={!canShowPreviousCard}
              aria-label="Show previous message"
              class="rounded-full border border-transparent bg-white/3 p-3 text-zinc-200 transition hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <ChevronLeft size={18} />
            </button>

            <p class="min-w-28 text-center text-sm text-zinc-500">
              {simplifiedDisplayedTotal === 0
                ? '0 / 0'
                : `${simplifiedCardIndex + 1} / ${simplifiedDisplayedTotal}`}
            </p>

            <button
              type="button"
              onclick={showNextSimplifiedCard}
              disabled={!canShowNextCard}
              aria-label="Show next message"
              class="rounded-full border border-transparent bg-white/3 p-3 text-zinc-200 transition hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40 md:border-white/8"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {#if loadMoreError}
            <p class="text-sm text-rose-300">{loadMoreError}</p>
          {/if}

          {#if hasMore && !isSearchMode}
            <div bind:this={sentinel} class="h-1 w-full max-w-2xl"></div>
            {#if isLoadingMore}
              <p class="text-sm text-zinc-500">Loading more messages…</p>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </section>
{:else}
  <div class="flex h-full" class:cursor-col-resize={resizing} class:select-none={resizing}>
    <section
      style={isDesktop ? `width: ${listWidth}px; min-width: ${listWidth}px` : undefined}
      class={[
        'flex flex-col overflow-x-hidden bg-[#0d0d10] md:border-r',
        'md:border-white/8',
        isMailboxRoot ? 'flex min-w-0 flex-1 md:flex-none' : 'hidden md:flex'
      ]}
      aria-label="Message list"
    >
      <div class="p-4 sm:p-5 md:border-b md:border-white/8">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-white sm:text-base">{folderDisplayName}</p>
            <p class="mt-1 text-xs text-zinc-500 sm:text-sm">{totalCount} messages</p>
          </div>

          <div class="flex justify-end overflow-x-auto">
            <div class="inline-flex min-w-max items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onclick={() => (mobileSearchOpen = !mobileSearchOpen)}
                class={[
                  'rounded-lg border border-transparent bg-white/3 p-2 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 md:hidden',
                  mobileSearchOpen || searchQuery.trim().length > 0 ? 'text-zinc-200' : ''
                ]}
                aria-label={mobileSearchOpen || searchQuery.trim().length > 0
                  ? 'Hide search'
                  : 'Show search'}
                aria-pressed={mobileSearchOpen || searchQuery.trim().length > 0}
              >
                <Search size={15} />
              </button>
              <button
                type="button"
                onclick={handleRefresh}
                class={[
                  'transition',
                  refreshing ? 'animate-spin text-zinc-400' : 'text-zinc-600 hover:text-zinc-400'
                ]}
                title="Refresh"
              >
                <RefreshCw size={15} />
              </button>
              <div
                class="shrink-0 rounded-xl border border-transparent bg-white/3 p-1 text-xs md:border-white/8 md:text-sm"
              >
                <button
                  type="button"
                  class={[
                    'rounded-lg px-2.5 py-1.5 transition sm:px-3',
                    activeFilter === 'all' ? 'bg-white/8 text-white' : 'text-zinc-400'
                  ]}
                  onclick={() => (activeFilter = 'all')}
                >
                  <span class="sm:hidden">All</span>
                  <span class="hidden sm:inline">All mail</span>
                </button>
                <button
                  type="button"
                  class={[
                    'rounded-lg px-2.5 py-1.5 transition sm:px-3',
                    activeFilter === 'unread' ? 'bg-white/8 text-white' : 'text-zinc-400'
                  ]}
                  onclick={() => (activeFilter = 'unread')}
                >
                  Unread
                </button>
              </div>
            </div>
          </div>
        </div>

        {#if isDesktop || mobileSearchOpen || searchQuery.trim().length > 0}
          <label class="mt-3 block md:mt-4">
            <span class="sr-only">Search messages</span>
            <input
              bind:value={searchQuery}
              type="search"
              placeholder="Search"
              class="w-full rounded-xl border border-transparent bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-white/8 md:border-white/8"
            />
          </label>
        {/if}
      </div>

      <!-- Bulk action toolbar -->
      {#if selectionMode}
        <div
          class="flex shrink-0 flex-wrap items-center gap-2 bg-[#0d0d10] px-4 py-2 md:border-b md:border-white/8"
        >
          <span class="text-xs text-zinc-400">{selectedIds.size} selected</span>
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <button
              type="button"
              title="Archive"
              onclick={() => void bulkAction('archive')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <Archive size={13} /> Archive
            </button>
            <button
              type="button"
              title="Trash"
              onclick={() => void bulkAction('trash')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <Trash2 size={13} /> Trash
            </button>
            <button
              type="button"
              title="Spam"
              onclick={() => void bulkAction('spam')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <ShieldAlert size={13} /> Spam
            </button>
            <button
              type="button"
              title="Mark read"
              onclick={() => void bulkAction('mark_read')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <MailOpen size={13} /> Mark read
            </button>
          </div>
          <button
            type="button"
            onclick={clearSelection}
            class="text-zinc-500 hover:text-zinc-300"
            title="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      {/if}

      <div {@attach registerListViewport} class="flex-1 overflow-y-auto">
        {#if isSearchMode}
          {#if isSearching}
            <div class="p-8 text-center">
              <p class="text-sm text-zinc-500">Searching…</p>
            </div>
          {:else if searchResults.length === 0}
            <div class="p-8 text-center">
              <p class="text-lg font-semibold text-white">No results</p>
              <p class="mt-2 text-sm text-zinc-500">No messages matched your search.</p>
            </div>
          {:else}
            <div class="space-y-2 p-2 md:space-y-0 md:p-0">
              {#each searchResults as message, index (message.id)}
                <div class="group relative" use:registerRow={{ id: message.id, map: rowEls }}>
                  <!-- Checkbox -->
                  <button
                    type="button"
                    aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
                    onclick={(e) => {
                      e.stopPropagation()
                      toggleSelection(message.id, index, e.shiftKey)
                    }}
                    class={[
                      'absolute top-1/2 left-2 z-10 -translate-y-1/2 transition',
                      selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    ].join(' ')}
                  >
                    {#if selectedIds.has(message.id)}
                      <CheckSquare size={16} class="text-blue-400" />
                    {:else}
                      <Square size={16} class="text-zinc-600" />
                    {/if}
                  </button>
                  <button
                    type="button"
                    class={[
                      'block w-full rounded-2xl bg-white/2 py-4 pr-4 pl-9 text-left transition sm:pr-5 sm:pl-10 md:rounded-none md:border-b md:border-white/8 md:bg-transparent',
                      selectedMessageId === message.id
                        ? selectedMessageRowClass
                        : 'hover:bg-white/3'
                    ].join(' ')}
                    onclick={() => selectMessage(message)}
                    oncontextmenu={(event) => openContextMenu(event, message, index)}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <p
                            class={[
                              'truncate text-sm',
                              isUnread(message.flags) ? 'font-semibold text-white' : 'text-zinc-300'
                            ]}
                          >
                            {senderName(message.from)}
                          </p>
                          {#if isUnread(message.flags)}
                            <span class="h-2 w-2 rounded-full bg-sky-400"></span>
                          {/if}
                        </div>

                        <p class="mt-1 truncate text-sm font-medium text-zinc-200">
                          {subjectLabel(message.subject)}
                        </p>
                      </div>

                      <div class="flex shrink-0 flex-col items-end gap-1">
                        <p class="text-xs text-zinc-500">
                          {formatRelativeTime(message.receivedAt)}
                        </p>
                        {#if message.mailbox}
                          <p class="rounded bg-white/6 px-1.5 py-0.5 text-xs text-zinc-400">
                            {mailboxLabel(message.mailbox)}
                          </p>
                        {/if}
                      </div>
                    </div>

                    {#if !compactModeEnabled}
                      <p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">
                        {previewLabel(message.preview)}
                      </p>
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
            <div class="px-4 py-5 text-center text-sm text-zinc-500 sm:px-5">
              {searchTotalCount} result{searchTotalCount === 1 ? '' : 's'}
            </div>
          {/if}
        {:else if isRefreshingList && messages.length === 0}
          <div class="space-y-3 p-4 sm:p-5">
            {#each Array.from({ length: 6 }, (_, index) => index) as index (`sidebar-skeleton-${index}`)}
              <div class="rounded-2xl border border-white/8 bg-white/3 p-4">
                <div class="h-3 w-28 animate-pulse rounded bg-white/8"></div>
                <div class="mt-3 h-4 w-3/4 animate-pulse rounded bg-white/10"></div>
                <div class="mt-3 h-3 w-full animate-pulse rounded bg-white/8"></div>
                <div class="mt-2 h-3 w-2/3 animate-pulse rounded bg-white/8"></div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="space-y-2 p-2 md:space-y-0 md:p-0">
            {#each visibleMessages as message, index (message.id)}
              <div class="group relative" use:registerRow={{ id: message.id, map: rowEls }}>
                <!-- Checkbox -->
                <button
                  type="button"
                  aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
                  onclick={(e) => {
                    e.stopPropagation()
                    toggleSelection(message.id, index, e.shiftKey)
                  }}
                  class={[
                    'absolute top-1/2 left-2 z-10 -translate-y-1/2 transition',
                    selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  ].join(' ')}
                >
                  {#if selectedIds.has(message.id)}
                    <CheckSquare size={16} class="text-blue-400" />
                  {:else}
                    <Square size={16} class="text-zinc-600" />
                  {/if}
                </button>
                <button
                  type="button"
                  class={messageRowClass(message, index)}
                  onclick={() => selectMessage(message)}
                  oncontextmenu={(event) => openContextMenu(event, message, index)}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p
                          class={[
                            'truncate text-sm',
                            isUnread(message.flags) ? 'font-semibold text-white' : 'text-zinc-300'
                          ]}
                        >
                          {senderName(message.from)}
                        </p>
                        {#if isUnread(message.flags)}
                          <span class="h-2 w-2 rounded-full bg-sky-400"></span>
                        {/if}
                        {#if threadedMode && message.threadCount && message.threadCount > 1}
                          <span
                            class="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-zinc-400"
                          >
                            {message.threadCount}
                          </span>
                        {/if}
                      </div>

                      <p class="mt-1 truncate text-sm font-medium text-zinc-200">
                        {subjectLabel(message.subject)}
                      </p>
                    </div>

                    <p class="shrink-0 text-xs text-zinc-500">
                      {formatRelativeTime(message.receivedAt)}
                    </p>
                  </div>

                  {#if !compactModeEnabled}
                    <p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">
                      {previewLabel(message.preview)}
                    </p>
                  {/if}
                </button>
              </div>
            {:else}
              <div class="p-8 text-center">
                <p class="text-lg font-semibold text-white">No messages found</p>
                <p class="mt-2 text-sm text-zinc-500">Wait for the next sync.</p>
              </div>
            {/each}
          </div>

          {#if visibleMessages.length > 0}
            <div class="px-4 py-5 sm:px-5">
              {#if loadMoreError}
                <p class="text-sm text-rose-300">{loadMoreError}</p>
              {/if}

              {#if hasMore}
                <div bind:this={sentinel} class="h-1 w-full"></div>
                {#if isLoadingMore}
                  <p class="text-center text-sm text-zinc-500">Loading more messages…</p>
                {/if}
              {:else}
                <p class="text-center text-sm text-zinc-500">All stored messages are loaded.</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </section>

    <!-- Resize handle: list ↔ detail -->
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

    <section
      class={[
        'min-w-0 overflow-hidden bg-[#0b0b0e]',
        isMailboxRoot ? 'hidden flex-1 md:block' : 'flex-1'
      ]}
    >
      {@render children()}
    </section>
  </div>
{/if}

{#if contextMenu}
  {@const activeContextMenu = contextMenu}
  <div
    class="fixed inset-0 z-40"
    role="presentation"
    onclick={closeContextMenu}
    oncontextmenu={(event) => {
      event.preventDefault()
      closeContextMenu()
    }}
  >
    <div
      class="absolute z-50 min-w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#111216] p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      style={`left:${activeContextMenu.x}px;top:${activeContextMenu.y}px;`}
      role="menu"
      tabindex="-1"
      aria-label="Message actions"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#each contextMenuItems(activeContextMenu.message) as item (item.action)}
        <button
          type="button"
          class="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/8"
          onclick={() => void runContextMenuAction(item.action, activeContextMenu.message)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  </div>
{/if}
