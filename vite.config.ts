import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'
import { failOnBuildWarningPlugin } from './vite.warnings.ts'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), svelteTesting(), failOnBuildWarningPlugin()],
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
})
