// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import GlobalTooltip from './GlobalTooltip.svelte'

function button(attributes: Record<string, string> = {}, text = '') {
  const element = document.createElement('button')
  element.textContent = text
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  document.body.append(element)
  return element
}

describe('GlobalTooltip', () => {
  it('promotes title attributes and labels icon-only controls', async () => {
    const iconButton = button({ title: 'Archive message' })
    const labelled = button({ title: 'Delete message', 'aria-label': 'Delete' })
    const textButton = button({ title: 'Reply' }, 'Reply now')
    render(GlobalTooltip)

    await waitFor(() => expect(iconButton).not.toHaveAttribute('title'))
    expect(iconButton).toHaveAttribute('data-app-tooltip', 'Archive message')
    expect(iconButton).toHaveAttribute('data-app-tooltip-source', 'title')
    expect(iconButton).toHaveAccessibleName('Archive message')
    expect(iconButton).toHaveAttribute('data-app-tooltip-generated-label', 'true')
    expect(labelled).toHaveAccessibleName('Delete')
    expect(textButton).not.toHaveAttribute('aria-label')
  })

  it('ignores iframe titles', async () => {
    const frame = document.createElement('iframe')
    frame.title = 'Embedded content'
    document.body.append(frame)
    render(GlobalTooltip)
    await Promise.resolve()
    expect(frame).toHaveAttribute('title', 'Embedded content')
    expect(frame).not.toHaveAttribute('data-app-tooltip')
  })

  it('promotes controls added in a subtree', async () => {
    render(GlobalTooltip)
    const wrapper = document.createElement('div')
    wrapper.innerHTML =
      '<button title="Dynamic title"></button><a data-app-tooltip="Dynamic link"></a>'
    document.body.append(wrapper)

    const titled = wrapper.querySelector('button') as HTMLButtonElement
    const link = wrapper.querySelector('a') as HTMLAnchorElement
    await waitFor(() => expect(titled).toHaveAttribute('data-app-tooltip', 'Dynamic title'))
    expect(titled).toHaveAccessibleName('Dynamic title')
    expect(link).toHaveAccessibleName('Dynamic link')
  })

  it('shows and positions on pointer hover', async () => {
    const target = button({ 'data-app-tooltip': 'Archive' })
    target.setAttribute('aria-describedby', 'existing')
    target.getBoundingClientRect = () =>
      ({ left: 100, right: 140, top: 50, bottom: 70, width: 40, height: 20 }) as DOMRect
    render(GlobalTooltip)
    await fireEvent.pointerOver(target)

    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip).toHaveAttribute('aria-hidden', 'false'))
    expect(tooltip).toHaveTextContent('Archive')
    expect(target).toHaveAttribute('aria-describedby', 'existing app-global-tooltip')
    expect(tooltip.style.left).not.toBe('')
    expect(tooltip.style.top).not.toBe('')
  })

  it('switches targets and preserves existing descriptions', async () => {
    const first = button({ 'data-app-tooltip': 'First', 'aria-describedby': 'help' })
    const second = button({ 'data-app-tooltip': 'Second' })
    render(GlobalTooltip)
    await fireEvent.pointerOver(first)
    await screen.findByText('First')
    await fireEvent.pointerOver(second)
    expect(await screen.findByText('Second')).toBeInTheDocument()
    expect(first).toHaveAttribute('aria-describedby', 'help')
    expect(second).toHaveAttribute('aria-describedby', 'app-global-tooltip')
  })

  it('keeps the tooltip while moving inside its target and hides after leaving', async () => {
    const target = button({ 'data-app-tooltip': 'Parent' })
    const child = document.createElement('span')
    target.append(child)
    render(GlobalTooltip)
    await fireEvent.pointerOver(child)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()

    await fireEvent.pointerOut(child, { relatedTarget: target })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await fireEvent.pointerOut(target, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(target).not.toHaveAttribute('aria-describedby')
  })

  it('shows on focus and hides after focus leaves', async () => {
    const target = button({ 'data-app-tooltip': 'Focused action' })
    render(GlobalTooltip)
    await fireEvent.focusIn(target)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Focused action')
    await fireEvent.focusOut(target, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['scroll', () => fireEvent.scroll(document)],
    ['resize', () => fireEvent(window, new Event('resize'))]
  ])('hides on %s', async (_name, dismiss) => {
    const target = button({ 'data-app-tooltip': 'Action' })
    render(GlobalTooltip)
    await fireEvent.pointerOver(target)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    await dismiss()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('ignores empty tooltip values and non-elements', async () => {
    const target = button({ 'data-app-tooltip': '   ' })
    render(GlobalTooltip)
    await fireEvent.pointerOver(target)
    await fireEvent.pointerOver(document)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('updates an active tooltip and generated label', async () => {
    const target = button({ 'data-app-tooltip': 'Original' })
    render(GlobalTooltip)
    await fireEvent.pointerOver(target)
    expect(await screen.findByText('Original')).toBeInTheDocument()
    target.dataset.appTooltip = 'Updated'
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Updated'))
    expect(target).toHaveAccessibleName('Updated')
  })

  it('removes an active tooltip when its value disappears', async () => {
    const target = button({ 'data-app-tooltip': 'Temporary' })
    render(GlobalTooltip)
    await fireEvent.pointerOver(target)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    delete target.dataset.appTooltip
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(target).not.toHaveAttribute('aria-label')
    expect(target).not.toHaveAttribute('data-app-tooltip-generated-label')
  })

  it('removes title-derived tooltip metadata when title becomes blank', async () => {
    const target = button({ title: 'Temporary title' })
    render(GlobalTooltip)
    await waitFor(() => expect(target).toHaveAttribute('data-app-tooltip', 'Temporary title'))
    target.setAttribute('title', '  ')
    await waitFor(() => expect(target).not.toHaveAttribute('data-app-tooltip'))
    expect(target).not.toHaveAttribute('data-app-tooltip-source')
    expect(target).not.toHaveAttribute('aria-label')
  })

  it('cleans up target descriptions and stops observing after destroy', async () => {
    const target = button({ 'data-app-tooltip': 'Active' })
    const { unmount } = render(GlobalTooltip)
    await fireEvent.pointerOver(target)
    await screen.findByRole('tooltip')
    unmount()
    expect(target).not.toHaveAttribute('aria-describedby')

    const later = button({ title: 'Later title' })
    await Promise.resolve()
    expect(later).toHaveAttribute('title', 'Later title')
    expect(later).not.toHaveAttribute('data-app-tooltip')
  })
})
