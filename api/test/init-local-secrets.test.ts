import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parse } from 'dotenv'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.resolve('scripts/init-local-secrets.mjs')
const directories: string[] = []
const names = [
  'PHONE_ENCRYPTION_KEYS', 'PHONE_ACTIVE_ENCRYPTION_KEY_ID',
  'PHONE_HMAC_KEYS', 'PHONE_ACTIVE_HMAC_KEY_ID',
  'PHONE_REVEAL_RATE_LIMIT_MAX', 'PHONE_REVEAL_RATE_LIMIT_WINDOW_MS', 'SESSION_CSRF_SECRET',
]

const testRing = `1:${Buffer.alloc(32, 17).toString('base64')}`
const assignmentForms = [
  ['equals', (name: string, value: string) => `${name}=${value}`],
  ['spaced equals', (name: string, value: string) => ` \t${name} \t= ${value} # retained`],
  ['colon double quotes', (name: string, value: string) => `${name}: "${value}"`],
  ['export colon', (name: string, value: string) => ` \texport ${name}: '${value}'`],
  ['export equals', (name: string, value: string) => `export \t${name} = "${value}"`],
  ['backticks', (name: string, value: string) => `${name}=\`${value}\``],
] as const

function fixture(content?: string | Buffer) {
  const directory = mkdtempSync(path.join(tmpdir(), 'gam-secrets-'))
  directories.push(directory)
  const target = path.join(directory, '.env')
  if (content !== undefined) writeFileSync(target, content)
  return { directory, target }
}

function expectRefusal(original: string | Buffer, variable?: string) {
  const { directory, target } = fixture(original)
  const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
  expect(result.status).toBe(1)
  expect(readFileSync(target).equals(Buffer.from(original))).toBe(true)
  expect(result.stdout.length).toBe(0)
  expect(result.stderr.includes(testRing)).toBe(false)
  expect(result.stderr.includes('existing-test-value')).toBe(false)
  if (variable) expect(result.stderr === `Secret initialization failed for ${variable}; values withheld.\n`).toBe(true)
  expect(readdirSync(directory)).toEqual(['.env'])
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local secrets initialization', () => {
  it('generates independent keys with the required sizes without printing values', () => {
    const { target } = fixture('# retained\r\nDB_NAME=temporary\r\nPHONE_HMAC_KEYS=\r\n')
    const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split('\n')).toEqual(names.map(name => `${name} set`))
    const content = readFileSync(target, 'utf8')
    expect(content.startsWith('# retained\r\nDB_NAME=temporary\r\n')).toBe(true)
    expect(content.match(/^PHONE_HMAC_KEYS=/gm)?.length).toBe(1)
    const values = parse(content)
    const encryption = values.PHONE_ENCRYPTION_KEYS?.split(':')
    const hmac = values.PHONE_HMAC_KEYS?.split(':')
    expect(encryption?.[0]).toBe('1')
    expect(hmac?.[0]).toBe('1')
    expect(Buffer.from(encryption?.[1] ?? '', 'base64').length).toBe(32)
    expect(Buffer.from(hmac?.[1] ?? '', 'base64').length).toBe(32)
    expect(encryption?.[1] === hmac?.[1]).toBe(false)
    expect(Buffer.from(values.SESSION_CSRF_SECRET ?? '', 'base64url').length).toBe(48)
    expect(values.PHONE_ACTIVE_ENCRYPTION_KEY_ID).toBe('1')
    expect(values.PHONE_ACTIVE_HMAC_KEY_ID).toBe('1')
    expect(values.PHONE_REVEAL_RATE_LIMIT_MAX).toBe('30')
    expect(values.PHONE_REVEAL_RATE_LIMIT_WINDOW_MS).toBe('3600000')
    expect(Object.values(values).filter(value => value.length >= 24).some(value => result.stdout.includes(value))).toBe(false)
    expect(spawnSync(process.execPath, ['--', script, '--env-file', target]).status).toBe(0)
  })

  it('keeps every existing non-empty value and preserves the file byte for byte', () => {
    const original = names.map(name => `export ${name}="existing-test-value"`).join('\n')
    const { target } = fixture(original)
    const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(readFileSync(target, 'utf8') === original).toBe(true)
    expect(result.stdout.trim().split('\n')).toEqual(names.map(name => `${name} kept`))
  })

  it('defaults to the current directory and is safe to rerun', () => {
    const { directory, target } = fixture()
    expect(spawnSync(process.execPath, ['--', script], { cwd: directory }).status).toBe(0)
    const original = readFileSync(target, 'utf8')
    const result = spawnSync(process.execPath, ['--', script], { cwd: directory, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(readFileSync(target, 'utf8') === original).toBe(true)
    expect(result.stdout.trim().split('\n')).toEqual(names.map(name => `${name} kept`))
  })

  it('fails closed on duplicate managed variables without modifying the file or printing values', () => {
    expectRefusal('PHONE_HMAC_KEYS=existing-test-value\nPHONE_HMAC_KEYS=\n', 'PHONE_HMAC_KEYS')
  })

  it.each(assignmentForms)('rejects duplicates using %s even when the last assignment is non-empty', (_label, assignment) => {
    for (const value of ['', testRing]) {
      expectRefusal(`${assignment('PHONE_ENCRYPTION_KEYS', testRing)}\nPHONE_ENCRYPTION_KEYS=${value}\n`, 'PHONE_ENCRYPTION_KEYS')
    }
  })

  it.each(names)('rejects colon duplicates for %s', name => {
    expectRefusal(`${name}: "existing-test-value"\n${name}=\n`, name)
  })

  it.each(assignmentForms)('keeps or fills a single %s assignment and remains safe to rerun', (_label, assignment) => {
    for (const value of ['', testRing]) {
      const { target } = fixture(`${assignment('PHONE_ENCRYPTION_KEYS', value)}\n# retained\n`)
      const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      const original = readFileSync(target)
      const parsed = parse(original)
      expect(parsed.PHONE_ENCRYPTION_KEYS === (value || parsed.PHONE_ENCRYPTION_KEYS)).toBe(true)
      expect(Buffer.from(parsed.PHONE_ENCRYPTION_KEYS?.split(':')[1] ?? '', 'base64').length).toBe(32)
      expect(original.toString().includes('# retained\n')).toBe(true)
      expect(result.stdout.includes(parsed.PHONE_ENCRYPTION_KEYS ?? '')).toBe(false)
      expect(result.stderr.length).toBe(0)
      expect(spawnSync(process.execPath, ['--', script, '--env-file', target]).status).toBe(0)
      expect(readFileSync(target).equals(original)).toBe(true)
    }
  })

  it.each([
    ['cross-line header', 'PHONE_ENCRYPTION_KEYS\n=\n'],
    ['cross-line duplicate', `PHONE_ENCRYPTION_KEYS=${testRing}\nPHONE_ENCRYPTION_KEYS\n=${testRing}\n`],
    ['multiline quoted value', 'PHONE_ENCRYPTION_KEYS="\n \n"\n'],
    ['assignment inside a quoted value', 'OTHER="\nPHONE_ENCRYPTION_KEYS=\n"\n'],
  ])('refuses an unsafe managed assignment: %s', (_label, original) => {
    expectRefusal(original, 'PHONE_ENCRYPTION_KEYS')
  })

  it.each([
    ['invalid UTF-8', Buffer.concat([Buffer.from('# retained '), Buffer.from([0xff]), Buffer.from(`\nPHONE_ENCRYPTION_KEYS=${testRing}\n`)])],
    ['truncated UTF-8', Buffer.from([0xe2, 0x82])],
    ['UTF-16LE BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`PHONE_ENCRYPTION_KEYS=${testRing}\r\n`, 'utf16le')])],
    ['UTF-16BE BOM', Buffer.from([0xfe, 0xff, 0, 35])],
    ['UTF-32LE BOM', Buffer.from([0xff, 0xfe, 0, 0, 35, 0, 0, 0])],
    ['UTF-32BE BOM', Buffer.from([0, 0, 0xfe, 0xff, 0, 0, 0, 35])],
    ['NUL without BOM', Buffer.from(`# retained\0\nPHONE_ENCRYPTION_KEYS=${testRing}\n`)],
  ])('rejects %s without changing bytes or leaving a temporary file', (_label, original) => {
    expectRefusal(original)
  })

  it('preserves a UTF-8 BOM, Unicode comments and CRLF while filling a blank variable', () => {
    const prefix = '\uFEFF# gi\u1eef nguy\u00ean\r\n'
    const { target } = fixture(`${prefix}PHONE_ENCRYPTION_KEYS=\r\n`)
    const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    const original = readFileSync(target)
    expect(original.subarray(0, Buffer.byteLength(prefix)).equals(Buffer.from(prefix))).toBe(true)
    expect(original.toString().replaceAll('\r\n', '').includes('\n')).toBe(false)
    expect(spawnSync(process.execPath, ['--', script, '--env-file', target]).status).toBe(0)
    expect(readFileSync(target).equals(original)).toBe(true)
  })

  it('rejects invalid arguments without touching the target', () => {
    const { directory, target } = fixture('DB_NAME=temporary\n')
    const result = spawnSync(process.execPath, ['--', script, '--unknown', target], { cwd: directory, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe('DB_NAME=temporary\n')
    expect(result.stdout).toBe('')
  })

  it('withholds values and leaves no temporary file when the target directory is missing', () => {
    const { directory } = fixture()
    const target = path.join(directory, 'missing', '.env')
    const result = spawnSync(process.execPath, ['--', script, '--env-file', target], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('Secret initialization failed; values withheld. Check arguments, encoding, duplicate variables and file access.\n')
    expect(readdirSync(directory)).toEqual([])
  })
})
