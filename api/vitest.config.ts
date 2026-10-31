import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/test-environment.ts'],
    // MySQL integration files use isolated test databases but share fixture tables
    // within one run, so files must not mutate those fixtures concurrently.
    fileParallelism: false,
  },
})

