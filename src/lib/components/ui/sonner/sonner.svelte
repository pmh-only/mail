<script lang="ts">
  import { Toaster as Sonner, type ToasterProps } from 'svelte-sonner'

  let { ...props }: ToasterProps = $props()
</script>

<Sonner class="toaster group" {...props} />

<style>
  :global(.toaster[data-sonner-toaster] [data-sonner-toast]) {
    border-color: color-mix(in srgb, var(--app-field-text), transparent 84%) !important;
    background: var(--app-banner-bg) !important;
    color: var(--app-field-text) !important;
    backdrop-filter: blur(18px);
    scale: 0.96;
    filter: blur(3px);
    transition:
      transform 360ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 220ms ease,
      scale 360ms cubic-bezier(0.16, 1, 0.3, 1),
      filter 220ms ease,
      height 360ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms ease;
  }

  :global(.toaster[data-sonner-toaster] [data-sonner-toast][data-mounted='true']) {
    scale: 1;
    filter: blur(0);
  }

  :global(.toaster[data-sonner-toaster] [data-sonner-toast][data-removed='true']) {
    scale: 0.97;
    filter: blur(3px);
    transition:
      transform 200ms cubic-bezier(0.4, 0, 1, 1),
      opacity 180ms ease,
      scale 180ms ease,
      filter 180ms ease,
      height 200ms ease,
      box-shadow 180ms ease;
  }
</style>
