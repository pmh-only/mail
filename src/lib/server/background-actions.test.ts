import assert from 'node:assert/strict'
import { test } from 'vitest'
import { startBackgroundAction, waitForBackgroundActions } from './background-actions.ts'

test('starts actions independently without blocking the caller', async () => {
  const actions = new Map<string, Promise<void>>()
  const started: string[] = []
  const resolvers = new Map<string, () => void>()
  const errors: unknown[] = []
  const action = (name: string) => async () => {
    started.push(name)
    await new Promise<void>((resolve) => resolvers.set(name, resolve))
  }

  assert.equal(
    startBackgroundAction(actions, 'imap', action('imap'), errors.push.bind(errors)),
    true
  )
  assert.equal(
    startBackgroundAction(actions, 'smtp', action('smtp'), errors.push.bind(errors)),
    true
  )
  assert.equal(
    startBackgroundAction(actions, 'imap', action('duplicate'), errors.push.bind(errors)),
    false
  )
  assert.deepEqual(started, [])

  await Promise.resolve()
  assert.deepEqual(started, ['imap', 'smtp'])
  assert.equal(actions.size, 2)

  resolvers.get('smtp')!()
  await actions.get('smtp')
  assert.equal(actions.has('imap'), true)
  assert.equal(actions.has('smtp'), false)

  resolvers.get('imap')!()
  await waitForBackgroundActions(actions)
  assert.equal(actions.size, 0)
  assert.deepEqual(errors, [])
})
