import type { Plugin } from 'vite'

// Build warnings are treated as errors so CI and the pre-commit hook fail on them.
// Add an entry here only when a warning is understood, unavoidable, and harmless.
const ALLOWED_BUILD_WARNINGS = [
  'contains an annotation that Rollup cannot interpret due to the position of the comment'
]

function warningMessage(warning: unknown) {
  if (typeof warning === 'string') return warning
  const { message, code } = (warning ?? {}) as { message?: string; code?: string }
  return message ?? code ?? String(warning)
}

export function failOnBuildWarning(warning: unknown) {
  const message = warningMessage(warning)
  if (ALLOWED_BUILD_WARNINGS.some((allowed) => message.includes(allowed))) return

  const code = (warning as { code?: string } | null)?.code
  throw new Error(`Build warning treated as an error${code ? ` [${code}]` : ''}: ${message}`)
}

// `onLog` sees warnings from every build environment, which a root-level
// `build.rolldownOptions.onwarn` does not when SvelteKit builds client and server separately.
export function failOnBuildWarningPlugin(): Plugin {
  return {
    name: 'fail-on-build-warning',
    apply: 'build',
    onLog(level, log) {
      if (level === 'warn') failOnBuildWarning(log)
    }
  }
}
