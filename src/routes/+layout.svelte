<script lang="ts">
  import { appLoading } from '$lib/loading.svelte'
  import { navigating } from '$app/state'
  import './layout.css'
  import type { Snippet } from 'svelte'

  let { children, data }: { children: Snippet; data: { demoMode: boolean } } = $props()

  const isLoading = $derived(Boolean(navigating.to) || appLoading.pending > 0)
</script>

<div aria-hidden="true" class={['route-loading-bar', isLoading && 'active']}></div>

{@render children()}
