<script lang="ts">
  import { ChevronDown, Check } from 'lucide-svelte'
  import { dismissOnOutside } from '$lib/dismiss-on-outside'
  import { shouldOpenPopoverAbove } from '$lib/popover'
  import { tick } from 'svelte'

  export type SelectValue = string | number

  export type SelectOption = {
    value: SelectValue
    label: string
    disabled?: boolean
  }

  type Props = {
    id?: string
    value: SelectValue
    options: SelectOption[]
    ariaLabel?: string
    disabled?: boolean
    class?: string
    buttonClass?: string
    menuClass?: string
    onchange?: (value: SelectValue) => void
  }

  let {
    id,
    value = $bindable<SelectValue>(),
    options,
    ariaLabel,
    disabled = false,
    class: className = '',
    buttonClass = '',
    menuClass = '',
    onchange
  }: Props = $props()

  let open = $state(false)
  let activeIndex = $state(0)
  let typeahead = ''
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null
  let buttonEl = $state<HTMLButtonElement | undefined>(undefined)
  let menuEl = $state<HTMLDivElement | undefined>(undefined)
  let openAbove = $state(false)
  const fallbackId = $derived(
    `custom-select-${(ariaLabel ?? 'select').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  )
  const listboxId = $derived(`${id ?? fallbackId}-listbox`)
  const activeOptionId = $derived(`${listboxId}-option-${activeIndex}`)

  const selectedOption = $derived(options.find((option) => option.value === value) ?? options[0])
  const enabledOptions = $derived(options.filter((option) => !option.disabled))

  function selectedIndex() {
    const index = options.findIndex((option) => option.value === value)
    return index >= 0 ? index : 0
  }

  function openMenu() {
    if (disabled || enabledOptions.length === 0) return
    activeIndex = selectedIndex()
    openAbove = false
    open = true
    void tick().then(() => {
      if (!buttonEl || !menuEl) return
      const buttonRect = buttonEl.getBoundingClientRect()
      const menuRect = menuEl.getBoundingClientRect()
      openAbove = shouldOpenPopoverAbove(buttonRect, menuRect.height, window.innerHeight)
    })
  }

  function closeMenu() {
    open = false
  }

  function selectOption(option: SelectOption) {
    if (!option || option.disabled) return
    value = option.value
    onchange?.(option.value)
    closeMenu()
    buttonEl?.focus()
  }

  function moveActive(delta: number) {
    if (enabledOptions.length === 0) return
    const currentValue = options[activeIndex]?.value
    const currentEnabledIndex = Math.max(
      0,
      enabledOptions.findIndex((option) => option.value === currentValue)
    )
    const nextEnabledIndex =
      (currentEnabledIndex + delta + enabledOptions.length) % enabledOptions.length
    const next = enabledOptions[nextEnabledIndex]
    activeIndex = options.findIndex((option) => option.value === next.value)
  }

  function setActiveToBoundary(position: 'first' | 'last') {
    if (enabledOptions.length === 0) return
    const option =
      position === 'first' ? enabledOptions[0] : enabledOptions[enabledOptions.length - 1]
    activeIndex = options.findIndex((candidate) => candidate.value === option.value)
  }

  function handleTypeahead(key: string) {
    if (!open) openMenu()
    typeahead += key.toLowerCase()
    if (typeaheadTimer) clearTimeout(typeaheadTimer)
    typeaheadTimer = setTimeout(() => (typeahead = ''), 700)

    const match = options.find(
      (option) => !option.disabled && option.label.toLowerCase().startsWith(typeahead)
    )
    if (match) activeIndex = options.findIndex((option) => option.value === match.value)
  }

  function handleButtonClick(event: MouseEvent) {
    event.stopPropagation()
    if (open) {
      closeMenu()
      return
    }
    openMenu()
  }

  function handleButtonKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) openMenu()
      setActiveToBoundary(event.key === 'Home' ? 'first' : 'last')
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) openMenu()
      else selectOption(options[activeIndex])
      return
    }

    if (event.key === 'Tab') {
      closeMenu()
      return
    }

    if (event.key === 'Escape') {
      closeMenu()
      return
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      handleTypeahead(event.key)
    }
  }
</script>

<div
  class={['relative', className]}
  use:dismissOnOutside={{ enabled: open, onDismiss: closeMenu }}
>
  <button
    {id}
    bind:this={buttonEl}
    type="button"
    role="combobox"
    aria-label={ariaLabel}
    aria-controls={listboxId}
    aria-activedescendant={open ? activeOptionId : undefined}
    aria-expanded={open}
    aria-haspopup="listbox"
    {disabled}
    onclick={handleButtonClick}
    onkeydown={handleButtonKeydown}
    class={[
      'flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 text-left text-white transition hover:bg-white/10 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40',
      buttonClass
    ]}
  >
    <span class="min-w-0 truncate" data-app-tooltip={selectedOption?.label ?? ''}
      >{selectedOption?.label ?? ''}</span
    >
    <ChevronDown
      size={14}
      class={open
        ? 'shrink-0 rotate-180 text-zinc-500 transition'
        : 'shrink-0 text-zinc-500 transition'}
    />
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      id={listboxId}
      role="listbox"
      tabindex="-1"
      class={[
        'app-popover absolute z-[100] max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl',
        openAbove ? 'bottom-full mb-1' : 'top-full mt-1',
        menuClass
      ]}
    >
      {#if options.length === 0}
        <p class="px-2.5 py-2 text-sm text-zinc-500">No options available</p>
      {/if}
      {#each options as option, index (`${option.value}-${index}`)}
        <button
          id={`${listboxId}-option-${index}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          onmouseenter={() => (activeIndex = index)}
          onclick={() => selectOption(option)}
          class={[
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
            option.value === value
              ? 'bg-blue-600 text-white'
              : index === activeIndex
                ? 'bg-white/8 text-zinc-100'
                : 'text-zinc-300 hover:bg-white/8 hover:text-zinc-100'
          ]}
        >
          <span class="min-w-0 flex-1 truncate" data-app-tooltip={option.label}
            >{option.label}</span
          >
          {#if option.value === value}
            <Check size={13} class="shrink-0" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
