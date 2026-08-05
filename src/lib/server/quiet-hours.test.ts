import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  getLocalMinutes,
  isQuietHoursActive,
  normalizeQuietHoursTime,
  normalizeQuietHoursTimezone,
  type QuietHoursConfig
} from './quiet-hours.ts'

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

describe('quiet-hours normalization', () => {
  it('accepts valid times and restores invalid values to the fallback', () => {
    assert.equal(normalizeQuietHoursTime(' 09:05 ', '22:00'), '09:05')
    for (const value of [null, '9:05', '24:00', '12:60']) {
      assert.equal(normalizeQuietHoursTime(value, '22:00'), '22:00')
    }
  })

  it('validates timezones and calculates their local minutes', () => {
    assert.equal(normalizeQuietHoursTimezone(' America/New_York '), 'America/New_York')
    assert.equal(normalizeQuietHoursTimezone(''), 'UTC')
    assert.equal(normalizeQuietHoursTimezone('Not/AZone', 'Europe/London'), 'Europe/London')
    assert.equal(getLocalMinutes(new Date('2026-05-29T12:30:00Z'), 'America/New_York'), 510)
    assert.equal(normalizeQuietHoursTimezone(null, 'Europe/London'), 'Europe/London')
  })

  it('handles same-time and daytime windows with malformed configuration', () => {
    assert.equal(
      isQuietHoursActive({ ...baseConfig, start: '07:00', end: '07:00' }, new Date()),
      false
    )
    assert.equal(
      isQuietHoursActive(
        { ...baseConfig, start: '08:00', end: '09:00' },
        new Date('2026-05-29T08:00:00Z')
      ),
      true
    )
    assert.equal(
      isQuietHoursActive(
        { ...baseConfig, start: '08:00', end: '09:00' },
        new Date('2026-05-29T09:00:00Z')
      ),
      false
    )
    assert.equal(
      isQuietHoursActive({ ...baseConfig, start: 'invalid', end: 'invalid' }, new Date()),
      false
    )
  })

  it('uses zero-valued locale parts when a formatter omits hour or minute', () => {
    const original = Intl.DateTimeFormat
    Object.defineProperty(Intl, 'DateTimeFormat', {
      configurable: true,
      value: function () {
        return { formatToParts: () => [] }
      }
    })
    try {
      assert.equal(getLocalMinutes(new Date(), 'UTC'), 0)
    } finally {
      Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: original })
    }
  })
})
