<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { pathToSlug } from '$lib/mailbox'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { RefreshCw, CheckSquare, Square, Archive, Trash2, MailOpen, ShieldAlert, X, Layers } from 'lucide-svelte'
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
    uid: number
    subject: string | null
    from: string | null
    to: string | null
    preview: string | null
    textContent: string | null
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
      messages: Message[]
      hasMore: boolean
      pageSize: number
      imapMailboxes: ImapMailbox[]
    }
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()

  const sync = $derived(data.sync)
  const pageSize = $derived(data.pageSize)
  const mailbox = $derived(page.params.mailbox ?? 'inbox')
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

  let messages = $state<Message[]>([])
  let hasMore = $state(false)
  let isLoadingMore = $state(false)
  let loadMoreError = $state<string | null>(null)
  let searchQuery = $state('')
  let activeFilter = $state<'all' | 'unread'>('all')
  let sentinel = $state<HTMLDivElement | null>(null)
  let loadedCount = 0
  let syncRequestId = 0

  let searchResults = $state<Message[]>([])
  let isSearching = $state(false)
  let searchRequestId = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  // Bulk selection
  let selectedIds = $state(new Set<number>())
  const selectionMode = $derived(selectedIds.size > 0)
  let bulkActionPending = $state(false)

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

  $effect(() => {
    const query = searchQuery.trim()

    if (searchTimer !== null) {
      clearTimeout(searchTimer)
      searchTimer = null
    }

    if (!query) {
      searchResults = []
      isSearching = false
      return
    }

    isSearching = true
    const requestId = ++searchRequestId

    searchTimer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/messages?q=${encodeURIComponent(query)}&limit=50`
        )
        if (!response.ok) throw new Error('Search failed')

        const payload = (await response.json()) as { messages: Message[] }

        if (requestId !== searchRequestId) return
        searchResults = payload.messages
      } catch {
        if (requestId !== searchRequestId) return
        searchResults = []
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
    const msg = listMessages[idx]
    if (!msg) return
    const el = rowEls.get(msg.id)
    el?.scrollIntoView({ block: 'nearest' })
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

  function previewLabel(
    preview: string | null | undefined,
    textContent: string | null | undefined
  ) {
    return preview || textContent || 'No preview available.'
  }

  function mailboxLabel(mailboxPath: string | undefined) {
    if (!mailboxPath) return ''
    const match = data.imapMailboxes.find((mb) => mb.path === mailboxPath)
    return match?.name ?? mailboxPath
  }

  function messagesUrl(offset: number, limit: number) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      mailbox
    })
    if (threadedMode) params.set('threaded', '1')
    return `/api/messages?${params}`
  }

  async function syncVisibleMessages() {
    const targetCount = Math.max(loadedCount, data.messages.length)

    if (targetCount <= data.messages.length && !threadedMode) {
      messages = data.messages
      hasMore = data.hasMore
      loadedCount = data.messages.length
      loadMoreError = null
      return
    }

    const requestId = ++syncRequestId

    try {
      const response = await fetch(messagesUrl(0, targetCount))
      if (!response.ok) throw new Error('Failed to refresh loaded messages.')

      const payload = (await response.json()) as { messages: Message[]; hasMore: boolean }

      if (requestId !== syncRequestId) return

      messages = payload.messages
      hasMore = payload.hasMore
      loadedCount = payload.messages.length
      loadMoreError = null
    } catch {
      if (requestId !== syncRequestId) return

      messages = data.messages
      hasMore = data.hasMore
      loadedCount = data.messages.length
    }
  }

  async function loadMoreMessages() {
    if (isLoadingMore || !hasMore) return

    isLoadingMore = true
    loadMoreError = null

    try {
      const response = await fetch(messagesUrl(messages.length, pageSize))
      if (!response.ok) throw new Error('Failed to load more messages.')

      const payload = (await response.json()) as { messages: Message[]; hasMore: boolean }

      messages = [...messages, ...payload.messages]
      hasMore = payload.hasMore
      loadedCount = messages.length
    } catch (error) {
      loadMoreError = error instanceof Error ? error.message : 'Failed to load more messages.'
    } finally {
      isLoadingMore = false
    }
  }

  function selectMessage(message: Message) {
    if (!message.flags.includes('\\Seen')) {
      messages = messages.map((m) =>
        m.id === message.id ? { ...m, flags: [...m.flags, '\\Seen'] } : m
      )
    }
    if (threadedMode && message.threadId) {
      goto(resolve(`/${mailbox}/thread/${encodeURIComponent(message.threadId)}`))
    } else {
      goto(resolve(`/${mailbox}/${message.id}`))
    }
  }

  let lastSelectedIndex: number | null = null

  function toggleSelection(id: number, index: number, shiftKey = false) {
    const list = isSearchMode ? searchResults : visibleMessages
    const next = new Set(selectedIds)

    if (shiftKey && lastSelectedIndex !== null) {
      const lo = Math.min(lastSelectedIndex, index)
      const hi = Math.max(lastSelectedIndex, index)
      for (let i = lo; i <= hi; i++) {
        if (list[i]) next.add(list[i].id)
      }
    } else {
      if (next.has(id)) next.delete(id)
      else next.add(id)
      lastSelectedIndex = index
    }

    selectedIds = next
  }

  function selectAll() {
    selectedIds = new Set(listMessages.map((m) => m.id))
  }

  function clearSelection() {
    selectedIds = new Set()
  }

  async function bulkAction(action: string) {
    if (bulkActionPending || selectedIds.size === 0) return
    bulkActionPending = true
    try {
      await fetch('/api/messages/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], action })
      })
      clearSelection()
      await invalidateAll()
    } finally {
      bulkActionPending = false
    }
  }

  $effect(() => {
    void syncVisibleMessages()
  })

  async function toggleThreadedMode() {
    threadedMode = !threadedMode
    messages = []
    loadedCount = 0
    await syncVisibleMessages()
  }

  onMount(() => {
    keyboard.context = 'list'
    keyboard.panel = 'list'

    const intervalMs = refreshIntervalMs
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void invalidateAll()
      }
    }, intervalMs)

    const teardown = setupKeyboardHandler({
      j: () => {
        const next = Math.min(keyboard.focusedIndex + 1, listMessages.length - 1)
        keyboard.focusedIndex = next
        const msg = listMessages[next]
        if (msg) selectMessage(msg)
      },
      ArrowDown: () => {
        const next = Math.min(keyboard.focusedIndex + 1, listMessages.length - 1)
        keyboard.focusedIndex = next
        const msg = listMessages[next]
        if (msg) selectMessage(msg)
      },
      k: () => {
        const next = Math.max(keyboard.focusedIndex - 1, 0)
        keyboard.focusedIndex = next
        const msg = listMessages[next]
        if (msg) selectMessage(msg)
      },
      ArrowUp: () => {
        const next = Math.max(keyboard.focusedIndex - 1, 0)
        keyboard.focusedIndex = next
        const msg = listMessages[next]
        if (msg) selectMessage(msg)
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
      Escape: () => clearSelection()
    })

    return () => {
      clearInterval(interval)
      teardown()
    }
  })

  async function archiveMessage(id: number) {
    await fetch(`/api/messages/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'archive' })
    })
    await invalidateAll()
  }

  async function trashMessage(id: number) {
    await fetch(`/api/messages/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'trash' })
    })
    await invalidateAll()
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

  async function handleRefresh() {
    if (refreshing) return
    refreshing = true
    await invalidateAll()
    await new Promise((r) => setTimeout(r, 600))
    refreshing = false
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

  function messageRowClass(message: Message, index: number) {
    const isFocused = focusedIndex === index && !isSearchMode
    const isSelected = selectedMessageId === message.id
    return [
      'block w-full border-b border-white/8 px-4 py-4 text-left transition sm:px-5',
      isSelected ? 'bg-white/6' : isFocused ? 'bg-white/4 ring-1 ring-inset ring-blue-500/40' : 'hover:bg-white/3'
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
</script>

<svelte:head>
  <title>{folderDisplayName}</title>
</svelte:head>

<div class="flex h-full" class:cursor-col-resize={resizing} class:select-none={resizing}>
  <section
    style="width: {listWidth}px; min-width: {listWidth}px"
    class={[
      'flex flex-col overflow-x-hidden border-r bg-[#0d0d10]',
      keyboard.panel === 'list' ? 'border-blue-500/40' : 'border-white/8'
    ]}
    role="region"
    aria-label="Message list"
  >
    <div class="border-b border-white/8 p-4 sm:p-5">
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold tracking-tight text-white">{folderDisplayName}</h1>
        <div class="flex items-center gap-2">
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
            onclick={() => void toggleThreadedMode()}
            class={[
              'transition',
              threadedMode ? 'text-sky-400' : 'text-zinc-600 hover:text-zinc-400'
            ]}
            title={threadedMode ? 'Threaded view (on)' : 'Threaded view (off)'}
          >
            <Layers size={15} />
          </button>
          <div class="rounded-xl border border-white/8 bg-white/3 p-1 text-sm">
            <button
              type="button"
              class={[
                'rounded-lg px-3 py-1.5 transition',
                activeFilter === 'all' ? 'bg-white/8 text-white' : 'text-zinc-400'
              ]}
              onclick={() => (activeFilter = 'all')}
            >
              All mail
            </button>
            <button
              type="button"
              class={[
                'rounded-lg px-3 py-1.5 transition',
                activeFilter === 'unread' ? 'bg-white/8 text-white' : 'text-zinc-400'
              ]}
              onclick={() => (activeFilter = 'unread')}
            >
              Unread
            </button>
          </div>
        </div>
      </div>

      <label class="mt-4 block">
        <span class="sr-only">Search messages</span>
        <input
          bind:value={searchQuery}
          type="search"
          placeholder="Search"
          class="w-full rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-sky-400/60"
        />
      </label>
    </div>

    <!-- Bulk action toolbar -->
    {#if selectionMode}
      <div class="flex shrink-0 items-center gap-2 border-b border-white/8 bg-[#0d0d10] px-4 py-2">
        <span class="text-xs text-zinc-400">{selectedIds.size} selected</span>
        <div class="flex flex-1 items-center gap-1">
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

    <div class="flex-1 overflow-y-auto">
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
          {#each searchResults as message, index (message.id)}
            <div
              class="group relative"
              use:registerRow={{ id: message.id, map: rowEls }}
            >
              <!-- Checkbox -->
              <button
                type="button"
                aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
                onclick={(e) => { e.stopPropagation(); toggleSelection(message.id, index, e.shiftKey) }}
                class={[
                  'absolute top-1/2 left-2 -translate-y-1/2 z-10 transition',
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
                  'block w-full border-b border-white/8 py-4 text-left transition',
                  selectionMode ? 'pl-9 pr-4 sm:pl-10 sm:pr-5' : 'px-4 sm:px-5',
                  selectedMessageId === message.id ? 'bg-white/6' : 'hover:bg-white/3'
                ].join(' ')}
                onclick={() => selectMessage(message)}
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
                    <p class="text-xs text-zinc-500">{formatRelativeTime(message.receivedAt)}</p>
                    {#if message.mailbox}
                      <p class="rounded bg-white/6 px-1.5 py-0.5 text-xs text-zinc-400">
                        {mailboxLabel(message.mailbox)}
                      </p>
                    {/if}
                  </div>
                </div>

                <p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">
                  {previewLabel(message.preview, message.textContent)}
                </p>
              </button>
            </div>
          {/each}
          <div class="px-4 py-5 text-center text-sm text-zinc-500 sm:px-5">
            {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
          </div>
        {/if}
      {:else}
        {#each visibleMessages as message, index (message.id)}
          <div
            class="group relative"
            use:registerRow={{ id: message.id, map: rowEls }}
          >
            <!-- Checkbox -->
            <button
              type="button"
              aria-label={selectedIds.has(message.id) ? 'Deselect' : 'Select'}
              onclick={(e) => { e.stopPropagation(); toggleSelection(message.id, index, e.shiftKey) }}
              class={[
                'absolute top-1/2 left-2 -translate-y-1/2 z-10 transition',
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
              aria-selected={selectedMessageId === message.id}
              class={messageRowClass(message, index)}
              onclick={() => selectMessage(message)}
            >
              <div class={['flex items-start justify-between gap-3', selectionMode ? 'pl-5' : ''].join(' ')}>
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
                      <span class="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-zinc-400">
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

              <p class={['mt-3 line-clamp-2 text-sm leading-6 text-zinc-400', selectionMode ? 'pl-5' : ''].join(' ')}>
                {previewLabel(message.preview, message.textContent)}
              </p>
            </button>
          </div>
        {:else}
          <div class="p-8 text-center">
            <p class="text-lg font-semibold text-white">No messages found</p>
            <p class="mt-2 text-sm text-zinc-500">Wait for the next sync.</p>
          </div>
        {/each}

        {#if visibleMessages.length > 0}
          <div class="px-4 py-5 sm:px-5">
            {#if loadMoreError}
              <p class="text-sm text-rose-300">{loadMoreError}</p>
            {/if}

            {#if hasMore}
              <div bind:this={sentinel} class="h-1 w-full"></div>
              <div class="flex justify-center">
                <button
                  type="button"
                  class="rounded-xl border border-white/8 bg-white/3 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-60"
                  onclick={() => void loadMoreMessages()}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
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
    class="group relative z-10 w-2 shrink-0 cursor-col-resize"
    onpointerdown={startResize}
  >
    <div
      class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-white/25"
    ></div>
  </div>

  <section class="min-w-0 flex-1 overflow-hidden bg-[#0b0b0e]">
    {@render children()}
  </section>
</div>

