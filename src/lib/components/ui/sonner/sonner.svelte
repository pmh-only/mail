<script lang="ts">
  import { Toaster as Sonner, type ToasterProps } from 'svelte-sonner'

  let { ...props }: ToasterProps = $props()
</script>

<Sonner class="toaster group" {...props} />
