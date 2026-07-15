<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { pathToSlug } from '$lib/mailbox'
  import { encodeThreadId } from '$lib/thread-url'
  import { ArrowLeft, Calendar, Loader2, Mail, MessageSquare, Pencil, Plus, X } from 'lucide-svelte'
  import { toast } from 'svelte-sonner'

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

  type ContactMessage = {
    id: number
    messageId: string
    mailbox: string
    uid: number
    flags: string[]
    subject: string
    from: string
    to: string
    cc: string
    preview: string
    receivedAt: string | null
    threadId: string | null
  }

  let { data } = $props<{ data: { contact: Contact; messages: ContactMessage[] } }>()

  const contact = $derived(data.contact)
  const messages = $derived(data.messages)
  let formOpen = $state(false)
  let formName = $state('')
  let formEmail = $state('')
  let saving = $state(false)
  let errorMessage = $state<string | null>(null)

  const initials = $derived((contact.name || contact.email).slice(0, 2).toUpperCase())

  function formatDate(value: string | null) {
    if (!value) return 'Never'
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(value))
  }

  function formatDateTime(value: string | null) {
    if (!value) return 'Unknown date'
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value))
  }

  function openEdit() {
    formName = contact.name
    formEmail = contact.email
    formOpen = true
  }

  async function saveContact() {
    if (saving) return
    saving = true
    errorMessage = null
    try {
      const res = await fetch(`/api/contacts?id=${contact.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), email: formEmail.trim() })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to save contact.'))
      formOpen = false
      await invalidateAll()
      toast.success('Contact updated')
    } catch (err) {
      errorMessage = errorMessageFromUnknown(err, 'Failed to save contact.')
    } finally {
      saving = false
    }
  }

  function messagePath(message: ContactMessage): `/${string}/${string}` {
    return `/${pathToSlug(message.mailbox)}/${message.id}`
  }

  function threadPath(
    message: ContactMessage
  ): `/${string}/${string}` | `/${string}/thread/${string}` {
    return message.threadId
      ? `/${pathToSlug(message.mailbox)}/thread/${encodeThreadId(message.threadId)}`
      : messagePath(message)
  }
</script>

<svelte:head>
  <title>{contact.display} · Contacts · Inbox</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
  <div class="border-b border-white/8 p-4 sm:p-5">
    <a
      href={resolve('/contacts')}
      class="mb-4 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-zinc-200"
    >
      <ArrowLeft size={15} />
      Contacts
    </a>

    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 items-center gap-4">
        <div
          class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-lg font-semibold text-blue-200"
        >
          {initials}
        </div>
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-semibold text-white">
            {contact.name || contact.email}
          </h1>
          <a
            class="mt-1 block truncate text-sm text-blue-300 hover:text-blue-200"
            href={`mailto:${contact.email}`}
          >
            {contact.email}
          </a>
        </div>
      </div>

      <button
        type="button"
        onclick={openEdit}
        class="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        <Pencil size={15} />
        Edit contact
      </button>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <section class="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        <h2 class="text-sm font-semibold text-zinc-200">Details</h2>
        <dl class="mt-4 space-y-4 text-sm">
          <div>
            <dt class="text-xs font-medium text-zinc-500">Source</dt>
            <dd class="mt-1 text-zinc-200 capitalize">{contact.source}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-zinc-500">Used in suggestions</dt>
            <dd class="mt-1 text-zinc-200">{contact.useCount} times</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-zinc-500">Last used</dt>
            <dd class="mt-1 text-zinc-200">{formatDate(contact.lastUsedAt)}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-zinc-500">Updated</dt>
            <dd class="mt-1 text-zinc-200">{formatDate(contact.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section class="min-w-0 rounded-xl border border-white/8 bg-white/[0.03]">
        <div class="flex items-center justify-between gap-3 border-b border-white/8 p-4">
          <div>
            <h2 class="text-sm font-semibold text-zinc-200">Recent messages</h2>
            <p class="mt-1 text-xs text-zinc-500">
              Messages where this address appears in headers.
            </p>
          </div>
          <Mail size={17} class="text-zinc-500" />
        </div>

        {#if messages.length === 0}
          <div class="flex h-48 flex-col items-center justify-center px-6 text-center">
            <MessageSquare size={24} class="text-zinc-600" />
            <p class="mt-3 text-sm font-medium text-zinc-300">No message history</p>
            <p class="mt-1 max-w-sm text-sm text-zinc-500">
              New synced mail involving this address will appear here.
            </p>
          </div>
        {:else}
          <div class="divide-y divide-white/6">
            {#each messages as message (message.id)}
              <article class="p-4 transition hover:bg-white/[0.03]">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <a href={resolve(messagePath(message))} class="min-w-0 flex-1">
                    <h3 class="truncate text-sm font-medium text-zinc-100">
                      {message.subject || '(No subject)'}
                    </h3>
                    <p class="mt-1 truncate text-xs text-zinc-500">From: {message.from}</p>
                    <p class="mt-1 truncate text-xs text-zinc-500">To: {message.to}</p>
                    {#if message.preview}
                      <p class="mt-2 line-clamp-2 text-sm text-zinc-400">{message.preview}</p>
                    {/if}
                  </a>

                  <div
                    class="flex shrink-0 items-center gap-3 text-xs text-zinc-500 sm:flex-col sm:items-end sm:gap-2"
                  >
                    <span class="inline-flex items-center gap-1">
                      <Calendar size={12} />
                      {formatDateTime(message.receivedAt)}
                    </span>
                    <a
                      class="text-blue-300 transition hover:text-blue-200"
                      href={resolve(threadPath(message))}
                    >
                      Open thread
                    </a>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

{#if formOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) formOpen = false
    }}
  >
    <div
      class="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Edit contact"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-200">Edit contact</h2>
        <button
          type="button"
          aria-label="Close"
          onclick={() => (formOpen = false)}
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
            Save changes
          {/if}
        </button>
      </form>
    </div>
  </div>
{/if}

<ErrorDialog message={errorMessage} title="Contact error" onclose={() => (errorMessage = null)} />
