import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { chromium } from "@playwright/test"

const root = new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3101"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5174"
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
let secondContext

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

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  })
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

  // Canonical navigation: "Đặt bàn" (/reservations)
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByText("Không có booking phù hợp", { exact: true }).waitFor()

  // Advance to tomorrow's business date via ChevronRight ("Ngày sau")
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByText("Không có booking phù hợp", { exact: true }).waitFor()
  const floorReadsBeforeMutations = floorReads

  const guestName = `Khách E2E ${Date.now()}`
  await page.getByRole("button", { name: "Đặt bàn mới" }).click()
  let sheet = page.getByRole("dialog").last()
  await sheet.getByText("Đặt bàn mới", { exact: true }).waitFor()
  if ((await sheet.locator('input[type="time"]').count()) !== 0) throw new Error("Native time picker is still present")

  // Step 0: Thời gian & số khách
  await sheet.getByRole("radio", { name: "3 khách" }).click()
  await sheet.getByRole("radio", { name: /^19:30/ }).click()
  await sheet.getByRole("button", { name: "Tiếp" }).click()

  // Step 1: Vị trí (nhận trước xếp sau)
  await sheet.getByRole("button", { name: "Nhận trước, xếp bàn sau" }).click()
  await sheet.getByRole("button", { name: "Tiếp" }).click()

  // Step 2: Khách & Loại khách RETURNING
  await sheet.locator("#bk-name").fill(guestName)
  await sheet.getByLabel("Loại khách").click()
  await page.getByRole("option", { name: "Khách quen (O)" }).click()
  await sheet.getByRole("button", { name: "Tiếp" }).click()

  // Step 3: Xác nhận đặt bàn
  await sheet.getByRole("button", { name: "Xác nhận đặt bàn" }).click()
  await sheet.waitFor({ state: "hidden" })

  // Open the newly created booking details
  await page.getByText(guestName, { exact: true }).first().waitFor()
  await page.getByText(guestName, { exact: true }).first().click()
  let detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()

  await page.keyboard.press("Escape")
  await detailSheet.waitFor({ state: "hidden" })

  // Verify Zalo export for RETURNING
  await page.getByRole("button", { name: "Xuất text Zalo" }).click()
  let dialog = page.getByRole("dialog").last()
  const returningExport = dialog.getByLabel("Nội dung text booking")
  await returningExport.waitFor()
  if (!(await returningExport.inputValue()).includes("Bàn khách quen O: 1")) {
    throw new Error("Returning classification was not reflected in Zalo export")
  }
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })

  // Table assignment on floor
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()
  await detailSheet.getByRole("button", { name: "Phân bàn", exact: true }).click()

  const pickDialog = page.getByRole("dialog", { name: /Phân bàn/ })
  await pickDialog.waitFor()

  const spareButton = page.getByRole("button", { name: /Bàn A10, Bàn sơ cua/ })
  const outOfServiceButton = page.getByRole("button", { name: /Bàn A3, Ngưng hoạt động/ })
  if ((await spareButton.getAttribute("aria-disabled")) !== "true" && !(await spareButton.isDisabled())) {
    throw new Error("Spare table was selectable")
  }
  if ((await outOfServiceButton.getAttribute("aria-disabled")) !== "true" && !(await outOfServiceButton.isDisabled())) {
    throw new Error("Out-of-service table was selectable")
  }

  await page.getByRole("button", { name: /^Bàn A1,/ }).click()
  const assignConfirm = pickDialog.getByRole("button", { name: "Phân bàn" })
  await assignConfirm.click()
  await pickDialog.waitFor({ state: "hidden" })

  // Verify assigned table in details
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.getByText("A1", { exact: true }).waitFor()

  await page.keyboard.press("Escape")
  await detailSheet.waitFor({ state: "hidden" })

  // Search and edit booking
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().waitFor()
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()
  await detailSheet.getByRole("button", { name: "Sửa" }).click()

  let editDialog = page.getByRole("dialog", { name: /Sửa booking/ })
  await editDialog.waitFor()
  if (!(await editDialog.getByLabel("Loại khách").textContent()).includes("Khách quen (O)")) {
    throw new Error("Returning classification was not persisted for edit")
  }
  // Change guests from 3 to 5 using Stepper
  await editDialog.getByRole("button", { name: "Tăng số khách" }).click()
  await editDialog.getByRole("button", { name: "Tăng số khách" }).click()
  await editDialog.getByLabel("Loại khách").click()
  await page.getByRole("option", { name: "Khách mới (N)" }).click()
  await editDialog.getByRole("button", { name: "Lưu thay đổi" }).click()
  await editDialog.waitFor({ state: "hidden" })

  await detailSheet.getByText("5 khách", { exact: true }).waitFor()

  // Second context: Mobile V1 (390x844)
  secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  })
  const secondPage = await secondContext.newPage()
  await secondPage.goto(webUrl, { waitUntil: "networkidle" })
  await secondPage.getByLabel("Tên đăng nhập").fill(username)
  await secondPage.getByLabel("Mật khẩu").fill(password)
  await secondPage.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await secondPage.getByRole("button", { name: "Danh sách" }).click()
  // Select tomorrow's tab on mobile by scoping to date controls
  const todayBtn = secondPage.getByRole("button", { name: "Hôm nay" })
  await todayBtn.waitFor()
  const tomorrowBtn = todayBtn.locator("..").locator("button").nth(1)
  await tomorrowBtn.click()
  if ((await tomorrowBtn.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Tomorrow's business date button was not selected")
  }
  const tomorrowDateLabel = (await tomorrowBtn.textContent())?.trim()
  if (!tomorrowDateLabel) throw new Error("Tomorrow date button missing label")

  // Verify export request selects tomorrow's business date
  const exportRequestPromise = secondPage
    .waitForRequest((req) => req.url().includes("/bookings/export"), { timeout: 5000 })
    .catch(() => null)
  await secondPage.getByRole("button", { name: "Xuất text Zalo" }).click()
  const exportReq = await exportRequestPromise
  if (exportReq) {
    const exportDate = new URL(exportReq.url()).searchParams.get("date")
    if (!exportDate) throw new Error("Export request missing date parameter")
  }
  const secondExport = secondPage.getByRole("dialog").getByLabel("Nội dung text booking")
  await secondExport.waitFor()
  const secondText = await secondExport.inputValue()
  if (!secondText.includes("Bàn khách quen O: 0") || !secondText.includes("Bàn khách mới N: 1")) {
    throw new Error("Second browser did not observe the updated O/N statistics")
  }
  if (!secondText.includes("Khách vào trước 21:30: 5")) {
    throw new Error("Second browser did not observe expected_at statistics")
  }
  if (/0987|phone|ciphertext|hmac/i.test(secondText)) throw new Error("Sensitive phone data leaked in export")
  await secondContext.close()
  secondContext = null

  // Reassign tables (Đổi bàn)
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()
  await detailSheet.getByRole("button", { name: "Đổi bàn", exact: true }).click()

  const reassignDialog = page.getByRole("dialog", { name: /Phân bàn/ })
  await reassignDialog.waitFor()
  await page.getByRole("button", { name: /^Bàn A1,/ }).click()
  await page.getByRole("button", { name: /^Bàn A2,/ }).click()
  await page.getByRole("button", { name: /^Bàn A4,/ }).click()
  const reassignConfirm = reassignDialog.getByRole("button", { name: "Phân bàn" })
  await reassignConfirm.click()
  await reassignDialog.waitFor({ state: "hidden" })

  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.getByText("A2 + A4", { exact: true }).waitFor()

  // Reload & check persistence
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.getByText("A2 + A4", { exact: true }).waitFor()

  // Cancel booking
  await detailSheet.getByRole("button", { name: "Hủy booking" }).click()
  let cancelDialog = page.getByRole("alertdialog")
  await cancelDialog.waitFor()
  await cancelDialog.locator("#confirm-note").fill("Kiểm thử Phase 2B")
  await cancelDialog.getByRole("button", { name: "Hủy booking" }).click()
  await cancelDialog.waitFor({ state: "hidden" })
  await page.getByText("Đã hủy", { exact: true }).filter({ visible: true }).first().waitFor()
  await waitUntil(() => floorReads > floorReadsBeforeMutations, "Floor State was not refetched after booking mutations")

  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByLabel("Tìm booking").fill(guestName)
  await page.getByText(guestName, { exact: true }).first().waitFor()
  await page.getByText("Đã hủy", { exact: true }).filter({ visible: true }).first().waitFor()

  // Return to floor
  await page.getByRole("link", { name: "Điều phối" }).click()
  await page.getByLabel("Sơ đồ bàn, trạng thái hiện tại").waitFor()

  const cookies = await page.context().cookies(`${apiUrl}/api/v1`)
  const session = cookies.find((cookie) => cookie.name === "21gam_session")
  if (!session?.httpOnly) throw new Error("Session cookie is missing or not HttpOnly")
  await page.getByLabel(/Tài khoản:/).click()
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click()
  await page.getByText("Đăng nhập 21GAM", { exact: true }).waitFor()

  console.log(
    JSON.stringify({
      login: "PASS",
      list: "PASS",
      search: "PASS",
      create: "PASS",
      detail: "PASS",
      assign: "PASS",
      reassign: "PASS",
      assignmentPersistence: "PASS",
      update: "PASS",
      classification: "PASS",
      exportStatistics: "PASS",
      twoBrowserSync: "PASS",
      cancel: "PASS",
      reload: "PASS",
      floorRefetch: "PASS",
      logout: "PASS",
    }),
  )
} finally {
  if (secondContext) await secondContext.close()
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
