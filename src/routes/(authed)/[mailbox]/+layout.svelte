<script lang="ts">
  import { dev } from '$app/environment'
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { trackAppLoading } from '$lib/loading.svelte'
  import { pathToSlug } from '$lib/mailbox'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'
  import { getSimplifiedModeSidebarActionContext } from '$lib/simplified-mode-context'
  import { page } from '$app/state'
  import { onMount, tick, untrack } from 'svelte'
  import { SvelteDate, SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity'
  import { toast } from 'svelte-sonner'
  import {
    RefreshCw,
    CheckSquare,
    Square,
    Mail,
    Archive,
    Trash2,
    MailOpen,
    Mails,
    ShieldAlert,
    X,
    ChevronLeft,
    ChevronRight,
    Search,
    Sparkles,
    Bookmark,
    Clock,
    WifiOff,
    Star,
    Pin,
    StickyNote
  } from 'lucide-svelte'
  import { openCompose } from '$lib/composer.svelte'
  import { encodeThreadId } from '$lib/thread-url'
  import { keyboard, setupKeyboardHandler } from '$lib/keyboard.svelte'
  import { readOfflineList, saveOfflineList, type OfflineListCache } from '$lib/offline-cache'
  import {
    LIST_RATIO_COOKIE,
    LIST_RATIO_COOKIE_MAX_AGE,
    DEFAULT_LIST_RATIO,
    MIN_LIST_PX,
    MIN_DETAIL_PX
  } from '$lib/list-width'

  type DensityPreference = 'comfortable' | 'compact' | 'condensed'

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
    hasUnread?: boolean
    receivedAt: string | null
    snoozedUntil?: string | null
    mailbox?: string
    threadId?: string | null
    threadCount?: number
    threadStarred?: boolean
    threadPinned?: boolean
    hasThreadNote?: boolean
  }

  type SavedSearch = {
    id: number
    name: string
    query: string
  }

  type ContactSuggestion = {
    id: number
    name: string
    email: string
    display: string
  }

  type SearchSyntaxSuggestion = {
    label: string
    value: string
    description: string
  }

  const searchSyntaxSuggestions: SearchSyntaxSuggestion[] = [
    { label: 'From', value: 'from:', description: 'Messages from a sender' },
    { label: 'To', value: 'to:', description: 'Messages sent to a recipient' },
    { label: 'Subject', value: 'subject:', description: 'Subject contains text' },
    { label: 'Has attachment', value: 'has:attachment', description: 'Messages with attachments' },
    { label: 'Before', value: 'before:', description: 'Before a date, e.g. before:2026-01-01' },
    { label: 'After', value: 'after:', description: 'After a date, e.g. after:2026-01-01' }
  ]

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
      density: DensityPreference
      compactMode: boolean
      threadModeOnPageLoad: boolean
      listRatio: number
      user?: { name: string; email: string } | null
    }
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()
  const { setSidebarSimplifiedModeAction } = getSimplifiedModeSidebarActionContext()
  let threadedMode = $state(untrack(() => data.threadModeOnPageLoad))

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
  const currentMailboxRole = $derived(inferMailboxRole(mailbox))
  const offlineUserKey = $derived(data.user?.email ?? null)
  const simplifiedViewEnabled = $derived(data.simplifiedView)
  const density = $derived(data.density ?? (data.compactMode ? 'compact' : 'comfortable'))
  const compactModeEnabled = $derived(density !== 'comfortable')
  const isMailboxRoot = $derived(!page.params.id && !page.params.threadId)

  function readRouteListSeed() {
    if (page.params.id || page.params.threadId) return null

    const seed = page.data as {
      messages?: Message[]
      hasMore?: boolean
      pageSize?: number
      total?: number
      threaded?: boolean
    }

    if (!Array.isArray(seed.messages)) return null
    if (typeof seed.hasMore !== 'boolean') return null
    if (typeof seed.pageSize !== 'number') return null
    if (typeof seed.total !== 'number') return null
    if (typeof seed.threaded !== 'boolean') return null

    return {
      messages: seed.messages,
      hasMore: seed.hasMore,
      pageSize: seed.pageSize,
      total: seed.total,
      threaded: seed.threaded
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
  let errorDialogMessage = $state<string | null>(null)
  let searchQuery = $state('')
  let mobileSearchOpen = $state(false)
  let activeFilter = $state<'all' | 'unread' | 'starred' | 'pinned'>('all')
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
  let savedSearches = $state<SavedSearch[]>([])
  let savingSearch = $state(false)
  let showSavedSearchMenu = $state(false)
  let contactSuggestions = $state<ContactSuggestion[]>([])
  let showContactSuggestions = $state(false)
  let searchInputFocused = $state(false)
  let searchRequestId = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let lastRouteSearchQuery = ''
  let contactSearchRequestId = 0
  let contactSearchTimer: ReturnType<typeof setTimeout> | null = null
  let pendingMailboxNavigationScrollTop: number | null = null
  let viewportHeight = $state(768)
  let online = $state(true)
  // Bulk selection
  let selectedIds = new SvelteSet<number>()
  const selectionMode = $derived(selectedIds.size > 0)
  let bulkActionPending = $state(false)
  let bulkSenderPending = $state(false)
  type ModalState = {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    inputLabel?: string
    inputValue?: string
    inputType?: string
    resolve: (value: string | boolean | null) => void
  }
  let actionModal = $state<ModalState | null>(null)

  type MobileSwipeAction = 'archive' | 'mark_read' | 'trash'

  let mobileSwipeMessageId = $state<number | null>(null)
  let mobileSwipePointerId = $state<number | null>(null)
  let mobileSwipeStartX = 0
  let mobileSwipeStartY = 0
  let mobileSwipeOffsetX = $state(0)
  let mobileSwipeDragging = $state(false)
  let mobileSwipeSuppressClickId = $state<number | null>(null)

  const mobileSwipeActivationDistance = 12
  const mobileSwipeActionThreshold = 88
  const mobileSwipeTrashThreshold = 148
  const mobileSwipeMaxOffset = 168

  type ContextMenuAction =
    | 'open'
    | 'archive'
    | 'trash'
    | 'spam'
    | 'inbox'
    | 'archive_sender'
    | 'trash_sender'
    | 'mark_read'
    | 'mark_unread'
    | 'snooze'

  type ContextMenuState = {
    message: Message
    index: number
    x: number
    y: number
  } | null

  let contextMenu = $state<ContextMenuState>(null)

  const isSearchMode = $derived(searchQuery.trim().length > 0)
  const currentSearchToken = $derived.by(() => searchQuery.split(/\s+/).at(-1)?.toLowerCase() ?? '')
  const syntaxSuggestions = $derived.by(() => {
    const token = currentSearchToken
    if (token.includes('@')) return []
    if (!token) return searchSyntaxSuggestions

    return searchSyntaxSuggestions.filter(
      (suggestion) =>
        suggestion.value.startsWith(token) || suggestion.label.toLowerCase().startsWith(token)
    )
  })
  const showSearchAutocomplete = $derived(
    searchInputFocused &&
      (syntaxSuggestions.length > 0 || (showContactSuggestions && contactSuggestions.length > 0))
  )

  const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const folderDisplayName = $derived.by(() => {
    const match = data.imapMailboxes.find((mb) => pathToSlug(mb.path) === mailbox)
    return match?.name ?? mailbox
  })

  const totalCountLabel = $derived(`${totalCount} ${threadedMode ? 'threads' : 'messages'}`)

  const visibleMessages = $derived.by(() => {
    return messages.filter((message) => {
      if (activeFilter === 'unread' && !isUnread(message.flags, message.hasUnread)) return false
      if (activeFilter === 'starred' && !message.threadStarred) return false
      if (activeFilter === 'pinned' && !message.threadPinned) return false
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
  let simplifiedDragOffsetY = $state(0)
  let simplifiedDragPointerId = $state<number | null>(null)
  let simplifiedDragging = $state(false)
  let simplifiedDragStartX = 0
  let simplifiedDragStartY = 0
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
  const activeSimplifiedMessageUnread = $derived(
    activeSimplifiedMessage
      ? isUnread(activeSimplifiedMessage.flags, activeSimplifiedMessage.hasUnread)
      : false
  )
  const simplifiedMarkReadThreshold = $derived(
    Math.min(Math.max(simplifiedCardWidthEstimate * 0.16, 72), 112)
  )
  const simplifiedMarkReadDragDistance = $derived(Math.abs(Math.min(simplifiedDragOffsetY, 0)))
  const simplifiedMarkReadDragDominates = $derived(
    simplifiedMarkReadDragDistance > Math.abs(simplifiedDragOffsetX) * 1.25
  )
  const simplifiedMarkReadGestureReady = $derived(
    simplifiedMarkReadDragDistance >= simplifiedMarkReadThreshold && simplifiedMarkReadDragDominates
  )
  const simplifiedMarkReadProgress = $derived.by(() => {
    if (!activeSimplifiedMessageUnread || !simplifiedMarkReadDragDominates) return 0

    return Math.min(simplifiedMarkReadDragDistance / simplifiedMarkReadThreshold, 1)
  })
  const simplifiedMarkReadReady = $derived(
    activeSimplifiedMessageUnread && simplifiedMarkReadGestureReady
  )

  $effect(() => {
    const routeQuery = page.url.searchParams.get('q')?.trim() ?? ''
    if (routeQuery === lastRouteSearchQuery) return
    lastRouteSearchQuery = routeQuery
    searchQuery = routeQuery
  })

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

  function contactAutocompleteQuery(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return ''

    const lastTerm = trimmed.split(/\s+/).at(-1) ?? trimmed
    const operatorMatch = /^(?:from|to|subject):(.+)$/i.exec(lastTerm)
    return (operatorMatch?.[1] ?? lastTerm).replace(/^"|"$/g, '').trim()
  }

  $effect(() => {
    const query = contactAutocompleteQuery(searchQuery)

    if (contactSearchTimer !== null) {
      clearTimeout(contactSearchTimer)
      contactSearchTimer = null
    }

    if (query.length < 1) {
      contactSuggestions = []
      showContactSuggestions = false
      return
    }

    const requestId = ++contactSearchRequestId
    contactSearchTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/contacts?q=${encodeURIComponent(query)}&limit=6`)
        if (!response.ok) return

        const payload = (await response.json()) as { contacts: ContactSuggestion[] }
        if (requestId !== contactSearchRequestId) return
        contactSuggestions = payload.contacts
        showContactSuggestions = payload.contacts.length > 0
      } catch {
        if (requestId !== contactSearchRequestId) return
        contactSuggestions = []
        showContactSuggestions = false
      }
    }, 150)
  })

  function selectContactSuggestion(contact: ContactSuggestion) {
    searchQuery = contact.email
    showContactSuggestions = false
  }

  function selectSyntaxSuggestion(suggestion: SearchSyntaxSuggestion) {
    const parts = searchQuery.split(/\s+/)
    if (parts.length === 0) {
      searchQuery = suggestion.value
    } else {
      parts[parts.length - 1] = suggestion.value
      searchQuery = parts.join(' ')
    }
    searchInputFocused = true
  }

  function onSearchFocus() {
    searchInputFocused = true
    showContactSuggestions = contactSuggestions.length > 0
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

  function onSearchBlur() {
    setTimeout(() => {
      searchInputFocused = false
      showContactSuggestions = false
    }, 150)
  }

  async function loadSavedSearches() {
    try {
      const response = await fetch('/api/saved-searches')
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to load saved searches.'))
      const payload = (await response.json()) as { searches: SavedSearch[] }
      savedSearches = payload.searches
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load saved searches.')
    }
  }

  async function saveCurrentSearch() {
    const query = searchQuery.trim()
    if (!query || savingSearch) return
    const defaultName = query.length > 36 ? `${query.slice(0, 33)}...` : query
    const name = String(
      (await requestModal({
        title: 'Save search',
        inputLabel: 'Saved search name',
        inputValue: defaultName,
        confirmLabel: 'Save'
      })) ?? ''
    ).trim()
    if (!name) return

    savingSearch = true
    try {
      const response = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, query })
      })
      if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to save search.'))
      await loadSavedSearches()
      window.dispatchEvent(new CustomEvent('mail:saved-searches-changed'))
      showSavedSearchMenu = false
      toast('Search saved')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to save search.')
    } finally {
      savingSearch = false
    }
  }

  async function renameSavedSearch(savedSearch: SavedSearch) {
    const name = String(
      (await requestModal({
        title: 'Rename saved search',
        inputLabel: 'Name',
        inputValue: savedSearch.name,
        confirmLabel: 'Rename'
      })) ?? ''
    ).trim()
    if (!name || name === savedSearch.name) return

    try {
      const response = await fetch(`/api/saved-searches/${savedSearch.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to rename saved search.'))
      await loadSavedSearches()
      window.dispatchEvent(new CustomEvent('mail:saved-searches-changed'))
      toast('Saved search renamed')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to rename saved search.')
    }
  }

  function selectSavedSearch(savedSearch: SavedSearch) {
    searchQuery = savedSearch.query
    showSavedSearchMenu = false
    void goto(resolve(`/${mailbox}?q=${encodeURIComponent(savedSearch.query)}`), {
      noScroll: true,
      keepFocus: true
    })
  }

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
    simplifiedDragOffsetY = 0
    simplifiedDragging = false
    simplifiedDragPointerId = null
    simplifiedDragVelocityX = 0
    simplifiedSwipeAnimating = false
  })

  $effect(() => {
    if (!showSimplifiedMailboxView) {
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
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

  function isUnread(flags: string[] = [], hasUnread?: boolean) {
    return hasUnread !== undefined ? hasUnread : !flags.includes('\\Seen')
  }

  function senderLabel(from: string | null | undefined) {
    if (!from) return 'Unknown sender'
    return from
  }

  function senderName(from: string | null | undefined) {
    const label = senderLabel(from)
    return label.split('<')[0]?.trim() || label
  }

  function normalizedSender(from: string | null | undefined) {
    if (!from) return ''
    const angleAddress = from.match(/<([^<>]+)>/)?.[1]
    return (angleAddress ?? from).trim().toLowerCase()
  }

  function subjectLabel(subject: string | null | undefined) {
    if (!subject) return '(no subject)'
    return subject
  }

  function previewLabel(preview: string | null | undefined) {
    return preview || 'No preview available.'
  }

  function defaultSnoozeInputValue() {
    const date = new SvelteDate(Date.now() + 60 * 60 * 1000)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }

  async function promptForSnoozeDate() {
    const value = await requestModal({
      title: 'Snooze messages',
      inputLabel: 'Snooze until',
      inputValue: defaultSnoozeInputValue(),
      inputType: 'datetime-local',
      confirmLabel: 'Snooze'
    })
    if (value === null || typeof value === 'boolean') return null

    const trimmed = value.trim()
    const date = trimmed ? new Date(trimmed) : null
    if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      errorDialogMessage = 'Choose a future date and time to snooze messages.'
      return null
    }

    return date
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
    if (activeFilter === 'unread') params.set('unread', '1')
    if (activeFilter === 'starred') params.set('starred', '1')
    if (activeFilter === 'pinned') params.set('pinned', '1')
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
    void cacheCurrentList()
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

  function applyOfflineList(cache: OfflineListCache, reason = 'offline-cache') {
    const scrollTop = captureListScrollTop()
    loadedMailbox = mailbox
    lastKnownPageSize = cache.pageSize
    isRefreshingList = false
    messages = cache.messages
    hasMore = cache.hasMore
    loadedCount = cache.messages.length
    totalCount = cache.total
    loadMoreError = null
    restoreListScrollTop(scrollTop)
    logPerf('applyOfflineList', { reason, mailbox, rows: messages.length })
  }

  async function readCachedList(reason = 'offline-cache') {
    if (!offlineUserKey || isSearchMode) return false
    const cache = await readOfflineList(offlineUserKey, mailbox, threadedMode)
    if (!cache) return false
    applyOfflineList(cache, reason)
    return true
  }

  async function cacheCurrentList() {
    if (!offlineUserKey || isSearchMode || messages.length === 0) return
    await saveOfflineList({
      userKey: offlineUserKey,
      mailbox,
      messages: messages.slice(0, lastKnownPageSize),
      hasMore,
      pageSize: lastKnownPageSize,
      total: totalCount,
      threaded: threadedMode
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
      void cacheCurrentList()
      restoreListScrollTop(scrollTop)
    } catch {
      if (requestId !== listRequestId) return
      const restored = await readCachedList('refresh-failed')
      loadMoreError = restored
        ? 'Showing cached messages because the network is unavailable.'
        : 'Failed to refresh message list.'
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
      void cacheCurrentList()
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

  function markMessageRowRead(message: Message) {
    const shouldMarkThread = threadedMode && message.threadId && (message.threadCount ?? 0) > 1
    const shouldMarkMessage = !message.flags.includes('\\Seen')

    if (!shouldMarkThread && !shouldMarkMessage && message.hasUnread !== true) return

    const scrollTop = captureListScrollTop()
    const markRead = (m: Message) =>
      m.id === message.id
        ? {
            ...m,
            flags: m.flags.includes('\\Seen') ? m.flags : [...m.flags, '\\Seen'],
            ...(m.hasUnread !== undefined ? { hasUnread: false } : {})
          }
        : m

    messages = messages.map(markRead)
    searchResults = searchResults.map(markRead)
    restoreListScrollTop(scrollTop)

    const request = shouldMarkThread
      ? fetch(`/api/threads/${encodeThreadId(message.threadId ?? '')}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mailbox })
        })
      : fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [message.id], action: 'mark_read' })
        })

    void request
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to mark message read.'))
        }

        notifyMailboxStateChanged('message-opened:mark-read')
      })
      .catch((error) => {
        errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark message read.')
      })
  }

  function selectMessage(message: Message) {
    closeContextMenu()
    markMessageRowRead(message)
    const targetMailbox = message.mailbox ? pathToSlug(message.mailbox) : mailbox
    if (threadedMode && message.threadId && (message.threadCount ?? 0) > 1) {
      goto(resolve(`/${targetMailbox}/thread/${encodeThreadId(message.threadId)}`), {
        noScroll: true,
        keepFocus: true
      })
    } else {
      goto(resolve(`/${targetMailbox}/${message.id}`), { noScroll: true, keepFocus: true })
    }
  }

  function selectMessageFromRow(message: Message) {
    if (mobileSwipeSuppressClickId === message.id) {
      mobileSwipeSuppressClickId = null
      return
    }

    selectMessage(message)
  }

  function isMobileSwipeEnabled(event: PointerEvent) {
    return !isDesktop && !selectionMode && event.isPrimary && event.pointerType !== 'mouse'
  }

  function resetMobileSwipe() {
    mobileSwipeMessageId = null
    mobileSwipePointerId = null
    mobileSwipeOffsetX = 0
    mobileSwipeDragging = false
  }

  function clampMobileSwipeOffset(deltaX: number) {
    return Math.max(-mobileSwipeMaxOffset, Math.min(mobileSwipeMaxOffset, deltaX))
  }

  function mobileSwipeActionFor(message: Message): MobileSwipeAction | null {
    if (mobileSwipeOffsetX >= mobileSwipeActionThreshold) return 'archive'
    if (mobileSwipeOffsetX <= -mobileSwipeTrashThreshold) return 'trash'
    if (mobileSwipeOffsetX <= -mobileSwipeActionThreshold) {
      return isUnread(message.flags, message.hasUnread) ? 'mark_read' : 'trash'
    }

    return null
  }

  function mobileSwipeBackgroundLabel(message: Message, side: 'left' | 'right') {
    const action = mobileSwipeActionFor(message)
    if (side === 'left') return action === 'archive' ? 'Release to archive' : 'Archive'
    if (action === 'trash') return 'Release to trash'
    if (action === 'mark_read') return 'Release to mark read'
    return isUnread(message.flags, message.hasUnread) ? 'Mark read' : 'Trash'
  }

  function mobileSwipeRowStyle(message: Message) {
    if (mobileSwipeMessageId !== message.id) return 'touch-action: pan-y;'

    return `transform: translate3d(${mobileSwipeOffsetX}px, 0, 0); touch-action: pan-y;`
  }

  function mobileSwipeActionBackgroundClass(
    message: Message,
    side: 'left' | 'right',
    baseClass: string
  ) {
    const active = mobileSwipeMessageId === message.id
    const action = mobileSwipeActionFor(message)
    const ready =
      side === 'left' ? action === 'archive' : action === 'mark_read' || action === 'trash'
    const actionClass =
      side === 'left'
        ? 'justify-start bg-emerald-500/16 text-emerald-100'
        : action === 'trash'
          ? 'justify-end bg-rose-500/16 text-rose-100'
          : 'justify-end bg-sky-500/16 text-sky-100'

    return [
      baseClass,
      actionClass,
      !active ? 'opacity-0' : ready ? 'opacity-100' : 'opacity-70'
    ].join(' ')
  }

  function handleMobileSwipePointerDown(event: PointerEvent, message: Message) {
    if (!isMobileSwipeEnabled(event)) return

    const row = event.currentTarget as HTMLElement
    mobileSwipeMessageId = message.id
    mobileSwipePointerId = event.pointerId
    mobileSwipeStartX = event.clientX
    mobileSwipeStartY = event.clientY
    mobileSwipeOffsetX = 0
    mobileSwipeDragging = false
    row.setPointerCapture(event.pointerId)
  }

  function handleMobileSwipePointerMove(event: PointerEvent) {
    if (mobileSwipePointerId !== event.pointerId || mobileSwipeMessageId === null) return

    const deltaX = event.clientX - mobileSwipeStartX
    const deltaY = event.clientY - mobileSwipeStartY

    if (!mobileSwipeDragging) {
      if (Math.abs(deltaY) > mobileSwipeActivationDistance && Math.abs(deltaY) > Math.abs(deltaX)) {
        const row = event.currentTarget as HTMLElement
        if (row.hasPointerCapture(event.pointerId)) {
          row.releasePointerCapture(event.pointerId)
        }
        resetMobileSwipe()
        return
      }

      if (Math.abs(deltaX) < mobileSwipeActivationDistance) return
      if (Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return

      mobileSwipeDragging = true
    }

    event.preventDefault()
    mobileSwipeOffsetX = clampMobileSwipeOffset(deltaX)
  }

  async function finishMobileSwipe(message: Message) {
    const action = mobileSwipeActionFor(message)
    if (mobileSwipeDragging) mobileSwipeSuppressClickId = message.id
    resetMobileSwipe()

    if (action === 'archive') {
      await archiveMessage(message.id)
    } else if (action === 'mark_read') {
      await markMessageRead(message.id)
    } else if (action === 'trash') {
      await trashMessage(message.id)
    }
  }

  function handleMobileSwipePointerUp(event: PointerEvent, message: Message) {
    if (mobileSwipePointerId !== event.pointerId) return

    const row = event.currentTarget as HTMLElement
    if (row.hasPointerCapture(event.pointerId)) {
      row.releasePointerCapture(event.pointerId)
    }

    void finishMobileSwipe(message)
  }

  function handleMobileSwipePointerCancel(event: PointerEvent) {
    if (mobileSwipePointerId !== event.pointerId) return

    const row = event.currentTarget as HTMLElement
    if (row.hasPointerCapture(event.pointerId)) {
      row.releasePointerCapture(event.pointerId)
    }

    resetMobileSwipe()
  }

  function showPreviousSimplifiedCard() {
    if (simplifiedSwipeAnimating || !canShowPreviousCard) {
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
      return
    }

    simplifiedCardIndex -= 1
    simplifiedDragOffsetX = 0
    simplifiedDragOffsetY = 0
    simplifiedDragVelocityX = 0
  }

  function showNextSimplifiedCard() {
    if (simplifiedSwipeAnimating || !canShowNextCard) {
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
      return
    }

    simplifiedCardIndex += 1
    simplifiedDragOffsetX = 0
    simplifiedDragOffsetY = 0
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
    simplifiedDragOffsetY = 0
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
    simplifiedDragOffsetY = 0
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
    if (!activeSimplifiedMessage) return
    if (!shouldStartSimplifiedCardDrag(event)) return

    const card = event.currentTarget as HTMLElement
    simplifiedDragPointerId = event.pointerId
    simplifiedDragging = true
    simplifiedSwipeAnimating = false
    simplifiedDragStartX = event.clientX
    simplifiedDragStartY = event.clientY
    simplifiedDragLastX = event.clientX
    simplifiedDragLastAt = event.timeStamp
    simplifiedDragVelocityX = 0
    simplifiedDragOffsetX = 0
    simplifiedDragOffsetY = 0
    card.setPointerCapture(event.pointerId)
  }

  function applySimplifiedDragResistance(deltaX: number) {
    const swipingPastStart = deltaX > 0 && !canShowPreviousCard
    const swipingPastEnd = deltaX < 0 && !canShowNextCard
    const resistance = swipingPastStart || swipingPastEnd ? 0.22 : 0.9
    const softened = Math.sign(deltaX) * Math.pow(Math.abs(deltaX), 0.92)
    return softened * resistance
  }

  function applySimplifiedVerticalDragResistance(deltaY: number) {
    if (deltaY >= 0) return 0

    return -Math.pow(Math.abs(deltaY), 0.92) * 0.75
  }

  function handleSimplifiedCardPointerMove(event: PointerEvent) {
    if (!simplifiedDragging || simplifiedDragPointerId !== event.pointerId) return
    const deltaX = event.clientX - simplifiedDragStartX
    const deltaY = event.clientY - simplifiedDragStartY
    simplifiedDragOffsetX = applySimplifiedDragResistance(deltaX)
    simplifiedDragOffsetY = applySimplifiedVerticalDragResistance(deltaY)

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
      simplifiedDragOffsetY = 0
      simplifiedDragVelocityX = 0
      return
    }
    if (!movingToPrevious && !canShowNextCard) {
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
      simplifiedDragVelocityX = 0
      return
    }

    simplifiedSwipeAnimating = true
    simplifiedDragOffsetX =
      (movingToPrevious ? 1 : -1) * Math.max(simplifiedCardWidthEstimate * 1.08, 320)
    simplifiedDragOffsetY = 0
    simplifiedDragVelocityX = 0

    window.setTimeout(() => {
      if (movingToPrevious) {
        simplifiedCardIndex -= 1
      } else {
        simplifiedCardIndex += 1
      }

      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
      simplifiedSwipeAnimating = false
    }, 180)
  }

  function finishSimplifiedCardDrag() {
    const swipeThreshold = simplifiedCardWidthEstimate * 0.18
    const swipeVelocityThreshold = 0.45
    const movingNext = simplifiedDragOffsetX < 0
    const canAdvanceByDistance = Math.abs(simplifiedDragOffsetX) >= swipeThreshold
    const canAdvanceByVelocity = Math.abs(simplifiedDragVelocityX) >= swipeVelocityThreshold
    const shouldMarkReadByDrag = simplifiedMarkReadGestureReady

    if (shouldMarkReadByDrag) {
      const message = activeSimplifiedMessage
      if (message && isUnread(message.flags, message.hasUnread)) {
        markMessageRowRead(message)
      }
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
      simplifiedDragVelocityX = 0
    } else if ((canAdvanceByDistance || canAdvanceByVelocity) && movingNext) {
      animateSimplifiedCardSwipe('next')
    } else if (canAdvanceByDistance || canAdvanceByVelocity) {
      animateSimplifiedCardSwipe('previous')
    } else {
      simplifiedDragOffsetX = 0
      simplifiedDragOffsetY = 0
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
    simplifiedDragOffsetY = 0
    simplifiedDragging = false
    simplifiedDragPointerId = null
    simplifiedDragVelocityX = 0
    simplifiedSwipeAnimating = false
  }

  function simplifiedCardTransform(offset: number) {
    const progress = simplifiedSwipeProgress

    if (offset === 0) {
      const rotate = simplifiedDragOffsetX / 36
      return `translate3d(${simplifiedDragOffsetX}px, ${simplifiedDragOffsetY}px, 0) rotate(${rotate}deg) scale(1)`
    }

    const directionLift = offset === 1 ? 10 : 6
    const directionScale = offset === 1 ? 0.045 : 0.03
    const xParallax = simplifiedDragOffsetX * (offset === 1 ? 0.1 : 0.05)
    const y = offset * 14 - progress * directionLift
    const scale = 1 - offset * 0.04 + progress * directionScale

    return `translate3d(${xParallax}px, ${y}px, 0) scale(${scale})`
  }

  function simplifiedCardOpacity(offset: number) {
    if (offset === 0) return 1
    const progress = simplifiedSwipeProgress
    return 1 - offset * 0.18 + progress * (offset === 1 ? 0.16 : 0.08)
  }

  function simplifiedMarkReadGlowStyle() {
    const opacity = simplifiedMarkReadReady ? 0.34 : simplifiedMarkReadProgress * 0.22
    return `opacity: ${opacity};`
  }

  function simplifiedMarkReadPillStyle() {
    const progress = simplifiedMarkReadProgress
    const opacity = progress === 0 ? 0 : Math.min(0.2 + progress * 0.8, 1)
    const lift = Math.round((1 - progress) * 10)
    const scale = simplifiedMarkReadReady ? 1 : 0.96 + progress * 0.04
    return `opacity: ${opacity}; transform: translateX(-50%) translateY(${lift}px) scale(${scale});`
  }

  function simplifiedMarkReadProgressStyle() {
    return `opacity: ${simplifiedMarkReadProgress === 0 ? 0 : 1};`
  }

  function simplifiedMarkReadProgressBarStyle() {
    return `transform: scaleX(${simplifiedMarkReadProgress});`
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
    const menuHeight = 288
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

    if (normalizedSender(message.from)) {
      if (role !== 'archive')
        items.push({ action: 'archive_sender', label: 'Archive from sender…' })
      if (role !== 'trash') items.push({ action: 'trash_sender', label: 'Trash from sender…' })
    }

    if (isUnread(message.flags, message.hasUnread)) {
      items.push({ action: 'mark_read', label: 'Mark as read' })
    } else {
      items.push({ action: 'mark_unread', label: 'Mark as unread' })
    }

    items.push({ action: 'snooze', label: 'Snooze...' })

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

  function updateThreadMetadataRows(threadId: string, values: Partial<Message>) {
    const update = (message: Message) =>
      message.threadId === threadId || message.messageId === threadId
        ? { ...message, ...values }
        : message
    messages = messages.map(update)
    searchResults = searchResults.map(update)
  }

  async function toggleThreadMetadata(
    event: MouseEvent,
    message: Message,
    field: 'threadStarred' | 'threadPinned'
  ) {
    event.stopPropagation()
    event.preventDefault()
    const threadId = message.threadId ?? message.messageId
    if (!threadId) return

    const nextValue = !message[field]
    updateThreadMetadataRows(threadId, { [field]: nextValue })

    try {
      const response = await fetch(`/api/threads/${encodeThreadId(threadId)}/metadata`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mailbox: message.mailbox ?? mailbox,
          [field === 'threadStarred' ? 'starred' : 'pinned']: nextValue
        })
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update thread metadata.'))
      }

      const payload = (await response.json()) as {
        metadata: { starred: boolean; pinned: boolean }
      }
      updateThreadMetadataRows(threadId, {
        threadStarred: payload.metadata.starred,
        threadPinned: payload.metadata.pinned
      })
      notifyMailboxStateChanged('thread-metadata')
      toast(
        field === 'threadStarred'
          ? nextValue
            ? 'Thread starred'
            : 'Thread unstarred'
          : nextValue
            ? 'Thread pinned'
            : 'Thread unpinned'
      )
    } catch (error) {
      updateThreadMetadataRows(threadId, { [field]: !nextValue })
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update thread metadata.')
    }
  }

  async function bulkAction(action: string) {
    if (bulkActionPending || selectedIds.size === 0) return
    const snoozedUntil = action === 'snooze' ? await promptForSnoozeDate() : null
    if (action === 'snooze' && !snoozedUntil) return

    bulkActionPending = true
    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [...selectedIds],
            action,
            threaded: threadedMode && !isSearchMode,
            mailbox,
            ...(snoozedUntil ? { snoozedUntil: snoozedUntil.toISOString() } : {})
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Failed to run ${action} action.`))
        }

        clearSelection()
        await refreshVisibleListWindow(`bulk-action:${action}`)
        notifyMailboxStateChanged(`bulk-action:${action}`)
        toast(
          action === 'mark_read'
            ? 'Messages marked as read'
            : action === 'mark_unread'
              ? 'Messages marked as unread'
              : action === 'snooze'
                ? 'Messages snoozed'
                : `Messages moved to ${action}`
        )
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, `Failed to run ${action} action.`)
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

    if (seed && seed.threaded === untrack(() => threadedMode)) {
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

  let lastActiveFilter = $state<'all' | 'unread' | 'starred' | 'pinned'>('all')
  $effect(() => {
    const filter = activeFilter
    if (filter === untrack(() => lastActiveFilter)) return
    lastActiveFilter = filter
    messages = []
    hasMore = false
    loadedCount = 0
    totalCount = 0
    loadMoreError = null
    void refreshVisibleListWindow(`filter-change:${filter}`)
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
    toast(threadedMode ? 'Threaded view enabled' : 'Threaded view disabled')

    logPerf('toggleThreadedMode', {
      mailbox,
      threadedMode,
      rows: messages.length,
      ms: Math.round(now() - startedAt)
    })
  }

  onMount(() => {
    keyboard.panel = 'list'
    online = navigator.onLine
    const updateOnline = () => {
      online = navigator.onLine
      if (!online) void readCachedList('went-offline')
    }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    void cacheCurrentList()
    if (!online) void readCachedList('mount-offline')

    void loadSavedSearches()

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
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      clearInterval(interval)
      teardown()
    }
  })

  async function archiveMessage(id: number) {
    closeContextMenu()
    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [id],
            action: 'archive',
            threaded: threadedMode && !isSearchMode,
            mailbox
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to archive message.'))
        }

        await refreshVisibleListWindow('archive-message')
        notifyMailboxStateChanged('archive-message')
        toast('Message archived')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to archive message.')
    }
  }

  async function trashMessage(id: number) {
    closeContextMenu()
    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [id],
            action: 'trash',
            threaded: threadedMode && !isSearchMode,
            mailbox
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to move message to trash.'))
        }

        await refreshVisibleListWindow('trash-message')
        notifyMailboxStateChanged('trash-message')
        toast('Message moved to trash')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to move message to trash.')
    }
  }

  async function moveMessageAction(id: number, action: 'archive' | 'trash' | 'spam' | 'inbox') {
    closeContextMenu()
    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [id],
            action,
            threaded: threadedMode && !isSearchMode,
            mailbox
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Failed to ${action} message.`))
        }

        await refreshVisibleListWindow(`message-action:${action}`)
        notifyMailboxStateChanged(`message-action:${action}`)
        toast(`Message moved to ${action}`)
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, `Failed to ${action} message.`)
    }
  }

  async function bulkSenderAction(message: Message, action: 'archive' | 'trash') {
    if (bulkSenderPending) return
    closeContextMenu()

    const sender = normalizedSender(message.from)
    if (!sender) {
      errorDialogMessage = 'This message does not have a sender to match.'
      return
    }

    const scopedMailbox = message.mailbox ?? mailbox
    bulkSenderPending = true

    try {
      await trackAppLoading(async () => {
        const params = new SvelteURLSearchParams({ mailbox: scopedMailbox, sender, action })
        const countResponse = await fetch(`/api/messages/by-sender?${params}`)
        if (!countResponse.ok) {
          throw new Error(await readErrorMessage(countResponse, 'Failed to count sender messages.'))
        }

        const countPayload = (await countResponse.json()) as {
          count: number
          mailbox: string
          normalizedSender: string
        }

        if (countPayload.count === 0) return

        const actionLabel = action === 'archive' ? 'archive' : 'move to trash'
        const confirmed = await requestModal({
          title: action === 'archive' ? 'Archive sender mail' : 'Trash sender mail',
          message: `This will ${actionLabel} ${countPayload.count} message${countPayload.count === 1 ? '' : 's'} from ${countPayload.normalizedSender} in ${mailboxLabel(countPayload.mailbox)}.`,
          confirmLabel: action === 'archive' ? 'Archive' : 'Move to trash',
          tone: action === 'archive' ? 'default' : 'danger'
        })
        if (!confirmed) return

        const actionResponse = await fetch('/api/messages/by-sender', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mailbox: countPayload.mailbox,
            sender: countPayload.normalizedSender,
            action,
            expectedCount: countPayload.count
          })
        })

        if (!actionResponse.ok) {
          throw new Error(
            await readErrorMessage(actionResponse, `Failed to ${actionLabel} sender mail.`)
          )
        }

        await refreshVisibleListWindow(`bulk-sender:${action}`)
        notifyMailboxStateChanged(`bulk-sender:${action}`)
        toast(action === 'archive' ? 'Sender messages archived' : 'Sender messages moved to trash')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, `Failed to ${action} sender mail.`)
    } finally {
      bulkSenderPending = false
    }
  }

  async function markMessageRead(id: number) {
    closeContextMenu()
    updateMessageFlags(id, (flags) => (flags.includes('\\Seen') ? flags : [...flags, '\\Seen']))

    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [id],
            action: 'mark_read',
            threaded: threadedMode && !isSearchMode,
            mailbox
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to mark message read.'))
        }

        await refreshVisibleListWindow('message-action:mark-read')
        notifyMailboxStateChanged('message-action:mark-read')
        toast('Message marked as read')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark message read.')
    }
  }

  async function markMessageUnread(id: number) {
    closeContextMenu()
    updateMessageFlags(id, (flags) => flags.filter((flag) => flag !== '\\Seen'))

    try {
      await trackAppLoading(async () => {
        const response = await fetch('/api/messages/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: [id],
            action: 'mark_unread',
            threaded: threadedMode && !isSearchMode,
            mailbox
          })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to mark message unread.'))
        }

        await refreshVisibleListWindow('message-action:mark-unread')
        notifyMailboxStateChanged('message-action:mark-unread')
        toast('Message marked as unread')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to mark message unread.')
    }
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

    if (action === 'mark_unread') {
      await markMessageUnread(message.id)
      return
    }

    if (action === 'snooze') {
      await snoozeMessage(message.id)
      return
    }

    if (action === 'archive_sender') {
      await bulkSenderAction(message, 'archive')
      return
    }

    if (action === 'trash_sender') {
      await bulkSenderAction(message, 'trash')
      return
    }

    await moveMessageAction(message.id, action)
  }

  async function snoozeMessage(id: number) {
    closeContextMenu()
    const snoozedUntil = await promptForSnoozeDate()
    if (!snoozedUntil) return

    try {
      await trackAppLoading(async () => {
        const response = await fetch(`/api/messages/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'snooze', snoozedUntil: snoozedUntil.toISOString() })
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to snooze message.'))
        }

        await refreshVisibleListWindow('message-action:snooze')
        notifyMailboxStateChanged('message-action:snooze')
        toast('Message snoozed')
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to snooze message.')
    }
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

  // Snapshot the SSR/cookie-seeded value once; the divider drag owns it afterward.
  let listRatio = $state(untrack(() => data.listRatio))
  let resizing = $state(false)
  let splitEl = $state<HTMLDivElement | null>(null)
  const listBasis = $derived(`${(listRatio * 100).toFixed(3)}%`)
  let refreshing = $state(false)
  let summarizing = $state(false)
  let recentSummary = $state<string | null>(null)

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

  async function readTextStream(response: Response, onChunk: (chunk: string) => void) {
    if (!response.body) {
      onChunk(await response.text())
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      onChunk(decoder.decode(value, { stream: true }))
    }

    const tail = decoder.decode()
    if (tail) onChunk(tail)
  }

  async function summarizeRecentMail() {
    if (summarizing) return
    summarizing = true
    recentSummary = ''
    try {
      const response = await trackAppLoading(() =>
        fetch(`/api/ai/recent-summary?mailbox=${encodeURIComponent(mailbox)}&limit=12`)
      )

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to summarize recent mail.'))
      }

      await readTextStream(response, (chunk) => {
        recentSummary = `${recentSummary ?? ''}${chunk}`
      })
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to summarize recent mail.')
      recentSummary = null
    } finally {
      summarizing = false
    }
  }

  function persistListRatio() {
    try {
      document.cookie = `${LIST_RATIO_COOKIE}=${listRatio.toFixed(4)}; path=/; max-age=${LIST_RATIO_COOKIE_MAX_AGE}; samesite=lax`
    } catch {
      /* ignore */
    }
  }

  // Translate a desired list width (px) into a stored ratio, enforcing the
  // per-viewport pixel floors so neither the list nor the reading pane vanishes.
  // Only the rendered width is clamped — the stored ratio keeps the user's intent
  // so the separator returns to its proportional spot when the window grows back.
  function ratioFromPx(px: number, container: number) {
    if (container <= 0) return listRatio
    const lower = MIN_LIST_PX / container
    const upper = Math.max(lower, (container - MIN_DETAIL_PX) / container)
    return Math.min(Math.max(px / container, lower), upper)
  }

  function resetListRatio() {
    listRatio = DEFAULT_LIST_RATIO
    persistListRatio()
  }

  function startResize(e: PointerEvent) {
    e.preventDefault()
    const container = splitEl?.clientWidth ?? 0
    if (container <= 0) return

    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    resizing = true
    const startX = e.clientX
    const startPx = listRatio * container

    function onMove(ev: PointerEvent) {
      listRatio = ratioFromPx(startPx + (ev.clientX - startX), container)
    }

    function stop() {
      resizing = false
      persistListRatio()
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  function onHandleKeydown(e: KeyboardEvent) {
    const container = splitEl?.clientWidth ?? 0
    if (container <= 0) return

    const stepPx = e.shiftKey ? 48 : 16
    const currentPx = listRatio * container
    let nextPx: number

    switch (e.key) {
      case 'ArrowLeft':
        nextPx = currentPx - stepPx
        break
      case 'ArrowRight':
        nextPx = currentPx + stepPx
        break
      case 'Home':
        nextPx = 0
        break
      case 'End':
        nextPx = container
        break
      default:
        return
    }

    e.preventDefault()
    listRatio = ratioFromPx(nextPx, container)
    persistListRatio()
  }

  // Derived so Svelte tracks keyboard.focusedIndex as a reactive dependency
  const focusedIndex = $derived(keyboard.focusedIndex)

  const selectedMessageRowClass = 'bg-white/14 shadow-[inset_3px_0_0_rgba(56,189,248,0.95)]'
  const focusedMessageRowClass = 'bg-white/10 shadow-[inset_3px_0_0_rgba(255,255,255,0.25)]'
  const listHeaderClass = $derived(
    density === 'condensed'
      ? 'p-3 sm:p-4 md:border-b md:border-white/8'
      : 'p-4 sm:p-5 md:border-b md:border-white/8'
  )
  const listSearchInputClass = $derived(
    density === 'condensed'
      ? 'w-full rounded-l-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-blue-500 md:border-white/10'
      : 'w-full rounded-l-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-blue-500 md:border-white/10'
  )
  const listContainerClass = $derived(
    density === 'condensed'
      ? 'space-y-1 p-1 md:space-y-0 md:p-0'
      : 'space-y-2 p-2 md:space-y-0 md:p-0'
  )
  const rowBaseClass = $derived(
    density === 'condensed'
      ? 'relative z-10 block w-full rounded-xl bg-white/2 py-2.5 pr-20 pl-8 text-left transition-[transform,background-color,box-shadow] sm:pl-9 md:rounded-none md:border-b md:border-white/8 md:bg-transparent'
      : 'relative z-10 block w-full rounded-2xl bg-white/2 py-4 pr-20 pl-9 text-left transition-[transform,background-color,box-shadow] sm:pl-10 md:rounded-none md:border-b md:border-white/8 md:bg-transparent'
  )
  const previewClass = $derived(
    density === 'condensed'
      ? 'mt-1.5 line-clamp-1 text-xs leading-5 text-zinc-400'
      : 'mt-3 line-clamp-2 text-sm leading-6 text-zinc-400'
  )

  function messageRowClass(message: Message, index: number) {
    const isFocused = focusedIndex === index && !isSearchMode
    const isSelected = selectedMessageId === message.id
    return [
      rowBaseClass,
      isSelected ? selectedMessageRowClass : isFocused ? focusedMessageRowClass : 'hover:bg-white/3'
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
    <div class={listHeaderClass}>
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-white sm:text-base">{folderDisplayName}</p>
          <p class="mt-1 text-xs text-zinc-500 sm:text-sm">{totalCountLabel}</p>
          {#if !online}
            <p
              class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/15 bg-amber-400/8 px-2.5 py-1 text-xs text-amber-200"
            >
              <WifiOff size={12} />
              Offline
            </p>
          {/if}
        </div>

        <div class="flex justify-end overflow-x-auto">
          <div class="inline-flex min-w-max items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onclick={() => void toggleThreadedMode()}
              class={[
                'transition',
                threadedMode ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'
              ]}
              aria-pressed={threadedMode}
              title={threadedMode ? 'Show individual messages' : 'Show threads'}
              aria-label={threadedMode ? 'Show individual messages' : 'Show threads'}
            >
              <Mails size={15} />
            </button>
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
            <button
              type="button"
              onclick={() => void summarizeRecentMail()}
              disabled={summarizing}
              class={[
                'transition disabled:cursor-not-allowed disabled:opacity-40',
                recentSummary || summarizing ? 'text-sky-300' : 'text-zinc-600 hover:text-zinc-400'
              ]}
              title="Summarize recent mail"
              aria-label="Summarize recent mail"
            >
              <Sparkles size={15} />
            </button>
            <div
              class="inline-flex shrink-0 items-center rounded-xl border border-transparent bg-white/3 p-1 text-xs md:border-white/8 md:text-sm"
            >
              <button
                type="button"
                title="Show starred"
                aria-label="Show starred"
                class={[
                  'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'all' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'all')}
              >
                <span class="sm:hidden">All</span>
                <span class="hidden sm:inline">All mail</span>
              </button>
              <button
                type="button"
                title="Show pinned"
                aria-label="Show pinned"
                class={[
                  'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'unread' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'unread')}
              >
                Unread
              </button>
              <button
                type="button"
                class={[
                  'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'starred' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'starred')}
              >
                <Star size={14} fill={activeFilter === 'starred' ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                class={[
                  'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                  activeFilter === 'pinned' ? 'bg-white/8 text-white' : 'text-zinc-400'
                ]}
                onclick={() => (activeFilter = 'pinned')}
              >
                <Pin size={14} fill={activeFilter === 'pinned' ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <p class="mt-3 hidden text-sm text-zinc-500 sm:block">
        Swipe through recent mail or open the current card.
      </p>

      {#if isDesktop || mobileSearchOpen || searchQuery.trim().length > 0}
        <div class="relative mt-3 flex md:mt-4">
          <label class="min-w-0 flex-1">
            <span class="sr-only">Search messages</span>
            <input
              bind:value={searchQuery}
              type="search"
              placeholder="Search"
              onfocus={onSearchFocus}
              onblur={onSearchBlur}
              class={listSearchInputClass}
            />
          </label>
          <button
            type="button"
            onclick={() => (showSavedSearchMenu = !showSavedSearchMenu)}
            aria-label="Saved searches"
            title="Saved searches"
            class="grid w-11 place-items-center rounded-r-xl border border-transparent border-l-white/8 bg-black/30 text-zinc-300 hover:bg-white/8 md:border-white/8"
          >
            <Bookmark size={15} />
          </button>
          {#if showSavedSearchMenu}
            <div
              class="absolute top-full right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl shadow-black/30"
            >
              <div class="border-b border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                Saved searches
              </div>
              {#if savedSearches.length > 0}
                {#each savedSearches as savedSearch (savedSearch.id)}
                  <div class="flex items-start gap-1 px-1 py-1 hover:bg-white/6">
                    <button
                      type="button"
                      onclick={() => selectSavedSearch(savedSearch)}
                      class="min-w-0 flex-1 rounded-lg px-2 py-1 text-left"
                      title={savedSearch.query}
                    >
                      <span class="block truncate text-sm font-medium text-zinc-200">
                        {savedSearch.name}
                      </span>
                      <span class="block truncate text-xs text-zinc-500">{savedSearch.query}</span>
                    </button>
                    <button
                      type="button"
                      onclick={() => void renameSavedSearch(savedSearch)}
                      class="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-white/8 hover:text-zinc-200"
                    >
                      Rename
                    </button>
                  </div>
                {/each}
              {:else}
                <p class="px-3 py-3 text-sm text-zinc-500">No saved searches yet.</p>
              {/if}
              {#if searchQuery.trim()}
                <div class="border-t border-white/8 p-2">
                  <button
                    type="button"
                    onclick={() => void saveCurrentSearch()}
                    disabled={savingSearch}
                    class="w-full rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {savingSearch ? 'Saving...' : 'Save current search'}
                  </button>
                </div>
              {/if}
            </div>
          {/if}
          {#if showSearchAutocomplete}
            <div
              class="absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-xl shadow-black/20"
            >
              {#if searchInputFocused && syntaxSuggestions.length > 0}
                <div class="border-b border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                  Search syntax
                </div>
                {#each syntaxSuggestions as suggestion (suggestion.value)}
                  <button
                    type="button"
                    onclick={() => selectSyntaxSuggestion(suggestion)}
                    class="block w-full px-3 py-2 text-left hover:bg-white/6"
                  >
                    <span class="font-mono text-sm text-zinc-200">{suggestion.value}</span>
                    <span class="ml-2 text-xs text-zinc-500">{suggestion.description}</span>
                  </button>
                {/each}
              {/if}
              {#if showContactSuggestions && contactSuggestions.length > 0}
                <div class="border-y border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                  Contacts
                </div>
                {#each contactSuggestions as contact (contact.id)}
                  <button
                    type="button"
                    onclick={() => selectContactSuggestion(contact)}
                    class="block w-full px-3 py-2 text-left text-sm hover:bg-white/6"
                  >
                    <span class="block truncate font-medium text-zinc-200">
                      {contact.name || contact.email}
                    </span>
                    {#if contact.name}
                      <span class="block truncate text-xs text-zinc-500">{contact.email}</span>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if recentSummary !== null || summarizing}
        <div class="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <Sparkles size={14} class="shrink-0 text-sky-300" />
              <p class="truncate text-xs font-semibold text-zinc-200">Recent summary</p>
            </div>
            {#if recentSummary}
              <button
                type="button"
                onclick={() => {
                  recentSummary = null
                }}
                class="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
              >
                Hide
              </button>
            {/if}
          </div>
          {#if recentSummary}
            <div class="mt-2 text-xs leading-5 whitespace-pre-wrap text-zinc-300">
              {recentSummary}
            </div>
            {#if summarizing}
              <p class="mt-2 text-xs text-zinc-500">Summarizing…</p>
            {/if}
          {:else if summarizing}
            <p class="mt-2 text-xs text-zinc-500">Summarizing…</p>
          {/if}
        </div>
      {/if}
    </div>

    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-x-hidden overflow-y-auto p-4 select-none sm:p-6"
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
                  'simplified-mail-card absolute inset-0 overflow-hidden rounded-3xl border border-white/10 bg-[#131319] p-6 text-left shadow-2xl shadow-black/30 lg:p-7',
                  offset === 0 && simplifiedMarkReadProgress > 0 ? 'border-sky-400/20' : '',
                  offset === 0 && simplifiedMarkReadReady ? 'ring-1 ring-sky-300/25' : '',
                  offset === 0
                    ? [
                        'cursor-grab touch-none will-change-transform active:cursor-grabbing',
                        simplifiedDragging
                          ? 'duration-0'
                          : 'transition-[transform,opacity,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                      ]
                    : 'pointer-events-none'
                ]}
                style={`transform: ${simplifiedCardTransform(offset)}; opacity: ${simplifiedCardOpacity(offset)}; z-index: ${10 - offset};`}
                onpointerdown={offset === 0 ? handleSimplifiedCardPointerDown : undefined}
                onpointermove={offset === 0 ? handleSimplifiedCardPointerMove : undefined}
                onpointerup={offset === 0 ? handleSimplifiedCardPointerUp : undefined}
                onpointercancel={offset === 0 ? handleSimplifiedCardPointerCancel : undefined}
              >
                {#if offset === 0 && activeSimplifiedMessageUnread}
                  <div
                    class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-sky-400/18 via-sky-400/6 to-transparent transition-opacity duration-150"
                    style={simplifiedMarkReadGlowStyle()}
                  ></div>
                  <div
                    class={[
                      'pointer-events-none absolute top-5 left-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-lg backdrop-blur transition-[opacity,transform,border-color,background-color,color] duration-150',
                      simplifiedMarkReadReady
                        ? 'border-sky-300/30 bg-sky-400/10 text-sky-100 shadow-sky-950/30'
                        : 'border-white/10 bg-zinc-950/70 text-zinc-300 shadow-black/20'
                    ]}
                    style={simplifiedMarkReadPillStyle()}
                  >
                    <MailOpen size={13} />
                    {simplifiedMarkReadReady ? 'Release to mark read' : 'Drag up to mark read'}
                  </div>
                  <div
                    class="pointer-events-none absolute inset-x-6 top-16 z-20 h-px overflow-hidden rounded-full bg-white/8"
                    style={simplifiedMarkReadProgressStyle()}
                  >
                    <div
                      class="h-full origin-left rounded-full bg-sky-300/80"
                      style={simplifiedMarkReadProgressBarStyle()}
                    ></div>
                  </div>
                {/if}

                <div class="relative z-10 flex h-full flex-col">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="truncate text-sm font-medium text-zinc-300">
                          {senderName(message.from)}
                        </p>
                        {#if isUnread(message.flags, message.hasUnread)}
                          <span class="h-2 w-2 shrink-0 rounded-full bg-sky-400"></span>
                          <span class="text-xs font-medium text-sky-300">Unread</span>
                        {/if}
                        {#if threadedMode && message.threadCount && message.threadCount > 1}
                          <span
                            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-xs font-medium text-zinc-300"
                          >
                            <Mails size={12} />
                            Thread
                          </span>
                        {/if}
                        {#if message.hasThreadNote}
                          <span
                            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-200"
                            title="Private note"
                          >
                            <StickyNote size={12} />
                            Note
                          </span>
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
                      {threadedMode && message.threadCount && message.threadCount > 1
                        ? 'Open thread'
                        : 'Open message'}
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
  <div
    bind:this={splitEl}
    class="flex h-full"
    class:cursor-col-resize={resizing}
    class:select-none={resizing}
  >
    <section
      id="message-list-pane"
      style:--list-basis={listBasis}
      class={[
        'mail-list-pane flex flex-col overflow-x-hidden bg-[#0d0d10] md:border-r',
        'md:border-white/8',
        isMailboxRoot ? 'flex min-w-0 flex-1 md:flex-none' : 'hidden md:flex'
      ]}
      aria-label="Message list"
    >
      <div class={listHeaderClass}>
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-white sm:text-base">
              {folderDisplayName}
            </p>
            <p class="mt-1 text-xs text-zinc-500 sm:text-sm">{totalCountLabel}</p>
            {#if !online}
              <p
                class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/15 bg-amber-400/8 px-2.5 py-1 text-xs text-amber-200"
              >
                <WifiOff size={12} />
                Offline
              </p>
            {/if}
          </div>

          <div class="flex justify-end overflow-x-auto">
            <div class="inline-flex min-w-max items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onclick={() => void toggleThreadedMode()}
                class={[
                  'transition',
                  threadedMode ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'
                ]}
                aria-pressed={threadedMode}
                title={threadedMode ? 'Show individual messages' : 'Show threads'}
                aria-label={threadedMode ? 'Show individual messages' : 'Show threads'}
              >
                <Mails size={15} />
              </button>
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
              <button
                type="button"
                onclick={() => void summarizeRecentMail()}
                disabled={summarizing}
                class={[
                  'transition disabled:cursor-not-allowed disabled:opacity-40',
                  recentSummary || summarizing
                    ? 'text-sky-300'
                    : 'text-zinc-600 hover:text-zinc-400'
                ]}
                title="Summarize recent mail"
                aria-label="Summarize recent mail"
              >
                <Sparkles size={15} />
              </button>
              <div
                class="inline-flex shrink-0 items-center rounded-xl border border-transparent bg-white/3 p-1 text-xs md:border-white/8 md:text-sm"
              >
                <button
                  type="button"
                  class={[
                    'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
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
                    'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                    activeFilter === 'unread' ? 'bg-white/8 text-white' : 'text-zinc-400'
                  ]}
                  onclick={() => (activeFilter = 'unread')}
                >
                  Unread
                </button>
                <button
                  type="button"
                  class={[
                    'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                    activeFilter === 'starred' ? 'bg-white/8 text-white' : 'text-zinc-400'
                  ]}
                  onclick={() => (activeFilter = 'starred')}
                >
                  <Star size={14} fill={activeFilter === 'starred' ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  class={[
                    'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition sm:px-3',
                    activeFilter === 'pinned' ? 'bg-white/8 text-white' : 'text-zinc-400'
                  ]}
                  onclick={() => (activeFilter = 'pinned')}
                >
                  <Pin size={14} fill={activeFilter === 'pinned' ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {#if isDesktop || mobileSearchOpen || searchQuery.trim().length > 0}
          <div class="relative mt-3 flex md:mt-4">
            <label class="min-w-0 flex-1">
              <span class="sr-only">Search messages</span>
              <input
                bind:value={searchQuery}
                type="search"
                placeholder="Search"
                onfocus={onSearchFocus}
                onblur={onSearchBlur}
                class={listSearchInputClass}
              />
            </label>
            <button
              type="button"
              onclick={() => (showSavedSearchMenu = !showSavedSearchMenu)}
              aria-label="Saved searches"
              title="Saved searches"
              class="grid w-11 place-items-center rounded-r-xl border border-transparent border-l-white/8 bg-black/30 text-zinc-300 hover:bg-white/8 md:border-white/8"
            >
              <Bookmark size={15} />
            </button>
            {#if showSavedSearchMenu}
              <div
                class="absolute top-full right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl shadow-black/30"
              >
                <div class="border-b border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                  Saved searches
                </div>
                {#if savedSearches.length > 0}
                  {#each savedSearches as savedSearch (savedSearch.id)}
                    <div class="flex items-start gap-1 px-1 py-1 hover:bg-white/6">
                      <button
                        type="button"
                        onclick={() => selectSavedSearch(savedSearch)}
                        class="min-w-0 flex-1 rounded-lg px-2 py-1 text-left"
                        title={savedSearch.query}
                      >
                        <span class="block truncate text-sm font-medium text-zinc-200">
                          {savedSearch.name}
                        </span>
                        <span class="block truncate text-xs text-zinc-500">{savedSearch.query}</span
                        >
                      </button>
                      <button
                        type="button"
                        onclick={() => void renameSavedSearch(savedSearch)}
                        class="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-white/8 hover:text-zinc-200"
                      >
                        Rename
                      </button>
                    </div>
                  {/each}
                {:else}
                  <p class="px-3 py-3 text-sm text-zinc-500">No saved searches yet.</p>
                {/if}
                {#if searchQuery.trim()}
                  <div class="border-t border-white/8 p-2">
                    <button
                      type="button"
                      onclick={() => void saveCurrentSearch()}
                      disabled={savingSearch}
                      class="w-full rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {savingSearch ? 'Saving...' : 'Save current search'}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
            {#if showSearchAutocomplete}
              <div
                class="absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-xl shadow-black/20"
              >
                {#if searchInputFocused && syntaxSuggestions.length > 0}
                  <div class="border-b border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                    Search syntax
                  </div>
                  {#each syntaxSuggestions as suggestion (suggestion.value)}
                    <button
                      type="button"
                      onclick={() => selectSyntaxSuggestion(suggestion)}
                      class="block w-full px-3 py-2 text-left hover:bg-white/6"
                    >
                      <span class="font-mono text-sm text-zinc-200">{suggestion.value}</span>
                      <span class="ml-2 text-xs text-zinc-500">{suggestion.description}</span>
                    </button>
                  {/each}
                {/if}
                {#if showContactSuggestions && contactSuggestions.length > 0}
                  <div class="border-y border-white/8 px-3 py-2 text-xs font-medium text-zinc-500">
                    Contacts
                  </div>
                  {#each contactSuggestions as contact (contact.id)}
                    <button
                      type="button"
                      onclick={() => selectContactSuggestion(contact)}
                      class="block w-full px-3 py-2 text-left text-sm hover:bg-white/6"
                    >
                      <span class="block truncate font-medium text-zinc-200">
                        {contact.name || contact.email}
                      </span>
                      {#if contact.name}
                        <span class="block truncate text-xs text-zinc-500">{contact.email}</span>
                      {/if}
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if recentSummary !== null || summarizing}
          <div class="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <Sparkles size={14} class="shrink-0 text-sky-300" />
                <p class="truncate text-xs font-semibold text-zinc-200">Recent summary</p>
              </div>
              {#if recentSummary}
                <button
                  type="button"
                  onclick={() => {
                    recentSummary = null
                  }}
                  class="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Hide
                </button>
              {/if}
            </div>
            {#if recentSummary}
              <div class="mt-2 text-xs leading-5 whitespace-pre-wrap text-zinc-300">
                {recentSummary}
              </div>
              {#if summarizing}
                <p class="mt-2 text-xs text-zinc-500">Summarizing…</p>
              {/if}
            {:else if summarizing}
              <p class="mt-2 text-xs text-zinc-500">Summarizing…</p>
            {/if}
          </div>
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
            {#if currentMailboxRole !== 'spam'}
              <button
                type="button"
                title="Move to spam"
                onclick={() => void bulkAction('spam')}
                disabled={bulkActionPending}
                class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
              >
                <ShieldAlert size={13} /> Spam
              </button>
            {/if}
            <button
              type="button"
              title="Snooze"
              onclick={() => void bulkAction('snooze')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <Clock size={13} /> Snooze
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
            <button
              type="button"
              title="Mark unread"
              onclick={() => void bulkAction('mark_unread')}
              disabled={bulkActionPending}
              class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/8 disabled:opacity-50"
            >
              <Mail size={13} /> Mark unread
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
            <div class={listContainerClass}>
              {#each searchResults as message, index (message.id)}
                <div
                  class="group relative overflow-hidden rounded-2xl md:rounded-none"
                  use:registerRow={{ id: message.id, map: rowEls }}
                >
                  <div
                    class={mobileSwipeActionBackgroundClass(
                      message,
                      'left',
                      'pointer-events-none absolute inset-y-0 right-1/2 left-0 flex items-center gap-2 px-5 text-xs font-semibold transition-opacity md:hidden'
                    )}
                  >
                    <Archive size={15} />
                    {mobileSwipeBackgroundLabel(message, 'left')}
                  </div>
                  <div
                    class={mobileSwipeActionBackgroundClass(
                      message,
                      'right',
                      'pointer-events-none absolute inset-y-0 right-0 left-1/2 flex items-center gap-2 px-5 text-xs font-semibold transition-opacity md:hidden'
                    )}
                  >
                    {mobileSwipeBackgroundLabel(message, 'right')}
                    {#if mobileSwipeActionFor(message) === 'trash'}
                      <Trash2 size={15} />
                    {:else}
                      <MailOpen size={15} />
                    {/if}
                  </div>
                  <!-- Checkbox -->
                  <button
                    type="button"
                    aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
                    onclick={(e) => {
                      e.stopPropagation()
                      toggleSelection(message.id, index, e.shiftKey)
                    }}
                    class={[
                      'absolute top-1/2 left-2 z-20 -translate-y-1/2 transition',
                      selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    ].join(' ')}
                  >
                    {#if selectedIds.has(message.id)}
                      <CheckSquare size={16} class="text-blue-400" />
                    {:else}
                      <Square size={16} class="text-zinc-600" />
                    {/if}
                  </button>
                  <div class="absolute top-3 right-3 z-30 flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={message.threadStarred ? 'Unstar thread' : 'Star thread'}
                      title={message.threadStarred ? 'Unstar thread' : 'Star thread'}
                      onclick={(event) =>
                        void toggleThreadMetadata(event, message, 'threadStarred')}
                      class={[
                        'rounded-md p-1 transition hover:bg-white/8',
                        message.threadStarred
                          ? 'text-amber-300'
                          : 'text-zinc-600 hover:text-zinc-300'
                      ]}
                    >
                      <Star size={14} fill={message.threadStarred ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      aria-label={message.threadPinned ? 'Unpin thread' : 'Pin thread'}
                      title={message.threadPinned ? 'Unpin thread' : 'Pin thread'}
                      onclick={(event) => void toggleThreadMetadata(event, message, 'threadPinned')}
                      class={[
                        'rounded-md p-1 transition hover:bg-white/8',
                        message.threadPinned ? 'text-sky-300' : 'text-zinc-600 hover:text-zinc-300'
                      ]}
                    >
                      <Pin size={14} fill={message.threadPinned ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <button
                    type="button"
                    class={[
                      rowBaseClass,
                      selectedMessageId === message.id
                        ? selectedMessageRowClass
                        : 'hover:bg-white/3'
                    ].join(' ')}
                    style={mobileSwipeRowStyle(message)}
                    onclick={() => selectMessageFromRow(message)}
                    oncontextmenu={(event) => openContextMenu(event, message, index)}
                    onpointerdown={(event) => handleMobileSwipePointerDown(event, message)}
                    onpointermove={handleMobileSwipePointerMove}
                    onpointerup={(event) => handleMobileSwipePointerUp(event, message)}
                    onpointercancel={handleMobileSwipePointerCancel}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <p
                            class={[
                              'truncate text-sm',
                              isUnread(message.flags, message.hasUnread)
                                ? 'font-semibold text-white'
                                : 'text-zinc-300'
                            ]}
                          >
                            {senderName(message.from)}
                          </p>
                          {#if isUnread(message.flags, message.hasUnread)}
                            <span class="h-2 w-2 rounded-full bg-sky-400"></span>
                          {/if}
                          {#if message.hasThreadNote}
                            <span
                              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-200"
                              title="Private note"
                              aria-label="Thread has a private note"
                            >
                              <StickyNote size={11} />
                            </span>
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
                      <p class={previewClass}>
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
          <div class={listContainerClass}>
            {#each visibleMessages as message, index (message.id)}
              <div
                class="group relative overflow-hidden rounded-2xl md:rounded-none"
                use:registerRow={{ id: message.id, map: rowEls }}
              >
                <div
                  class={mobileSwipeActionBackgroundClass(
                    message,
                    'left',
                    'pointer-events-none absolute inset-y-0 right-1/2 left-0 flex items-center gap-2 px-5 text-xs font-semibold transition-opacity md:hidden'
                  )}
                >
                  <Archive size={15} />
                  {mobileSwipeBackgroundLabel(message, 'left')}
                </div>
                <div
                  class={mobileSwipeActionBackgroundClass(
                    message,
                    'right',
                    'pointer-events-none absolute inset-y-0 right-0 left-1/2 flex items-center gap-2 px-5 text-xs font-semibold transition-opacity md:hidden'
                  )}
                >
                  {mobileSwipeBackgroundLabel(message, 'right')}
                  {#if mobileSwipeActionFor(message) === 'trash'}
                    <Trash2 size={15} />
                  {:else}
                    <MailOpen size={15} />
                  {/if}
                </div>
                <!-- Checkbox -->
                <button
                  type="button"
                  aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
                  onclick={(e) => {
                    e.stopPropagation()
                    toggleSelection(message.id, index, e.shiftKey)
                  }}
                  class={[
                    'absolute top-1/2 left-2 z-20 -translate-y-1/2 transition',
                    selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  ].join(' ')}
                >
                  {#if selectedIds.has(message.id)}
                    <CheckSquare size={16} class="text-blue-400" />
                  {:else}
                    <Square size={16} class="text-zinc-600" />
                  {/if}
                </button>
                <div class="absolute top-3 right-3 z-30 flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={message.threadStarred ? 'Unstar thread' : 'Star thread'}
                    title={message.threadStarred ? 'Unstar thread' : 'Star thread'}
                    onclick={(event) => void toggleThreadMetadata(event, message, 'threadStarred')}
                    class={[
                      'rounded-md p-1 transition hover:bg-white/8',
                      message.threadStarred ? 'text-amber-300' : 'text-zinc-600 hover:text-zinc-300'
                    ]}
                  >
                    <Star size={14} fill={message.threadStarred ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    aria-label={message.threadPinned ? 'Unpin thread' : 'Pin thread'}
                    title={message.threadPinned ? 'Unpin thread' : 'Pin thread'}
                    onclick={(event) => void toggleThreadMetadata(event, message, 'threadPinned')}
                    class={[
                      'rounded-md p-1 transition hover:bg-white/8',
                      message.threadPinned ? 'text-sky-300' : 'text-zinc-600 hover:text-zinc-300'
                    ]}
                  >
                    <Pin size={14} fill={message.threadPinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <button
                  type="button"
                  class={messageRowClass(message, index)}
                  style={mobileSwipeRowStyle(message)}
                  onclick={() => selectMessageFromRow(message)}
                  oncontextmenu={(event) => openContextMenu(event, message, index)}
                  onpointerdown={(event) => handleMobileSwipePointerDown(event, message)}
                  onpointermove={handleMobileSwipePointerMove}
                  onpointerup={(event) => handleMobileSwipePointerUp(event, message)}
                  onpointercancel={handleMobileSwipePointerCancel}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p
                          class={[
                            'truncate text-sm',
                            isUnread(message.flags, message.hasUnread)
                              ? 'font-semibold text-white'
                              : 'text-zinc-300'
                          ]}
                        >
                          {senderName(message.from)}
                        </p>
                        {#if isUnread(message.flags, message.hasUnread)}
                          <span class="h-2 w-2 rounded-full bg-sky-400"></span>
                        {/if}
                        {#if threadedMode && message.threadCount && message.threadCount > 1}
                          <span
                            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/8 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-zinc-500"
                            title={`${message.threadCount} messages in thread`}
                            aria-label={`${message.threadCount} messages in thread`}
                          >
                            <Mails size={11} />
                            {message.threadCount}
                          </span>
                        {/if}
                        {#if message.hasThreadNote}
                          <span
                            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-200"
                            title="Private note"
                            aria-label="Thread has a private note"
                          >
                            <StickyNote size={11} />
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
                    <p class={previewClass}>
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
    <!-- A focusable separator is the WAI-ARIA "window splitter" pattern; the
         checker classifies role="separator" as non-interactive (false positive). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize message list"
      aria-controls="message-list-pane"
      aria-valuemin={5}
      aria-valuemax={95}
      aria-valuenow={Math.round(listRatio * 100)}
      tabindex="0"
      class="group relative z-10 hidden w-2 shrink-0 cursor-col-resize md:block"
      onpointerdown={startResize}
      onkeydown={onHandleKeydown}
      ondblclick={resetListRatio}
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

<ErrorDialog
  message={errorDialogMessage}
  title="Mailbox error"
  onclose={() => (errorDialogMessage = null)}
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
    inputType={actionModal.inputType}
    onconfirm={(value) => closeActionModal(value ?? true)}
    oncancel={() => closeActionModal(null)}
  />
{/if}
