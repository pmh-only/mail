import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parseShareTarget, shareContent } from './web-share.ts'

test('declares the compose route as a text and URL share target', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../static/manifest.json', import.meta.url), 'utf8')
  )

  assert.deepEqual(manifest.share_target, {
    action: '/inbox',
    method: 'GET',
    enctype: 'application/x-www-form-urlencoded',
    params: {
      title: 'share-title',
      text: 'share-text',
      url: 'share-url'
    }
  })
})

test('declares matching desktop and mobile install screenshots', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../static/manifest.json', import.meta.url), 'utf8')
  )

  assert.ok(
    manifest.screenshots.some(
      (screenshot: { form_factor?: string }) => screenshot.form_factor === 'wide'
    )
  )
  assert.ok(
    manifest.screenshots.some(
      (screenshot: { form_factor?: string }) => screenshot.form_factor !== 'wide'
    )
  )

  for (const screenshot of manifest.screenshots) {
    const image = readFileSync(new URL(`../../static${screenshot.src}`, import.meta.url))
    const [width, height] = screenshot.sizes.split('x').map(Number)
    assert.equal(image.toString('ascii', 1, 4), 'PNG')
    assert.equal(image.readUInt32BE(16), width)
    assert.equal(image.readUInt32BE(20), height)
  }
})

test('shares content with the native Web Share API', async () => {
  const shared: ShareData[] = []
  const copied: string[] = []
  const data = { title: 'Project update', text: 'From Alice', url: 'https://mail.example/share/1' }

  const result = await shareContent(data, {
    canShare: () => true,
    share: async (value) => {
      shared.push(value)
    },
    clipboard: { writeText: async (value) => void copied.push(value) }
  })

  assert.equal(result, 'shared')
  assert.deepEqual(shared, [data])
  assert.deepEqual(copied, [])
})

test('copies the URL without opening native share when requested', async () => {
  const shared: ShareData[] = []
  const copied: string[] = []
  const data = { title: 'Project update', url: 'https://mail.example/share/copy' }

  const result = await shareContent(
    data,
    {
      canShare: () => true,
      share: async (value) => {
        shared.push(value)
      },
      clipboard: { writeText: async (value) => void copied.push(value) }
    },
    'copy-url'
  )

  assert.equal(result, 'copied')
  assert.deepEqual(shared, [])
  assert.deepEqual(copied, [data.url])
})

test('falls back to copying the URL when native sharing is unavailable or fails', async () => {
  for (const share of [undefined, async () => Promise.reject(new Error('Share failed'))]) {
    const copied: string[] = []
    const result = await shareContent(
      { url: 'https://mail.example/share/2' },
      {
        share,
        clipboard: { writeText: async (value) => void copied.push(value) }
      }
    )

    assert.equal(result, 'copied')
    assert.deepEqual(copied, ['https://mail.example/share/2'])
  }
})

test('does not copy when the native share dialog is cancelled', async () => {
  const copied: string[] = []
  const result = await shareContent(
    { url: 'https://mail.example/share/3' },
    {
      share: async () => {
        throw new DOMException('Cancelled', 'AbortError')
      },
      clipboard: { writeText: async (value) => void copied.push(value) }
    }
  )

  assert.equal(result, 'cancelled')
  assert.deepEqual(copied, [])
})

test('turns shared title, text, and URL into compose fields', () => {
  assert.deepEqual(
    parseShareTarget(
      new URL(
        'https://mail.example/inbox?share-title=Useful+page&share-text=Take+a+look&share-url=https%3A%2F%2Fexample.com%2Farticle'
      )
    ),
    {
      subject: 'Useful page',
      body: 'Take a look\n\nhttps://example.com/article'
    }
  )
})

test('handles partial and unrelated share-target query strings', () => {
  assert.deepEqual(
    parseShareTarget(new URL('https://mail.example/inbox?share-url=https%3A%2F%2Fexample.com')),
    { subject: '', body: 'https://example.com' }
  )
  assert.equal(parseShareTarget(new URL('https://mail.example/inbox?share-text=')), null)
  assert.equal(parseShareTarget(new URL('https://mail.example/inbox?query=mail')), null)
})
