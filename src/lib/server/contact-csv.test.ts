import assert from 'node:assert/strict'
import { test } from 'vitest'
import { serializeContactsCsv } from './contacts.ts'

test('neutralizes spreadsheet formulas in every contact CSV cell', () => {
  const csv = serializeContactsCsv([
    { name: '=HYPERLINK("https://attacker.test","Open")', email: '+cmd@example.test' },
    { name: '  @SUM(1,1)', email: 'safe@example.test' }
  ])
  assert.match(
    csv,
    /^name,email\n"'=HYPERLINK\(""https:\/\/attacker\.test"",""Open""\)",'\+cmd@example\.test/m
  )
  assert.match(csv, /"'  @SUM\(1,1\)",safe@example\.test/)
})
