import 'dotenv/config'

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) return fallback

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} phải là số nguyên dương`)
  }

  return value
}

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`)
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readNumber('PORT', 3000),
  webOrigin: readString('WEB_ORIGIN', 'http://localhost:5173'),
  database: {
    host: readString('DB_HOST', '127.0.0.1'),
    port: readNumber('DB_PORT', 3306),
    name: readString('DB_NAME', 'gam21_dev'),
    user: readString('DB_USER', 'gam21'),
    password: readString('DB_PASSWORD', 'gam21_dev'),
  },
} as const

