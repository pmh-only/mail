<script lang="ts">
	type Message = {
		id: string;
		uid: number;
		subject: string | null;
		from: string | null;
		to: string | null;
		preview: string | null;
		htmlContent: string | null;
		textContent: string | null;
		flags: string[];
		receivedAt: string | null;
	};

	type Props = {
		data: { message: Message };
	};

	let { data }: Props = $props();

	const message = $derived(data.message);

	let replyText = $state('');
	let mutedThread = $state(false);
	let draftNotice = $state<string | null>(null);

	const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatFullDate(value: string | null | undefined) {
		if (!value) return 'Unknown';
		return fullDateFormatter.format(new Date(value));
	}

	function senderLabel(from: string | null | undefined) {
		if (!from) return 'Unknown sender';
		return from;
	}

	function senderName(from: string | null | undefined) {
		const label = senderLabel(from);
		return label.split('<')[0]?.trim() || label;
	}

	function senderInitials(from: string | null | undefined) {
		const words = senderName(from).split(/\s+/).filter(Boolean).slice(0, 2);
		return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || 'NA';
	}

	function subjectLabel(subject: string | null | undefined) {
		if (!subject) return '(no subject)';
		return subject;
	}

	function bodyText(msg: Message) {
		return msg.textContent || msg.preview || 'No message body available.';
	}

	function sendReply() {
		if (!replyText.trim()) return;
		draftNotice = 'Reply drafted locally.';
		replyText = '';
	}
</script>

<svelte:head>
	<title>{subjectLabel(message.subject)} · Inbox</title>
</svelte:head>

<div class="flex h-full flex-col">
	<div class="border-b border-white/8 p-4 sm:p-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
				>
					Archive
				</button>
				<button
					type="button"
					class="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
				>
					Delete
				</button>
				<button
					type="button"
					class="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
				>
					Later
				</button>
			</div>
		</div>
	</div>

	<div class="border-b border-white/8 p-4 sm:p-5">
		<div class="flex items-start justify-between gap-4">
			<div class="flex min-w-0 gap-3">
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-zinc-200"
				>
					{senderInitials(message.from)}
				</div>

				<div class="min-w-0">
					<h2 class="truncate text-xl font-semibold text-white">
						{subjectLabel(message.subject)}
					</h2>
					<p class="mt-1 truncate text-sm font-medium text-zinc-200">
						{senderName(message.from)}
					</p>
					<p class="mt-1 text-sm text-zinc-500">
						Reply-To: {senderLabel(message.from)}
					</p>
				</div>
			</div>

			<p class="shrink-0 text-sm text-zinc-500">
				{formatFullDate(message.receivedAt)}
			</p>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
			{#if message.htmlContent}
				<iframe
					title={`Email body for ${subjectLabel(message.subject)}`}
					sandbox=""
					srcdoc={message.htmlContent}
					class="block h-full w-full bg-white"
				></iframe>
			{:else}
			<div class="space-y-6 p-4 text-[15px] leading-8 text-zinc-200">
			{#each bodyText(message)
				.split(/\n{2,}/)
				.filter(Boolean) as paragraph, index (`${message.id}-${index}`)}
				<p>{paragraph}</p>
				{/each}
			</div>
		{/if}
	</div>

	<div class="border-t border-white/8 p-4 sm:p-5">
		<textarea
			bind:value={replyText}
			rows="4"
			placeholder={`Reply ${senderName(message.from)}...`}
			class="w-full resize-none rounded-2xl border border-white/8 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-400/60"
		></textarea>

		<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
			<label class="flex items-center gap-3 text-sm text-zinc-400">
				<input bind:checked={mutedThread} type="checkbox" class="rounded" />
				<span>Mute this thread</span>
			</label>

			<button
				type="button"
				class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
				onclick={sendReply}
				disabled={!replyText.trim()}
			>
				Send
			</button>
		</div>

		{#if draftNotice}
			<p class="mt-3 text-sm text-zinc-500">{draftNotice}</p>
		{/if}
	</div>
</div>
