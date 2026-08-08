import assert from 'node:assert/strict'
import { test } from 'vitest'
import { tooltipPosition, type Rect } from './tooltip.ts'

function rect(top: number, left: number, width: number, height: number): Rect {
  return {
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height
  }
}

test('positions tooltips above centered targets when space is available', () => {
  assert.deepEqual(tooltipPosition(rect(100, 80, 40, 20), rect(0, 0, 60, 24), 240, 180), {
    left: 70,
    top: 68
  })
})

test('places tooltips below targets near the top and clamps both horizontal edges', () => {
  assert.deepEqual(tooltipPosition(rect(4, 0, 20, 20), rect(0, 0, 80, 24), 160, 180), {
    left: 8,
    top: 32
  })
  assert.deepEqual(tooltipPosition(rect(4, 150, 20, 20), rect(0, 0, 80, 24), 180, 180), {
    left: 92,
    top: 32
  })
})

test('keeps a tooltip inside a viewport with insufficient space on either side', () => {
  assert.deepEqual(tooltipPosition(rect(20, 20, 20, 60), rect(0, 0, 50, 50), 100, 100), {
    left: 8,
    top: 8
  })
  assert.deepEqual(tooltipPosition(rect(0, 20, 20, 10), rect(0, 0, 50, 120), 100, 100), {
    left: 8,
    top: 8
  })
})
