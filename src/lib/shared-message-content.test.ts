import assert from 'node:assert/strict'
import { test } from 'vitest'
import { prepareSharedMessageHtml } from './shared-message-content'

const html =
  '<style>p{color:red}</style><p><a href="https://example.com" ping="https://example.com/ping">Read more</a><img src="https://example.com/image.png"></p>'

test('text-only shared messages do not render HTML', () => {
  assert.equal(prepareSharedMessageHtml(html, 'only-text'), null)
})

test('styled shared messages block images and retain links', () => {
  const result = prepareSharedMessageHtml(html, 'style-included')!
  assert.ok(result.includes('p{color:red}'))
  assert.ok(result.includes('href="https://example.com"'))
  assert.ok(!result.includes('<img src='))
  assert.ok(result.includes("default-src 'none'"))
})

test('full-featured shared messages retain images and links', () => {
  const result = prepareSharedMessageHtml(html, 'full-featured')!
  assert.ok(result.endsWith(html))
  assert.ok(result.includes("default-src 'none'"))
})

test('link-deducted shared messages preserve content and images without link destinations', () => {
  const result = prepareSharedMessageHtml(
    html +
      '<map><area href="https://example.com" /></map><svg><a xlink:href="https://example.com">SVG</a></svg><meta http-equiv="Refresh" content="0;url=https://example.com">',
    'full-featured-link-deducted'
  )!
  assert.ok(result.includes('<a>Read more</a>'))
  assert.ok(result.includes('<img src="https://example.com/image.png">'))
  assert.ok(result.includes('p{color:red}'))
  assert.ok(!result.includes('href='))
  assert.ok(!result.includes('ping='))
  assert.ok(!result.includes('Refresh'))
})
