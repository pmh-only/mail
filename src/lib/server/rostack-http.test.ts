import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  acceptsJson,
  isRostackHttpProblemCode,
  rostackJson,
  rostackProblem
} from './rostack-http.ts'

test('negotiates application/json media ranges and quality', () => {
  assert.equal(acceptsJson(null), true)
  assert.equal(acceptsJson('*/*'), true)
  assert.equal(acceptsJson('application/*'), true)
  assert.equal(acceptsJson('text/plain, application/json; q=0.5'), true)
  assert.equal(acceptsJson('application/json; q=0'), false)
  assert.equal(acceptsJson('application/json; q=0, */*; q=1'), false)
  assert.equal(acceptsJson('application/json; q=invalid'), false)
  assert.equal(acceptsJson('application/problem+json'), false)
  assert.equal(acceptsJson('text/application/json-ish'), false)
})

test('builds protocol JSON responses and registered problem objects', async () => {
  const success = rostackJson({ ok: true }, { etag: '"revision"' })
  assert.equal(success.headers.get('content-type'), 'application/json')
  assert.equal(success.headers.get('x-rostack-api-version'), 'mail-2026-08-13-1')
  assert.equal(success.headers.get('etag'), '"revision"')

  const problem = rostackProblem('rate-limited', {
    detail: 'Wait before retrying.',
    retryAfterMs: 1500
  })
  assert.equal(problem.status, 429)
  assert.equal(problem.headers.get('retry-after'), '2')
  assert.deepEqual(await problem.json(), {
    type: 'https://spec.pmh.codes/problems/rate-limited',
    title: 'Rate limited',
    status: 429,
    detail: 'Wait before retrying.',
    retry_after_ms: 1500
  })
  assert.equal(isRostackHttpProblemCode('invalid-filter'), true)
  assert.equal(isRostackHttpProblemCode('unknown'), false)

  const simple = rostackProblem('invalid-request')
  assert.equal(simple.headers.get('retry-after'), null)
  assert.deepEqual(await simple.json(), {
    type: 'https://spec.pmh.codes/problems/invalid-request',
    title: 'Invalid request',
    status: 400
  })
})
