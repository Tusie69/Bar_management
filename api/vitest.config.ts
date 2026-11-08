import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/test-environment.ts'],
    // MySQL integration files use isolated test databases but share fixture tables
    // within one run, so files must not mutate those fixtures concurrently.
    fileParallelism: false,
    // T-01: the defaults (5s test, 10s hook) are tight for a contended MySQL.
    // Measured on a local server the fixture costs resetFixture p50 101ms /
    // max 161ms and clearFixture max 64ms, so these budgets leave roughly two
    // orders of magnitude of headroom while still bounding a hang. They are
    // headroom for a slow server, not permission for a slow test: a case that
    // needs seconds of fixture time is a case to look at.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})

