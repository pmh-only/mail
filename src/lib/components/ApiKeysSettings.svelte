<script lang="ts">
  import { onMount } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { KeyRound, Copy, Trash2 } from 'lucide-svelte'
  import { toast } from 'svelte-sonner'
  import { readErrorMessage } from '$lib/http'

  type ApiKeyRow = {
    id: string
    name: string
    prefix: string
    lastUsedAt: string | null
    createdAt: string
  }

  let apiKeys = $state<ApiKeyRow[]>([])
  let name = $state('')
  let issuedKey = $state<string | null>(null)
  let issuedKeyId = $state<string | null>(null)
  let loading = $state(true)
  let creating = $state(false)
  let errorMessage = $state<string | null>(null)

  function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : 'Never'
  }

  async function loadApiKeys() {
    loading = true
    errorMessage = null
    try {
      const response = await fetch('/api/settings/api-keys')
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to load API keys.'))
      const payload = (await response.json()) as { apiKeys: ApiKeyRow[] }
      apiKeys = payload.apiKeys
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load API keys.'
    } finally {
      loading = false
    }
  }

  async function createKey() {
    const trimmedName = name.trim()
    if (!trimmedName || creating) return
    creating = true
    errorMessage = null
    try {
      const response = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmedName })
      })
      if (!response.ok)
        throw new Error(await readErrorMessage(response, 'Failed to create API key.'))
      const payload = (await response.json()) as { apiKey: ApiKeyRow & { key: string } }
      const { key, ...metadata } = payload.apiKey
      issuedKey = key
      issuedKeyId = metadata.id
      apiKeys = [metadata, ...apiKeys]
      name = ''
      toast('API key created')
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to create API key.'
    } finally {
      creating = false
    }
  }

  async function revokeKey(id: string) {
    const response = await fetch(`/api/settings/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      errorMessage = await readErrorMessage(response, 'Failed to revoke API key.')
      return
    }
    apiKeys = apiKeys.filter((key) => key.id !== id)
    if (issuedKeyId === id) {
      issuedKey = null
      issuedKeyId = null
    }
    toast('API key revoked')
    await invalidateAll()
  }

  async function copyIssuedKey() {
    if (!issuedKey) return
    await navigator.clipboard.writeText(issuedKey)
    toast('API key copied')
  }

  onMount(() => void loadApiKeys())
</script>

<div class="space-y-5">
  <div>
    <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">External API</h2>
    <p class="mt-1 text-sm text-zinc-500">
      Create keys for REST and MCP clients. Keys have full mail read and send access.
    </p>
  </div>

  <div class="rounded-xl border border-white/8 bg-white/3 p-4">
    <label class="block">
      <span class="text-sm font-medium text-zinc-200">Key name</span>
      <span class="mt-1 block text-xs text-zinc-500">Use a name that identifies the client.</span>
      <div class="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          bind:value={name}
          maxlength="80"
          placeholder="Automation server"
          class="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onclick={() => void createKey()}
          disabled={!name.trim() || creating}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <KeyRound size={15} />
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </div>
    </label>
  </div>

  {#if issuedKey}
    <div class="rounded-xl border border-amber-300/20 bg-amber-400/8 p-4">
      <p class="text-sm font-medium text-amber-100">
        Copy this key now. It will not be shown again.
      </p>
      <div class="mt-3 flex items-start gap-2">
        <code class="min-w-0 flex-1 rounded-lg bg-black/25 p-3 text-xs break-all text-amber-50">
          {issuedKey}
        </code>
        <button
          type="button"
          onclick={() => void copyIssuedKey()}
          aria-label="Copy API key"
          class="rounded-lg border border-amber-300/20 p-2 text-amber-100 hover:bg-amber-300/10"
        >
          <Copy size={16} />
        </button>
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <p class="rounded-lg border border-rose-400/20 bg-rose-400/8 p-3 text-sm text-rose-200">
      {errorMessage}
    </p>
  {/if}

  <div class="overflow-hidden rounded-xl border border-white/8 bg-white/3">
    {#if loading}
      <p class="p-4 text-sm text-zinc-500">Loading API keys…</p>
    {:else if apiKeys.length === 0}
      <p class="p-4 text-sm text-zinc-500">No API keys have been created.</p>
    {:else}
      <div class="divide-y divide-white/8">
        {#each apiKeys as apiKey (apiKey.id)}
          <div class="flex items-center gap-4 p-4">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-zinc-200">{apiKey.name}</p>
              <p class="mt-1 font-mono text-xs text-zinc-500">{apiKey.prefix}</p>
              <p class="mt-1 text-xs text-zinc-600">
                Created {formatDate(apiKey.createdAt)} · Last used {formatDate(apiKey.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              onclick={() => void revokeKey(apiKey.id)}
              aria-label={`Revoke ${apiKey.name}`}
              class="rounded-lg border border-white/10 p-2 text-zinc-500 hover:bg-white/8 hover:text-rose-300"
            >
              <Trash2 size={15} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <a
    href={resolve('/api-docs')}
    class="inline-flex text-sm font-medium text-blue-300 hover:text-blue-200"
  >
    Open API and MCP documentation →
  </a>
</div>
