import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessage } from '$lib/server/db/schema'
import { or, like } from 'drizzle-orm'

type Contact = { name: string; email: string; display: string }

const EMAIL_RE = /([^<,]*?)\s*<([^>]+)>/g
const BARE_EMAIL_RE = /[\w.+%-]+@[\w.-]+\.[a-z]{2,}/gi

function parseAddresses(field: string): Contact[] {
  const contacts: Contact[] = []
  let match: RegExpExecArray | null

  EMAIL_RE.lastIndex = 0
  while ((match = EMAIL_RE.exec(field)) !== null) {
    const name = match[1].trim().replace(/^["']|["']$/g, '')
    const email = match[2].trim().toLowerCase()
    if (email) contacts.push({ name, email, display: name ? `${name} <${email}>` : email })
  }

  // Also catch bare emails not inside angle brackets
  BARE_EMAIL_RE.lastIndex = 0
  while ((match = BARE_EMAIL_RE.exec(field)) !== null) {
    const email = match[0].toLowerCase()
    if (!contacts.some((c) => c.email === email)) {
      contacts.push({ name: '', email, display: email })
    }
  }

  return contacts
}

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!q) return json({ contacts: [] })

  const pattern = `%${q}%`
  const rows = await db
    .select({ from: mailMessage.from, to: mailMessage.to, cc: mailMessage.cc })
    .from(mailMessage)
    .where(
      or(
        like(mailMessage.from, pattern),
        like(mailMessage.to, pattern),
        like(mailMessage.cc, pattern)
      )
    )
    .limit(200)

  const seen = new Map<string, Contact>()
  for (const row of rows) {
    for (const field of [row.from, row.to, row.cc].filter(Boolean)) {
      for (const c of parseAddresses(field)) {
        if (
          !seen.has(c.email) &&
          (c.email.includes(q) || c.name.toLowerCase().includes(q.toLowerCase()))
        ) {
          seen.set(c.email, c)
        }
      }
    }
  }

  const contacts = [...seen.values()].slice(0, 10)
  return json({ contacts })
}
