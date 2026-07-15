<script lang="ts">
  import { appLoading } from '$lib/loading.svelte'
  import { navigating } from '$app/state'
  import './layout.css'
  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import { Toaster } from '$lib/components/ui/sonner'

  type ThemePreference = 'light' | 'dark' | 'system'

  let {
    children,
    data
  }: { children: Snippet; data: { demoMode: boolean; themePreference: ThemePreference } } = $props()

  const isLoading = $derived(Boolean(navigating.to) || appLoading.pending > 0)

  function resolveTheme(preference: ThemePreference) {
    if (preference !== 'system') return preference
    if (typeof window === 'undefined') return 'dark'
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }

  function applyTheme(preference: ThemePreference) {
    const resolvedTheme = resolveTheme(preference)
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = preference
    document.documentElement.style.colorScheme = resolvedTheme
  }

  onMount(() => {
    applyTheme(data.themePreference)

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleSystemThemeChange = () => {
      if (data.themePreference === 'system') applyTheme(data.themePreference)
    }

    media.addEventListener('change', handleSystemThemeChange)
    return () => media.removeEventListener('change', handleSystemThemeChange)
  })

  $effect(() => {
    applyTheme(data.themePreference)
  })
</script>

<svelte:head>
  <meta name="color-scheme" content="light dark" />
</svelte:head>

<div aria-hidden="true" class={['route-loading-bar', isLoading && 'active']}></div>

<Toaster position="top-center" theme={data.themePreference} />

{@render children()}
