import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { afterEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  chmod: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
  mkdir: vi.fn(),
  randomUUID: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn()
}))

vi.mock('node:crypto', () => ({ randomUUID: state.randomUUID }))
vi.mock('node:fs', () => ({
  createReadStream: state.createReadStream,
  createWriteStream: state.createWriteStream
}))
vi.mock('node:fs/promises', () => ({
  chmod: state.chmod,
  mkdir: state.mkdir,
  rename: state.rename,
  stat: state.stat,
  unlink: state.unlink
}))

import {
  MAX_PUBLIC_ATTACHMENT_SIZE,
  assertPublicAttachmentFile,
  deletePublicAttachmentFile,
  publicAttachmentDirectory,
  publicAttachmentFile,
  publicAttachmentFilePath,
  writePublicAttachmentFile
} from './public-attachment-files.ts'

const token = '67c5a06e-7ff2-49e4-9fa4-c182b4dc9161'

function body(...chunks: Uint8Array[]) {
  return (async function* () {
    yield* chunks
  })()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  process.env.PUBLIC_ATTACHMENT_DIR = '/attachments'
  state.randomUUID.mockReturnValue('upload-id')
  state.mkdir.mockResolvedValue(undefined)
  state.chmod.mockResolvedValue(undefined)
  state.rename.mockResolvedValue(undefined)
  state.unlink.mockResolvedValue(undefined)
  state.createWriteStream.mockImplementation(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        }
      })
  )
})

test('builds attachment paths only for UUID-shaped tokens', () => {
  process.env.PUBLIC_ATTACHMENT_DIR = '/attachments'
  assert.equal(publicAttachmentDirectory(), '/attachments')
  assert.equal(publicAttachmentFilePath(token), `/attachments/${token}.bin`)
  assert.throws(() => publicAttachmentFilePath('../file'), /Invalid public attachment token/)
  delete process.env.PUBLIC_ATTACHMENT_DIR
  assert.match(publicAttachmentDirectory(), /data\/public-attachments$/)
  process.env.PUBLIC_ATTACHMENT_DIR = ''
  assert.match(publicAttachmentDirectory(), /data\/public-attachments$/)
})

test('writes an exact-size stream through a private temporary file before publishing it', async () => {
  await writePublicAttachmentFile(token, body(Buffer.from('hello'), Buffer.from('!')), 6)
  assert.deepEqual(state.mkdir.mock.calls[0], ['/attachments', { recursive: true, mode: 0o700 }])
  assert.deepEqual(state.chmod.mock.calls[0], ['/attachments', 0o700])
  assert.deepEqual(state.createWriteStream.mock.calls[0], [
    `/attachments/.${token}.upload-id.upload`,
    { flags: 'wx', mode: 0o600 }
  ])
  assert.deepEqual(state.rename.mock.calls[0], [
    `/attachments/.${token}.upload-id.upload`,
    `/attachments/${token}.bin`
  ])
  assert.equal(state.unlink.mock.calls.length, 0)
})

test('rejects invalid declared sizes before filesystem access', async () => {
  for (const size of [-1, 1.5, Number.NaN, MAX_PUBLIC_ATTACHMENT_SIZE + 1]) {
    await assert.rejects(writePublicAttachmentFile(token, body(Buffer.from('x')), size), /at most/)
  }
  assert.equal(state.mkdir.mock.calls.length, 0)
})

test('removes partial files after oversized, undersized, and pipeline-failed uploads', async () => {
  state.unlink.mockRejectedValueOnce(new Error('already absent'))
  await assert.rejects(
    writePublicAttachmentFile(token, body(Buffer.from('long')), 2),
    /larger than declared/
  )
  await assert.rejects(
    writePublicAttachmentFile(token, body(Buffer.from('short')), 6),
    /size does not match/
  )
  state.createWriteStream.mockImplementationOnce(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(new Error('disk failed'))
        }
      })
  )
  await assert.rejects(writePublicAttachmentFile(token, body(Buffer.from('ok')), 2), /disk failed/)
  assert.equal(state.unlink.mock.calls.length, 3)
})

test('aborts uploads that become idle or exceed the total upload duration', async () => {
  const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
  const idleBody = new Readable({ read() {} })
  const idleUpload = writePublicAttachmentFile(token, idleBody, 2)
  await vi.waitFor(() =>
    assert.equal(
      setTimeoutSpy.mock.calls.some(([, delay]) => delay === 30_000),
      true
    )
  )
  idleBody.push(Buffer.from('x'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  const initialIdleTimeout = setTimeoutSpy.mock.calls.find(
    ([, delay]) => delay === 30_000
  )?.[0] as () => void
  const idleTimeout = setTimeoutSpy.mock.calls.findLast(
    ([, delay]) => delay === 30_000
  )?.[0] as () => void
  initialIdleTimeout()
  idleTimeout()
  await new Promise<void>((resolve) => setImmediate(resolve))
  idleBody.push(null)
  await assert.rejects(idleUpload, /timed out/)

  const activeBody = new Readable({ read() {} })
  const longUpload = writePublicAttachmentFile(token, activeBody, 1)
  await vi.waitFor(() =>
    assert.equal(
      setTimeoutSpy.mock.calls.some(([, delay]) => delay === 5 * 60_000),
      true
    )
  )
  activeBody.push(Buffer.from('x'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  const durationTimeout = setTimeoutSpy.mock.calls.findLast(
    ([, delay]) => delay === 5 * 60_000
  )?.[0] as () => void
  durationTimeout()
  await new Promise<void>((resolve) => setImmediate(resolve))
  activeBody.push(null)
  await assert.rejects(longUpload, /exceeded maximum duration/)
})

test('asserts stored files, opens downloads, and ignores only missing-file deletes', async () => {
  state.stat.mockResolvedValue({ isFile: () => true, size: 3 })
  const stream = Readable.from([])
  state.createReadStream.mockReturnValue(stream)
  assert.equal(await assertPublicAttachmentFile(token, 3), `/attachments/${token}.bin`)
  assert.deepEqual(await publicAttachmentFile(token, 3), {
    path: `/attachments/${token}.bin`,
    stream
  })

  state.stat.mockResolvedValue({ isFile: () => false, size: 3 })
  await assert.rejects(assertPublicAttachmentFile(token, 3), /incomplete/)
  state.stat.mockResolvedValue({ isFile: () => true, size: 2 })
  await assert.rejects(assertPublicAttachmentFile(token, 3), /incomplete/)

  state.unlink.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  await deletePublicAttachmentFile(token)
  state.unlink.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await assert.rejects(deletePublicAttachmentFile(token), /denied/)
})
