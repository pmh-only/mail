import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { isQuietHoursActive, type QuietHoursConfig } from './quiet-hours.ts'

const baseConfig: QuietHoursConfig = {
  enabled: true,
  start: '22:00',
  end: '07:00',
  timezone: 'UTC'
}

describe('isQuietHoursActive', () => {
  it('does not suppress notifications when disabled', () => {
    assert.equal(
      isQuietHoursActive({ ...baseConfig, enabled: false }, new Date('2026-05-29T23:00:00Z')),
      false
    )
  })

  it('handles quiet windows that cross midnight', () => {
    assert.equal(isQuietHoursActive(baseConfig, new Date('2026-05-29T23:00:00Z')), true)
    assert.equal(isQuietHoursActive(baseConfig, new Date('2026-05-29T06:30:00Z')), true)
    assert.equal(isQuietHoursActive(baseConfig, new Date('2026-05-29T12:00:00Z')), false)
  })

  it('uses the configured timezone when evaluating local time', () => {
    assert.equal(
      isQuietHoursActive(
        { ...baseConfig, start: '08:00', end: '09:00', timezone: 'America/New_York' },
        new Date('2026-05-29T12:30:00Z')
      ),
      true
    )
  })
})
