<script lang="ts">
  import favicon from '$lib/assets/favicon.svg'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'

  let loading = $state(false)
  let error = $state<string | null>(null)

  async function signIn() {
    loading = true
    error = null
    try {
      const res = await fetch('/api/auth/sign-in/oauth2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'oidc', callbackURL: '/' })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to start sign-in.'))
      }

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        error = 'No redirect URL returned.'
        loading = false
      }
    } catch (e) {
      error = errorMessageFromUnknown(e, 'Something went wrong.')
      loading = false
    }
  }
</script>

<svelte:head><title>Sign in</title></svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-[#0d0d10] px-4">
  <!-- Subtle radial glow behind the card -->
  <div
    class="pointer-events-none fixed inset-0"
    style="background: radial-gradient(ellipse 60% 50% at 50% 40%, rgba(59,130,246,0.07) 0%, transparent 70%)"
  ></div>

  <div class="relative w-full max-w-sm">
    <!-- Logo -->
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

    <!-- Card -->
    <div class="rounded-2xl border border-white/8 bg-white/3 p-6 shadow-2xl backdrop-blur-sm">
      <button
        type="button"
        onclick={signIn}
        disabled={loading}
        class="flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-500 active:scale-98 disabled:opacity-60"
      >
        {#if loading}
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
            ></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
          </svg>
          Redirecting…
        {:else}
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Continue with SSO
        {/if}
      </button>
    </div>
  </div>
</div>

<ErrorDialog message={error} title="Sign-in failed" onclose={() => (error = null)} />
