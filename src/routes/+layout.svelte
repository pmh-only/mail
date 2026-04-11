<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
