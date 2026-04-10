<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';

	type SyncData = {
		mailbox: string;
		configured: boolean;
		skipped: boolean;
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
		};
	};

	let { data }: Props = $props();

	const sync = $derived(data.sync);
	const messages = $derived(data.messages);
	const refreshIntervalMs = $derived.by(() => {
		if (!sync.configured) return 60_000;
		if (sync.lastError) return 15_000;
		return 15_000;
	});

	const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	const timeFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatDateTime(value: string | null | undefined) {
		if (!value) return 'Never';
		return dateTimeFormatter.format(new Date(value));
	}

	function formatMessageTime(value: string | null) {
		if (!value) return 'Unknown';
		return timeFormatter.format(new Date(value));
	}

	function isUnread(flags: string[] = []) {
		return !flags.includes('\\Seen');
	}

	function senderLabel(from: string | null | undefined) {
		if (!from) return 'Unknown sender';
		return from;
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

	onMount(() => {
		const intervalMs = refreshIntervalMs;
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void invalidateAll();
			}
		}, intervalMs);

		return () => clearInterval(interval);
	});
</script>

<svelte:head>
	<title>Inbox</title>
</svelte:head>

<div class="min-h-screen bg-slate-950 text-slate-100">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		<section
			class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-black/20"
		>
			<div class="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
				<div class="space-y-3">
					<div class="flex flex-wrap items-center gap-3">
						<p class="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Mailbox</p>
						{#if !sync.configured}
							<span
								class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300"
							>
								Configuration missing
							</span>
						{/if}
					</div>

					<div>
						<h1 class="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
							{sync.mailbox}
						</h1>
						<p class="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
							Last synced {formatDateTime(sync.lastSyncedAt)}
							{#if sync.reason}
								<span class="text-slate-500">· {sync.reason}</span>
							{/if}
						</p>
					</div>

					{#if sync.lastError}
						<div
							class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
						>
							<p class="font-medium text-rose-100">Sync error</p>
							<p class="mt-1 break-words text-rose-200/90">{sync.lastError}</p>
						</div>
					{/if}
				</div>

				<div class="grid min-w-full grid-cols-2 gap-3 sm:min-w-80">
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
						<p class="text-xs tracking-wide text-slate-500 uppercase">Fetched</p>
						<p class="mt-2 text-2xl font-semibold text-white">{sync.fetchedCount}</p>
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
						<p class="text-xs tracking-wide text-slate-500 uppercase">Stored</p>
						<p class="mt-2 text-2xl font-semibold text-white">{sync.storedCount}</p>
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
						<p class="text-xs tracking-wide text-slate-500 uppercase">Status</p>
						<p class="mt-2 text-sm font-medium text-slate-200">
							{#if sync.skipped}
								Skipped
							{:else}
								Synced
							{/if}
						</p>
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
						<p class="text-xs tracking-wide text-slate-500 uppercase">Refresh</p>
						<p class="mt-2 text-sm font-medium text-slate-200">
							{Math.round(refreshIntervalMs / 1000)}s
						</p>
					</div>
				</div>
			</div>
		</section>

		<section class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
			<div class="border-b border-slate-800 px-5 py-4 sm:px-6">
				<div class="flex items-center justify-between gap-4">
					<div>
						<h2 class="text-lg font-semibold text-white">Messages</h2>
						<p class="mt-1 text-sm text-slate-400">Latest stored mail in your inbox.</p>
					</div>
					<p class="text-sm text-slate-500">{messages.length} total</p>
				</div>
			</div>

			<div class="divide-y divide-slate-800">
				{#each messages as message (message.id)}
					<article
						class="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-800/40 sm:px-6"
					>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h3
										class={[
											'text-base leading-6 text-white',
											isUnread(message.flags) ? 'font-semibold' : 'font-medium text-slate-200'
										]}
									>
										{subjectLabel(message.subject)}
									</h3>

									{#if isUnread(message.flags)}
										<span
											class="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-sky-300 uppercase"
										>
											New
										</span>
									{/if}
								</div>

								<p class="mt-1 truncate text-sm text-slate-400">{senderLabel(message.from)}</p>
							</div>

							<p class="shrink-0 text-sm text-slate-500">{formatMessageTime(message.receivedAt)}</p>
						</div>

						<p class="text-sm leading-6 text-slate-300">
							{previewLabel(message.preview, message.textContent)}
						</p>
					</article>
				{:else}
					<div class="flex flex-col items-center justify-center px-6 py-16 text-center">
						<div class="rounded-full border border-slate-800 bg-slate-950/80 p-4 text-slate-400">
							✉️
						</div>
						<h3 class="mt-5 text-lg font-semibold text-white">No messages yet</h3>
						<p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
							Stored inbox messages will appear here after the first successful sync.
						</p>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>
