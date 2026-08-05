import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    environment: 'node',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov']
    }
  },
  build: {
    rolldownOptions: {
      checks: {
        pluginTimings: false
      },
      onwarn(warning, defaultHandler) {
        const message = typeof warning === 'string' ? warning : warning.message

        if (
          message.includes(
            'contains an annotation that Rollup cannot interpret due to the position of the comment'
          )
        ) {
          return
        }

        defaultHandler(warning)
      }
    }
  }
})
