export type QuietHoursConfig = {
  enabled: boolean
  start: string
  end: string
  timezone: string
}

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: 'UTC'
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function normalizeQuietHoursTime(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return TIME_PATTERN.test(trimmed) ? trimmed : fallback
}

export function normalizeQuietHoursTimezone(
  value: unknown,
  fallback = DEFAULT_QUIET_HOURS.timezone
) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback

  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date())
    return trimmed
  } catch {
    return fallback
  }
}

function minutesFromTime(value: string) {
  const [, hour, minute] = value.match(TIME_PATTERN)!
  return Number(hour) * 60 + Number(minute)
}

export function getLocalMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

export function isQuietHoursActive(config: QuietHoursConfig, date = new Date()) {
  if (!config.enabled) return false

  const start = minutesFromTime(normalizeQuietHoursTime(config.start, DEFAULT_QUIET_HOURS.start))
  const end = minutesFromTime(normalizeQuietHoursTime(config.end, DEFAULT_QUIET_HOURS.end))
  if (start === end) return false

  const timezone = normalizeQuietHoursTimezone(config.timezone)
  const now = getLocalMinutes(date, timezone)

  if (start < end) return now >= start && now < end
  return now >= start || now < end
}
