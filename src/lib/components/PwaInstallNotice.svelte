<script lang="ts">
  import { Download, X } from 'lucide-svelte'
  import { onMount } from 'svelte'

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  }

  const dismissalKey = 'mail:pwa-install-notice-dismissed'
  const displayModes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']

  let visible = $state(false)
  let installPrompt = $state<BeforeInstallPromptEvent | null>(null)
  let installing = $state(false)

  function isInstalled() {
    const iosNavigator = navigator as Navigator & { standalone?: boolean }
    return (
      iosNavigator.standalone === true ||
      document.referrer.startsWith('android-app://') ||
      displayModes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
    )
  }

  function wasDismissed() {
    try {
      return localStorage.getItem(dismissalKey) === 'true'
    } catch {
      return false
    }
  }

  function dismiss() {
    visible = false
    try {
      localStorage.setItem(dismissalKey, 'true')
    } catch {
      // The in-memory dismissal still applies when storage is unavailable.
    }
  }

  async function install() {
    if (!installPrompt || installing) return

    installing = true
    const prompt = installPrompt

    try {
      await prompt.prompt()
      await prompt.userChoice
      installPrompt = null
      dismiss()
    } catch {
      // Browsers can reject the prompt when installation becomes unavailable.
      installPrompt = null
    } finally {
      installing = false
    }
  }

  onMount(() => {
    visible = !isInstalled() && !wasDismissed()

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      installPrompt = event as BeforeInstallPromptEvent
      visible = !isInstalled() && !wasDismissed()
    }
    const handleInstalled = () => {
      installPrompt = null
      visible = false
    }
    const displayModeQueries = displayModes.map((mode) =>
      window.matchMedia(`(display-mode: ${mode})`)
    )
    const handleDisplayModeChange = () => {
      if (isInstalled()) handleInstalled()
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    for (const query of displayModeQueries)
      query.addEventListener('change', handleDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      for (const query of displayModeQueries) {
        query.removeEventListener('change', handleDisplayModeChange)
      }
    }
  })

  $effect(() => {
    document.documentElement.classList.toggle('pwa-install-notice-visible', visible)
    return () => document.documentElement.classList.remove('pwa-install-notice-visible')
  })
</script>

{#if visible}
  <aside class="install-notice" aria-label="Install Mail app">
    <div class="install-notice__content">
      <span class="install-notice__icon"><Download size={18} aria-hidden="true" /></span>
      <p>
        {#if installPrompt}
          Install Mail for faster access and a focused app window.
        {:else}
          Install Mail from your browser menu for faster access.
        {/if}
      </p>
      {#if installPrompt}
        <button
          type="button"
          class="install-notice__action"
          disabled={installing}
          onclick={() => void install()}
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      {/if}
      <button
        type="button"
        class="install-notice__close"
        aria-label="Dismiss install notice"
        onclick={dismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  </aside>
{/if}

<style>
  .install-notice {
    position: fixed;
    inset: 0 0 auto;
    z-index: 45;
    padding-top: env(safe-area-inset-top, 0px);
    border-bottom: 1px solid color-mix(in srgb, var(--app-field-text), transparent 84%);
    background: var(--app-banner-bg);
    color: var(--app-field-text);
    box-shadow: 0 8px 30px rgb(0 0 0 / 18%);
    backdrop-filter: blur(18px);
  }

  .install-notice__content {
    display: flex;
    min-height: 3rem;
    width: 100%;
    margin: 0;
    padding: 0.5rem max(1.25rem, env(safe-area-inset-right)) 0.5rem
      max(1.25rem, env(safe-area-inset-left));
    align-items: center;
    gap: 0.75rem;
  }

  .install-notice__icon {
    display: inline-flex;
    flex: none;
    color: #60a5fa;
  }

  p {
    min-width: 0;
    flex: 1;
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  button {
    flex: none;
    border: 0;
    font: inherit;
  }

  .install-notice__action {
    border-radius: 0.5rem;
    background: #2563eb;
    padding: 0.375rem 0.75rem;
    color: white;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .install-notice__action:hover:not(:disabled) {
    background: #3b82f6;
  }

  .install-notice__action:disabled {
    opacity: 0.65;
  }

  .install-notice__close {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 0.5rem;
    background: transparent;
    color: color-mix(in srgb, var(--app-field-text), transparent 32%);
  }

  .install-notice__close:hover {
    background: color-mix(in srgb, var(--app-field-text), transparent 92%);
    color: var(--app-field-text);
  }

  @media (max-width: 480px) {
    .install-notice__content {
      gap: 0.5rem;
    }

    .install-notice__icon {
      display: none;
    }

    p {
      font-size: 0.75rem;
      line-height: 1rem;
    }
  }
</style>
