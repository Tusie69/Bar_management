import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { parse } from 'dotenv'

let temporary
let refusedVariable
try {
  const args = process.argv.slice(2)
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--env-file' || !args[1])) {
    throw new Error('Invalid arguments')
  }
  const target = path.resolve(args[1] ?? '.env')
  let content = ''
  try {
    const bytes = readFileSync(target)
    if (bytes.includes(0) || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
      throw new Error('Unsupported encoding')
    }
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const existing = parse(content)
  const lines = content.split(/(\r\n|[\r\n\u2028\u2029])/)
  const parsedLines = lines.map(line => parse(line))
  // Use dotenv's assignment header grammar, refusing cross-line/quoted ambiguity below.
  const assignments = [...content.replace(/\r\n?/g, '\n').matchAll(/^\s*(?:export\s+)?([\w.-]+)(?:\s*=|:\s+)/gm)]
  const values = {
    PHONE_ENCRYPTION_KEYS: `1:${randomBytes(32).toString('base64')}`,
    PHONE_ACTIVE_ENCRYPTION_KEY_ID: '1',
    PHONE_HMAC_KEYS: `1:${randomBytes(32).toString('base64')}`,
    PHONE_ACTIVE_HMAC_KEY_ID: '1',
    PHONE_REVEAL_RATE_LIMIT_MAX: '30',
    PHONE_REVEAL_RATE_LIMIT_WINDOW_MS: '3600000',
    SESSION_CSRF_SECRET: randomBytes(48).toString('base64url'),
  }
  const statuses = []
  const additions = []
  for (const [name, value] of Object.entries(values)) {
    const matches = assignments.filter(assignment => assignment[1] === name)
    const indexes = parsedLines.flatMap((line, index) => Object.hasOwn(line, name) ? [index] : [])
    if (matches.length > 1 || matches.length !== indexes.length
      || (Object.hasOwn(existing, name) && indexes.length !== 1)
      || (indexes.length === 1 && parsedLines[indexes[0]][name] !== existing[name])) {
      refusedVariable = name
      throw new Error('Ambiguous managed variable')
    }
    const kept = Boolean(existing[name]?.trim())
    statuses.push(`${name} ${kept ? 'kept' : 'set'}`)
    if (!kept) {
      if (indexes.length) {
        const index = indexes[0]
        lines[index] = `${lines[index].startsWith('\uFEFF') ? '\uFEFF' : ''}${name}=${value}`
      } else {
        additions.push(`${name}=${value}`)
      }
    }
  }
  if (statuses.some(status => status.endsWith(' set'))) {
    const newline = content.includes('\r\n') ? '\r\n' : '\n'
    const separator = content && !content.endsWith('\n') ? newline : ''
    const output = lines.join('') + (additions.length ? separator + additions.join(newline) + newline : '')
    const prepared = parse(output)
    for (const [name, value] of Object.entries(values)) {
      if (prepared[name] !== (existing[name]?.trim() ? existing[name] : value)) {
        refusedVariable = name
        throw new Error('Unsafe managed assignment')
      }
    }
    temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temporary, output, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, target)
    temporary = undefined
  }
  console.log(statuses.join('\n'))
} catch {
  console.error(refusedVariable
    ? `Secret initialization failed for ${refusedVariable}; values withheld.`
    : 'Secret initialization failed; values withheld. Check arguments, encoding, duplicate variables and file access.')
  process.exitCode = 1
} finally {
  if (temporary) rmSync(temporary, { force: true })
}
