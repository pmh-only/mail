import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareRemoteContent, sanitizeRemoteContent } from './remote-content.ts'

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
