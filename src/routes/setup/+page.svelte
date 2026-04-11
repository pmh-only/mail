<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);

	// IMAP defaults
	let imapPort = $state(993);
	let imapSecure = $state(true);
	let imapMailbox = $state('INBOX');
	let imapPollSeconds = $state(15);

	// SMTP defaults
	let smtpPort = $state(587);
	let smtpSecure = $state(false);
</script>

<svelte:head><title>Setup</title></svelte:head>

<div class="min-h-screen bg-[#0d0d10] px-4 py-12">
	<div class="mx-auto w-full max-w-lg">
		<!-- Header -->
		<div class="mb-8">
			<h1 class="text-2xl font-semibold text-white">First-time setup</h1>
			<p class="mt-1 text-sm text-zinc-400">
				Configure your mail server and identity provider to get started.
			</p>
		</div>

		<form
			method="post"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
			class="space-y-8"
		>
			<!-- OIDC -->
			<section class="space-y-4">
				<h2 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
					Identity Provider (OIDC)
				</h2>

				<div class="space-y-3">
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="discoveryUrl"
							>Discovery URL <span class="text-red-400">*</span></label
						>
						<input
							id="discoveryUrl"
							name="discoveryUrl"
							type="url"
							required
							placeholder="https://auth.example.com/…/.well-known/openid-configuration"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="mb-1 block text-xs text-zinc-400" for="clientId"
								>Client ID <span class="text-red-400">*</span></label
							>
							<input
								id="clientId"
								name="clientId"
								type="text"
								required
								placeholder="your-client-id"
								class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
							/>
						</div>
						<div>
							<label class="mb-1 block text-xs text-zinc-400" for="clientSecret"
								>Client Secret <span class="text-red-400">*</span></label
							>
							<input
								id="clientSecret"
								name="clientSecret"
								type="password"
								required
								autocomplete="new-password"
								placeholder="••••••••"
								class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
							/>
						</div>
					</div>
					<p class="text-xs text-zinc-600">
						Redirect URI: <span class="font-mono text-zinc-500"
							>{data.origin}/api/auth/oauth2/callback/oidc</span
						>
					</p>
				</div>
			</section>

			<div class="border-t border-white/8"></div>

			<!-- IMAP -->
			<section class="space-y-4">
				<h2 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
					IMAP — Incoming Mail <span class="ml-1 tracking-normal text-zinc-600 normal-case"
						>(optional)</span
					>
				</h2>

				<div class="grid grid-cols-2 gap-3">
					<div class="col-span-2 sm:col-span-1">
						<label class="mb-1 block text-xs text-zinc-400" for="imapHost">Host</label>
						<input
							id="imapHost"
							name="imapHost"
							type="text"
							placeholder="imap.example.com"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="imapPort">Port</label>
						<input
							id="imapPort"
							name="imapPort"
							type="number"
							min="1"
							max="65535"
							bind:value={imapPort}
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="imapUser">Username / Email</label>
						<input
							id="imapUser"
							name="imapUser"
							type="text"
							autocomplete="username"
							placeholder="you@example.com"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="imapPassword">Password</label>
						<input
							id="imapPassword"
							name="imapPassword"
							type="password"
							autocomplete="current-password"
							placeholder="••••••••"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="imapMailbox">Default mailbox</label
						>
						<input
							id="imapMailbox"
							name="imapMailbox"
							type="text"
							bind:value={imapMailbox}
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="imapPollSeconds"
							>Poll interval (s)</label
						>
						<input
							id="imapPollSeconds"
							name="imapPollSeconds"
							type="number"
							min="5"
							bind:value={imapPollSeconds}
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div class="col-span-2 flex items-center gap-2">
						<!-- hidden field so the value is always submitted -->
						<input type="hidden" name="imapSecure" value={String(imapSecure)} />
						<button
							type="button"
							role="switch"
							aria-checked={imapSecure}
							onclick={() => (imapSecure = !imapSecure)}
							class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition {imapSecure
								? 'bg-blue-600'
								: 'bg-zinc-700'}"
						>
							<span
								class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition {imapSecure
									? 'translate-x-4'
									: ''}"
							></span>
						</button>
						<span class="text-sm text-zinc-300">TLS / SSL</span>
					</div>
				</div>
			</section>

			<div class="border-t border-white/8"></div>

			<!-- SMTP -->
			<section class="space-y-4">
				<h2 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
					SMTP — Outgoing Mail <span class="ml-1 tracking-normal text-zinc-600 normal-case"
						>(optional)</span
					>
				</h2>

				<div class="grid grid-cols-2 gap-3">
					<div class="col-span-2 sm:col-span-1">
						<label class="mb-1 block text-xs text-zinc-400" for="smtpHost">Host</label>
						<input
							id="smtpHost"
							name="smtpHost"
							type="text"
							placeholder="smtp.example.com"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="smtpPort">Port</label>
						<input
							id="smtpPort"
							name="smtpPort"
							type="number"
							min="1"
							max="65535"
							bind:value={smtpPort}
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="smtpUser">Username / Email</label>
						<input
							id="smtpUser"
							name="smtpUser"
							type="text"
							autocomplete="username"
							placeholder="you@example.com"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400" for="smtpPassword">Password</label>
						<input
							id="smtpPassword"
							name="smtpPassword"
							type="password"
							autocomplete="current-password"
							placeholder="••••••••"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div class="col-span-2">
						<label class="mb-1 block text-xs text-zinc-400" for="smtpFrom">From address</label>
						<input
							id="smtpFrom"
							name="smtpFrom"
							type="text"
							placeholder="Defaults to username if empty"
							class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
						/>
					</div>
					<div class="col-span-2 flex items-center gap-2">
						<input type="hidden" name="smtpSecure" value={String(smtpSecure)} />
						<button
							type="button"
							role="switch"
							aria-checked={smtpSecure}
							onclick={() => (smtpSecure = !smtpSecure)}
							class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition {smtpSecure
								? 'bg-blue-600'
								: 'bg-zinc-700'}"
						>
							<span
								class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition {smtpSecure
									? 'translate-x-4'
									: ''}"
							></span>
						</button>
						<span class="text-sm text-zinc-300">TLS / SSL</span>
					</div>
				</div>
			</section>

			{#if form?.error}
				<p class="text-sm text-red-400">{form.error}</p>
			{/if}

			<button
				type="submit"
				disabled={saving}
				class="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
			>
				{saving ? 'Saving…' : 'Save and continue'}
			</button>
		</form>
	</div>
</div>
