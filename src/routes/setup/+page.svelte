<script lang="ts">
  import { enhance } from '$app/forms'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import type { ActionData, PageData } from './$types'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let saving = $state(false)
  let formError = $state<string | null>(null)

  // IMAP defaults
  let imapPort = $state(993)
  let imapSecure = $state(true)
  let imapAllowInvalidCertificate = $state(false)
  let imapMailbox = $state('INBOX')
  let imapPollSeconds = $state(15)

  // SMTP defaults
  let smtpPort = $state(587)
  let smtpSecure = $state(false)
  let smtpAllowInvalidCertificate = $state(false)

  $effect(() => {
    formError = form?.error ?? null
  })
</script>

<svelte:head><title>Setup</title></svelte:head>

<div class="min-h-screen bg-[#0d0d10] px-4 py-12">
  <div class="mx-auto w-full max-w-2xl">
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
        saving = true
        return async ({ update }) => {
          await update()
          saving = false
        }
      }}
      class="space-y-8"
    >
      <!-- Authentication -->
      <section class="space-y-4">
        <h2 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
          Authentication
        </h2>
        <p class="text-sm text-zinc-500">
          Configure at least one method. You can add passkeys after your first sign-in.
        </p>

        <div class="space-y-4 rounded-xl border border-white/8 bg-white/3 p-4">
          <div>
            <p class="text-sm font-medium text-zinc-200">Email and password</p>
            <p class="mt-1 text-xs text-zinc-600">
              Optional when an external provider is configured.
            </p>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="adminName">Name</label>
              <input
                id="adminName"
                name="adminName"
                type="text"
                autocomplete="name"
                placeholder="Your name"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="adminEmail">Email</label>
              <input
                id="adminEmail"
                name="adminEmail"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="adminPassword">Password</label>
              <input
                id="adminPassword"
                name="adminPassword"
                type="password"
                minlength="8"
                maxlength="128"
                autocomplete="new-password"
                placeholder="At least 8 characters"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-3 rounded-xl border border-white/8 bg-white/3 p-4">
            <div>
              <p class="text-sm font-medium text-zinc-200">GitHub OAuth</p>
              <p class="mt-1 text-xs text-zinc-600">
                Callback: <span class="font-mono">{data.origin}/api/auth/callback/github</span>
              </p>
            </div>
            <input
              name="githubClientId"
              type="text"
              aria-label="GitHub Client ID"
              placeholder="Client ID"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <input
              name="githubClientSecret"
              type="password"
              autocomplete="new-password"
              aria-label="GitHub Client Secret"
              placeholder="Client secret"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div class="space-y-3 rounded-xl border border-white/8 bg-white/3 p-4">
            <div>
              <p class="text-sm font-medium text-zinc-200">Discord OAuth</p>
              <p class="mt-1 text-xs text-zinc-600">
                Callback: <span class="font-mono">{data.origin}/api/auth/callback/discord</span>
              </p>
            </div>
            <input
              name="discordClientId"
              type="text"
              aria-label="Discord Client ID"
              placeholder="Client ID"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <input
              name="discordClientSecret"
              type="password"
              autocomplete="new-password"
              aria-label="Discord Client Secret"
              placeholder="Client secret"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-white/8 bg-white/3 p-4">
          <div>
            <p class="text-sm font-medium text-zinc-200">OpenID Connect</p>
            <p class="mt-1 text-xs text-zinc-600">
              Manual endpoints only. Callback:
              <span class="font-mono">{data.origin}/api/auth/callback/oidc</span>
            </p>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="oidcIssuer">Issuer</label>
              <input
                id="oidcIssuer"
                name="oidcIssuer"
                type="url"
                placeholder="https://auth.example.com"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidcAuthorizationUrl"
                >Authorization URL</label
              >
              <input
                id="oidcAuthorizationUrl"
                name="oidcAuthorizationUrl"
                type="url"
                placeholder="https://auth.example.com/authorize"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidcTokenUrl">Token URL</label>
              <input
                id="oidcTokenUrl"
                name="oidcTokenUrl"
                type="url"
                placeholder="https://auth.example.com/token"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidcUserInfoUrl"
                >User info URL</label
              >
              <input
                id="oidcUserInfoUrl"
                name="oidcUserInfoUrl"
                type="url"
                placeholder="https://auth.example.com/userinfo"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidcClientId">Client ID</label>
              <input
                id="oidcClientId"
                name="oidcClientId"
                type="text"
                placeholder="your-client-id"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="oidcClientSecret"
                >Client Secret</label
              >
              <input
                id="oidcClientSecret"
                name="oidcClientSecret"
                type="password"
                autocomplete="new-password"
                placeholder="Client secret"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
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

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div class="col-span-2 flex flex-wrap items-center gap-2">
            <!-- hidden field so the value is always submitted -->
            <input type="hidden" name="imapSecure" value={String(imapSecure)} />
            <button
              type="button"
              role="switch"
              aria-checked={imapSecure}
              aria-label="IMAP TLS / SSL"
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
          <div class="col-span-2 flex flex-wrap items-center gap-2">
            <input
              type="hidden"
              name="imapAllowInvalidCertificate"
              value={String(imapAllowInvalidCertificate)}
            />
            <button
              type="button"
              role="switch"
              aria-checked={imapAllowInvalidCertificate}
              aria-label="Allow self-signed IMAP certificate"
              onclick={() => (imapAllowInvalidCertificate = !imapAllowInvalidCertificate)}
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition {imapAllowInvalidCertificate
                ? 'bg-amber-600'
                : 'bg-zinc-700'}"
            >
              <span
                class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition {imapAllowInvalidCertificate
                  ? 'translate-x-4'
                  : ''}"
              ></span>
            </button>
            <span class="text-sm text-zinc-300">Allow self-signed certificate</span>
            <span class="text-xs text-amber-400">Disables certificate verification</span>
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

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div class="col-span-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="smtpSecure" value={String(smtpSecure)} />
            <button
              type="button"
              role="switch"
              aria-checked={smtpSecure}
              aria-label="SMTP TLS / SSL"
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
          <div class="col-span-2 flex flex-wrap items-center gap-2">
            <input
              type="hidden"
              name="smtpAllowInvalidCertificate"
              value={String(smtpAllowInvalidCertificate)}
            />
            <button
              type="button"
              role="switch"
              aria-checked={smtpAllowInvalidCertificate}
              aria-label="Allow self-signed SMTP certificate"
              onclick={() => (smtpAllowInvalidCertificate = !smtpAllowInvalidCertificate)}
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition {smtpAllowInvalidCertificate
                ? 'bg-amber-600'
                : 'bg-zinc-700'}"
            >
              <span
                class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition {smtpAllowInvalidCertificate
                  ? 'translate-x-4'
                  : ''}"
              ></span>
            </button>
            <span class="text-sm text-zinc-300">Allow self-signed certificate</span>
            <span class="text-xs text-amber-400">Disables certificate verification</span>
          </div>
        </div>
      </section>
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

<ErrorDialog message={formError} title="Setup failed" onclose={() => (formError = null)} />
