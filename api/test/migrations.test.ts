import { readdir } from 'node:fs/promises'

import { expect, it } from 'vitest'

it('migration files have unique numeric prefixes', async () => {
  const filenames = (await readdir(new URL('../database/migrations/', import.meta.url)))
    .filter((filename) => filename.endsWith('.sql'))
  const prefixes = filenames.map((filename) => filename.split('_')[0])
  expect(new Set(prefixes).size).toBe(filenames.length)
})
