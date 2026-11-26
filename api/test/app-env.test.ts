import { describe, expect, it } from 'vitest'

import { resolveAppEnv } from '../src/config/app-env.js'

describe('resolveAppEnv (TU-41)', () => {
  it('mặc định production khi NODE_ENV=production, local khi còn lại', () => {
    expect(resolveAppEnv(undefined, 'production', 'gam21_platform')).toBe('production')
    expect(resolveAppEnv('', 'development', 'gam21_platform_dev')).toBe('local')
    expect(resolveAppEnv(undefined, 'test', 'gam21_platform_it_test')).toBe('local')
  })

  it('nhận dev khi database có hậu tố _dev', () => {
    expect(resolveAppEnv('dev', 'production', 'gam21_platform_dev')).toBe('dev')
  })

  it('từ chối dev trỏ vào database Production', () => {
    expect(() => resolveAppEnv('dev', 'production', 'gam21_platform')).toThrow(/_dev/)
  })

  it('từ chối production trỏ vào database _dev hoặc _test', () => {
    expect(() => resolveAppEnv(undefined, 'production', 'gam21_platform_dev')).toThrow(/production/)
    expect(() => resolveAppEnv('production', 'production', 'gam21_restore_test')).toThrow(/production/)
  })

  it('từ chối giá trị lạ', () => {
    expect(() => resolveAppEnv('staging', 'production', 'gam21_platform_dev')).toThrow(/APP_ENV/)
  })
})
