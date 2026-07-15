<script lang="ts">
  import { Toaster as Sonner, type ToasterProps } from 'svelte-sonner'

  let { ...props }: ToasterProps = $props()
</script>

<Sonner
  richColors
  closeButton
  class="toaster group"
  style="--normal-bg: var(--app-popover-bg); --normal-text: var(--app-field-text); --normal-border: color-mix(in srgb, var(--app-field-text), transparent 85%);"
  {...props}
/>
