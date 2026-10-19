<script lang="ts">
  import favicon from '$lib/assets/favicon.svg'
  import { authClient } from '$lib/auth-client'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { clearOfflineCache } from '$lib/offline-cache'
  import { KeyRound, LogIn } from 'lucide-svelte'
  import { onMount } from 'svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
  let email = $state('')
  let password = $state('')
  let loading = $state<string | null>(null)
  let error = $state<string | null>(null)

  const externalMethodCount = $derived(
    Number(data.methods.github) + Number(data.methods.discord) + Number(data.methods.oidc)
  )

  onMount(() => {
    void clearOfflineCache()
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_OFFLINE_CACHE' })

    const callbackError = new URLSearchParams(window.location.search).get('error')
    if (callbackError) error = callbackError.replaceAll('_', ' ')
  })

  async function startOAuth(provider: 'github' | 'discord' | 'oidc') {
    loading = provider
    error = null
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, callbackURL: '/', errorCallbackURL: '/login' })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to start sign-in.'))

      const payload = (await res.json()) as { url?: string }
      if (!payload.url) throw new Error('No redirect URL returned.')
      window.location.href = payload.url
    } catch (cause) {
      error = errorMessageFromUnknown(cause, 'Something went wrong.')
      loading = null
    }
  }

  async function signInWithPassword(event: SubmitEvent) {
    event.preventDefault()
    loading = 'password'
    error = null
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, rememberMe: true, callbackURL: '/' })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Invalid email or password.'))
      window.location.href = '/'
    } catch (cause) {
      error = errorMessageFromUnknown(cause, 'Sign-in failed.')
      loading = null
    }
  }

  async function signInWithPasskey() {
    loading = 'passkey'
    error = null
    try {
      const result = await authClient.signIn.passkey({ autoFill: false })
      if (result.error) throw new Error(result.error.message || 'Passkey sign-in failed.')
      window.location.href = '/'
    } catch (cause) {
      error = errorMessageFromUnknown(cause, 'Passkey sign-in failed.')
      loading = null
    }
  }
</script>

<svelte:head><title>Sign in</title></svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-[#0d0d10] px-4 py-10">
  <div
    class="pointer-events-none fixed inset-0"
    style="background: radial-gradient(ellipse 60% 50% at 50% 40%, rgba(59,130,246,0.07) 0%, transparent 70%)"
  ></div>

  <div class="relative w-full max-w-sm">
    <div class="mb-8 flex flex-col items-center gap-3">
      <div
        class="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/15 ring-1 ring-blue-500/20"
      >
        <img src={favicon} alt="" class="h-6 w-6" />
      </div>
      <div class="text-center">
        <h1 class="text-xl font-semibold tracking-tight text-white">Mail</h1>
        <p class="mt-0.5 text-sm text-zinc-500">Sign in to your account</p>
      </div>
    </div>

    <div
      class="space-y-4 rounded-2xl border border-white/8 bg-white/3 p-6 shadow-2xl backdrop-blur-sm"
    >
      {#if data.methods.password}
        <form class="space-y-3" onsubmit={signInWithPassword}>
          <div>
            <label for="email" class="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input
              id="email"
              type="email"
              bind:value={email}
              autocomplete="username webauthn"
              required
              class="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label for="password" class="mb-1 block text-xs font-medium text-zinc-400"
              >Password</label
            >
            <input
              id="password"
              type="password"
              bind:value={password}
              autocomplete="current-password webauthn"
              required
              class="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-blue-500"
              placeholder="Your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading !== null}
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-500 active:scale-98 disabled:opacity-60"
          >
            <LogIn size={16} />
            {loading === 'password' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      {/if}

      {#if data.methods.passkey}
        <button
          type="button"
          onclick={signInWithPasskey}
          disabled={loading !== null}
          class="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10 active:scale-98 disabled:opacity-60"
        >
          <KeyRound size={16} />
          {loading === 'passkey' ? 'Waiting for passkey…' : 'Sign in with a passkey'}
        </button>
      {/if}

      {#if externalMethodCount > 0}
        {#if data.methods.password || data.methods.passkey}
          <div class="flex items-center gap-3 text-xs text-zinc-700">
            <span class="h-px flex-1 bg-white/8"></span>
            <span>or continue with</span>
            <span class="h-px flex-1 bg-white/8"></span>
          </div>
        {/if}

        <div class="grid gap-2 {externalMethodCount > 1 ? 'sm:grid-cols-2' : ''}">
          {#if data.methods.github}
            <button
              type="button"
              onclick={() => startOAuth('github')}
              disabled={loading !== null}
              class="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
                <path
                  d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"
                />
              </svg>
              {loading === 'github' ? 'Redirecting…' : 'GitHub'}
            </button>
          {/if}

          {#if data.methods.discord}
            <button
              type="button"
              onclick={() => startOAuth('discord')}
              disabled={loading !== null}
              class="flex items-center justify-center gap-2 rounded-xl border border-indigo-400/15 bg-indigo-500/8 px-4 py-2.5 text-sm font-medium text-indigo-100 transition hover:bg-indigo-500/15 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
                <path
                  d="M19.5 5.3A17 17 0 0 0 15.4 4l-.5 1a15 15 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.1 1.3C1.9 9.8 1.2 14.2 1.6 18.5A17 17 0 0 0 6.7 21l1.2-1.7a11 11 0 0 1-1.9-.9l.5-.4a12.2 12.2 0 0 0 11 0l.5.4c-.6.4-1.2.7-1.9.9l1.2 1.7a17 17 0 0 0 5.1-2.5c.5-5-.8-9.4-2.9-13.2ZM8.7 15.8c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2c1 0 1.9 1 1.9 2.2s-.9 2.2-1.9 2.2Zm6.6 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2c1 0 1.9 1 1.9 2.2s-.8 2.2-1.9 2.2Z"
                />
              </svg>
              {loading === 'discord' ? 'Redirecting…' : 'Discord'}
            </button>
          {/if}

          {#if data.methods.oidc}
            <button
              type="button"
              onclick={() => startOAuth('oidc')}
              disabled={loading !== null}
              class="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-60 {externalMethodCount >
              1
                ? 'sm:col-span-2'
                : ''}"
            >
              <LogIn size={16} />
              {loading === 'oidc' ? 'Redirecting…' : 'OpenID Connect'}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<ErrorDialog message={error} title="Sign-in failed" onclose={() => (error = null)} />
