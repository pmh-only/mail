export type VerticalRect = Pick<DOMRect, 'top' | 'bottom'>

export function shouldOpenPopoverAbove(
  trigger: VerticalRect,
  popoverHeight: number,
  viewportHeight: number,
  padding = 8
) {
  const roomAbove = trigger.top - padding
  const roomBelow = viewportHeight - trigger.bottom - padding
  return roomBelow < popoverHeight && roomAbove > roomBelow
}
