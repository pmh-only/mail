import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'
import { test } from 'vitest'
import { createImapProxyServer } from './imap-proxy.ts'

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Missing TCP address'))
      resolve(address.port)
    })
  })
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

test('forwards public IMAP TCP traffic to the configured upstream', async () => {
  const upstream = createServer((socket) => {
    socket.on('data', (data) => socket.end(`upstream:${data.toString()}`))
  })
  const upstreamPort = await listen(upstream)
  const proxy = createImapProxyServer(async () => ({ host: '127.0.0.1', port: upstreamPort }))
  const proxyPort = await listen(proxy)

  try {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: proxyPort }, () => {
        socket.write('imap-probe')
      })
      let body = ''
      socket.on('data', (data) => (body += data.toString()))
      socket.once('end', () => resolve(body))
      socket.once('error', reject)
    })
    assert.equal(response, 'upstream:imap-probe')
  } finally {
    await close(proxy)
    await close(upstream)
  }
})

test('handles clients disconnecting while the target is being resolved', async () => {
  const proxy = createImapProxyServer(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
    return { host: '127.0.0.1', port: 1 }
  })
  const proxyPort = await listen(proxy)

  const client = createConnection({ host: '127.0.0.1', port: proxyPort })
  client.on('error', () => {})
  client.destroy()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await close(proxy)
})
