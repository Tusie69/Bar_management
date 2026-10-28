import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { chromium } from "@playwright/test"

const root = new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")
const apiUrl = "http://127.0.0.1:3101"
const webUrl = "http://127.0.0.1:5174"
const databaseName = process.env.DB_NAME ?? "gam21_platform_test"
if (!/_test$/.test(databaseName)) throw new Error("Refusing browser E2E: DB_NAME must end in _test")
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")

const username = `phase2b_${Date.now()}`
const password = randomBytes(24).toString("base64url")
const common = {
  ...process.env,
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: databaseName,
  DB_USER: process.env.DB_USER ?? "gam21",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "gam21_dev",
  ORGANIZATION_ID: "1",
  VENUE_ID: "1",
  NO_SHOW_WORKER_ENABLED: "false",
}
const credentialEnv = { ...common, E2E_USERNAME: username, E2E_PASSWORD: password }
const children = []
let browser

function run(command, args, env = common) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  children.push(child)
  return child
}

const runPnpm = (args, env = common) => run(process.execPath, [pnpmCli, ...args], env)
const startPnpm = (args, env) => start(process.execPath, [pnpmCli, ...args], env)

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitUntil(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  }
}

try {
  runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "setup"], credentialEnv)
  startPnpm(["--filter", "@21gam/api", "exec", "tsx", "src/server.ts"], {
    ...common,
    PORT: "3101",
    WEB_ORIGIN: webUrl,
    SESSION_CSRF_SECRET: randomBytes(32).toString("hex"),
    SESSION_COOKIE_SECURE: "false",
    SESSION_COOKIE_SAME_SITE: "lax",
  })
  startPnpm(["--filter", "@21gam/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5174"], {
    ...process.env,
    VITE_API_MODE: "http",
    VITE_API_BASE_URL: apiUrl,
    VITE_VENUE_ID: "1",
  })
  await Promise.all([waitFor(`${apiUrl}/api/v1/health`), waitFor(webUrl)])

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let floorReads = 0
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/v1/tables") floorReads += 1
  })

  await page.goto(webUrl, { waitUntil: "networkidle" })
  await page.getByLabel("Tên đăng nhập").fill(username)
  await page.getByLabel("Mật khẩu").fill(password)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await page.getByText("Lễ tân E2E", { exact: false }).waitFor()
  await page.getByRole("button", { name: "Booking", exact: true }).click()
  await page.getByText("Chưa có booking", { exact: true }).waitFor()
  const floorReadsBeforeMutations = floorReads

  const guestName = `Khách E2E ${Date.now()}`
  await page.getByRole("button", { name: "Tạo booking" }).click()
  let dialog = page.getByRole("dialog").last()
  await dialog.getByText("Tạo booking", { exact: true }).waitFor()
  await dialog.locator("input").first().fill(guestName)
  await dialog.locator('input[type="number"]').fill("3")
  await dialog.locator('input[type="time"]').fill("19:30")
  await dialog.getByRole("button", { name: "Lưu qua backend" }).click()
  await page.getByText("Chi tiết booking", { exact: true }).waitFor()
  await page.getByText(guestName, { exact: true }).first().waitFor()

  await page.keyboard.press("Escape")
  await page.getByText("Chi tiết booking", { exact: true }).waitFor({ state: "hidden" })
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().waitFor()
  await page.getByText(guestName, { exact: true }).first().click()
  await page.getByRole("button", { name: "Chỉnh sửa" }).click()
  dialog = page.getByRole("dialog").last()
  await dialog.locator('input[type="number"]').fill("5")
  await dialog.getByRole("button", { name: "Lưu qua backend" }).click()
  await page.getByText("Chi tiết booking", { exact: true }).waitFor()
  await page.getByText("5", { exact: true }).first().waitFor()

  await page.getByRole("button", { name: "Hủy booking" }).click()
  dialog = page.getByRole("dialog").last()
  await dialog.getByRole("textbox").fill("Kiểm thử Phase 2B")
  await dialog.getByRole("button", { name: "Xác nhận hủy" }).click()
  await page.getByText("Đã hủy", { exact: true }).filter({ visible: true }).first().waitFor()
  await waitUntil(() => floorReads > floorReadsBeforeMutations, "Floor State was not refetched after booking mutations")

  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Booking", exact: true }).click()
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().waitFor()
  await page.getByText("Đã hủy", { exact: true }).filter({ visible: true }).first().waitFor()
  await page.getByRole("button", { name: "Sơ đồ bàn" }).click()
  await page.getByLabel("Sơ đồ bàn từ backend").waitFor()

  const cookies = await page.context().cookies(`${apiUrl}/api/v1`)
  const session = cookies.find((cookie) => cookie.name === "21gam_session")
  if (!session?.httpOnly) throw new Error("Session cookie is missing or not HttpOnly")
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click()
  await page.getByText("Đăng nhập 21GAM", { exact: true }).waitFor()

  console.log(
    JSON.stringify({
      login: "PASS",
      list: "PASS",
      search: "PASS",
      create: "PASS",
      detail: "PASS",
      update: "PASS",
      cancel: "PASS",
      reload: "PASS",
      floorRefetch: "PASS",
      logout: "PASS",
    }),
  )
} finally {
  if (browser) await browser.close()
  stopChildren()
  try {
    runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "cleanup"], credentialEnv)
    const clean = runPnpm(
      ["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-clean"],
      credentialEnv,
    )
    console.log(clean)
  } catch (cleanupError) {
    console.error(cleanupError)
    process.exitCode = 1
  }
}
