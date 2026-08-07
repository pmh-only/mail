export const MIN_THEME_COLORS = 2
export const MAX_THEME_COLORS = 5

export const THEME_PRESETS = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep blue and violet',
    colors: ['#0f172a', '#1d4ed8', '#581c87'],
    angle: 135
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Cobalt into cyan',
    colors: ['#0c4a6e', '#2563eb', '#06b6d4'],
    angle: 145
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Violet and emerald',
    colors: ['#312e81', '#7c3aed', '#10b981'],
    angle: 125
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'Rose into warm amber',
    colors: ['#7c2d12', '#e11d48', '#f59e0b'],
    angle: 120
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Pine and fresh green',
    colors: ['#052e16', '#047857', '#84cc16'],
    angle: 140
  },
  {
    id: 'berry',
    label: 'Berry',
    description: 'Plum, magenta, and rose',
    colors: ['#4c1d95', '#be185d', '#fb7185'],
    angle: 135
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Crimson into orange',
    colors: ['#450a0a', '#b91c1c', '#f97316'],
    angle: 115
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Quiet neutral contrast',
    colors: ['#09090b', '#3f3f46', '#18181b'],
    angle: 145
  }
] as const

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id']
export type ThemeStyleId = ThemePresetId | 'custom' | 'off'
export type ThemeStyle = {
  preset: ThemeStyleId
  colors: string[]
  angle: number
}

export const DEFAULT_THEME_STYLE: ThemeStyle = {
  preset: 'off',
  colors: ['#2563eb', '#7c3aed', '#ec4899'],
  angle: 135
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const THEME_PRESET_IDS = new Set<ThemeStyleId>([
  ...THEME_PRESETS.map((preset) => preset.id),
  'custom',
  'off'
])

function normalizeColor(value: unknown) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  return HEX_COLOR_PATTERN.test(color) ? color.toLowerCase() : null
}

export function isValidThemeStyle(value: unknown): value is ThemeStyle {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.preset === 'string' &&
    THEME_PRESET_IDS.has(record.preset as ThemeStyleId) &&
    Array.isArray(record.colors) &&
    record.colors.length >= MIN_THEME_COLORS &&
    record.colors.length <= MAX_THEME_COLORS &&
    record.colors.every((color) => normalizeColor(color) !== null) &&
    typeof record.angle === 'number' &&
    Number.isFinite(record.angle) &&
    record.angle >= 0 &&
    record.angle <= 360
  )
}

export function normalizeThemeStyle(value: unknown): ThemeStyle {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const preset =
    typeof record.preset === 'string' && THEME_PRESET_IDS.has(record.preset as ThemeStyleId)
      ? (record.preset as ThemeStyleId)
      : DEFAULT_THEME_STYLE.preset
  const colors = Array.isArray(record.colors)
    ? record.colors
        .map(normalizeColor)
        .filter((color): color is string => color !== null)
        .slice(0, MAX_THEME_COLORS)
    : []
  const angle =
    typeof record.angle === 'number' && Number.isFinite(record.angle)
      ? Math.min(360, Math.max(0, Math.round(record.angle)))
      : DEFAULT_THEME_STYLE.angle

  return {
    preset,
    colors: colors.length >= MIN_THEME_COLORS ? colors : [...DEFAULT_THEME_STYLE.colors],
    angle
  }
}

export function getThemeGradient(style: ThemeStyle) {
  const normalized = normalizeThemeStyle(style)
  if (normalized.preset === 'off') return 'none'
  const preset = THEME_PRESETS.find((candidate) => candidate.id === normalized.preset)
  const colors = preset?.colors ?? normalized.colors
  const angle = preset?.angle ?? normalized.angle
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`
}

export function applyThemeStyle(style: ThemeStyle, root = document.documentElement) {
  const normalized = normalizeThemeStyle(style)
  root.dataset.themePreset = normalized.preset
  root.style.setProperty('--app-theme-gradient', getThemeGradient(normalized))
}
