<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Download,
    Loader2,
    Mail,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    X
  } from 'lucide-svelte'

  type Contact = {
    id: number
    name: string
    email: string
    display: string
    source: string
    useCount: number
    lastUsedAt: string | null
    updatedAt: string
  }

  let contacts = $state<Contact[]>([])
  let query = $state('')
  let loading = $state(false)
  let saving = $state(false)
  let importing = $state(false)
  let errorMessage = $state<string | null>(null)
  let editing = $state<Contact | null>(null)
  let deleting = $state<Contact | null>(null)
  let formOpen = $state(false)
  let formName = $state('')
  let formEmail = $state('')
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const filteredLabel = $derived(query.trim() ? `Results for "${query.trim()}"` : 'All contacts')

  function formatDate(value: string | null) {
    if (!value) return 'Never'
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(value))
  }

  async function loadContacts() {
    loading = true
    errorMessage = null
    try {
      const q = query.trim()
      const url = q
        ? `/api/contacts?limit=100&q=${encodeURIComponent(q)}`
        : '/api/contacts?limit=100'
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      contacts = data.contacts as Contact[]
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load contacts.'
    } finally {
      loading = false
    }
  }

  function scheduleSearch() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void loadContacts(), 150)
  }

  function resetForm() {
    editing = null
    formName = ''
    formEmail = ''
    formOpen = false
  }

  function startAdd() {
    editing = null
    formName = ''
    formEmail = ''
    formOpen = true
  }

  function startEdit(contact: Contact) {
    editing = contact
    formName = contact.name
    formEmail = contact.email
    formOpen = true
  }

  async function saveContact() {
    if (saving) return
    saving = true
    errorMessage = null
    try {
      const payload = JSON.stringify({ name: formName.trim(), email: formEmail.trim() })
      const url = editing ? `/api/contacts?id=${editing.id}` : '/api/contacts'
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload
      })
      if (!res.ok) throw new Error(await res.text())
      resetForm()
      await loadContacts()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to save contact.'
    } finally {
      saving = false
    }
  }

  async function deleteContact() {
    if (!deleting) return
    errorMessage = null
    const contact = deleting
    const res = await fetch(`/api/contacts?id=${contact.id}`, { method: 'DELETE' })
    if (!res.ok) {
      errorMessage = await res.text()
      return
    }
    contacts = contacts.filter((item) => item.id !== contact.id)
    if (editing?.id === contact.id) resetForm()
    deleting = null
  }

  async function importFromMail() {
    importing = true
    errorMessage = null
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'import' })
      })
      if (!res.ok) throw new Error(await res.text())
      await loadContacts()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to import contacts.'
    } finally {
      importing = false
    }
  }

  onMount(() => {
    void loadContacts()
  })
</script>

<svelte:head>
  <title>Contacts · Inbox</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
  <div class="border-b border-white/8 p-4 sm:p-5">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-white">Contacts</h1>
        <p class="mt-1 text-sm text-zinc-500">Address book for compose suggestions.</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label="Import from mail"
          title="Import from mail"
          onclick={() => void importFromMail()}
          disabled={importing}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if importing}
            <Loader2 size={15} class="animate-spin" />
          {:else}
            <Download size={15} />
          {/if}
        </button>
        <button
          type="button"
          aria-label="Add contact"
          onclick={startAdd}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  </div>

  <div class="min-h-0 flex-1">
    <section class="flex h-full min-h-0 flex-col">
      <div class="space-y-3 border-b border-white/8 p-4 sm:p-5">
        <div class="relative">
          <Search
            size={15}
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="search"
            bind:value={query}
            oninput={scheduleSearch}
            placeholder="Search name or email"
            class="w-full rounded-xl border border-white/8 bg-black/20 py-2.5 pr-3 pl-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/16 focus:outline-none"
          />
        </div>
        <div class="flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span>{filteredLabel}</span>
          <button
            type="button"
            onclick={() => void loadContacts()}
            class="inline-flex items-center gap-1.5 text-zinc-400 transition hover:text-zinc-200"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {#if errorMessage}
        <p class="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
          {errorMessage}
        </p>
      {/if}

      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if loading}
          <div class="flex h-48 items-center justify-center text-sm text-zinc-500">
            <Loader2 size={16} class="mr-2 animate-spin" />
            Loading contacts
          </div>
        {:else if contacts.length === 0}
          <div class="flex h-48 flex-col items-center justify-center px-6 text-center">
            <Mail size={24} class="text-zinc-600" />
            <p class="mt-3 text-sm font-medium text-zinc-300">No contacts found</p>
            <p class="mt-1 max-w-sm text-sm text-zinc-500">
              Import from synced mail or add contacts manually.
            </p>
          </div>
        {:else}
          <div class="divide-y divide-white/6">
            {#each contacts as contact (contact.id)}
              <div class="flex items-center gap-3 px-4 py-3 transition hover:bg-white/3 sm:px-5">
                <div
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-zinc-300"
                >
                  {(contact.name || contact.email).slice(0, 2).toUpperCase()}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-zinc-200">
                    {contact.name || contact.email}
                  </p>
                  <p class="truncate text-xs text-zinc-500">{contact.email}</p>
                </div>
                <div class="hidden text-right text-xs text-zinc-500 sm:block">
                  <p>{contact.useCount} uses</p>
                  <p>{formatDate(contact.lastUsedAt)}</p>
                </div>
                <button
                  type="button"
                  aria-label="Edit contact"
                  onclick={() => startEdit(contact)}
                  class="rounded-lg p-2 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Delete contact"
                  onclick={() => (deleting = contact)}
                  class="rounded-lg p-2 text-zinc-500 transition hover:bg-white/6 hover:text-rose-300"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>

{#if formOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) resetForm()
    }}
  >
    <div
      class="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit contact' : 'Add contact'}
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-200">
          {editing ? 'Edit contact' : 'Add contact'}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onclick={resetForm}
          class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
        >
          <X size={14} />
        </button>
      </div>

      <form
        class="space-y-3"
        onsubmit={(event) => {
          event.preventDefault()
          void saveContact()
        }}
      >
        <label class="block">
          <span class="text-xs font-medium text-zinc-500">Name</span>
          <input
            type="text"
            bind:value={formName}
            class="mt-1 w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/16 focus:outline-none"
            placeholder="Jane Doe"
          />
        </label>

        <label class="block">
          <span class="text-xs font-medium text-zinc-500">Email</span>
          <input
            type="email"
            bind:value={formEmail}
            required
            class="mt-1 w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/16 focus:outline-none"
            placeholder="jane@example.com"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if saving}
            <Loader2 size={15} class="animate-spin" />
            Saving
          {:else}
            <Plus size={15} />
            {editing ? 'Save changes' : 'Add contact'}
          {/if}
        </button>
      </form>
    </div>
  </div>
{/if}

{#if deleting}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) deleting = null
    }}
  >
    <div
      class="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Delete contact"
    >
      <div class="mb-4 flex items-start gap-3">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300"
        >
          <Trash2 size={16} />
        </div>
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-200">Delete contact</h2>
          <p class="mt-1 text-sm text-zinc-500">
            {deleting.display} will be removed from address book suggestions.
          </p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (deleting = null)}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/8"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={() => void deleteContact()}
          class="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}
