export type DismissOnOutsideOptions = {
  enabled: boolean
  onDismiss: () => void
}

export function dismissOnOutside(node: HTMLElement, options: DismissOnOutsideOptions) {
  let currentOptions = options
  const ownerDocument = node.ownerDocument
  const ownerWindow = ownerDocument.defaultView as Window
  const pointerListenerOptions = { capture: true }

  function dismiss() {
    if (currentOptions.enabled) currentOptions.onDismiss()
  }

  function handlePointerDown(event: PointerEvent) {
    if (!event.composedPath().includes(node)) dismiss()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dismiss()
  }

  ownerDocument.addEventListener('pointerdown', handlePointerDown, pointerListenerOptions)
  ownerWindow.addEventListener('keydown', handleKeydown)
  ownerWindow.addEventListener('blur', dismiss)

  return {
    update(nextOptions: DismissOnOutsideOptions) {
      currentOptions = nextOptions
    },
    destroy() {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown, pointerListenerOptions)
      ownerWindow.removeEventListener('keydown', handleKeydown)
      ownerWindow.removeEventListener('blur', dismiss)
    }
  }
}
