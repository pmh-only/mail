import { randomUUID } from 'node:crypto'
import {
  createCleartextMessage,
  createMessage,
  decrypt,
  encrypt,
  readCleartextMessage,
  readMessage,
  readSignature,
  sign,
  verify,
  type PartialConfig,
  type PrivateKey,
  type PublicKey
} from 'openpgp'
import { openPgpKeyEmails } from './openpgp-keyservers.ts'

export type OpenPgpSigningMethod = 'none' | 'cleartext' | 'detached' | 'pgp-mime'
export type OpenPgpSignatureStatus =
  | 'valid'
  | 'valid-untrusted'
  | 'valid-mismatch'
  | 'invalid'
  | 'unknown'
  | null

export type OpenPgpSecurityResult = {
  signed: boolean
  signatureStatus: OpenPgpSignatureStatus
  signer: string | null
  fingerprint: string | null
  encrypted: boolean
  decrypted: boolean
  error: string | null
}

export type InboundOpenPgpResult = OpenPgpSecurityResult & { rawMessage: Buffer }

const EMPTY_RESULT: OpenPgpSecurityResult = {
  signed: false,
  signatureStatus: null,
  signer: null,
  fingerprint: null,
  encrypted: false,
  decrypted: false,
  error: null
}

const OPENPGP_DECRYPT_CONFIG = {
  maxDecompressedMessageSize: 25 * 1024 * 1024
} satisfies PartialConfig

function normalizeCrlf(value: string | Uint8Array) {
  return Buffer.from(value).toString('utf8').replace(/\r?\n/g, '\r\n')
}

function splitHeaders(raw: string) {
  const separator = raw.indexOf('\r\n\r\n')
  if (separator < 0) return { headers: raw, body: '' }
  return { headers: raw.slice(0, separator), body: raw.slice(separator + 4) }
}

function headerValue(headers: string, name: string) {
  const unfolded = headers.replace(/\r\n[\t ]+/g, ' ')
  return unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? ''
}

function contentTypeBoundary(contentType: string) {
  return (
    contentType
      .match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)
      ?.slice(1)
      .find(Boolean) ?? null
  )
}

function multipartParts(body: string, boundary: string) {
  const delimiter = `--${boundary}`
  const starts: Array<{ index: number; contentStart: number; closing: boolean }> = []
  let cursor = 0
  while (cursor < body.length) {
    const index = body.indexOf(delimiter, cursor)
    if (index < 0) break
    if (index === 0 || body.slice(index - 2, index) === '\r\n') {
      const lineEnd = body.indexOf('\r\n', index)
      const closing = body
        .slice(index + delimiter.length, lineEnd < 0 ? undefined : lineEnd)
        .startsWith('--')
      starts.push({ index, contentStart: lineEnd < 0 ? body.length : lineEnd + 2, closing })
      if (closing) break
    }
    cursor = index + delimiter.length
  }
  const parts: string[] = []
  for (let index = 0; index < starts.length - 1; index += 1) {
    const current = starts[index]!
    const next = starts[index + 1]!
    parts.push(body.slice(current.contentStart, next.index - 2))
  }
  return parts
}

function decodePart(part: string) {
  const { headers, body } = splitHeaders(part)
  const encoding = headerValue(headers, 'content-transfer-encoding').toLowerCase()
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64')
  if (encoding === 'quoted-printable') {
    return Buffer.from(
      body
        .replace(/=\r\n/g, '')
        .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16))
        ),
      'binary'
    )
  }
  return Buffer.from(body, 'utf8')
}

function outerHeaders(headers: string) {
  const retained: string[] = []
  let skip = false
  for (const line of headers.split('\r\n')) {
    if (/^[\t ]/.test(line)) {
      if (!skip) retained.push(line)
      continue
    }
    skip = /^(content-|mime-version:)/i.test(line)
    if (!skip) retained.push(line)
  }
  return retained.join('\r\n')
}

function entityFromRaw(raw: Buffer) {
  const normalized = normalizeCrlf(raw)
  const { headers, body } = splitHeaders(normalized)
  const contentHeaders = headers
    .split('\r\n')
    .reduce<{ lines: string[]; include: boolean }>(
      (state, line) => {
        if (/^[\t ]/.test(line)) {
          if (state.include) state.lines.push(line)
        } else {
          state.include = /^content-/i.test(line)
          if (state.include) state.lines.push(line)
        }
        return state
      },
      { lines: [], include: false }
    )
    .lines.join('\r\n')
  return {
    envelopeHeaders: outerHeaders(headers),
    entity: `${contentHeaders || 'Content-Type: text/plain; charset=utf-8'}\r\n\r\n${body}`
  }
}

function rawWithTextBody(raw: string, text: string) {
  const { headers } = splitHeaders(raw)
  return Buffer.from(
    `${outerHeaders(headers)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${normalizeCrlf(text)}\r\n`,
    'utf8'
  )
}

function signerForKey(
  keys: PublicKey[],
  keyId: string
): { signer: string | null; fingerprint: string | null; emails: string[] } {
  const key = keys.find((candidate) =>
    candidate.getKeyIDs().some((id) => id.toHex().toLowerCase() === keyId.toLowerCase())
  )
  return key
    ? {
        signer: key.getUserIDs()[0] ?? null,
        fingerprint: key.getFingerprint().toLowerCase(),
        emails: openPgpKeyEmails(key)
      }
    : { signer: null, fingerprint: null, emails: [] }
}

async function signatureResult(
  result: { signatures: Array<{ keyID: { toHex(): string }; verified: Promise<unknown> }> },
  keys: PublicKey[],
  trustedFingerprints?: ReadonlySet<string>,
  senderAddress?: string
) {
  const signature = result.signatures[0]
  if (!signature) return { status: 'unknown' as const, signer: null, fingerprint: null }
  const identity = signerForKey(keys, signature.keyID.toHex())
  try {
    await signature.verified
    if (!senderAddress) {
      return {
        status: 'valid-untrusted' as const,
        signer: identity.signer,
        fingerprint: identity.fingerprint
      }
    }
    if (!identity.emails.includes(senderAddress.trim().toLowerCase())) {
      return {
        status: 'valid-mismatch' as const,
        signer: identity.signer,
        fingerprint: identity.fingerprint
      }
    }
    const trusted =
      !trustedFingerprints ||
      (identity.fingerprint !== null && trustedFingerprints.has(identity.fingerprint))
    return {
      status: trusted ? ('valid' as const) : ('valid-untrusted' as const),
      signer: identity.signer,
      fingerprint: identity.fingerprint
    }
  } catch {
    return {
      status: identity.fingerprint ? ('invalid' as const) : ('unknown' as const),
      signer: identity.signer,
      fingerprint: identity.fingerprint
    }
  }
}

export async function clearSignText(text: string, privateKey: PrivateKey) {
  return String(
    await sign({
      message: await createCleartextMessage({ text }),
      signingKeys: privateKey,
      format: 'armored'
    })
  )
}

export async function detachedSignText(text: string, privateKey: PrivateKey) {
  return String(
    await sign({
      message: await createMessage({ text }),
      signingKeys: privateKey,
      detached: true,
      format: 'armored'
    })
  )
}

export async function signPgpMime(raw: Buffer, privateKey: PrivateKey) {
  const { envelopeHeaders, entity } = entityFromRaw(raw)
  const signature = String(
    await sign({
      message: await createMessage({ binary: Buffer.from(entity, 'utf8') }),
      signingKeys: privateKey,
      detached: true,
      format: 'armored'
    })
  )
  const parsedSignature = await readSignature({ armoredSignature: signature })
  const hashAlgorithm = parsedSignature.packets[0]?.hashAlgorithm
  const micalg =
    hashAlgorithm === 8
      ? 'pgp-sha256'
      : hashAlgorithm === 9
        ? 'pgp-sha384'
        : hashAlgorithm === 10
          ? 'pgp-sha512'
          : hashAlgorithm === 11
            ? 'pgp-sha224'
            : hashAlgorithm === 2
              ? 'pgp-sha1'
              : 'pgp-unknown'
  const boundary = `----=pmail_signed_${randomUUID().replaceAll('-', '')}`
  return Buffer.from(
    `${envelopeHeaders}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/signed; protocol="application/pgp-signature"; micalg=${micalg}; boundary="${boundary}"\r\n\r\n` +
      `This is an OpenPGP/MIME signed message.\r\n--${boundary}\r\n${entity}\r\n` +
      `--${boundary}\r\nContent-Type: application/pgp-signature; name="signature.asc"\r\nContent-Disposition: attachment; filename="signature.asc"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${signature.trimEnd()}\r\n--${boundary}--\r\n`,
    'utf8'
  )
}

export async function encryptPgpMime(
  raw: Buffer,
  encryptionKeys: PublicKey[],
  signingKey?: PrivateKey
) {
  const { envelopeHeaders, entity } = entityFromRaw(raw)
  const encrypted = String(
    await encrypt({
      message: await createMessage({ binary: Buffer.from(entity, 'utf8') }),
      encryptionKeys,
      signingKeys: signingKey,
      wildcard: true,
      format: 'armored'
    })
  )
  const boundary = `----=pmail_encrypted_${randomUUID().replaceAll('-', '')}`
  return Buffer.from(
    `${envelopeHeaders}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"\r\n\r\n` +
      `This is an OpenPGP/MIME encrypted message.\r\n--${boundary}\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream; name="encrypted.asc"\r\nContent-Disposition: inline; filename="encrypted.asc"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${encrypted.trimEnd()}\r\n--${boundary}--\r\n`,
    'utf8'
  )
}

async function verifyPgpMime(
  raw: string,
  keys: PublicKey[],
  trustedFingerprints?: ReadonlySet<string>,
  senderAddress?: string
): Promise<OpenPgpSecurityResult | null> {
  const { headers, body } = splitHeaders(raw)
  const contentType = headerValue(headers, 'content-type')
  if (
    !/^multipart\/signed\b/i.test(contentType) ||
    !/application\/pgp-signature/i.test(contentType)
  )
    return null
  const boundary = contentTypeBoundary(contentType)
  if (!boundary)
    return {
      ...EMPTY_RESULT,
      signed: true,
      signatureStatus: 'invalid',
      error: 'Signed message boundary is missing'
    }
  const parts = multipartParts(body, boundary)
  if (parts.length < 2)
    return {
      ...EMPTY_RESULT,
      signed: true,
      signatureStatus: 'invalid',
      error: 'Signed message is incomplete'
    }
  try {
    const verification = await verify({
      message: await createMessage({ binary: Buffer.from(parts[0]!, 'utf8') }),
      signature: await readSignature({ armoredSignature: decodePart(parts[1]!).toString('utf8') }),
      verificationKeys: keys,
      format: 'binary'
    })
    const result = await signatureResult(verification, keys, trustedFingerprints, senderAddress)
    return {
      ...EMPTY_RESULT,
      signed: true,
      signatureStatus: result.status,
      signer: result.signer,
      fingerprint: result.fingerprint
    }
  } catch (error) {
    return {
      ...EMPTY_RESULT,
      signed: true,
      signatureStatus: keys.length ? 'invalid' : 'unknown',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function decryptPgpMime(
  raw: string,
  privateKeys: PrivateKey[],
  verificationKeys: PublicKey[],
  trustedFingerprints?: ReadonlySet<string>,
  senderAddress?: string
): Promise<InboundOpenPgpResult | null> {
  const { headers, body } = splitHeaders(raw)
  const contentType = headerValue(headers, 'content-type')
  if (
    !/^multipart\/encrypted\b/i.test(contentType) ||
    !/application\/pgp-encrypted/i.test(contentType)
  )
    return null
  const boundary = contentTypeBoundary(contentType)
  const parts = boundary ? multipartParts(body, boundary) : []
  if (parts.length < 2)
    return {
      ...EMPTY_RESULT,
      encrypted: true,
      rawMessage: Buffer.from(raw),
      error: 'Encrypted message is incomplete'
    }
  if (privateKeys.length === 0)
    return {
      ...EMPTY_RESULT,
      encrypted: true,
      rawMessage: Buffer.from(raw),
      error: 'No private key is available for decryption'
    }
  try {
    const encryptedData = decodePart(parts[1]!)
    const message = encryptedData.toString('utf8').includes('BEGIN PGP MESSAGE')
      ? await readMessage({ armoredMessage: encryptedData.toString('utf8') })
      : await readMessage({ binaryMessage: encryptedData })
    const decrypted = await decrypt({
      message,
      decryptionKeys: privateKeys,
      verificationKeys,
      format: 'binary',
      config: OPENPGP_DECRYPT_CONFIG
    })
    const entity = Buffer.from(decrypted.data).toString('utf8')
    const signature = await signatureResult(
      decrypted,
      verificationKeys,
      trustedFingerprints,
      senderAddress
    )
    return {
      ...EMPTY_RESULT,
      signed: decrypted.signatures.length > 0,
      signatureStatus: decrypted.signatures.length > 0 ? signature.status : null,
      signer: signature.signer,
      fingerprint: signature.fingerprint,
      encrypted: true,
      decrypted: true,
      rawMessage: Buffer.from(`${outerHeaders(headers)}\r\nMIME-Version: 1.0\r\n${entity}`, 'utf8')
    }
  } catch (error) {
    return {
      ...EMPTY_RESULT,
      encrypted: true,
      rawMessage: Buffer.from(raw),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function processInboundOpenPgp(input: {
  raw: Buffer
  text?: string
  detachedSignatures?: Buffer[]
  privateKeys: PrivateKey[]
  verificationKeys: PublicKey[]
  trustedFingerprints?: ReadonlySet<string>
  senderAddress?: string
}): Promise<InboundOpenPgpResult> {
  const raw = normalizeCrlf(input.raw)
  const decrypted = await decryptPgpMime(
    raw,
    input.privateKeys,
    input.verificationKeys,
    input.trustedFingerprints,
    input.senderAddress
  )
  if (decrypted) return decrypted
  const mimeSignature = await verifyPgpMime(
    raw,
    input.verificationKeys,
    input.trustedFingerprints,
    input.senderAddress
  )
  if (mimeSignature) return { ...mimeSignature, rawMessage: Buffer.from(raw) }

  const text = input.text?.trim() ?? ''
  if (text.includes('-----BEGIN PGP MESSAGE-----')) {
    if (input.privateKeys.length === 0) {
      return {
        ...EMPTY_RESULT,
        encrypted: true,
        rawMessage: Buffer.from(raw),
        error: 'No private key is available for decryption'
      }
    }
    try {
      const decrypted = await decrypt({
        message: await readMessage({ armoredMessage: text }),
        decryptionKeys: input.privateKeys,
        verificationKeys: input.verificationKeys,
        format: 'utf8',
        config: OPENPGP_DECRYPT_CONFIG
      })
      const signature = await signatureResult(
        decrypted,
        input.verificationKeys,
        input.trustedFingerprints,
        input.senderAddress
      )
      return {
        ...EMPTY_RESULT,
        signed: decrypted.signatures.length > 0,
        signatureStatus: decrypted.signatures.length > 0 ? signature.status : null,
        signer: signature.signer,
        fingerprint: signature.fingerprint,
        encrypted: true,
        decrypted: true,
        rawMessage: rawWithTextBody(raw, decrypted.data)
      }
    } catch (error) {
      return {
        ...EMPTY_RESULT,
        encrypted: true,
        rawMessage: Buffer.from(raw),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  if (text.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    try {
      const verification = await verify({
        message: await readCleartextMessage({ cleartextMessage: text }),
        verificationKeys: input.verificationKeys
      })
      const result = await signatureResult(
        verification,
        input.verificationKeys,
        input.trustedFingerprints,
        input.senderAddress
      )
      return {
        ...EMPTY_RESULT,
        signed: true,
        signatureStatus: result.status,
        signer: result.signer,
        fingerprint: result.fingerprint,
        rawMessage: rawWithTextBody(raw, verification.data)
      }
    } catch (error) {
      return {
        ...EMPTY_RESULT,
        signed: true,
        signatureStatus: input.verificationKeys.length ? 'invalid' : 'unknown',
        rawMessage: Buffer.from(raw),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const signatureData = input.detachedSignatures?.[0]
  if (signatureData && text) {
    try {
      const signature = signatureData.toString('utf8').includes('BEGIN PGP SIGNATURE')
        ? await readSignature({ armoredSignature: signatureData.toString('utf8') })
        : await readSignature({ binarySignature: signatureData })
      const verification = await verify({
        message: await createMessage({ text }),
        signature,
        verificationKeys: input.verificationKeys
      })
      const result = await signatureResult(
        verification,
        input.verificationKeys,
        input.trustedFingerprints,
        input.senderAddress
      )
      return {
        ...EMPTY_RESULT,
        signed: true,
        signatureStatus: result.status,
        signer: result.signer,
        fingerprint: result.fingerprint,
        rawMessage: Buffer.from(raw)
      }
    } catch (error) {
      return {
        ...EMPTY_RESULT,
        signed: true,
        signatureStatus: input.verificationKeys.length ? 'invalid' : 'unknown',
        rawMessage: Buffer.from(raw),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
  return { ...EMPTY_RESULT, rawMessage: Buffer.from(raw) }
}
