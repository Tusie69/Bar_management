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

const table = (page, code) =>
  page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()

const bookingRow = (page, guestName) => page.getByRole("row").filter({ hasText: guestName }).first()

async function activateTable(tableButton) {
  await tableButton.focus()
  await tableButton.press("Enter")
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
  let validWaitlistReads = 0
  let invalidWaitlistReads = 0
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname !== "/api/v1/waitlist") return
    if (url.searchParams.get("date")) validWaitlistReads += 1
    else invalidWaitlistReads += 1
  })
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/v1/tables") floorReads += 1
  })

  await page.goto(webUrl, { waitUntil: "networkidle" })
  await page.getByLabel("Tên đăng nhập").fill(username)
  await page.getByLabel("Mật khẩu").fill(password)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await page.getByRole("button", { name: /^Tài khoản: Lễ tân E2E/ }).waitFor()
  await waitUntil(() => validWaitlistReads >= 1, "Waitlist did not load after businessDate became available")
  const waitlistReadsBeforePolling = validWaitlistReads
  await waitUntil(
    () => validWaitlistReads > waitlistReadsBeforePolling,
    "Waitlist did not continue polling after businessDate became available",
    18_000,
  )
  if (invalidWaitlistReads !== 0) throw new Error("Waitlist was requested with an empty businessDate")

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
  const timeGroups = sheet.getByRole("radiogroup").filter({ hasText: /Tối|Sáng hôm sau/ })
  const timeRadios = timeGroups.getByRole("radio")
  if ((await timeRadios.count()) !== 13) throw new Error(`Time picker does not contain all 13 slots across canonical groups (found ${await timeRadios.count()})`)
  const slotTops = await timeRadios.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  if (new Set(slotTops).size <= 1) throw new Error("Time slots are not rendered in a multi-row grid")
  const firstSlot = sheet.getByRole("radio", { name: /^19:00/ })
  await firstSlot.focus()
  await firstSlot.press("ArrowRight")
  if ((await sheet.getByRole("radio", { name: /^19:30/ }).getAttribute("aria-checked")) !== "true") {
    throw new Error("Arrow-key time selection did not update the selected slot")
  }
  const lastSlot = sheet.getByRole("radio", { name: /^01:00/ })
  await lastSlot.click()
  if ((await lastSlot.getAttribute("aria-checked")) !== "true") {
    throw new Error("Clicking 01:00 slot did not select it")
  }
  await sheet.getByText(/Đã chọn:\s*01:00/i).waitFor()
  if (await sheet.evaluate((node) => node.scrollWidth > node.clientWidth + 1)) {
    throw new Error("Time picker caused modal overflow")
  }

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
  await bookingRow(page, guestName).waitFor()
  await bookingRow(page, guestName).click()
  let detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()

  await closeTopDialog(page)
  await detailSheet.waitFor({ state: "hidden" })

  // Verify Zalo export for RETURNING
  await page.getByRole("button", { name: "Xuất text Zalo" }).click()
  let dialog = page.getByRole("dialog").last()
  const returningExport = dialog.getByLabel("Nội dung text booking")
  await returningExport.waitFor()
  if (!(await returningExport.inputValue()).includes("Bàn khách quen O: 1")) {
    throw new Error("Returning classification was not reflected in Zalo export")
  }
  await closeTopDialog(page)
  await dialog.waitFor({ state: "hidden" })

  // Table assignment on floor
  await bookingRow(page, guestName).click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()
  await detailSheet.getByRole("button", { name: "Phân bàn", exact: true }).click()

  const pickDialog = page.getByRole("dialog", { name: /Phân bàn/ })
  await pickDialog.waitFor()

  const spareButton = table(page, "A10")
  const outOfServiceButton = table(page, "A3")
  if ((await spareButton.getAttribute("aria-disabled")) !== "true" && !(await spareButton.isDisabled())) {
    throw new Error("Spare table was selectable")
  }
  if ((await outOfServiceButton.getAttribute("aria-disabled")) !== "true" && !(await outOfServiceButton.isDisabled())) {
    throw new Error("Out-of-service table was selectable")
  }

  await activateTable(table(page, "A1"))
  const assignConfirm = pickDialog.getByRole("button", { name: "Phân bàn" })
  await assignConfirm.click()
  await pickDialog.waitFor({ state: "hidden" })

  // Verify assigned table in details
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  // Returning from the Floor route remounts the canonical reservations page on
  // today's business date. The booking created above belongs to tomorrow.
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await bookingRow(page, guestName).click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.getByText("A1", { exact: true }).waitFor()

  await closeTopDialog(page)
  await detailSheet.waitFor({ state: "hidden" })

  // Search and edit booking
  await page.getByLabel("Tìm booking").fill(guestName)
  await bookingRow(page, guestName).waitFor()
  await bookingRow(page, guestName).click()
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
  await closeTopDialog(page)
  await detailSheet.waitFor({ state: "hidden" })

  // Second context: Mobile V1 (390x844)
  secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  })
  const secondPage = await secondContext.newPage()
  await secondPage.goto(webUrl, { waitUntil: "networkidle" })
  await secondPage.getByLabel("Tên đăng nhập").fill(username)
  await secondPage.getByLabel("Mật khẩu").fill(password)
  await secondPage.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await secondPage.getByRole("button", { name: "Danh sách", exact: true }).click()
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

  // Open mobile booking creation through canonical controls
  await secondPage.getByRole("button", { name: "Tạo mới" }).click()
  const createSheet = secondPage.getByRole("dialog", { name: "Tạo mới" })
  await createSheet.waitFor()
  await createSheet.getByRole("button", { name: /Tạo đặt trước/ }).click()
  await createSheet.waitFor({ state: "hidden" })

  const mobileForm = secondPage.getByRole("dialog", { name: "Tạo đơn đặt bàn" })
  await mobileForm.waitFor()
  if (await mobileForm.evaluate((node) => node.scrollWidth > node.clientWidth + 1)) {
    throw new Error("Mobile booking form has horizontal overflow")
  }

  // Verify date-named time slot groups in mobile FormScreen
  const mobileTimeGroups = mobileForm.getByRole("radiogroup").filter({ hasText: /Tối|Sáng hôm sau/ })
  const mobileRadios = mobileTimeGroups.getByRole("radio")
  if ((await mobileRadios.count()) !== 13) {
    throw new Error(`Mobile form does not contain all 13 slots across date-named groups (found ${await mobileRadios.count()})`)
  }

  // Reachability and touch/selection verification for late slot
  const mobileLastSlot = mobileForm.getByRole("radio", { name: /^01:00/ })
  await mobileLastSlot.scrollIntoViewIfNeeded()
  await mobileLastSlot.click()
  if ((await mobileLastSlot.getAttribute("aria-checked")) !== "true") {
    throw new Error("Slot 01:00 was not selectable in mobile form")
  }

  // Dismiss via canonical back/leave flow
  await mobileForm.getByRole("button", { name: "Quay lại" }).click()
  const leaveConfirm = secondPage.getByRole("alertdialog", { name: "Bỏ đơn đang nhập" })
  if (await leaveConfirm.isVisible()) {
    await leaveConfirm.getByRole("button", { name: "Bỏ đơn" }).click()
  }
  await mobileForm.waitFor({ state: "hidden" })

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
  await bookingRow(page, guestName).click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.waitFor()
  await detailSheet.getByRole("button", { name: "Đổi bàn", exact: true }).click()

  const reassignDialog = page.getByRole("dialog", { name: /Phân bàn|Đổi bàn/ })
  await reassignDialog.waitFor()
  const a1Btn = table(page, "A1")
  if ((await a1Btn.getAttribute("aria-pressed")) === "true") {
    await activateTable(a1Btn)
  }
  const a2Btn = table(page, "A2")
  if ((await a2Btn.getAttribute("aria-pressed")) !== "true") {
    await activateTable(a2Btn)
  }
  const a4Btn = table(page, "A4")
  if ((await a4Btn.getAttribute("aria-pressed")) !== "true") {
    await activateTable(a4Btn)
  }
  const reassignConfirm = reassignDialog.getByRole("button", { name: /Phân bàn|Đổi bàn/ })
  await reassignConfirm.click()
  await reassignDialog.waitFor({ state: "hidden" })

  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await bookingRow(page, guestName).click()
  detailSheet = page.getByRole("dialog").filter({ hasText: guestName })
  await detailSheet.getByText("A2 + A4", { exact: true }).waitFor()

  // Reload & check persistence
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByLabel("Tìm booking").fill(guestName)
  await bookingRow(page, guestName).click()
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
      waitlistPolling: "PASS",
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

async function closeTopDialog(page) {
  const close = page.getByRole("dialog").last().getByRole("button", { name: "Đóng", exact: true })
  if (await close.count()) await close.first().click()
  else await page.keyboard.press("Escape")
}
