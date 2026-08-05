import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { Readable } from 'node:stream'
import {
  deletePublicAttachmentFile,
  MAX_PUBLIC_ATTACHMENT_SIZE,
  publicAttachmentFile,
  writePublicAttachmentFile
} from './public-attachment-files.ts'

test('streams a public attachment to a file and opens it for download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pmail-public-attachment-'))
  const previousDirectory = process.env.PUBLIC_ATTACHMENT_DIR
  process.env.PUBLIC_ATTACHMENT_DIR = directory
  const token = '67c5a06e-7ff2-49e4-9fa4-c182b4dc9161'
  const content = Buffer.alloc(8 * 1024 * 1024, 0x5a)

  try {
    await writePublicAttachmentFile(token, Readable.toWeb(Readable.from(content)), content.length)
    const stored = await publicAttachmentFile(token, content.length)
    assert.deepEqual(await readFile(stored.path), content)
    assert.equal((await stat(stored.path)).mode & 0o777, 0o600)
    await deletePublicAttachmentFile(token)
    await assert.rejects(publicAttachmentFile(token, content.length), /ENOENT/)
  } finally {
    if (previousDirectory === undefined) delete process.env.PUBLIC_ATTACHMENT_DIR
    else process.env.PUBLIC_ATTACHMENT_DIR = previousDirectory
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a public attachment above the one GiB boundary before reading it', async () => {
  const token = 'b197474a-b273-4599-bd5b-bbece7c5d55a'
  let read = false
  const body = (async function* () {
    read = true
    yield Buffer.alloc(1)
  })()

  await assert.rejects(
    writePublicAttachmentFile(token, body, MAX_PUBLIC_ATTACHMENT_SIZE + 1),
    /at most/
  )
  assert.equal(read, false)
})

test('removes partial uploads when the declared size does not match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pmail-public-attachment-'))
  const previousDirectory = process.env.PUBLIC_ATTACHMENT_DIR
  process.env.PUBLIC_ATTACHMENT_DIR = directory
  const token = '5f4db311-e9d6-4a18-ae70-0aa89f7a03ab'

  try {
    await assert.rejects(
      writePublicAttachmentFile(token, Readable.toWeb(Readable.from('short')), 100),
      /size does not match/
    )
    await assert.rejects(publicAttachmentFile(token, 100), /ENOENT/)
  } finally {
    if (previousDirectory === undefined) delete process.env.PUBLIC_ATTACHMENT_DIR
    else process.env.PUBLIC_ATTACHMENT_DIR = previousDirectory
    await rm(directory, { recursive: true, force: true })
  }
})
