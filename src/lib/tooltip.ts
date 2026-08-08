export type Rect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

export function tooltipPosition(
  target: Rect,
  tooltip: Rect,
  viewportWidth: number,
  viewportHeight: number,
  gap = 8,
  padding = 8
) {
  const roomAbove = target.top - padding
  const roomBelow = viewportHeight - target.bottom - padding
  const placeBelow = roomAbove < tooltip.height + gap && roomBelow > roomAbove
  const maxLeft = Math.max(padding, viewportWidth - tooltip.width - padding)
  const left = Math.min(
    maxLeft,
    Math.max(padding, target.left + target.width / 2 - tooltip.width / 2)
  )
  const top = placeBelow
    ? Math.max(padding, Math.min(target.bottom + gap, viewportHeight - tooltip.height - padding))
    : Math.max(padding, target.top - tooltip.height - gap)

  return { left, top }
}
