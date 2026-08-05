import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const results: unknown[][] = []
  const inserts: unknown[] = []
  const chain = (rows: unknown[] = results.shift() ?? []) => {
    const value = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
    for (const name of ['from', 'where', 'set']) value[name] = () => value
    value.limit = async () => rows
    value.returning = async () => rows
    return value
  }
  const db = {
    select: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
    delete: vi.fn(() => chain()),
    transaction: vi.fn(async (callback) =>
      callback({
        execute: vi.fn(),
        select: vi.fn(() => chain()),
        insert: vi.fn(() => ({ values: vi.fn((value) => inserts.push(value)) }))
      })
    )
  }
  return {
    results,
    inserts,
    db,
    publicAttachment: new Proxy({}, { get: (_, key) => `attachment.${String(key)}` }),
    randomUUID: vi.fn(),
    isDemoModeEnabled: vi.fn(),
    registerDemoPublicAttachment: vi.fn(),
    getDemoPublicAttachment: vi.fn(),
    commitDemoPublicAttachments: vi.fn(),
    uncommitDemoPublicAttachments: vi.fn(),
    deleteDemoPublicAttachments: vi.fn(),
    writePublicAttachmentFile: vi.fn(),
    assertPublicAttachmentFile: vi.fn(),
    deletePublicAttachmentFile: vi.fn()
  }
})

vi.mock('node:crypto', () => ({ randomUUID: state.randomUUID }))
vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({ publicAttachment: state.publicAttachment }))
vi.mock('./demo', () => ({
  isDemoModeEnabled: state.isDemoModeEnabled,
  registerDemoPublicAttachment: state.registerDemoPublicAttachment,
  getDemoPublicAttachment: state.getDemoPublicAttachment,
  commitDemoPublicAttachments: state.commitDemoPublicAttachments,
  uncommitDemoPublicAttachments: state.uncommitDemoPublicAttachments,
  deleteDemoPublicAttachments: state.deleteDemoPublicAttachments
}))
vi.mock('./public-attachment-files', () => ({
  writePublicAttachmentFile: state.writePublicAttachmentFile,
  assertPublicAttachmentFile: state.assertPublicAttachmentFile,
  deletePublicAttachmentFile: state.deletePublicAttachmentFile
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn()
}))

const attachments = await import('./public-attachments.ts')
const metadata = { filename: 'report.pdf', contentType: 'application/pdf', size: 3 }

beforeEach(() => {
  state.results.length = 0
  state.inserts.length = 0
  vi.clearAllMocks()
  state.isDemoModeEnabled.mockReturnValue(false)
  state.randomUUID.mockReturnValue('11111111-1111-4111-8111-111111111111')
})

test('registers demo attachments or persists quota-checked metadata', async () => {
  state.isDemoModeEnabled.mockReturnValueOnce(true)
  await attachments.registerPublicAttachment('demo', metadata)
  assert.deepEqual(state.registerDemoPublicAttachment.mock.calls[0], ['demo', metadata])

  state.results.push([{ bytes: 2 }])
  await attachments.registerPublicAttachment('token', metadata)
  assert.partialDeepStrictEqual(state.inserts[0], { token: 'token', ...metadata, content: null })
  state.results.push([{ bytes: 2 * 1024 ** 3 }])
  await assert.rejects(attachments.registerPublicAttachment('over', metadata), /quota exceeded/)

  state.results.push([])
  await attachments.registerPublicAttachment('unused', metadata)
  assert.equal(state.inserts.length, 2)
})

test('stores legacy content, validates uploaded metadata, and cleans up failed legacy files', async () => {
  state.results.push([{ bytes: 0 }], [{ ...metadata, content: null }])
  const links = await attachments.storePublicAttachments([
    {
      deliveryMode: 'public',
      name: metadata.filename,
      contentType: metadata.contentType,
      size: 3,
      contentBase64: 'YWJj'
    }
  ])
  assert.deepEqual(links, [
    {
      token: '11111111-1111-4111-8111-111111111111',
      name: metadata.filename,
      contentType: metadata.contentType,
      size: 3
    }
  ])
  assert.equal(state.writePublicAttachmentFile.mock.calls.length, 1)
  assert.deepEqual(state.assertPublicAttachmentFile.mock.calls[0], [
    '11111111-1111-4111-8111-111111111111',
    3
  ])

  await assert.rejects(
    attachments.storePublicAttachments([
      { deliveryMode: 'public', name: 'x', contentType: 'text/plain', size: 1, contentBase64: '' }
    ]),
    /content is missing/
  )
  state.results.push([{ bytes: 0 }])
  state.writePublicAttachmentFile.mockRejectedValueOnce(new Error('disk'))
  await assert.rejects(
    attachments.storePublicAttachments([
      {
        deliveryMode: 'public',
        name: 'x',
        contentType: 'text/plain',
        size: 1,
        contentBase64: 'eA=='
      }
    ]),
    /disk/
  )
  assert.equal(state.deletePublicAttachmentFile.mock.calls.length, 1)
})

test('rejects unavailable uploads and deletes only tokens created by this call', async () => {
  state.results.push([{ bytes: 0 }], [])
  await assert.rejects(
    attachments.storePublicAttachments([
      {
        deliveryMode: 'public',
        name: 'x',
        contentType: 'text/plain',
        size: 1,
        contentBase64: 'eA=='
      }
    ]),
    /unavailable/
  )
  assert.equal(state.db.delete.mock.calls.length, 1)
})

test('uses an existing upload without re-writing its content', async () => {
  state.results.push([{ ...metadata, content: Buffer.from('abc') }])

  const links = await attachments.storePublicAttachments([
    {
      deliveryMode: 'public',
      token: 'existing',
      name: metadata.filename,
      contentType: metadata.contentType,
      size: 3
    }
  ])

  assert.deepEqual(links, [
    { token: 'existing', name: metadata.filename, contentType: metadata.contentType, size: 3 }
  ])
  assert.equal(state.writePublicAttachmentFile.mock.calls.length, 0)
  assert.equal(state.assertPublicAttachmentFile.mock.calls.length, 0)
})

test('cleans up an empty upload token when a later attachment fails', async () => {
  state.results.push([{ ...metadata, content: Buffer.from('abc') }], [], [{ token: '' }])

  await assert.rejects(
    attachments.storePublicAttachments([
      {
        deliveryMode: 'public',
        token: '',
        name: metadata.filename,
        contentType: metadata.contentType,
        size: 3,
        contentBase64: 'YWJj'
      },
      {
        deliveryMode: 'public',
        token: 'unavailable',
        name: metadata.filename,
        contentType: metadata.contentType,
        size: 3
      }
    ]),
    /unavailable/
  )

  assert.deepEqual(
    state.deletePublicAttachmentFile.mock.calls.map((call) => call[0]),
    ['']
  )
})

test('uses demo attachment metadata for an existing upload', async () => {
  state.isDemoModeEnabled.mockReturnValue(true)
  state.getDemoPublicAttachment.mockReturnValue({ ...metadata, content: null })

  const links = await attachments.storePublicAttachments([
    {
      deliveryMode: 'public',
      token: 'demo-upload',
      name: metadata.filename,
      contentType: metadata.contentType,
      size: metadata.size
    }
  ])

  assert.deepEqual(links, [
    { token: 'demo-upload', name: metadata.filename, contentType: metadata.contentType, size: 3 }
  ])
  assert.deepEqual(state.assertPublicAttachmentFile.mock.calls, [['demo-upload', 3]])
})

test('commits, uncommits, deletes, and cleans attachments in database and demo modes', async () => {
  assert.deepEqual(await attachments.commitPublicAttachments([]), [])
  await attachments.uncommitPublicAttachments([])
  await attachments.deletePublicAttachments([])
  state.results.push([{ token: 'one' }])
  assert.deepEqual(await attachments.commitPublicAttachments(['one']), ['one'])
  await attachments.uncommitPublicAttachments(['one'])
  state.results.push([{ token: 'one' }])
  await attachments.deletePublicAttachments(['one'])
  state.results.push([{ token: 'stale' }])
  assert.equal(await attachments.cleanupStalePublicAttachments(), 1)
  assert.deepEqual(
    state.deletePublicAttachmentFile.mock.calls.map((call) => call[0]),
    ['one', 'stale']
  )

  state.isDemoModeEnabled.mockReturnValue(true)
  state.commitDemoPublicAttachments.mockReturnValue(['demo'])
  state.deleteDemoPublicAttachments.mockReturnValue(['demo'])
  assert.deepEqual(await attachments.commitPublicAttachments(['demo']), ['demo'])
  await attachments.uncommitPublicAttachments(['demo'])
  await attachments.deletePublicAttachments(['demo'])
  assert.equal(await attachments.cleanupStalePublicAttachments(), 0)
})
