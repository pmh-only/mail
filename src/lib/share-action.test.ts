import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_SHARE_CLICK_ACTION,
  DEFAULT_SHARE_SHIFT_CLICK_ACTION,
  normalizeShareAction,
  shareActionForClick
} from './share-action.ts'

test('defaults normal clicks to native share and Shift-clicks to copying the URL', () => {
  assert.equal(DEFAULT_SHARE_CLICK_ACTION, 'native-share')
  assert.equal(DEFAULT_SHARE_SHIFT_CLICK_ACTION, 'copy-url')
  assert.equal(
    shareActionForClick(false, DEFAULT_SHARE_CLICK_ACTION, DEFAULT_SHARE_SHIFT_CLICK_ACTION),
    'native-share'
  )
  assert.equal(
    shareActionForClick(true, DEFAULT_SHARE_CLICK_ACTION, DEFAULT_SHARE_SHIFT_CLICK_ACTION),
    'copy-url'
  )
})

test('supports configuring either click gesture to either action', () => {
  assert.equal(shareActionForClick(false, 'copy-url', 'native-share'), 'copy-url')
  assert.equal(shareActionForClick(true, 'copy-url', 'native-share'), 'native-share')
})

test('normalizes persisted share actions with the supplied fallback', () => {
  assert.equal(normalizeShareAction('native-share', 'copy-url'), 'native-share')
  assert.equal(normalizeShareAction('copy-url', 'native-share'), 'copy-url')
  assert.equal(normalizeShareAction('invalid', 'copy-url'), 'copy-url')
  assert.equal(normalizeShareAction(undefined, 'native-share'), 'native-share')
})
