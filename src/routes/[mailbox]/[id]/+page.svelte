<script lang="ts">
	import { Archive, Trash2, ShieldAlert, Reply, ReplyAll, Forward } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

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

	let acting = $state(false);

	async function performAction(action: 'archive' | 'trash' | 'spam') {
		if (acting) return;
		acting = true;
		try {
			const res = await fetch(`/api/messages/${data.message.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			if (res.ok) {
				await goto(`/${page.params.mailbox}`);
			}
		} finally {
			acting = false;
		}
	}

	const message = $derived(data.message);

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

	const SCROLLBAR_STYLE = `<style>
*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.18) transparent}
*::-webkit-scrollbar{width:6px;height:6px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:999px}
*::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.32)}
</style>`;

	function injectScrollbarStyle(html: string): string {
		const headClose = html.indexOf('</head>');
		if (headClose !== -1) return html.slice(0, headClose) + SCROLLBAR_STYLE + html.slice(headClose);
		return SCROLLBAR_STYLE + html;
	}

	const srcdoc = $derived(message.htmlContent ? injectScrollbarStyle(message.htmlContent) : null);
</script>

<svelte:head>
	<title>{subjectLabel(message.subject)} · Inbox</title>
</svelte:head>

<div class="flex h-full flex-col">
	<div class="border-b border-white/8 p-4 sm:p-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap items-center gap-1">
				<div class="group relative">
					<button
						type="button"
						aria-label="Archive"
						disabled={acting}
						onclick={() => performAction('archive')}
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Archive size={16} />
					</button>
					<span class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
						Archive
					</span>
				</div>
				<div class="group relative">
					<button
						type="button"
						aria-label="Delete"
						disabled={acting}
						onclick={() => performAction('trash')}
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Trash2 size={16} />
					</button>
					<span class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
						Delete
					</span>
				</div>
				<div class="group relative">
					<button
						type="button"
						aria-label="Move to spam"
						disabled={acting}
						onclick={() => performAction('spam')}
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<ShieldAlert size={16} />
					</button>
					<span class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
						Move to spam
					</span>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-1">
				<div class="group relative">
					<button
						type="button"
						aria-label="Reply"
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
					>
						<Reply size={16} />
					</button>
					<span class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
						Reply
					</span>
				</div>
				<div class="group relative">
					<button
						type="button"
						aria-label="Reply all"
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
					>
						<ReplyAll size={16} />
					</button>
					<span class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
						Reply all
					</span>
				</div>
				<div class="group relative">
					<button
						type="button"
						aria-label="Forward"
						class="rounded-lg border border-white/8 bg-white/[0.03] p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
					>
						<Forward size={16} />
					</button>
					<span class="pointer-events-none absolute top-full right-0 mt-2 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
						Forward
					</span>
				</div>
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
			{#if srcdoc}
				<iframe
					title={`Email body for ${subjectLabel(message.subject)}`}
					sandbox=""
					{srcdoc}
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

</div>
