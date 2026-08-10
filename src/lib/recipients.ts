export type RecipientField = 'to' | 'cc' | 'bcc'

export type ParsedRecipient = {
  raw: string
  email: string
  valid: boolean
  reason?: string
}

export type RecipientValidationIssue = {
  field: RecipientField
  message: string
  recipients?: string[]
}

export type RecipientValidationResult = {
  recipients: Record<RecipientField, ParsedRecipient[]>
  errors: RecipientValidationIssue[]
  warnings: RecipientValidationIssue[]
}

const FIELD_LABELS: Record<RecipientField, string> = {
  to: 'To',
  cc: 'Cc',
  bcc: 'Bcc'
}

const COMMON_TYPO_DOMAINS = new Map([
  ['gmal.com', 'gmail.com'],
  ['gmial.com', 'gmail.com'],
  ['gmail.con', 'gmail.com'],
  ['hotmial.com', 'hotmail.com'],
  ['hotmai.com', 'hotmail.com'],
  ['outlok.com', 'outlook.com'],
  ['outlook.con', 'outlook.com'],
  ['yaho.com', 'yahoo.com'],
  ['yahoo.con', 'yahoo.com']
])

export function splitRecipientList(value: string | null | undefined) {
  const input = value ?? ''
  const entries: string[] = []
  let current = ''
  let inQuotes = false
  let angleDepth = 0

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }

    if (!inQuotes && char === '<') angleDepth += 1
    if (!inQuotes && char === '>' && angleDepth > 0) angleDepth -= 1

    if (!inQuotes && angleDepth === 0 && (char === ',' || char === ';')) {
      const entry = current.trim()
      if (entry) entries.push(entry)
      current = ''
      continue
    }

    current += char
  }

  const entry = current.trim()
  if (entry) entries.push(entry)
  return entries
}

function extractEmail(raw: string) {
  const text = raw.trim()
  const matches = [...text.matchAll(/<([^<>]+)>/g)]
  if (matches.length > 1) return ''
  return (matches[0]?.[1] ?? text).trim()
}

function validateEmail(email: string) {
  if (!email) return 'Enter an email address.'
  if (/\s/.test(email)) return 'Email addresses cannot contain spaces.'
  if (email.includes('..')) return 'Email addresses cannot contain consecutive dots.'
  if (!/^[^@<>(),;:]+@[^@<>(),;:]+\.[^@<>(),;:]+$/.test(email)) {
    return 'Use a valid email address.'
  }
  return null
}

export function parseRecipientList(value: string | null | undefined): ParsedRecipient[] {
  return splitRecipientList(value).map((raw) => {
    const email = extractEmail(raw)
    const reason = validateEmail(email)
    return {
      raw,
      email,
      valid: reason === null,
      reason: reason ?? undefined
    }
  })
}

export function normalizeRecipientList(value: string | null | undefined) {
  return parseRecipientList(value)
    .map((recipient) => recipient.raw)
    .join(', ')
}

export function validateRecipientFields(fields: Record<RecipientField, string | null | undefined>) {
  const recipients: Record<RecipientField, ParsedRecipient[]> = {
    to: parseRecipientList(fields.to),
    cc: parseRecipientList(fields.cc),
    bcc: parseRecipientList(fields.bcc)
  }
  const errors: RecipientValidationIssue[] = []
  const warnings: RecipientValidationIssue[] = []

  if (recipients.to.length === 0) {
    errors.push({ field: 'to', message: 'Add at least one recipient.' })
  }

  for (const field of ['to', 'cc', 'bcc'] as const) {
    const invalid = recipients[field].filter((recipient) => !recipient.valid)
    if (invalid.length > 0) {
      errors.push({
        field,
        message: `${FIELD_LABELS[field]} contains invalid recipients: ${invalid.map((r) => r.raw).join(', ')}`,
        recipients: invalid.map((recipient) => recipient.raw)
      })
    }
  }

  const seen = new Map<string, { field: RecipientField; raw: string }>()
  const duplicates: string[] = []
  for (const field of ['to', 'cc', 'bcc'] as const) {
    for (const recipient of recipients[field]) {
      if (!recipient.valid) continue
      const email = recipient.email.toLowerCase()
      if (seen.has(email)) {
        duplicates.push(recipient.raw)
      } else {
        seen.set(email, { field, raw: recipient.raw })
      }
    }
  }

  if (duplicates.length > 0) {
    warnings.push({
      field: 'to',
      message: `Some recipients are listed more than once: ${duplicates.join(', ')}`,
      recipients: duplicates
    })
  }

  const allValid = Object.values(recipients).flatMap((fieldRecipients) =>
    fieldRecipients.filter((recipient) => recipient.valid)
  )

  if (allValid.length > 10) {
    warnings.push({
      field: 'to',
      message: `This message has ${allValid.length} recipients. Confirm before sending.`
    })
  }

  const typoWarnings = allValid
    .map((recipient) => {
      const domain = recipient.email.split('@')[1]!.toLowerCase()
      const suggestion = COMMON_TYPO_DOMAINS.get(domain)
      return suggestion ? `${recipient.email} (did you mean ${suggestion}?)` : null
    })
    .filter((warning): warning is string => warning !== null)

  if (typoWarnings.length > 0) {
    warnings.push({
      field: 'to',
      message: `Possible recipient typo: ${typoWarnings.join(', ')}`
    })
  }

  return { recipients, errors, warnings } satisfies RecipientValidationResult
}
