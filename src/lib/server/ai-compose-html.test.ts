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

test('escapes text and attributes while preserving safe absolute link protocols', () => {
  assert.equal(
    sanitizeAiComposeHtml(
      '<div>&lt;x&gt; &amp; <a href="mailto:person@example.com?subject=Say%20%22hi%22">mail</a><a href="//example.com">protocol relative</a><br></div>'
    ),
    '&lt;x&gt; &amp; <a href="mailto:person@example.com?subject=Say%20%22hi%22">mail</a>protocol relative<br>'
  )
  assert.equal(aiComposePreviewText('before<br><li>item</li><p>after</p>'), 'before item after')
  assert.equal(sanitizeAiComposeHtml('<a href=":not-a-url">bad</a>'), 'bad')
})

test('handles empty nodes, unsupported elements, and non-element preview content', () => {
  assert.equal(sanitizeAiComposeHtml(''), '')
  assert.equal(sanitizeAiComposeHtml('plain<span> nested</span>'), 'plain nested')
  assert.equal(aiComposePreviewText('plain<span> nested</span>'), 'plain nested')
})

test('drops document directives and comments without adding preview separators', () => {
  assert.equal(
    sanitizeAiComposeHtml('<!doctype html><!-- hidden --><p>Visible</p>'),
    '<p>Visible</p>'
  )
  assert.equal(aiComposePreviewText('before<!-- hidden -->after'), 'beforeafter')
})
