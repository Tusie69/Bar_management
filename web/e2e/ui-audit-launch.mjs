import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { devNull } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const host = "127.0.0.1"
let auditRun

export function assertAuditDatabase({ name, host: dbHost, port, user, password }) {
  assert.equal(process.env.NODE_ENV, "test", "UI audit requires NODE_ENV=test")
  assert(
    name?.endsWith("_test") &&
      [host, "localhost", "::1"].includes(dbHost) &&
      Number.isInteger(port) &&
      port > 1024 &&
      port <= 65535 &&
      user &&
      password,
    "UI audit requires an explicit loopback MySQL _test database and credentials",
  )
}

export function requireAuditRun() {
  assert(auditRun, "Run the UI audit through ui-audit-launch.mjs")
  return auditRun
}

async function launch() {
  const { DB_NAME, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env
  const database = Object.freeze({
    name: DB_NAME,
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
  })
  assertAuditDatabase(database)
  for (const key of ["E2E_BASE_URL", "E2E_API_URL", "VITE_API_BASE_URL"]) {
    assert(process.env[key] === undefined, `Unset ${key}; the launcher owns the audit URLs`)
  }

  const apiServer = createServer()
  let web
  let databasePool
  try {
    await once(apiServer.listen(0, host), "listening")
    const api = new URL(`http://${host}:${apiServer.address().port}`)
    Object.assign(process.env, {
      VITE_API_MODE: "http",
      VITE_API_BASE_URL: api.origin,
      VITE_VENUE_ID: process.env.VENUE_ID ?? "1",
      VITE_E2E_FIXED_NOW: process.env.E2E_FIXED_NOW ?? "",
    })
    const { createServer: createViteServer } = await import("vite")
    web = await createViteServer({
      root: path.resolve(import.meta.dirname, ".."),
      mode: "test",
      envDir: false,
      server: { host, open: false },
    })
    await web.listen(0)
    const base = new URL(`http://${host}:${web.httpServer.address().port}`)

    Object.assign(process.env, { PORT: api.port, WEB_ORIGIN: base.origin, DOTENV_CONFIG_PATH: devNull })
    const apiRequire = createRequire(new URL("../../api/package.json", import.meta.url))
    apiRequire("tsx/esm/api").register()
    const { env } = await import("../../api/src/config/env.ts")
    assert(
      env.nodeEnv === "test" && Object.keys(database).every((key) => env.database[key] === database[key]),
      "The API did not load the verified audit database configuration",
    )
    const { app } = await import("../../api/src/app.ts")
    databasePool = (await import("../../api/src/database/pool.ts")).databasePool
    apiServer.on("request", app)

    auditRun = Object.freeze({ id: randomUUID(), database, base, api })
    console.log(`UI audit run ${auditRun.id}: ${database.name}, API ${api.origin}, web ${base.origin}`)
    await import("./ui-audit-capture.mjs")
  } finally {
    const apiClosed = apiServer[Symbol.asyncDispose]()
    apiServer.closeAllConnections()
    await Promise.all([apiClosed, web?.close(), databasePool?.end()])
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
