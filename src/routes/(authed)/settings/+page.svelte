<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { onMount } from 'svelte'
  import { Trash2, Plus, GripVertical } from 'lucide-svelte'

  type ConfigSection = {
    host: string
    port: number
    secure: boolean
    user: string
    password: string
    mailbox?: string
    pollSeconds?: number
    from?: string
    source: 'db' | 'env'
  }

  type Props = {
    data: {
      config: {
        signature: string
        imap: ConfigSection & { mailbox: string; pollSeconds: number }
        smtp: ConfigSection & { from: string }
        oidc: {
          discoveryUrl: string
          clientId: string
          clientSecret: string
          source: 'db' | 'env'
        }
      }
      origin: string
      simplifiedView: boolean
    }
  }

  type ImapForm = Props['data']['config']['imap'] & { password: string }
  type SmtpForm = Props['data']['config']['smtp'] & { password: string }
  type OidcForm = Props['data']['config']['oidc'] & { clientSecret: string }

  class SettingsFormState {
    imap = $state({} as ImapForm)
    smtp = $state({} as SmtpForm)
    oidc = $state({} as OidcForm)
    signature = $state('')
    simplifiedView = $state(false)

    constructor(config: Props['data']['config'], simplifiedView: boolean) {
      this.imap = { ...config.imap, password: '' }
      this.smtp = { ...config.smtp, password: '' }
      this.oidc = { ...config.oidc, clientSecret: '' }
      this.signature = config.signature
      this.simplifiedView = simplifiedView
    }
  }

  let { data }: Props = $props()

  // Editable form state
  let form = $derived.by(() => new SettingsFormState(data.config, data.simplifiedView))
  let imap = $derived(form.imap)
  let smtp = $derived(form.smtp)
  let oidc = $derived(form.oidc)
  let simplifiedView = $derived(form.simplifiedView)

  type Filter = {
    id: number
    field: string
    operator: string
    value: string
    action: string
    target: string | null
    enabled: boolean
    sortOrder: number
  }

  let filters = $state<Filter[]>([])
  let showAddFilter = $state(false)
  let newFilter = $state({
    field: 'from',
    operator: 'contains',
    value: '',
    action: 'mark_read',
    target: ''
  })

  async function loadFilters() {
    const res = await fetch('/api/filters')
    if (res.ok) {
      const data = await res.json()
      filters = data.filters as Filter[]
    }
  }

  async function addFilter() {
    if (!newFilter.value.trim()) return
    const res = await fetch('/api/filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        field: newFilter.field,
        operator: newFilter.operator,
        value: newFilter.value,
        action: newFilter.action,
        target: newFilter.action === 'move' ? newFilter.target : null,
        sort_order: filters.length
      })
    })
    if (res.ok) {
      await loadFilters()
      showAddFilter = false
      newFilter = {
        field: 'from',
        operator: 'contains',
        value: '',
        action: 'mark_read',
        target: ''
      }
    }
  }

  async function deleteFilter(id: number) {
    await fetch(`/api/filters/${id}`, { method: 'DELETE' })
    await loadFilters()
  }

  async function toggleFilter(filter: Filter) {
    await fetch(`/api/filters/${filter.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !filter.enabled })
    })
    await loadFilters()
  }

  onMount(() => {
    void loadFilters()
  })

  let notifStatus = $state<'idle' | 'generating' | 'done' | 'error'>('idle')
  let notifPublicKey = $state('')

  async function generateVapid() {
    notifStatus = 'generating'
    try {
      const res = await fetch('/api/push/generate-vapid', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        notifPublicKey = data.publicKey
        notifStatus = 'done'
      } else {
        notifStatus = 'error'
      }
    } catch {
      notifStatus = 'error'
    }
  }

  let saving = $state(false)
  let testingImap = $state(false)
  let testingSmtp = $state(false)
  let saveError = $state('')
  let saveSuccess = $state(false)
  let imapTestResult = $state<{ ok: boolean; message: string } | null>(null)
  let smtpTestResult = $state<{ ok: boolean; message: string } | null>(null)

  async function save() {
    saving = true
    saveError = ''
    saveSuccess = false
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imap, smtp, oidc, signature: form.signature, simplifiedView })
      })
      if (!res.ok) {
        const text = await res.text()
        saveError = text || `HTTP ${res.status}`
      } else {
        saveSuccess = true
        // Clear passwords after save so they show as bullets again
        imap.password = ''
        smtp.password = ''
        oidc.clientSecret = ''
        await invalidateAll()
      }
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function testImap() {
    testingImap = true
    imapTestResult = null
    try {
      const res = await fetch('/api/settings/test-imap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imap })
      })
      const data = await res.json()
      imapTestResult = {
        ok: res.ok,
        message: data.message ?? (res.ok ? 'Connected successfully' : 'Connection failed')
      }
    } catch (err) {
      imapTestResult = { ok: false, message: err instanceof Error ? err.message : String(err) }
    } finally {
      testingImap = false
    }
  }

  async function testSmtp() {
    testingSmtp = true
    smtpTestResult = null
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ smtp })
      })
      const data = await res.json()
      smtpTestResult = {
        ok: res.ok,
        message: data.message ?? (res.ok ? 'Connected successfully' : 'Connection failed')
      }
    } catch (err) {
      smtpTestResult = { ok: false, message: err instanceof Error ? err.message : String(err) }
    } finally {
      testingSmtp = false
    }
  }
</script>

<div class="h-full overflow-y-auto p-4 sm:p-6 lg:p-10">
  <div class="mx-auto max-w-3xl space-y-10">
    <div>
      <h1 class="text-xl font-semibold text-white">Settings</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Values set here take priority over environment variables.
      </p>
    </div>

    <!-- IMAP -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
          IMAP — Incoming Mail
        </h2>
        {#if data.config.imap.source === 'db'}
          <span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
            >from DB</span
          >
        {:else if data.config.imap.host}
          <span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
            >from env</span
          >
        {/if}
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="col-span-2 sm:col-span-1">
          <label class="mb-1 block text-xs text-zinc-400" for="imap-host">Host</label>
          <input
            id="imap-host"
            type="text"
            placeholder={data.config.imap.source === 'env'
              ? data.config.imap.host || 'e.g. imap.gmail.com'
              : 'e.g. imap.gmail.com'}
            bind:value={imap.host}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="imap-port">Port</label>
          <input
            id="imap-port"
            type="number"
            min="1"
            max="65535"
            bind:value={imap.port}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="mb-1 block text-xs text-zinc-400" for="imap-user">Username / Email</label>
          <input
            id="imap-user"
            type="text"
            autocomplete="username"
            placeholder="you@example.com"
            bind:value={imap.user}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="mb-1 block text-xs text-zinc-400" for="imap-password">Password</label>
          <input
            id="imap-password"
            type="password"
            autocomplete="current-password"
            placeholder={data.config.imap.password ? '(unchanged)' : 'Enter password'}
            bind:value={imap.password}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="imap-mailbox">Default Mailbox</label>
          <input
            id="imap-mailbox"
            type="text"
            placeholder="INBOX"
            bind:value={imap.mailbox}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="imap-poll"
            >Poll interval (seconds)</label
          >
          <input
            id="imap-poll"
            type="number"
            min="5"
            bind:value={imap.pollSeconds}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2 flex items-center gap-2">
          <label class="relative inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={imap.secure} class="peer sr-only" />
            <div
              class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
            ></div>
            <span class="text-sm text-zinc-300">TLS / SSL</span>
          </label>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={testImap}
          disabled={testingImap}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {testingImap ? 'Testing…' : 'Test connection'}
        </button>
        {#if imapTestResult}
          <span class={imapTestResult.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>
            {imapTestResult.message}
          </span>
        {/if}
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- SMTP -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
          SMTP — Outgoing Mail
        </h2>
        {#if data.config.smtp.source === 'db'}
          <span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
            >from DB</span
          >
        {:else if data.config.smtp.host}
          <span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
            >from env</span
          >
        {/if}
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="col-span-2 sm:col-span-1">
          <label class="mb-1 block text-xs text-zinc-400" for="smtp-host">Host</label>
          <input
            id="smtp-host"
            type="text"
            placeholder="e.g. smtp.gmail.com"
            bind:value={smtp.host}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="smtp-port">Port</label>
          <input
            id="smtp-port"
            type="number"
            min="1"
            max="65535"
            bind:value={smtp.port}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="mb-1 block text-xs text-zinc-400" for="smtp-user">Username / Email</label>
          <input
            id="smtp-user"
            type="text"
            autocomplete="username"
            placeholder="you@example.com"
            bind:value={smtp.user}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="mb-1 block text-xs text-zinc-400" for="smtp-password">Password</label>
          <input
            id="smtp-password"
            type="password"
            autocomplete="current-password"
            placeholder={data.config.smtp.password ? '(unchanged)' : 'Enter password'}
            bind:value={smtp.password}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="mb-1 block text-xs text-zinc-400" for="smtp-from"
            >From address (optional)</label
          >
          <input
            id="smtp-from"
            type="text"
            placeholder="Defaults to username if empty"
            bind:value={smtp.from}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div class="col-span-2 flex items-center gap-2">
          <label class="relative inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={smtp.secure} class="peer sr-only" />
            <div
              class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
            ></div>
            <span class="text-sm text-zinc-300">TLS / SSL</span>
          </label>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={testSmtp}
          disabled={testingSmtp}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {testingSmtp ? 'Testing…' : 'Test connection'}
        </button>
        {#if smtpTestResult}
          <span class={smtpTestResult.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>
            {smtpTestResult.message}
          </span>
        {/if}
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- OIDC -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
          OIDC — Authentication
        </h2>
        {#if data.config.oidc.source === 'db'}
          <span class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
            >from DB</span
          >
        {:else if data.config.oidc.discoveryUrl || data.config.oidc.clientId}
          <span class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
            >from env</span
          >
        {/if}
      </div>

      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="oidc-discovery">Discovery URL</label>
          <input
            id="oidc-discovery"
            type="url"
            placeholder="https://auth.example.com/…/.well-known/openid-configuration"
            bind:value={oidc.discoveryUrl}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="oidc-client-id">Client ID</label>
          <input
            id="oidc-client-id"
            type="text"
            placeholder="your-client-id"
            bind:value={oidc.clientId}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-zinc-400" for="oidc-client-secret"
            >Client Secret</label
          >
          <input
            id="oidc-client-secret"
            type="password"
            autocomplete="new-password"
            placeholder={data.config.oidc.clientSecret ? '(unchanged)' : 'Enter client secret'}
            bind:value={oidc.clientSecret}
            class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <p class="text-xs text-zinc-500">
          Redirect URI to register with your provider: <span class="font-mono text-zinc-400"
            >{data.origin}/api/auth/oauth2/callback/oidc</span
          >
        </p>
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Interface -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Interface</h2>
      <div class="rounded-lg border border-white/8 bg-white/3 p-4">
        <label class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-sm font-medium text-zinc-200">
              Use simplified mailbox view on page load
            </p>
            <p class="mt-1 text-sm text-zinc-500">
              Open mailbox root pages in the swipeable card view by default.
            </p>
          </div>

          <span class="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" bind:checked={simplifiedView} class="peer sr-only" />
            <span
              class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
            ></span>
          </span>
        </label>
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Signature -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Signature</h2>
      <div class="space-y-2">
        <label class="block text-xs text-zinc-400" for="signature-input">
          Appended to new messages (HTML)
        </label>
        <textarea
          id="signature-input"
          rows="4"
          placeholder="--&#10;Your Name"
          bind:value={form.signature}
          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
        ></textarea>
        <p class="text-xs text-zinc-600">Accepts plain text or HTML.</p>
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Notifications -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
        Push Notifications
      </h2>
      <p class="text-sm text-zinc-500">
        Generate VAPID keys to enable browser push notifications for new mail. Keys are stored in
        the database and only need to be generated once.
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={() => void generateVapid()}
          disabled={notifStatus === 'generating'}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {notifStatus === 'generating' ? 'Generating…' : 'Generate VAPID keys'}
        </button>
        {#if notifStatus === 'done'}
          <span class="text-sm text-emerald-400">Keys generated. Reload to activate push.</span>
        {:else if notifStatus === 'error'}
          <span class="text-sm text-red-400">Failed to generate keys.</span>
        {/if}
      </div>
      {#if notifPublicKey}
        <p class="font-mono text-xs break-all text-zinc-600">{notifPublicKey}</p>
      {/if}
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Filters -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Filters</h2>
        <button
          type="button"
          onclick={() => (showAddFilter = !showAddFilter)}
          class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
        >
          <Plus size={12} /> Add rule
        </button>
      </div>

      {#if filters.length === 0 && !showAddFilter}
        <p class="text-sm text-zinc-600">
          No filters configured. Filters auto-process incoming mail.
        </p>
      {/if}

      {#each filters as filter (filter.id)}
        <div
          class="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 sm:flex-nowrap"
        >
          <GripVertical size={14} class="shrink-0 cursor-grab text-zinc-600" />
          <div class="min-w-0 flex-1 basis-full sm:basis-auto">
            <p class="text-xs text-zinc-300">
              <span class="text-zinc-500">If</span>
              <span class="font-medium text-zinc-200">{filter.field}</span>
              <span class="text-zinc-500">{filter.operator}</span>
              <span class="font-mono text-zinc-200">"{filter.value}"</span>
              <span class="text-zinc-500">→</span>
              <span class="font-medium text-zinc-200">
                {filter.action === 'mark_read'
                  ? 'Mark as read'
                  : filter.action === 'trash'
                    ? 'Move to trash'
                    : `Move to ${filter.target}`}
              </span>
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={filter.enabled}
              onchange={() => void toggleFilter(filter)}
              class="peer sr-only"
            />
            <div
              class="h-4 w-7 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-3"
            ></div>
          </label>
          <button
            type="button"
            onclick={() => void deleteFilter(filter.id)}
            class="shrink-0 text-zinc-600 hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}

      {#if showAddFilter}
        <div class="space-y-3 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 class="text-xs font-medium text-zinc-400">New rule</h3>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-zinc-500" for="new-filter-field">Field</label>
              <select
                id="new-filter-field"
                bind:value={newFilter.field}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="from">From</option>
                <option value="to">To</option>
                <option value="subject">Subject</option>
                <option value="cc">CC</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-500" for="new-filter-condition"
                >Condition</label
              >
              <select
                id="new-filter-condition"
                bind:value={newFilter.operator}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
              </select>
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-500" for="new-filter-value">Value</label>
              <input
                id="new-filter-value"
                type="text"
                bind:value={newFilter.value}
                placeholder="e.g. newsletter@example.com"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-500" for="new-filter-action">Action</label>
              <select
                id="new-filter-action"
                bind:value={newFilter.action}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="mark_read">Mark as read</option>
                <option value="trash">Move to trash</option>
                <option value="move">Move to folder…</option>
              </select>
            </div>
            {#if newFilter.action === 'move'}
              <div>
                <label class="mb-1 block text-xs text-zinc-500" for="new-filter-target"
                  >Target folder</label
                >
                <input
                  id="new-filter-target"
                  type="text"
                  bind:value={newFilter.target}
                  placeholder="e.g. INBOX.Newsletters"
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            {/if}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              onclick={addFilter}
              class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              Add filter
            </button>
            <button
              type="button"
              onclick={() => (showAddFilter = false)}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Save -->
    <div class="flex flex-wrap items-center gap-4">
      <button
        type="button"
        onclick={save}
        disabled={saving}
        class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
      {#if saveSuccess}
        <span class="text-sm text-emerald-400">Settings saved.</span>
      {/if}
      {#if saveError}
        <span class="text-sm text-red-400">{saveError}</span>
      {/if}
    </div>
  </div>
</div>
