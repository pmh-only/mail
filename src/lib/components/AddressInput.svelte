<script lang="ts">
  import { X } from 'lucide-svelte'
  import { parseRecipientList, splitRecipientList } from '$lib/recipients'

  type Contact = { name: string; email: string; display: string; type?: 'contact' }
  type ContactGroup = {
    id: number
    name: string
    display: string
    members: Contact[]
    type: 'group'
  }
  type Suggestion = Contact | ContactGroup

  type Props = {
    value: string
    id?: string
    placeholder?: string
    label?: string
  }

  let { value = $bindable(''), id, placeholder = 'recipient@example.com', label }: Props = $props()

  // Confirmed pills (full "Name <email>" or bare email entries)
  let pills = $state<string[]>([])
  // The partial text being typed right now
  let partial = $state('')
  let suggestions = $state<Suggestion[]>([])
  let highlightIndex = $state(-1)
  let showDropdown = $state(false)
  let inputEl = $state<HTMLInputElement | undefined>(undefined)
  const listboxId = $derived(id ? `${id}-listbox` : undefined)
  const invalidPills = $derived(parseRecipientList(value).filter((recipient) => !recipient.valid))
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Sync `value` → pills on mount and when value changes externally
  $effect(() => {
    const entries = value ? splitRecipientList(value) : []
    // Only reset pills if they differ from what we have (avoids infinite loop)
    const current = pills.join(', ')
    const incoming = entries.join(', ')
    if (current !== incoming) {
      pills = entries
    }
  })

  // Keep `value` prop in sync when pills change
  function syncValue() {
    value = pills.join(', ')
  }

  function emailKey(text: string) {
    return (text.match(/<([^>]+)>/)?.[1] ?? text).trim().toLowerCase()
  }

  function addPill(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const entries = splitRecipientList(trimmed).filter(
      (entry) => !pills.some((pill) => emailKey(pill) === emailKey(entry))
    )
    if (entries.length === 0) {
      partial = ''
      return
    }
    pills = [...pills, ...entries]
    partial = ''
    syncValue()
    showDropdown = false
    suggestions = []
    highlightIndex = -1
  }

  function removePill(index: number) {
    pills = pills.filter((_, i) => i !== index)
    syncValue()
  }

  function onInput() {
    showDropdown = false
    if (debounceTimer) clearTimeout(debounceTimer)
    const q = partial.trim()
    if (q.length < 1) {
      suggestions = []
      return
    }
    debounceTimer = setTimeout(async () => {
      const res = await fetch(`/api/contacts?includeGroups=1&q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        suggestions = [
          ...((data.groups ?? []) as ContactGroup[]).map((group) => ({
            ...group,
            type: 'group' as const
          })),
          ...((data.contacts ?? []) as Contact[]).map((contact) => ({
            ...contact,
            type: 'contact' as const
          }))
        ]
        highlightIndex = -1
        showDropdown = suggestions.length > 0
      }
    }, 200)
  }

  function selectSuggestion(suggestion: Suggestion) {
    if (suggestion.type === 'group') {
      for (const member of suggestion.members) addPill(member.display)
    } else {
      addPill(suggestion.display)
    }
    inputEl?.focus()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlightIndex = Math.min(highlightIndex + 1, suggestions.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlightIndex = Math.max(highlightIndex - 1, -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showDropdown && highlightIndex >= 0 && suggestions[highlightIndex]) {
        selectSuggestion(suggestions[highlightIndex])
      } else if (partial.trim()) {
        addPill(partial)
      }
    } else if (e.key === 'Escape') {
      showDropdown = false
      highlightIndex = -1
    } else if ((e.key === ',' || e.key === ' ') && partial.includes('@')) {
      e.preventDefault()
      addPill(partial)
    } else if (e.key === 'Backspace' && partial === '' && pills.length > 0) {
      removePill(pills.length - 1)
    }
  }

  function onBlur() {
    // Delay so click on suggestion fires first
    setTimeout(() => {
      if (partial.trim()) addPill(partial)
      showDropdown = false
    }, 150)
  }
</script>

<div class="relative flex w-full flex-wrap items-start gap-1 rounded-none bg-transparent py-1.5">
  {#if label}
    <span class="w-full shrink-0 pt-1 text-xs font-medium text-zinc-500 sm:w-10">{label}</span>
  {/if}

  {#each pills as pill, i (`${pill}-${i}`)}
    {@const parsedPill = parseRecipientList(pill)[0]}
    <span
      class={[
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
        parsedPill?.valid === false
          ? 'border border-rose-400/30 bg-rose-500/15 text-rose-100'
          : 'border border-white/10 bg-white/10 text-zinc-200'
      ].join(' ')}
      data-app-tooltip={parsedPill?.valid === false ? parsedPill.reason : undefined}
    >
      {pill}
      <button
        type="button"
        aria-label="Remove"
        onclick={() => removePill(i)}
        class="text-zinc-400 hover:text-zinc-100"
      >
        <X size={10} />
      </button>
    </span>
  {/each}

  <input
    {id}
    type="text"
    bind:this={inputEl}
    bind:value={partial}
    {placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
    onblur={onBlur}
    autocomplete="off"
    role="combobox"
    aria-label={label ?? 'Recipient'}
    aria-autocomplete="list"
    aria-expanded={showDropdown}
    aria-controls={listboxId}
    aria-haspopup="listbox"
    aria-invalid={invalidPills.length > 0}
    class="app-transparent-field min-w-[120px] flex-1 basis-[180px] py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
  />

  {#if invalidPills.length > 0}
    <p class="w-full pl-0 text-xs text-rose-300 sm:pl-10">
      Invalid recipient: {invalidPills.map((recipient) => recipient.raw).join(', ')}
    </p>
  {/if}

  {#if showDropdown && suggestions.length > 0}
    <ul
      id={listboxId}
      role="listbox"
      class="app-popover absolute top-full left-0 z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-white/10 shadow-xl backdrop-blur-xl"
    >
      {#each suggestions as suggestion, i (`${suggestion.type === 'group' ? `group-${suggestion.id}` : suggestion.email}-${i}`)}
        <li
          role="option"
          aria-selected={i === highlightIndex}
          class={[
            'cursor-pointer px-3 py-2 text-sm',
            i === highlightIndex ? 'bg-blue-600/20 text-white' : 'text-zinc-300 hover:bg-white/5'
          ].join(' ')}
          onmousedown={() => selectSuggestion(suggestion)}
        >
          <span class="font-medium">
            {suggestion.type === 'group' ? suggestion.name : suggestion.name || suggestion.email}
          </span>
          {#if suggestion.type === 'group'}
            <span class="ml-1 text-xs text-blue-300">Group · {suggestion.members.length}</span>
          {:else if suggestion.name}
            <span class="ml-1 text-xs text-zinc-500">{suggestion.email}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
