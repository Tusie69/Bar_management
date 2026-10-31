import { expect, it, vi } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { clearFixture, resetFixture } from './support/integration-fixture.js'

it.each(['gam21_platform_dev', 'gam21_platform_e2e_test', 'other_test', '',
  'GAM21_PLATFORM_IT_TEST', ' gam21_platform_it_test', 'gam21_platform_it_test '])(
  'refuses fixture cleanup and reset for database %j before any SQL', async (name) => {
    const original = env.database.name
    const execute = vi.spyOn(databasePool, 'execute').mockRejectedValue(new Error('Unexpected fixture SQL'))
    try {
      Object.defineProperty(env.database, 'name', { value: name })
      await expect(clearFixture()).rejects.toThrow('Refusing destructive fixture outside integration database')
      await expect(resetFixture()).rejects.toThrow('Refusing destructive fixture outside integration database')
      expect(execute).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(env.database, 'name', { value: original })
      execute.mockRestore()
    }
  },
)
