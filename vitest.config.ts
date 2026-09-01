import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/tests/**/*.test.{ts,tsx}'],
    // Only the client tests need a DOM; the server and core tests stay in node,
    // where better-sqlite3 works and a fake DOM would only slow them down.
    environmentMatchGlobs: [['**/client/**', 'happy-dom'], ['**/*.test.tsx', 'happy-dom']],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
