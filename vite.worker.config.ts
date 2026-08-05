import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { failOnBuildWarningPlugin } from './vite.warnings'

function fromRoot(path: string) {
  return fileURLToPath(new URL(path, import.meta.url))
}

export default defineConfig({
  plugins: [failOnBuildWarningPlugin()],
  resolve: {
    alias: {
      $lib: fromRoot('./src/lib'),
      '$env/dynamic/private': fromRoot('./src/lib/server/env-private.ts')
    }
  },
  build: {
    ssr: fromRoot('./src/worker.ts'),
    outDir: 'build-worker',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'worker.js'
      }
    }
  }
})
