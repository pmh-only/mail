import { describe, expect, it } from 'vitest'
import {
  normalizeRecipientList,
  parseRecipientList,
  splitRecipientList,
  validateRecipientFields
} from './recipients'

describe('splitRecipientList', () => {
  it.each([null, undefined, '', ' , ; '])('returns no entries for %j', (value) => {
    expect(splitRecipientList(value)).toEqual([])
  })

  it('splits comma and semicolon lists while preserving quoted delimiters', () => {
    expect(
      splitRecipientList(
        '"Doe, Jane" <jane@example.com>; John <john@example.com>, last@example.com'
      )
    ).toEqual(['"Doe, Jane" <jane@example.com>', 'John <john@example.com>', 'last@example.com'])
  })

  it('preserves separators inside angle brackets and handles unmatched brackets', () => {
    expect(splitRecipientList('Name <odd,name@example.com>, next@example.com')).toEqual([
      'Name <odd,name@example.com>',
      'next@example.com'
    ])
    expect(splitRecipientList('Name <open@example.com, still')).toEqual([
      'Name <open@example.com, still'
    ])
  })
})

describe('parseRecipientList', () => {
  it.each([
    ['', 'Enter an email address.'],
    ['user name@example.com', 'Email addresses cannot contain spaces.'],
    ['user..name@example.com', 'Email addresses cannot contain consecutive dots.'],
    ['not-an-email', 'Use a valid email address.'],
    ['One <one@example.com> Two <two@example.com>', 'Enter an email address.']
  ])('rejects %s', (value, reason) => {
    const parsed = parseRecipientList(value)[0]
    if (value === '') {
      expect(parsed).toBeUndefined()
      return
    }
    expect(parsed).toMatchObject({ valid: false, reason })
  })

  it('extracts valid bare and named addresses', () => {
    expect(parseRecipientList('Alice <alice@example.com>, bob@example.com')).toEqual([
      {
        raw: 'Alice <alice@example.com>',
        email: 'alice@example.com',
        valid: true,
        reason: undefined
      },
      { raw: 'bob@example.com', email: 'bob@example.com', valid: true, reason: undefined }
    ])
  })

  it('normalizes recipient spacing', () => {
    expect(normalizeRecipientList(' Alice <a@example.com> ; b@example.com ')).toBe(
      'Alice <a@example.com>, b@example.com'
    )
  })
})

describe('validateRecipientFields', () => {
  it('requires a To recipient and reports invalid fields', () => {
    const result = validateRecipientFields({
      to: '',
      cc: 'bad cc',
      bcc: 'bad-bcc'
    })
    expect(result.errors).toEqual([
      { field: 'to', message: 'Add at least one recipient.' },
      {
        field: 'cc',
        message: 'Cc contains invalid recipients: bad cc',
        recipients: ['bad cc']
      },
      {
        field: 'bcc',
        message: 'Bcc contains invalid recipients: bad-bcc',
        recipients: ['bad-bcc']
      }
    ])
  })

  it('reports invalid To recipients without duplicate processing', () => {
    const result = validateRecipientFields({ to: 'bad', cc: '', bcc: '' })
    expect(result.errors[0]).toMatchObject({ field: 'to', recipients: ['bad'] })
    expect(result.warnings).toEqual([])
  })

  it('warns about duplicates across fields case-insensitively', () => {
    const result = validateRecipientFields({
      to: 'Alice <ALICE@example.com>',
      cc: 'alice@example.com',
      bcc: 'alice@example.com'
    })
    expect(result.warnings[0]).toEqual({
      field: 'to',
      message: 'Some recipients are listed more than once: alice@example.com, alice@example.com',
      recipients: ['alice@example.com', 'alice@example.com']
    })
  })

  it('warns for messages with more than ten valid recipients', () => {
    const recipients = Array.from({ length: 11 }, (_, index) => `user${index}@example.com`).join(
      ','
    )
    const result = validateRecipientFields({ to: recipients, cc: '', bcc: '' })
    expect(result.warnings).toContainEqual({
      field: 'to',
      message: 'This message has 11 recipients. Confirm before sending.'
    })
  })

  it.each([
    ['user@gmal.com', 'gmail.com'],
    ['user@gmial.com', 'gmail.com'],
    ['user@gmail.con', 'gmail.com'],
    ['user@hotmial.com', 'hotmail.com'],
    ['user@hotmai.com', 'hotmail.com'],
    ['user@outlok.com', 'outlook.com'],
    ['user@outlook.con', 'outlook.com'],
    ['user@yaho.com', 'yahoo.com'],
    ['user@yahoo.con', 'yahoo.com']
  ])('warns that %s may mean %s', (email, suggestion) => {
    const result = validateRecipientFields({ to: email, cc: '', bcc: '' })
    expect(result.warnings).toContainEqual({
      field: 'to',
      message: `Possible recipient typo: ${email} (did you mean ${suggestion}?)`
    })
  })

  it('returns no issues for ordinary unique recipients', () => {
    const result = validateRecipientFields({
      to: 'a@example.com',
      cc: 'b@example.com',
      bcc: null
    })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })
})
