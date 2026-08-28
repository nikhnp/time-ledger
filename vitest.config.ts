import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // DB-backed suites self-skip when no DATABASE_URL is configured
    // (e.g. a quick local run); CI / the Netlify build set it.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
