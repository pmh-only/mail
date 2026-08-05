import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const MAX_PUBLIC_ATTACHMENT_SIZE =
  Number(process.env.PUBLIC_ATTACHMENT_MAX_BYTES) || 100 * 1024 ** 2
const UPLOAD_IDLE_TIMEOUT_MS = 30_000
const UPLOAD_MAX_DURATION_MS = 5 * 60_000

export function publicAttachmentDirectory() {
  return resolve(process.env.PUBLIC_ATTACHMENT_DIR || 'data/public-attachments')
}

export function publicAttachmentFilePath(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('Invalid public attachment token')
  return resolve(publicAttachmentDirectory(), `${token}.bin`)
}

export async function writePublicAttachmentFile(
  token: string,
  body: AsyncIterable<Uint8Array>,
  expectedSize: number
) {
  if (
    !Number.isInteger(expectedSize) ||
    expectedSize < 0 ||
    expectedSize > MAX_PUBLIC_ATTACHMENT_SIZE
  ) {
    throw new Error(`Public attachments must be at most ${MAX_PUBLIC_ATTACHMENT_SIZE} bytes`)
  }

  const directory = publicAttachmentDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const destination = publicAttachmentFilePath(token)
  const temporary = resolve(directory, `.${token}.${randomUUID()}.upload`)
  let received = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      resetIdleTimeout()
      received += chunk.length
      if (received > expectedSize) {
        callback(new Error('Uploaded attachment is larger than declared'))
        return
      }
      callback(null, chunk)
    }
  })
  let idleTimeout = setTimeout(
    () => counter.destroy(new Error('Attachment upload timed out')),
    UPLOAD_IDLE_TIMEOUT_MS
  )
  const durationTimeout = setTimeout(
    () => counter.destroy(new Error('Attachment upload exceeded maximum duration')),
    UPLOAD_MAX_DURATION_MS
  )
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeout)
    idleTimeout = setTimeout(
      () => counter.destroy(new Error('Attachment upload timed out')),
      UPLOAD_IDLE_TIMEOUT_MS
    )
  }

  try {
    await pipeline(
      Readable.from(body),
      counter,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    )
    if (received !== expectedSize)
      throw new Error('Uploaded attachment size does not match declaration')
    await rename(temporary, destination)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(idleTimeout)
    clearTimeout(durationTimeout)
  }
}

export async function assertPublicAttachmentFile(token: string, expectedSize: number) {
  const path = publicAttachmentFilePath(token)
  const details = await stat(path)
  if (!details.isFile() || details.size !== expectedSize) {
    throw new Error('Stored public attachment is incomplete')
  }
  return path
}

export async function publicAttachmentFile(token: string, expectedSize: number) {
  const path = await assertPublicAttachmentFile(token, expectedSize)
  return { path, stream: createReadStream(path) }
}

export async function deletePublicAttachmentFile(token: string) {
  await unlink(publicAttachmentFilePath(token)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}
