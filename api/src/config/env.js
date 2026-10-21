import 'dotenv/config'

const readPort = (value, fallback) => {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Cổng không hợp lệ: ${value}`)
  return port
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readPort(process.env.PORT, 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: readPort(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'gam21_dev',
  },
})
