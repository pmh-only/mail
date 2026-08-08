import assert from 'node:assert/strict'
import { test } from 'vitest'
import { dismissOnOutside } from './dismiss-on-outside.ts'

function eventWithPath(type: string, path: EventTarget[], key?: string) {
  const event = new Event(type)
  Object.defineProperty(event, 'composedPath', { value: () => path })
  if (key) Object.defineProperty(event, 'key', { value: key })
  return event
}

test('dismisses an enabled overlay for outside pointers, Escape, and window blur', () => {
  const ownerDocument = new EventTarget() as Document
  const ownerWindow = new EventTarget() as Window
  Object.defineProperty(ownerDocument, 'defaultView', { value: ownerWindow })
  const node = { ownerDocument } as HTMLElement
  let dismissCount = 0
  const action = dismissOnOutside(node, {
    enabled: false,
    onDismiss: () => dismissCount++
  })

  ownerDocument.dispatchEvent(eventWithPath('pointerdown', [ownerDocument]))
  assert.equal(dismissCount, 0)

  action.update({ enabled: true, onDismiss: () => dismissCount++ })
  ownerDocument.dispatchEvent(eventWithPath('pointerdown', [node, ownerDocument]))
  ownerWindow.dispatchEvent(eventWithPath('keydown', [ownerWindow], 'Enter'))
  assert.equal(dismissCount, 0)

  ownerDocument.dispatchEvent(eventWithPath('pointerdown', [ownerDocument]))
  ownerWindow.dispatchEvent(eventWithPath('keydown', [ownerWindow], 'Escape'))
  ownerWindow.dispatchEvent(new Event('blur'))
  assert.equal(dismissCount, 3)

  action.destroy()
  ownerDocument.dispatchEvent(eventWithPath('pointerdown', [ownerDocument]))
  assert.equal(dismissCount, 3)
  ownerWindow.dispatchEvent(eventWithPath('keydown', [ownerWindow], 'Escape'))
  assert.equal(dismissCount, 3)
  ownerWindow.dispatchEvent(new Event('blur'))
  assert.equal(dismissCount, 3)
})
