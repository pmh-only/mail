<script lang="ts">
  import { tooltipPosition } from '$lib/tooltip'
  import { onMount, tick } from 'svelte'

  const tooltipId = 'app-global-tooltip'
  const generatedTooltipSelector = '[data-app-tooltip]'

  let tooltipElement = $state<HTMLDivElement>()
  let activeTarget = $state<HTMLElement | null>(null)
  let text = $state('')
  let left = $state(0)
  let top = $state(0)
  let positioned = $state(false)

  function tooltipTarget(value: EventTarget | null) {
    return value instanceof Element
      ? (value.closest(generatedTooltipSelector) as HTMLElement | null)
      : null
  }

  function updateDescription(target: HTMLElement, add: boolean) {
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    const nextIds = add
      ? Array.from(new Set([...ids, tooltipId]))
      : ids.filter((id) => id !== tooltipId)

    if (nextIds.length > 0) target.setAttribute('aria-describedby', nextIds.join(' '))
    else target.removeAttribute('aria-describedby')
  }

  function hide() {
    if (activeTarget) updateDescription(activeTarget, false)
    activeTarget = null
    positioned = false
  }

  async function show(target: HTMLElement) {
    const nextText = target.dataset.appTooltip?.trim()
    if (!nextText) return
    if (activeTarget && activeTarget !== target) updateDescription(activeTarget, false)

    activeTarget = target
    text = nextText
    positioned = false
    updateDescription(target, true)
    await tick()

    if (activeTarget !== target || !tooltipElement) return
    const position = tooltipPosition(
      target.getBoundingClientRect(),
      tooltipElement.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight
    )
    left = position.left
    top = position.top
    positioned = true
  }

  onMount(() => {
    const promotedRemovals = new WeakSet<Element>()
    const interactiveSelector =
      'button, a, input, select, textarea, [role="button"], [role="menuitem"]'

    function removeGeneratedLabel(element: HTMLElement) {
      if (element.dataset.appTooltipGeneratedLabel !== 'true') return
      element.removeAttribute('aria-label')
      delete element.dataset.appTooltipGeneratedLabel
    }

    function syncGeneratedLabel(element: HTMLElement) {
      const tooltip = element.dataset.appTooltip?.trim()
      if (element.dataset.appTooltipGeneratedLabel === 'true') {
        if (tooltip) element.setAttribute('aria-label', tooltip)
        else removeGeneratedLabel(element)
        return
      }

      if (
        tooltip &&
        element.matches(interactiveSelector) &&
        !element.getAttribute('aria-label') &&
        !element.textContent?.trim()
      ) {
        element.setAttribute('aria-label', tooltip)
        element.dataset.appTooltipGeneratedLabel = 'true'
      }
    }

    function removePromotedTooltip(element: HTMLElement) {
      if (element.dataset.appTooltipSource !== 'title') return
      delete element.dataset.appTooltip
      delete element.dataset.appTooltipSource
      syncGeneratedLabel(element)
      if (activeTarget === element) hide()
    }

    function promoteTitle(element: Element) {
      if (!(element instanceof HTMLElement) || element instanceof HTMLIFrameElement) return
      const title = element.getAttribute('title')?.trim()
      if (!title) {
        removePromotedTooltip(element)
        return
      }

      element.dataset.appTooltip = title
      element.dataset.appTooltipSource = 'title'
      syncGeneratedLabel(element)

      promotedRemovals.add(element)
      element.removeAttribute('title')
      if (activeTarget === element) void show(element)
    }

    function promoteTree(node: Node) {
      if (!(node instanceof Element)) return
      if (node.hasAttribute('title')) promoteTitle(node)
      if (node instanceof HTMLElement && node.hasAttribute('data-app-tooltip')) {
        syncGeneratedLabel(node)
      }
      node.querySelectorAll('[title]').forEach(promoteTitle)
      node
        .querySelectorAll<HTMLElement>('[data-app-tooltip]')
        .forEach(syncGeneratedLabel)
    }

    document.querySelectorAll('[title]').forEach(promoteTitle)
    document
      .querySelectorAll<HTMLElement>('[data-app-tooltip]')
      .forEach(syncGeneratedLabel)

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(promoteTree)
          continue
        }

        const element = record.target
        if (!(element instanceof HTMLElement) || element instanceof HTMLIFrameElement) continue
        if (record.attributeName === 'data-app-tooltip') {
          syncGeneratedLabel(element)
          if (activeTarget === element) {
            if (element.dataset.appTooltip?.trim()) void show(element)
            else hide()
          }
          continue
        }
        if (element.hasAttribute('title')) {
          promoteTitle(element)
        } else if (promotedRemovals.has(element)) {
          promotedRemovals.delete(element)
        } else {
          removePromotedTooltip(element)
        }
      }
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title', 'data-app-tooltip'],
      childList: true,
      subtree: true
    })

    function handlePointerOver(event: PointerEvent) {
      const target = tooltipTarget(event.target)
      if (target && target !== activeTarget) void show(target)
    }

    function handlePointerOut(event: PointerEvent) {
      if (!activeTarget) return
      const relatedTarget = tooltipTarget(event.relatedTarget)
      if (relatedTarget === activeTarget) return
      hide()
    }

    function handleFocusIn(event: FocusEvent) {
      const target = tooltipTarget(event.target)
      if (target) void show(target)
    }

    function handleFocusOut(event: FocusEvent) {
      if (tooltipTarget(event.relatedTarget) === activeTarget) return
      hide()
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', handlePointerOver, true)
    document.addEventListener('pointerout', handlePointerOut, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('focusout', handleFocusOut, true)
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)

    return () => {
      hide()
      observer.disconnect()
      document.removeEventListener('pointerover', handlePointerOver, true)
      document.removeEventListener('pointerout', handlePointerOut, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('focusout', handleFocusOut, true)
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  })
</script>

{#if activeTarget}
  <div
    bind:this={tooltipElement}
    id={tooltipId}
    role="tooltip"
    aria-hidden={!positioned}
    class="app-tooltip pointer-events-none fixed z-[1000] max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border px-2.5 py-1.5 text-xs leading-4 whitespace-pre-line shadow-xl transition-opacity"
    class:opacity-0={!positioned}
    style:left="{left}px"
    style:top="{top}px"
  >
    {text}
  </div>
{/if}
