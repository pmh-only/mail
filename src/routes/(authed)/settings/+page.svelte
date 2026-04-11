<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	type ConfigSection = {
		host: string;
		port: number;
		secure: boolean;
		user: string;
		password: string;
		mailbox?: string;
		pollSeconds?: number;
		from?: string;
		source: 'db' | 'env';
	};

	type Props = {
		data: {
			config: {
				imap: ConfigSection & { mailbox: string; pollSeconds: number };
				smtp: ConfigSection & { from: string };
				oidc: { discoveryUrl: string; clientId: string; clientSecret: string; source: 'db' | 'env' };
			};
			origin: string;
		};
	};

	let { data }: Props = $props();

	// Editable form state
	let imap = $state({ ...data.config.imap, password: '' });
	let smtp = $state({ ...data.config.smtp, password: '' });
	let oidc = $state({ ...data.config.oidc, clientSecret: '' });

	let saving = $state(false);
	let testingImap = $state(false);
	let testingSmtp = $state(false);
	let saveError = $state('');
	let saveSuccess = $state(false);
	let imapTestResult = $state<{ ok: boolean; message: string } | null>(null);
	let smtpTestResult = $state<{ ok: boolean; message: string } | null>(null);

	async function save() {
		saving = true;
		saveError = '';
		saveSuccess = false;
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ imap, smtp, oidc })
			});
			if (!res.ok) {
				const text = await res.text();
				saveError = text || `HTTP ${res.status}`;
			} else {
				saveSuccess = true;
				// Clear passwords after save so they show as bullets again
				imap.password = '';
				smtp.password = '';
				oidc.clientSecret = '';
				await invalidateAll();
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	async function testImap() {
		testingImap = true;
		imapTestResult = null;
		try {
			const res = await fetch('/api/settings/test-imap', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ imap })
			});
			const data = await res.json();
			imapTestResult = { ok: res.ok, message: data.message ?? (res.ok ? 'Connected successfully' : 'Connection failed') };
		} catch (err) {
			imapTestResult = { ok: false, message: err instanceof Error ? err.message : String(err) };
		} finally {
			testingImap = false;
		}
	}

	async function testSmtp() {
		testingSmtp = true;
		smtpTestResult = null;
		try {
			const res = await fetch('/api/settings/test-smtp', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ smtp })
			});
			const data = await res.json();
			smtpTestResult = { ok: res.ok, message: data.message ?? (res.ok ? 'Connected successfully' : 'Connection failed') };
		} catch (err) {
			smtpTestResult = { ok: false, message: err instanceof Error ? err.message : String(err) };
		} finally {
			testingSmtp = false;
		}
	}
</script>

<div class="h-full overflow-y-auto p-6 lg:p-10">
	<div class="mx-auto max-w-2xl space-y-10">
		<div>
			<h1 class="text-xl font-semibold text-white">Settings</h1>
			<p class="mt-1 text-sm text-zinc-400">
				Values set here take priority over environment variables.
			</p>
		</div>

		<!-- IMAP -->
		<section class="space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-widest text-zinc-500">IMAP — Incoming Mail</h2>
				{#if data.config.imap.source === 'db'}
					<span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">saved</span>
				{:else if data.config.imap.host}
					<span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400">from env</span>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="col-span-2 sm:col-span-1">
					<label class="mb-1 block text-xs text-zinc-400" for="imap-host">Host</label>
					<input
						id="imap-host"
						type="text"
						placeholder={data.config.imap.source === 'env' ? data.config.imap.host || 'e.g. imap.gmail.com' : 'e.g. imap.gmail.com'}
						bind:value={imap.host}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="imap-port">Port</label>
					<input
						id="imap-port"
						type="number"
						min="1"
						max="65535"
						bind:value={imap.port}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-xs text-zinc-400" for="imap-user">Username / Email</label>
					<input
						id="imap-user"
						type="text"
						autocomplete="username"
						placeholder="you@example.com"
						bind:value={imap.user}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-xs text-zinc-400" for="imap-password">Password</label>
					<input
						id="imap-password"
						type="password"
						autocomplete="current-password"
						placeholder={data.config.imap.password ? '(unchanged)' : 'Enter password'}
						bind:value={imap.password}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="imap-mailbox">Default Mailbox</label>
					<input
						id="imap-mailbox"
						type="text"
						placeholder="INBOX"
						bind:value={imap.mailbox}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="imap-poll">Poll interval (seconds)</label>
					<input
						id="imap-poll"
						type="number"
						min="5"
						bind:value={imap.pollSeconds}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2 flex items-center gap-2">
					<label class="relative inline-flex cursor-pointer items-center gap-2">
						<input type="checkbox" bind:checked={imap.secure} class="peer sr-only" />
						<div class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"></div>
						<span class="text-sm text-zinc-300">TLS / SSL</span>
					</label>
				</div>
			</div>

			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={testImap}
					disabled={testingImap}
					class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
				>
					{testingImap ? 'Testing…' : 'Test connection'}
				</button>
				{#if imapTestResult}
					<span class={imapTestResult.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>
						{imapTestResult.message}
					</span>
				{/if}
			</div>
		</section>

		<div class="border-t border-white/8"></div>

		<!-- SMTP -->
		<section class="space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-widest text-zinc-500">SMTP — Outgoing Mail</h2>
				{#if data.config.smtp.source === 'db'}
					<span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">saved</span>
				{:else if data.config.smtp.host}
					<span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400">from env</span>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="col-span-2 sm:col-span-1">
					<label class="mb-1 block text-xs text-zinc-400" for="smtp-host">Host</label>
					<input
						id="smtp-host"
						type="text"
						placeholder="e.g. smtp.gmail.com"
						bind:value={smtp.host}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="smtp-port">Port</label>
					<input
						id="smtp-port"
						type="number"
						min="1"
						max="65535"
						bind:value={smtp.port}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-xs text-zinc-400" for="smtp-user">Username / Email</label>
					<input
						id="smtp-user"
						type="text"
						autocomplete="username"
						placeholder="you@example.com"
						bind:value={smtp.user}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-xs text-zinc-400" for="smtp-password">Password</label>
					<input
						id="smtp-password"
						type="password"
						autocomplete="current-password"
						placeholder={data.config.smtp.password ? '(unchanged)' : 'Enter password'}
						bind:value={smtp.password}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-xs text-zinc-400" for="smtp-from">From address (optional)</label>
					<input
						id="smtp-from"
						type="text"
						placeholder="Defaults to username if empty"
						bind:value={smtp.from}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div class="col-span-2 flex items-center gap-2">
					<label class="relative inline-flex cursor-pointer items-center gap-2">
						<input type="checkbox" bind:checked={smtp.secure} class="peer sr-only" />
						<div class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"></div>
						<span class="text-sm text-zinc-300">TLS / SSL</span>
					</label>
				</div>
			</div>

			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={testSmtp}
					disabled={testingSmtp}
					class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
				>
					{testingSmtp ? 'Testing…' : 'Test connection'}
				</button>
				{#if smtpTestResult}
					<span class={smtpTestResult.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>
						{smtpTestResult.message}
					</span>
				{/if}
			</div>
		</section>

		<div class="border-t border-white/8"></div>

		<!-- OIDC -->
		<section class="space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-widest text-zinc-500">OIDC — Authentication</h2>
				{#if data.config.oidc.source === 'db'}
					<span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">saved</span>
				{:else if data.config.oidc.discoveryUrl || data.config.oidc.clientId}
					<span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400">from env</span>
				{/if}
			</div>

			<div class="space-y-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="oidc-discovery">Discovery URL</label>
					<input
						id="oidc-discovery"
						type="url"
						placeholder="https://auth.example.com/…/.well-known/openid-configuration"
						bind:value={oidc.discoveryUrl}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="oidc-client-id">Client ID</label>
					<input
						id="oidc-client-id"
						type="text"
						placeholder="your-client-id"
						bind:value={oidc.clientId}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="oidc-client-secret">Client Secret</label>
					<input
						id="oidc-client-secret"
						type="password"
						autocomplete="new-password"
						placeholder={data.config.oidc.clientSecret ? '(unchanged)' : 'Enter client secret'}
						bind:value={oidc.clientSecret}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<p class="text-xs text-zinc-500">
					Redirect URI to register with your provider: <span class="font-mono text-zinc-400">{data.origin}/api/auth/oauth2/callback/oidc</span>
				</p>
			</div>
		</section>

		<div class="border-t border-white/8"></div>

		<!-- Save -->
		<div class="flex items-center gap-4">
			<button
				type="button"
				onclick={save}
				disabled={saving}
				class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
			>
				{saving ? 'Saving…' : 'Save settings'}
			</button>
			{#if saveSuccess}
				<span class="text-sm text-emerald-400">Settings saved.</span>
			{/if}
			{#if saveError}
				<span class="text-sm text-red-400">{saveError}</span>
			{/if}
		</div>
	</div>
</div>
