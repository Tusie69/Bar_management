import { fork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { devNull } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { debuglog } from "node:util"

const host = "127.0.0.1"
const workerFlag = "--ui-audit-worker"
let auditRun

export class AuditFailure extends Error {}

export function auditReason(error, fallback) {
  return error instanceof AuditFailure ? error.message : fallback
}

export async function auditStep(step, run) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AuditFailure) throw error
    throw new AuditFailure(step + " failed")
  }
}

export function reportAudit(message, failed = false) {
  process.send({ audit: message, failed })
}

export function assertAuditDatabase({ name, host: dbHost, port, user, password }) {
  if (process.env.NODE_ENV !== "test") throw new AuditFailure("UI audit requires NODE_ENV=test")
  if (!(
    name?.endsWith("_test") &&
    [host, "localhost", "::1"].includes(dbHost) &&
    Number.isInteger(port) &&
    port > 1024 &&
    port <= 65535 &&
    user &&
    password
  )) {
    throw new AuditFailure("UI audit requires an explicit loopback MySQL _test database and credentials")
  }
}

export function requireAuditRun() {
  if (!auditRun) throw new AuditFailure("Run the UI audit through ui-audit-launch.mjs")
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
    if (process.env[key] !== undefined) throw new AuditFailure(`Unset ${key}; the launcher owns the audit URLs`)
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
    if (env.nodeEnv !== "test" || !Object.keys(database).every((key) => env.database[key] === database[key])) {
      throw new AuditFailure("The API did not load the verified audit database configuration")
    }
    const { app } = await import("../../api/src/app.ts")
    databasePool = (await import("../../api/src/database/pool.ts")).databasePool
    apiServer.on("request", app)

    auditRun = Object.freeze({ id: randomUUID(), database, base, api })
    reportAudit(`UI audit run ${auditRun.id}`)
    await auditStep("Capture UI audit", () => import("./ui-audit-capture.mjs"))
  } finally {
    const apiClosed = apiServer[Symbol.asyncDispose]()
    apiServer.closeAllConnections()
    await Promise.all([apiClosed, web?.close(), databasePool?.end()])
  }
}

async function supervise() {
  if (debuglog("child_process").enabled) {
    console.error("Disable NODE_DEBUG for child_process before running the UI audit")
    process.exitCode = 1
    return
  }
  // Dependencies can write raw errors directly to their process streams.
  const worker = fork(fileURLToPath(import.meta.url), [workerFlag, ...process.argv.slice(2)], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
  let failureReported = false
  worker.on("message", (message) => {
    if (typeof message?.audit !== "string") return
    if (message.failed) {
      failureReported = true
      console.error(message.audit)
    } else console.log(message.audit)
  })
  const [code] = await once(worker, "close")
  if (code === 0) return
  process.exitCode = 1
  if (!failureReported)
    console.error(code === null ? "UI audit worker terminated" : `UI audit worker exited with code ${code}`)
}

async function runWorker() {
  const stop = () => process.exit(1)
  process.once("disconnect", stop)
  try {
    await launch()
  } catch (error) {
    reportAudit(auditReason(error, "UI audit launcher failed"), true)
    process.exitCode = 1
  } finally {
    process.off("disconnect", stop)
    process.disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.send && process.argv[2] === workerFlag) {
    process.argv.splice(2, 1)
    void runWorker()
  } else {
    void supervise().catch(() => {
      console.error("Could not start UI audit worker")
      process.exitCode = 1
    })
  }
}
