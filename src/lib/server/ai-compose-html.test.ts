import assert from 'node:assert/strict'
import { test } from 'vitest'
import { aiComposePreviewText, sanitizeAiComposeHtml } from './ai-compose-html.ts'

test('allows only compose tags and safe link protocols', () => {
  assert.equal(
    sanitizeAiComposeHtml(
      '<p onclick="alert(1)">Hi <strong>there</strong><a href="https://example.com" style="x">link</a></p>'
    ),
    '<p>Hi <strong>there</strong><a href="https://example.com">link</a></p>'
  )
})

test('drops executable content and dangerous links', () => {
  const html = sanitizeAiComposeHtml(
    '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">click</a><svg><script>x</script></svg>'
  )
  assert.equal(html, 'click')
  assert.equal(aiComposePreviewText('<p>Hello <em>world</em></p>'), 'Hello world')
})
