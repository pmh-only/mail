<script lang="ts">
  import { resolve } from '$app/paths'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import {
    Download,
    Loader2,
    Mail,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    Users,
    Upload,
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

  type ContactGroup = {
    id: number
    name: string
    description: string
    display: string
    members: Contact[]
    updatedAt: string
  }

  type ContactCsvPreviewRow = {
    row: number
    name: string
    email: string
    status: 'valid' | 'duplicate' | 'invalid'
    error: string | null
  }

  type ContactCsvPreview = {
    rows: ContactCsvPreviewRow[]
    validCount: number
    duplicateCount: number
    invalidCount: number
  }

  let contacts = $state<Contact[]>([])
  let groups = $state<ContactGroup[]>([])
  let query = $state('')
  let loading = $state(false)
  let saving = $state(false)
  let importing = $state(false)
  let importingCsv = $state(false)
  let exportingCsv = $state(false)
  let errorMessage = $state<string | null>(null)
  let editing = $state<Contact | null>(null)
  let deleting = $state<Contact | null>(null)
  let csvPreview = $state<ContactCsvPreview | null>(null)
  let csvText = $state('')
  let csvFileName = $state('')
  let csvInput = $state<HTMLInputElement | null>(null)
  let formOpen = $state(false)
  let formName = $state('')
  let formEmail = $state('')
  let groupFormOpen = $state(false)
  let groupSaving = $state(false)
  let editingGroup = $state<ContactGroup | null>(null)
  let deletingGroup = $state<ContactGroup | null>(null)
  let groupName = $state('')
  let groupDescription = $state('')
  let groupContactIds = $state<number[]>([])
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
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load contacts.'))
      const data = await res.json()
      contacts = data.contacts as Contact[]
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to load contacts.')
    } finally {
      loading = false
    }
  }

  async function loadGroups() {
    errorMessage = null
    try {
      const res = await fetch('/api/contact-groups?limit=100')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load contact groups.'))
      const data = await res.json()
      groups = data.groups as ContactGroup[]
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to load contact groups.')
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

  function resetGroupForm() {
    editingGroup = null
    groupName = ''
    groupDescription = ''
    groupContactIds = []
    groupFormOpen = false
  }

  function startAdd() {
    editing = null
    formName = ''
    formEmail = ''
    formOpen = true
  }

  function startAddGroup() {
    editingGroup = null
    groupName = ''
    groupDescription = ''
    groupContactIds = []
    groupFormOpen = true
  }

  function startEdit(contact: Contact) {
    editing = contact
    formName = contact.name
    formEmail = contact.email
    formOpen = true
  }

  function startEditGroup(group: ContactGroup) {
    editingGroup = group
    groupName = group.name
    groupDescription = group.description
    groupContactIds = group.members.map((member) => member.id)
    groupFormOpen = true
  }

  function toggleGroupContact(contactId: number) {
    groupContactIds = groupContactIds.includes(contactId)
      ? groupContactIds.filter((id) => id !== contactId)
      : [...groupContactIds, contactId]
  }

  async function saveContact() {
    if (saving) return
    saving = true
    errorMessage = null
    const updated = Boolean(editing)
    try {
      const payload = JSON.stringify({ name: formName.trim(), email: formEmail.trim() })
      const url = editing ? `/api/contacts?id=${editing.id}` : '/api/contacts'
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to save contact.'))
      resetForm()
      await loadContacts()
      toast(updated ? 'Contact updated' : 'Contact created')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to save contact.')
    } finally {
      saving = false
    }
  }

  async function saveGroup() {
    if (groupSaving) return
    groupSaving = true
    errorMessage = null
    const updated = Boolean(editingGroup)
    try {
      const payload = JSON.stringify({
        name: groupName.trim(),
        description: groupDescription.trim(),
        contactIds: groupContactIds
      })
      const url = editingGroup ? `/api/contact-groups?id=${editingGroup.id}` : '/api/contact-groups'
      const res = await fetch(url, {
        method: editingGroup ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to save group.'))
      resetGroupForm()
      await loadGroups()
      toast(updated ? 'Group updated' : 'Group created')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to save group.')
    } finally {
      groupSaving = false
    }
  }

  async function deleteContact() {
    if (!deleting) return
    errorMessage = null
    const contact = deleting
    try {
      const res = await fetch(`/api/contacts?id=${contact.id}`, { method: 'DELETE' })
      if (!res.ok) {
        errorMessage = await readErrorMessage(res, 'Failed to delete contact.')
        return
      }

      contacts = contacts.filter((item) => item.id !== contact.id)
      if (editing?.id === contact.id) resetForm()
      deleting = null
      toast('Contact deleted')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to delete contact.')
    }
  }

  async function deleteGroup() {
    if (!deletingGroup) return
    errorMessage = null
    const group = deletingGroup
    try {
      const res = await fetch(`/api/contact-groups?id=${group.id}`, { method: 'DELETE' })
      if (!res.ok) {
        errorMessage = await readErrorMessage(res, 'Failed to delete group.')
        return
      }

      groups = groups.filter((item) => item.id !== group.id)
      if (editingGroup?.id === group.id) resetGroupForm()
      deletingGroup = null
      toast('Group deleted')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to delete group.')
    }
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
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to import contacts.'))
      const { imported } = (await res.json()) as { imported: number }
      await loadContacts()
      toast(`${imported} contact${imported === 1 ? '' : 's'} imported`)
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to import contacts.')
    } finally {
      importing = false
    }
  }

  async function previewCsvFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    importingCsv = true
    errorMessage = null
    csvPreview = null
    csvText = ''
    csvFileName = file.name
    try {
      const text = await file.text()
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'preview-csv', csv: text })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to preview CSV.'))
      const data = await res.json()
      csvText = text
      csvPreview = data.preview as ContactCsvPreview
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to preview CSV.')
    } finally {
      importingCsv = false
      input.value = ''
    }
  }

  function closeCsvPreview() {
    csvPreview = null
    csvText = ''
    csvFileName = ''
  }

  async function importCsv() {
    if (!csvText || importingCsv) return
    importingCsv = true
    errorMessage = null
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'import-csv', csv: csvText })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to import CSV.'))
      const { imported } = (await res.json()) as { imported: number }
      closeCsvPreview()
      await loadContacts()
      toast(`${imported} contact${imported === 1 ? '' : 's'} imported`)
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to import CSV.')
    } finally {
      importingCsv = false
    }
  }

  async function exportCsv() {
    exportingCsv = true
    errorMessage = null
    try {
      const res = await fetch('/api/contacts?format=csv')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to export contacts.'))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'contacts.csv'
      link.click()
      URL.revokeObjectURL(url)
      toast('Contacts exported')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to export contacts.')
    } finally {
      exportingCsv = false
    }
  }

  onMount(() => {
    void loadContacts()
    void loadGroups()
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
        <input
          bind:this={csvInput}
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          onchange={(event) => void previewCsvFile(event)}
        />
        <button
          type="button"
          aria-label="Import CSV"
          title="Import CSV"
          onclick={() => csvInput?.click()}
          disabled={importingCsv}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if importingCsv}
            <Loader2 size={15} class="animate-spin" />
          {:else}
            <Upload size={15} />
          {/if}
        </button>
        <button
          type="button"
          aria-label="Export CSV"
          title="Export CSV"
          onclick={() => void exportCsv()}
          disabled={exportingCsv}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if exportingCsv}
            <Loader2 size={15} class="animate-spin" />
          {:else}
            <Download size={15} />
          {/if}
        </button>
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
          aria-label="Add group"
          title="Add group"
          onclick={startAddGroup}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/8"
        >
          <Users size={16} />
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
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="border-b border-white/8 p-4 sm:p-5">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-zinc-200">Groups</h2>
              <p class="mt-1 text-xs text-zinc-500">
                Use groups in compose to add all members at once.
              </p>
            </div>
            <button
              type="button"
              onclick={startAddGroup}
              class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 transition hover:bg-white/8"
            >
              <Users size={13} />
              New group
            </button>
          </div>
          {#if groups.length === 0}
            <p class="rounded-lg border border-dashed border-white/10 p-3 text-sm text-zinc-500">
              No groups yet. Create one to speed up recurring recipients.
            </p>
          {:else}
            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {#each groups as group (group.id)}
                <div class="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-zinc-200">{group.name}</p>
                      <p class="mt-0.5 text-xs text-zinc-500">
                        {group.members.length}
                        {group.members.length === 1 ? 'member' : 'members'}
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Edit group"
                        onclick={() => startEditGroup(group)}
                        class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete group"
                        onclick={() => (deletingGroup = group)}
                        class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-rose-300"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {#if group.description}
                    <p class="mt-2 line-clamp-2 text-xs text-zinc-500">{group.description}</p>
                  {/if}
                  {#if group.members.length > 0}
                    <p class="mt-2 truncate text-xs text-zinc-400">
                      {group.members.map((member) => member.name || member.email).join(', ')}
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
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
              <div class="flex items-center gap-2 px-4 py-3 transition hover:bg-white/3 sm:px-5">
                <a
                  href={resolve(`/contacts/${contact.id}`)}
                  class="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus:ring-2 focus:ring-blue-500/60 focus:outline-none"
                >
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
                </a>
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

{#if groupFormOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) resetGroupForm()
    }}
  >
    <div
      class="w-full max-w-lg rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={editingGroup ? 'Edit group' : 'Add group'}
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-200">
          {editingGroup ? 'Edit group' : 'Add group'}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onclick={resetGroupForm}
          class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
        >
          <X size={14} />
        </button>
      </div>

      <form
        class="space-y-3"
        onsubmit={(event) => {
          event.preventDefault()
          void saveGroup()
        }}
      >
        <label class="block">
          <span class="text-xs font-medium text-zinc-500">Group name</span>
          <input
            type="text"
            bind:value={groupName}
            required
            class="mt-1 w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/16 focus:outline-none"
            placeholder="Design team"
          />
        </label>

        <label class="block">
          <span class="text-xs font-medium text-zinc-500">Description</span>
          <textarea
            bind:value={groupDescription}
            rows="2"
            class="mt-1 w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/16 focus:outline-none"
            placeholder="Optional note"
          ></textarea>
        </label>

        <div>
          <span class="text-xs font-medium text-zinc-500">Members</span>
          <div class="mt-1 max-h-52 overflow-y-auto rounded-lg border border-white/8 bg-black/20">
            {#if contacts.length === 0}
              <p class="p-3 text-sm text-zinc-500">Add contacts before creating a group.</p>
            {:else}
              {#each contacts as contact (contact.id)}
                <label
                  class="flex cursor-pointer items-center gap-3 border-b border-white/6 px-3 py-2 last:border-b-0 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={groupContactIds.includes(contact.id)}
                    onchange={() => toggleGroupContact(contact.id)}
                    class="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  <span class="min-w-0 text-sm text-zinc-300">
                    <span class="block truncate">{contact.name || contact.email}</span>
                    {#if contact.name}
                      <span class="block truncate text-xs text-zinc-500">{contact.email}</span>
                    {/if}
                  </span>
                </label>
              {/each}
            {/if}
          </div>
        </div>

        <button
          type="submit"
          disabled={groupSaving || contacts.length === 0}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if groupSaving}
            <Loader2 size={15} class="animate-spin" />
            Saving
          {:else}
            <Users size={15} />
            {editingGroup ? 'Save group' : 'Create group'}
          {/if}
        </button>
      </form>
    </div>
  </div>
{/if}

{#if deletingGroup}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) deletingGroup = null
    }}
  >
    <div
      class="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Delete group"
    >
      <div class="mb-4 flex items-start gap-3">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300"
        >
          <Trash2 size={16} />
        </div>
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-200">Delete group</h2>
          <p class="mt-1 text-sm text-zinc-500">
            {deletingGroup.name} will be removed from compose group suggestions.
          </p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (deletingGroup = null)}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/8"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={() => void deleteGroup()}
          class="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}

{#if csvPreview}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeCsvPreview()
    }}
  >
    <div
      class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Preview CSV import"
    >
      <div class="flex items-start justify-between gap-4 border-b border-white/8 p-4">
        <div>
          <h2 class="text-sm font-semibold text-zinc-200">Preview CSV import</h2>
          <p class="mt-1 text-xs text-zinc-500">
            {csvFileName || 'Selected CSV'} &middot; {csvPreview.validCount} valid, {csvPreview.duplicateCount}
            duplicate, {csvPreview.invalidCount} invalid
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onclick={closeCsvPreview}
          class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
          ><X size={14} /></button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <table class="w-full text-left text-sm">
          <thead class="sticky top-0 bg-zinc-950 text-xs text-zinc-500"
            ><tr class="border-b border-white/8"
              ><th class="px-4 py-2 font-medium">Row</th><th class="px-4 py-2 font-medium">Name</th
              ><th class="px-4 py-2 font-medium">Email</th><th class="px-4 py-2 font-medium"
                >Status</th
              ></tr
            ></thead
          >
          <tbody class="divide-y divide-white/6">
            {#each csvPreview.rows.slice(0, 100) as row (row.row)}
              <tr
                ><td class="px-4 py-2 text-xs text-zinc-500">{row.row}</td><td
                  class="px-4 py-2 text-zinc-300">{row.name || 'N/A'}</td
                ><td class="px-4 py-2 text-zinc-300">{row.email || 'N/A'}</td><td
                  class="px-4 py-2 text-xs"
                  >{#if row.status === 'valid'}<span class="text-emerald-300">Valid</span
                    >{:else if row.status === 'duplicate'}<span class="text-amber-300"
                      >Duplicate</span
                    >{:else}<span class="text-rose-300">{row.error}</span>{/if}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
      <div class="flex justify-end gap-2 border-t border-white/8 p-4">
        <button
          type="button"
          onclick={closeCsvPreview}
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/8"
          >Cancel</button
        >
        <button
          type="button"
          onclick={() => void importCsv()}
          disabled={importingCsv || csvPreview.validCount === 0}
          class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >{#if importingCsv}<Loader2 size={15} class="animate-spin" />Importing{:else}Import {csvPreview.validCount}
            contacts{/if}</button
        >
      </div>
    </div>
  </div>
{/if}

<ErrorDialog message={errorMessage} title="Contacts error" onclose={() => (errorMessage = null)} />
