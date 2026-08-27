import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  isRemoteContentAllowedForSender,
  normalizeAllowedSenders,
  normalizeSenderAddress,
  prepareRemoteContent,
  sanitizeRemoteContent
} from './remote-content.ts'

const remoteHtml = '<p>Hello</p><img src="https://images.example/pixel.png">'
const blockedSettings = { blockRemoteContent: true, allowedSenders: [] }

test('allows remote content only for the message granted a one-time exception', () => {
  const allowedMessageIds = new Set([101])

  const allowed = prepareRemoteContent(remoteHtml, 'first@example.com', blockedSettings, {
    messageId: 101,
    allowedMessageIds
  })
  const otherMessage = prepareRemoteContent(remoteHtml, 'other@example.com', blockedSettings, {
    messageId: 102,
    allowedMessageIds
  })

  assert.equal(allowed.blockedCount, 0)
  assert.equal(allowed.html, remoteHtml)
  assert.equal(otherMessage.blockedCount, 1)
  assert.match(
    otherMessage.html,
    /data-remote-content-blocked-src="https:\/\/images\.example\/pixel\.png"/
  )
})

test('blocks entity URLs, CSS imports, SVG resources, and meta refresh', () => {
  const result = sanitizeRemoteContent(`
    <img src="&#x68;ttps://attacker.test/pixel">
    <style>@import 'https://attacker.test/style.css';</style>
    <svg><image href="https://attacker.test/pixel"></image></svg>
    <meta http-equiv="refresh" content="0;url=https://attacker.test/">
  `)
  assert.equal(result.blockedCount, 4)
  assert.doesNotMatch(result.html, /<style|http-equiv="refresh"|<image href=/i)
  assert.match(result.html, /data-remote-content-blocked-src=/)
  assert.match(result.html, /data-remote-content-blocked-href=/)
})

test('allows remote content only for messages from a trusted sender', () => {
  const settings = { blockRemoteContent: true, allowedSenders: ['trusted@example.com'] }

  const trustedSender = prepareRemoteContent(remoteHtml, 'Trusted <trusted@example.com>', settings)
  const otherSender = prepareRemoteContent(remoteHtml, 'other@example.com', settings)

  assert.equal(trustedSender.blockedCount, 0)
  assert.equal(trustedSender.html, remoteHtml)
  assert.equal(otherSender.blockedCount, 1)
  assert.match(
    otherSender.html,
    /data-remote-content-blocked-src="https:\/\/images\.example\/pixel\.png"/
  )
})

test('normalizes sender allow-lists and honors disabled blocking', () => {
  assert.equal(normalizeSenderAddress(' Name <USER@Example.com> '), 'user@example.com')
  assert.equal(normalizeSenderAddress('not an address'), '')
  assert.equal(normalizeSenderAddress(null), '')
  assert.deepEqual(
    normalizeAllowedSenders(' B@example.com\ninvalid, a@example.com, A@example.com '),
    ['a@example.com', 'b@example.com']
  )
  assert.deepEqual(normalizeAllowedSenders([' B@example.com ', 'a@example.com']), [
    'a@example.com',
    'b@example.com'
  ])
  assert.deepEqual(normalizeAllowedSenders(null), [])
  assert.equal(
    isRemoteContentAllowedForSender(undefined, { blockRemoteContent: false, allowedSenders: [] }),
    true
  )
})

test('removes all remote URL attributes while preserving local references', () => {
  const result = sanitizeRemoteContent(
    '<!-- comment --><video poster="//cdn.test/poster" background="https://cdn.test/bg" data="http://cdn.test/data"></video><a href="https://safe.test">safe</a><link href="https://cdn.test/style"><img srcset="a 1x" src="/local.png">'
  )

  assert.equal(result.blockedCount, 5)
  assert.match(result.html, /data-remote-content-blocked-poster="\/\/cdn\.test\/poster"/)
  assert.match(result.html, /data-remote-content-blocked-background=/)
  assert.match(result.html, /data-remote-content-blocked-data=/)
  assert.match(result.html, /data-remote-content-blocked-href=/)
  assert.match(result.html, /href="https:\/\/safe\.test"/)
  assert.match(result.html, /src="\/local\.png"/)
  assert.doesNotMatch(result.html, /srcset/)
})

test('blocks remote SVG xlink references without removing local SVG references', () => {
  const result = sanitizeRemoteContent(
    '<svg><use xlink:href="//cdn.test/icons.svg#remote"></use><use xlink:href="#local"></use></svg>'
  )

  assert.equal(result.blockedCount, 1)
  assert.match(
    result.html,
    /data-remote-content-blocked-xlink-href="\/\/cdn\.test\/icons\.svg#remote"/
  )
  assert.match(result.html, /xlink:href="#local"/)
})

test('leaves non-refresh meta tags and elements without attributes or children intact', () => {
  const result = sanitizeRemoteContent('<meta name="viewport"><meta http-equiv><img><div></div>')
  assert.equal(result.blockedCount, 0)
  assert.match(result.html, /meta name="viewport"/)
})

test('blocks remote attachment and object content URLs', () => {
  const result = sanitizeRemoteContent(
    '<object data="https://cdn.test/file.pdf"><embed src="//cdn.test/file.pdf"></object>'
  )

  assert.equal(result.blockedCount, 2)
  assert.match(result.html, /data-remote-content-blocked-data="https:\/\/cdn\.test\/file\.pdf"/)
  assert.match(result.html, /data-remote-content-blocked-src="\/\/cdn\.test\/file\.pdf"/)
})

test('preserves styles while removing resources referenced by CSS', () => {
  const result = sanitizeRemoteContent(
    '<style>@import "https://cdn.test/mail.css";p{color:red;background:url(//cdn.test/bg)}</style><p style="color: blue; background-image: url(https://cdn.test/pixel)">Hello</p>',
    { includeStyles: true }
  )

  assert.equal(result.blockedCount, 3)
  assert.match(result.html, /<style>p\{color:red;background:\}<\/style>/)
  assert.match(result.html, /style="color: blue; background-image: "/)
  assert.doesNotMatch(result.html, /cdn\.test/)
})

test('removes inline styles when styles are not included', () => {
  const result = sanitizeRemoteContent('<p style="color: red">Hello</p>')

  assert.equal(result.blockedCount, 1)
  assert.equal(result.html, '<p>Hello</p>')
})

test('blocks embedded images when displaying styles without images', () => {
  const result = sanitizeRemoteContent(
    '<img src="data:image/png;base64,abc" alt="Logo"><svg><image href="cid:logo"></image></svg><video src="https://cdn.test/movie.mp4"></video>',
    { includeStyles: true, blockImages: true }
  )

  assert.equal(result.blockedCount, 3)
  assert.match(result.html, /data-remote-content-blocked-src="data:image\/png;base64,abc"/)
  assert.match(result.html, /data-remote-content-blocked-href="cid:logo"/)
  assert.match(result.html, /data-remote-content-blocked-src="https:\/\/cdn.test\/movie.mp4"/)
})
