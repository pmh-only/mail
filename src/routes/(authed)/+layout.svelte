<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Inbox, Send, FileText, Trash2, ArchiveX, Archive, Folder, Pencil, Settings } from 'lucide-svelte';
	import type { Component } from 'svelte';
	import { pathToSlug } from '$lib/mailbox';
	import Composer from '$lib/components/Composer.svelte';
	import { openCompose } from '$lib/composer.svelte';

	type ImapMailbox = {
		path: string;
		name: string;
		delimiter: string;
	};

	type Props = {
		data: { imapMailboxes: ImapMailbox[] };
		children: import('svelte').Snippet;
	};

	let { data, children }: Props = $props();

	const mailbox = $derived(page.params.mailbox ?? null);

	function iconForMailbox(name: string): Component {
		const n = name.toLowerCase();
		if (n.includes('inbox')) return Inbox;
		if (n.includes('sent')) return Send;
		if (n.includes('draft')) return FileText;
		if (n.includes('trash') || n.includes('deleted')) return Trash2;
		if (n.includes('junk') || n.includes('spam')) return ArchiveX;
		if (n.includes('archive')) return Archive;
		return Folder;
	}

	const mailboxes = $derived(
		data.imapMailboxes.map((mb) => ({
			label: mb.name,
			slug: pathToSlug(mb.path),
			icon: iconForMailbox(mb.name)
		}))
	);

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
	let resizing = $state(false);
	let ready = $state(false);

	onMount(() => {
		ready = true;
	});

	function startResize(e: PointerEvent) {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		resizing = true;
		const startX = e.clientX;
		const startWidth = sidebarWidth;

		function onMove(ev: PointerEvent) {
			sidebarWidth = Math.max(150, Math.min(400, startWidth + (ev.clientX - startX)));
		}

		function stop() {
			resizing = false;
			localStorage.setItem('mail:sidebarWidth', String(sidebarWidth));
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', stop);
			handle.removeEventListener('pointercancel', stop);
		}

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', stop);
		handle.addEventListener('pointercancel', stop);
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div
	class="flex h-screen overflow-hidden bg-[#0d0d10] text-zinc-100"
	class:cursor-col-resize={resizing}
	class:select-none={resizing}
	style="opacity: {ready ? 1 : 0}"
>
	<aside style="width: {sidebarWidth}px; min-width: {sidebarWidth}px" class="flex flex-col bg-[#0a0a0d]">
		<div class="flex flex-1 flex-col p-3 sm:p-4">
			<div class="mb-3 px-1">
				<button
					type="button"
					onclick={openCompose}
					class="flex w-full items-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
				>
					<Pencil size={14} />
					Compose
				</button>
			</div>
			<p class="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">Mail</p>
			<nav class="space-y-1.5">
				{#each mailboxes as mb (mb.slug)}
					<a
						href="/{mb.slug}"
						class={[
							'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
							mailbox === mb.slug
								? 'bg-white/[0.08] font-medium text-white'
								: 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
						]}
					>
						<mb.icon size={15} />
						{mb.label}
					</a>
				{/each}
			</nav>
			<div class="mt-auto pt-4">
				<a
					href="/settings"
					class={[
						'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
						page.url.pathname === '/settings'
							? 'bg-white/[0.08] font-medium text-white'
							: 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
					]}
				>
					<Settings size={15} />
					Settings
				</a>
			</div>
		</div>
	</aside>

	<!-- Resize handle: sidebar ↔ content -->
	<div
		role="separator"
		aria-orientation="vertical"
		tabindex="-1"
		class="group relative z-10 w-2 shrink-0 cursor-col-resize"
		onpointerdown={startResize}
	>
		<div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-white/25"></div>
	</div>

	<div class="min-w-0 flex-1 overflow-hidden">
		{@render children()}
	</div>
</div>

<Composer />
