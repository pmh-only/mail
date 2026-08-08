import assert from 'node:assert/strict'
import { test } from 'vitest'
import { shouldOpenPopoverAbove } from './popover.ts'

test('opens popovers below triggers with enough room', () => {
  assert.equal(shouldOpenPopoverAbove({ top: 20, bottom: 54 }, 106, 720), false)
})

test('opens popovers above triggers near the viewport bottom', () => {
  assert.equal(shouldOpenPopoverAbove({ top: 608, bottom: 640 }, 106, 720), true)
})

test('keeps the default placement when neither side has more room', () => {
  assert.equal(shouldOpenPopoverAbove({ top: 42, bottom: 58 }, 80, 100, 0), false)
})
