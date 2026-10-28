import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import adapter from '@sveltejs/adapter-node'
import { failOnBuildWarningPlugin } from './vite.warnings.ts'

export default defineConfig(({ mode }) => {
  // The shared web/worker environment reads process.env. Preserve Vite's .env loading
  // and its precedence rules without baking runtime settings into the bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [
      tailwindcss(),
      sveltekit({
        adapter: adapter(),
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in Svelte 6.
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes('node_modules') ? undefined : true
        }
      }),
      svelteTesting(),
      failOnBuildWarningPlugin()
    ],
    resolve: {
      alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
    },
    test: {
      environment: 'node',
      fileParallelism: false,
      setupFiles: ['./src/test-setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'cobertura'],
        exclude: ['src/**/*.svelte'],
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100
        }
      }
    },
    build: {
      rolldownOptions: {
        checks: {
          pluginTimings: false
        }
      }
    }
  }
})
