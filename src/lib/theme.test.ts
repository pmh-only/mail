import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_THEME_STYLE,
  getThemeGradient,
  isValidThemeStyle,
  MAX_THEME_COLORS,
  normalizeThemeStyle
} from './theme.ts'

test('normalizes invalid custom theme values', () => {
  assert.deepEqual(normalizeThemeStyle({ preset: 'unknown', colors: ['red'], angle: 900 }), {
    ...DEFAULT_THEME_STYLE,
    colors: [...DEFAULT_THEME_STYLE.colors],
    angle: 360
  })
})

test('keeps two to five valid custom colors', () => {
  const style = normalizeThemeStyle({
    preset: 'custom',
    colors: ['#ABCDEF', '#123456', '#abcdef', '#654321', '#fedcba', '#000000'],
    angle: 42.4
  })

  assert.equal(style.preset, 'custom')
  assert.equal(style.colors.length, MAX_THEME_COLORS)
  assert.deepEqual(style.colors.slice(0, 2), ['#abcdef', '#123456'])
  assert.equal(style.angle, 42)
})

test('uses preset colors and custom colors for their respective gradients', () => {
  assert.equal(
    getThemeGradient({ preset: 'ocean', colors: ['#000000', '#ffffff'], angle: 20 }),
    'linear-gradient(145deg, #0c4a6e, #2563eb, #06b6d4)'
  )
  assert.equal(
    getThemeGradient({ preset: 'custom', colors: ['#000000', '#ffffff'], angle: 20 }),
    'linear-gradient(20deg, #000000, #ffffff)'
  )
})

test('validates persisted theme style input', () => {
  assert.equal(
    isValidThemeStyle({ preset: 'custom', colors: ['#123456', '#abcdef'], angle: 90 }),
    true
  )
  assert.equal(
    isValidThemeStyle({ preset: 'custom', colors: ['red', '#abcdef'], angle: 90 }),
    false
  )
  assert.equal(
    isValidThemeStyle({ preset: 'custom', colors: ['#123456', '#abcdef'], angle: 900 }),
    false
  )
})
