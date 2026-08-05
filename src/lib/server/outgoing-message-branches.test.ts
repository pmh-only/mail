import assert from 'node:assert/strict'
import { test } from 'vitest'
import { outgoingListHeaders, outgoingMessageBody } from './outgoing-message.ts'

test('encodes incomplete bracketed domains as ordinary sender domains', () => {
  assert.deepEqual(outgoingListHeaders('sender@[127.0.0.1'), {
    'List-Unsubscribe': '<mailto:sender@%5B127.0.0.1>'
  })
})

test('omits whitespace-only, null, and empty outgoing message bodies', () => {
  assert.deepEqual(outgoingMessageBody('   '), {})
  assert.deepEqual(outgoingMessageBody(null), {})
  assert.deepEqual(outgoingMessageBody(''), {})
})
