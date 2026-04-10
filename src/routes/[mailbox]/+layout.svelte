<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	type SyncData = {
		mailbox: string;
		configured: boolean;
		skipped: boolean;
		syncing?: boolean;
		fetchedCount: number;
		storedCount: number;
		lastSyncedAt: string | null;
		lastError: string | null;
		reason?: string;
	};

	type Message = {
		id: string;
		uid: number;
		subject: string | null;
		from: string | null;
		to: string | null;
		preview: string | null;
		textContent: string | null;
		flags: string[];
		receivedAt: string | null;
	};

	type Props = {
		data: {
			sync: SyncData;
			messages: Message[];
			hasMore: boolean;
			pageSize: number;
		};
		children: import('svelte').Snippet;
	};

	let { data, children }: Props = $props();

	const sync = $derived(data.sync);
	const pageSize = $derived(data.pageSize);
	const mailbox = $derived(page.params.mailbox ?? 'inbox');
	const selectedMessageId = $derived(page.params.id ?? null);

	const refreshIntervalMs = $derived.by(() => {
		if (!sync.configured) return 60_000;
		if (sync.lastError) return 15_000;
		return 15_000;
	});

	let messages = $state<Message[]>([]);
	let hasMore = $state(false);
	let isLoadingMore = $state(false);
	let loadMoreError = $state<string | null>(null);
	let searchQuery = $state('');
	let activeFilter = $state<'all' | 'unread'>('all');
	let sentinel = $state<HTMLDivElement | null>(null);
	let loadedCount = 0;
	let syncRequestId = 0;

	const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

	const unsyncedFolders = new Set(['drafts', 'sent', 'junk', 'trash', 'archive']);

	const folderDisplayName = $derived.by(() => {
		const names: Record<string, string> = {
			inbox: 'Inbox',
			drafts: 'Drafts',
			sent: 'Sent',
			junk: 'Junk',
			trash: 'Trash',
			archive: 'Archive',
			unread: 'Unread',
			flagged: 'Flagged',
			'all-mail': 'All Mail'
		};
		return names[mailbox] ?? mailbox;
	});

	const primaryMailboxes = $derived([
		{ label: 'Inbox', slug: 'inbox', count: messages.length },
		{ label: 'Drafts', slug: 'drafts', count: 0 },
		{ label: 'Sent', slug: 'sent', count: 0 },
		{ label: 'Junk', slug: 'junk', count: 0 },
		{ label: 'Trash', slug: 'trash', count: 0 },
		{ label: 'Archive', slug: 'archive', count: 0 }
	]);

	const visibleMessages = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();

		return messages.filter((message) => {
			if (unsyncedFolders.has(mailbox)) return false;
			if (mailbox === 'unread' && !isUnread(message.flags)) return false;
			if (mailbox === 'flagged' && !message.flags.includes('\\Flagged')) return false;
			if (
				(mailbox === 'inbox' || mailbox === 'all-mail') &&
				activeFilter === 'unread' &&
				!isUnread(message.flags)
			)
				return false;

			if (!query) return true;

			const haystack = [
				senderLabel(message.from),
				subjectLabel(message.subject),
				previewLabel(message.preview, message.textContent)
			]
				.join(' ')
				.toLowerCase();

			return haystack.includes(query);
		});
	});

	function formatRelativeTime(value: string | null | undefined) {
		if (!value) return 'Unknown';

		const diffMs = new Date(value).getTime() - Date.now();
		const minute = 60_000;
		const hour = 60 * minute;
		const day = 24 * hour;
		const month = 30 * day;
		const year = 365 * day;

		if (Math.abs(diffMs) >= year) return relativeFormatter.format(Math.round(diffMs / year), 'year');
		if (Math.abs(diffMs) >= month)
			return relativeFormatter.format(Math.round(diffMs / month), 'month');
		if (Math.abs(diffMs) >= day) return relativeFormatter.format(Math.round(diffMs / day), 'day');
		if (Math.abs(diffMs) >= hour) return relativeFormatter.format(Math.round(diffMs / hour), 'hour');
		return relativeFormatter.format(Math.round(diffMs / minute), 'minute');
	}

	function isUnread(flags: string[] = []) {
		return !flags.includes('\\Seen');
	}

	function senderLabel(from: string | null | undefined) {
		if (!from) return 'Unknown sender';
		return from;
	}

	function senderName(from: string | null | undefined) {
		const label = senderLabel(from);
		return label.split('<')[0]?.trim() || label;
	}

	function subjectLabel(subject: string | null | undefined) {
		if (!subject) return '(no subject)';
		return subject;
	}

	function previewLabel(
		preview: string | null | undefined,
		textContent: string | null | undefined
	) {
		return preview || textContent || 'No preview available.';
	}

	async function syncVisibleMessages() {
		const targetCount = Math.max(loadedCount, data.messages.length);

		if (targetCount <= data.messages.length) {
			messages = data.messages;
			hasMore = data.hasMore;
			loadedCount = data.messages.length;
			loadMoreError = null;
			return;
		}

		const requestId = ++syncRequestId;

		try {
			const response = await fetch(`/api/messages?offset=0&limit=${targetCount}`);
			if (!response.ok) throw new Error('Failed to refresh loaded messages.');

			const payload = (await response.json()) as { messages: Message[]; hasMore: boolean };

			if (requestId !== syncRequestId) return;

			messages = payload.messages;
			hasMore = payload.hasMore;
			loadedCount = payload.messages.length;
			loadMoreError = null;
		} catch {
			if (requestId !== syncRequestId) return;

			messages = data.messages;
			hasMore = data.hasMore;
			loadedCount = data.messages.length;
		}
	}

	async function loadMoreMessages() {
		if (isLoadingMore || !hasMore) return;

		isLoadingMore = true;
		loadMoreError = null;

		try {
			const response = await fetch(`/api/messages?offset=${messages.length}&limit=${pageSize}`);
			if (!response.ok) throw new Error('Failed to load more messages.');

			const payload = (await response.json()) as { messages: Message[]; hasMore: boolean };

			messages = [...messages, ...payload.messages];
			hasMore = payload.hasMore;
			loadedCount = messages.length;
		} catch (error) {
			loadMoreError = error instanceof Error ? error.message : 'Failed to load more messages.';
		} finally {
			isLoadingMore = false;
		}
	}

	function selectMessage(message: Message) {
		goto(`/${mailbox}/${message.id}`);
	}

	$effect(() => {
		void syncVisibleMessages();
	});

	onMount(() => {
		const intervalMs = refreshIntervalMs;
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void invalidateAll();
			}
		}, intervalMs);

		return () => clearInterval(interval);
	});

	$effect(() => {
		if (!sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					void loadMoreMessages();
				}
			},
			{ rootMargin: '200px 0px' }
		);

		observer.observe(sentinel);

		return () => observer.disconnect();
	});

	function readStorage(key: string, fallback: number): number {
		if (typeof window === 'undefined') return fallback;
		try {
			const raw = localStorage.getItem(key);
			const parsed = raw !== null ? Number(raw) : NaN;
			return Number.isFinite(parsed) ? parsed : fallback;
		} catch {
			return fallback;
		}
	}

	let sidebarWidth = $state(readStorage('mail:sidebarWidth', 260));
	let listWidth = $state(readStorage('mail:listWidth', 440));
	let resizing = $state(false);

	function startResize(e: PointerEvent, col: 'sidebar' | 'list') {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startWidth = col === 'sidebar' ? sidebarWidth : listWidth;

		function onMove(ev: PointerEvent) {
			const next = startWidth + (ev.clientX - startX);
			if (col === 'sidebar') {
				sidebarWidth = Math.max(150, Math.min(400, next));
			} else {
				listWidth = Math.max(240, Math.min(700, next));
			}
		}

		function onUp() {
			resizing = false;
			localStorage.setItem('mail:sidebarWidth', String(sidebarWidth));
			localStorage.setItem('mail:listWidth', String(listWidth));
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

<svelte:head>
	<title>{folderDisplayName}</title>
</svelte:head>

<div class="h-screen overflow-hidden text-zinc-100" class:cursor-col-resize={resizing} class:select-none={resizing}>
	<div class="flex h-full bg-[#0d0d10]">
		<aside style="width: {sidebarWidth}px; min-width: {sidebarWidth}px" class="bg-[#0a0a0d]">
			<div class="grid gap-6 p-3 sm:p-4">
				<nav class="space-y-1.5">
					{#each primaryMailboxes as mb (mb.slug)}
						<a
							href="/{mb.slug}"
							class={[
								'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition',
								mailbox === mb.slug
									? 'bg-white/[0.08] font-medium text-white'
									: 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
							]}
						>
							<span>{mb.label}</span>
							<span class="text-xs text-zinc-500">{mb.count}</span>
						</a>
					{/each}
				</nav>
			</div>
		</aside>

		<!-- Resize handle: sidebar ↔ list -->
		<div
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			class="group relative z-10 w-2 shrink-0 cursor-col-resize"
			onpointerdown={(e) => startResize(e, 'sidebar')}
		>
			<div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-white/25"></div>
		</div>

		<section style="width: {listWidth}px; min-width: {listWidth}px" class="flex flex-col overflow-x-hidden">
			<div class="border-b border-white/8 p-4 sm:p-5">
				<div class="flex items-center justify-between gap-3">
					<h1 class="text-2xl font-semibold tracking-tight text-white">{folderDisplayName}</h1>
					<div class="rounded-xl border border-white/8 bg-white/[0.03] p-1 text-sm">
						<button
							type="button"
							class={[
								'rounded-lg px-3 py-1.5 transition',
								activeFilter === 'all' ? 'bg-white/[0.08] text-white' : 'text-zinc-400'
							]}
							onclick={() => (activeFilter = 'all')}
						>
							All mail
						</button>
						<button
							type="button"
							class={[
								'rounded-lg px-3 py-1.5 transition',
								activeFilter === 'unread' ? 'bg-white/[0.08] text-white' : 'text-zinc-400'
							]}
							onclick={() => (activeFilter = 'unread')}
						>
							Unread
						</button>
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

			<div class="flex-1 overflow-y-auto">
				{#each visibleMessages as message (message.id)}
					<button
						type="button"
						class={[
							'block w-full border-b border-white/8 px-4 py-4 text-left transition sm:px-5',
							selectedMessageId === message.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
						]}
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

							<p class="shrink-0 text-xs text-zinc-500">
								{formatRelativeTime(message.receivedAt)}
							</p>
						</div>

						<p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">
							{previewLabel(message.preview, message.textContent)}
						</p>

						<div class="mt-3 flex flex-wrap gap-2">
							<span class="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-zinc-300">
								{isUnread(message.flags) ? 'unread' : 'read'}
							</span>
							{#if message.textContent}
								<span
									class="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-zinc-300"
								>
									text
								</span>
							{/if}
						</div>
					</button>
				{:else}
					<div class="p-8 text-center">
						<p class="text-lg font-semibold text-white">
							{unsyncedFolders.has(mailbox) ? 'Not synced yet' : 'No messages found'}
						</p>
						<p class="mt-2 text-sm text-zinc-500">
							{unsyncedFolders.has(mailbox)
								? `${folderDisplayName} syncing is not set up yet.`
								: 'Try a different search or wait for the next sync.'}
						</p>
					</div>
				{/each}

				{#if visibleMessages.length > 0 && !unsyncedFolders.has(mailbox)}
					<div class="px-4 py-5 sm:px-5">
						{#if loadMoreError}
							<p class="text-sm text-rose-300">{loadMoreError}</p>
						{/if}

						{#if hasMore}
							<div bind:this={sentinel} class="h-1 w-full"></div>
							<div class="flex justify-center">
								<button
									type="button"
									class="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
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
			</div>
		</section>

		<!-- Resize handle: list ↔ detail -->
		<div
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			class="group relative z-10 w-2 shrink-0 cursor-col-resize"
			onpointerdown={(e) => startResize(e, 'list')}
		>
			<div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-white/25"></div>
		</div>

		<section class="min-w-0 flex-1 overflow-hidden bg-[#0b0b0e]">
			{@render children()}
		</section>
	</div>
</div>
