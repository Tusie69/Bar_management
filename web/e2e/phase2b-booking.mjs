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
const fixedNow = "2026-11-03T12:00:00.000Z"
const tomorrow = "2026-11-04"

const username = `phase2b_${Date.now()}`
const password = randomBytes(24).toString("base64url")
const common = {
  ...process.env,
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: process.env.DB_PORT ?? "3306",
  DB_NAME: databaseName,
  DB_USER: process.env.DB_USER ?? "gam21",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "gam21_dev",
  ORGANIZATION_ID: "1",
  VENUE_ID: "1",
  NO_SHOW_WORKER_ENABLED: "false",
  BUSINESS_DAY_WORKER_ENABLED: "false",
  E2E_FIXED_NOW: fixedNow,
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

const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const bookingForm = (page) =>
  page
    .getByRole("dialog", { name: /Tạo đặt bàn|Tạo đơn đặt bàn/ })
    .or(page.getByRole("form", { name: /Tạo đặt bàn|Tạo đơn đặt bàn/ }))
    .last()
const calendar = (page) => page.getByRole("button", { name: /Chọn ngày/ }).first()

async function chooseDate(page, date) {
  const [year, month, day] = date.split("-").map(Number)
  const label = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`
  if ((await calendar(page).textContent()).includes(label)) return
  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tables" &&
      new URL(response.url()).searchParams.get("date") === date,
  )
  await calendar(page).click()
  await page.locator(`[data-day="${month}/${day}/${year}"]`).click()
  await loaded
}

async function jsonRequest(context, method, path, body) {
  const me = await context.request.get(`${apiUrl}/api/v1/auth/me`)
  const { csrfToken } = await me.json()
  const response = await context.request.fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: { Origin: webUrl, "X-CSRF-Token": csrfToken },
    ...(body ? { data: body } : {}),
  })
  if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`)
  return response.json()
}

async function openBookingFromSearch(page, suffix, guestName) {
  const search = page.getByRole("textbox", { name: /3 số cuối/ })
  await search.fill(suffix)
  await page.getByTestId("reception-search-summary").waitFor()
  const detail = page
    .getByRole("dialog")
    .filter({ hasText: guestName })
    .or(page.getByLabel("Bảng điều phối").filter({ hasText: guestName }))
    .or(page.getByLabel("Chi tiết").filter({ hasText: guestName }))
    .last()
  if (await detail.isVisible().catch(() => false)) return detail
  const result = page.locator('[data-search-highlighted="true"]').first()
  await result.waitFor()
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('[data-search-highlighted="true"]')].some((node) =>
        node.getAttribute("aria-label")?.includes(name),
      ),
    guestName,
  )
  await result.click()
  await detail.waitFor()
  return detail
}

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
    PHONE_ENCRYPTION_KEYS: `1:${randomBytes(32).toString("base64")}`,
    PHONE_HMAC_KEYS: `1:${randomBytes(32).toString("base64")}`,
    PHONE_ACTIVE_ENCRYPTION_KEY_ID: "1",
    PHONE_ACTIVE_HMAC_KEY_ID: "1",
    PHONE_REVEAL_RATE_LIMIT_MAX: "3",
    PHONE_REVEAL_RATE_LIMIT_WINDOW_MS: "60000",
  })
  startPnpm(["--filter", "@21gam/web", "exec", "vite", "--mode", "test", "--host", "127.0.0.1", "--port", "5174"], {
    ...process.env,
    VITE_API_MODE: "http",
    VITE_API_BASE_URL: apiUrl,
    VITE_VENUE_ID: "1",
    VITE_E2E_FIXED_NOW: fixedNow,
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

  // Single-floor receptionist navigation: the floor is the only workspace.
  await chooseDate(page, tomorrow)
  const floorReadsBeforeMutations = floorReads
  const guestName = `Khách E2E ${Date.now()}`
  const phoneNumber = "0987654789"
  const phoneLast3 = "789"

  // The table-first form keeps the legacy slot-picker, keyboard and overflow assertions.
  await table(page, "A1").click()
  let form = bookingForm(page)
  await form.waitFor()
  if ((await form.locator('input[type="time"]').count()) !== 0) throw new Error("Native time picker is still present")
  const timeGroups = form.getByRole("radiogroup").filter({ hasText: /Tối|Sáng hôm sau/ })
  const timeRadios = timeGroups.getByRole("radio")
  if ((await timeRadios.count()) !== 13) {
    throw new Error(`Time picker does not contain all 13 canonical slots (found ${await timeRadios.count()})`)
  }
  const slotTops = await timeRadios.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  )
  if (new Set(slotTops).size <= 1) throw new Error("Time slots are not rendered in a multi-row grid")
  const firstSlot = form.getByRole("radio", { name: /^19:00/ })
  await firstSlot.focus()
  await firstSlot.press("ArrowRight")
  if ((await form.getByRole("radio", { name: /^19:30/ }).getAttribute("aria-checked")) !== "true") {
    throw new Error("Arrow-key time selection did not update the selected slot")
  }
  await form.getByRole("radio", { name: /^01:00/ }).click()
  if (await form.evaluate((node) => node.scrollWidth > node.clientWidth + 1)) {
    throw new Error("Time picker caused form overflow")
  }
  for (const guarded of [table(page, "A10"), table(page, "A3")]) {
    if ((await guarded.getAttribute("aria-disabled")) !== "true" && !(await guarded.isDisabled())) {
      throw new Error("Spare/out-of-service table was selectable")
    }
  }
  await form
    .getByRole("button", { name: /^(Hủy|Quay lại)$/ })
    .first()
    .click()
  const leave = page.getByRole("alertdialog", { name: /Bỏ đơn đang nhập/ })
  if (await leave.isVisible().catch(() => false)) await leave.getByRole("button", { name: "Bỏ đơn" }).click()
  await form.waitFor({ state: "hidden" })

  // Create an assigned booking: fast reception search is a map highlight, not an unassigned-booking list.
  const createdPayload = await jsonRequest(page.context(), "POST", "/bookings/direct", {
    guestName,
    phoneNumber,
    partySize: 3,
    expectedAt: `${tomorrow}T19:30:00+07:00`,
    businessDate: tomorrow,
    sourceCode: "HOTLINE",
    classification: "RETURNING",
    guestType: "REGULAR",
    isBirthday: true,
    note: "Khách cần khu yên tĩnh",
    tableIds: [9501],
  })
  let booking = createdPayload.booking
  if (booking.guestType !== "REGULAR" || booking.isBirthday !== true) {
    throw new Error("NA-14 booking metadata was not persisted")
  }

  // Exact-three-digit search is scoped to the selected business date.
  let detailSheet = await openBookingFromSearch(page, phoneLast3, guestName)
  const projectedLabel = await page.locator('[data-search-highlighted="true"]').first().getAttribute("aria-label")
  if (!/khách quen/i.test(projectedLabel ?? "") || !/sinh nhật/i.test(projectedLabel ?? "")) {
    throw new Error("Booking metadata flags were not projected on the canonical map")
  }
  if ((await page.locator("body").innerText()).includes(phoneNumber))
    throw new Error("Full phone leaked into receptionist UI")

  const maskedDetail = await jsonRequest(page.context(), "GET", `/bookings/${booking.id}`)
  if (/phoneNumber|ciphertext|hmac/i.test(JSON.stringify(maskedDetail))) {
    throw new Error("Sensitive phone fields leaked through booking detail")
  }
  await closeTopDialog(page)
  await detailSheet.waitFor({ state: "hidden" })

  // Guest-total/Zalo overlay preserves classification statistics without phone data.
  await page.getByRole("button", { name: "Đếm khách", exact: true }).click()
  let dialog = page.getByRole("dialog").last()
  const returningExport = dialog.getByLabel("Nội dung text booking")
  await returningExport.waitFor()
  if (!(await returningExport.inputValue()).includes("Bàn khách quen O: 1")) {
    throw new Error("Returning classification was not reflected in Zalo export")
  }
  if (/0987|ciphertext|hmac/i.test(await returningExport.inputValue())) {
    throw new Error("Sensitive phone data leaked in export")
  }
  await closeTopDialog(page)
  await dialog.waitFor({ state: "hidden" })

  // The direct hold is projected on the same canonical map used by search.
  await table(page, "A1").waitFor()
  await page.waitForFunction(() =>
    document.querySelector('[aria-label^="Bàn A1,"]')?.getAttribute("aria-label")?.includes("Khách E2E"),
  )

  // Search/detail remain reachable from the single-floor controls; metadata writes stay on the authenticated contract.
  detailSheet = await openBookingFromSearch(page, phoneLast3, guestName)
  await detailSheet.getByText("A1", { exact: true }).first().waitFor()
  await closeTopDialog(page)
  booking = (await jsonRequest(page.context(), "GET", `/bookings/${booking.id}`)).booking
  booking = (
    await jsonRequest(page.context(), "PUT", `/bookings/${booking.id}`, {
      guestName,
      partySize: 5,
      expectedAt: booking.expectedAt,
      businessDate: booking.businessDate,
      sourceCode: booking.sourceCode,
      classification: "NEW",
      guestType: "NEW",
      isBirthday: true,
      version: booking.version,
    })
  ).booking
  if (booking.classification !== "NEW" || booking.guestType !== "NEW" || booking.isBirthday !== true) {
    throw new Error("Metadata-only edit lost classification or birthday")
  }
  // Historical raw notes are redacted on read and preserved when an unrelated API edit omits note.
  runPnpm(
    [
      "--filter",
      "@21gam/api",
      "exec",
      "tsx",
      "test/support/phase2b-e2e-fixture.ts",
      "inject-historical-note",
      guestName,
    ],
    credentialEnv,
  )
  const redacted = await jsonRequest(page.context(), "GET", `/bookings/${booking.id}`)
  if (JSON.stringify(redacted).includes("0987 654 321")) throw new Error("Historical phone leaked through booking note")
  booking = (
    await jsonRequest(page.context(), "PUT", `/bookings/${booking.id}`, {
      guestName,
      partySize: booking.partySize,
      expectedAt: booking.expectedAt,
      businessDate: booking.businessDate,
      sourceCode: booking.sourceCode,
      classification: booking.classification,
      guestType: booking.guestType,
      isBirthday: false,
      version: booking.version,
    })
  ).booking
  runPnpm(
    [
      "--filter",
      "@21gam/api",
      "exec",
      "tsx",
      "test/support/phase2b-e2e-fixture.ts",
      "verify-historical-note",
      guestName,
    ],
    credentialEnv,
  )

  // Receptionist cannot reveal a full phone; denial must not create a reveal audit.
  const me = await page.context().request.get(`${apiUrl}/api/v1/auth/me`)
  const auth = await me.json()
  const reveal = await page.context().request.post(`${apiUrl}/api/v1/bookings/${booking.id}/phone:reveal`, {
    headers: { Origin: webUrl, "X-CSRF-Token": auth.csrfToken },
    data: {},
  })
  if (reveal.status() !== 403) throw new Error(`Receptionist phone reveal returned ${reveal.status()}`)
  runPnpm(
    ["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-phone-audit"],
    credentialEnv,
  )

  // Second context: mobile single-floor keeps date, slot reachability and export privacy.
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
  await table(secondPage, "A1").waitFor()
  await chooseDate(secondPage, tomorrow)
  await table(secondPage, "A2").tap()
  const mobileForm = bookingForm(secondPage)
  await mobileForm.waitFor()
  if (await mobileForm.evaluate((node) => node.scrollWidth > node.clientWidth + 1)) {
    throw new Error("Mobile booking form has horizontal overflow")
  }
  const mobileTimeGroups = mobileForm.getByRole("radiogroup").filter({ hasText: /Tối|Sáng hôm sau/ })
  const mobileRadios = mobileTimeGroups.getByRole("radio")
  if ((await mobileRadios.count()) !== 13) {
    throw new Error(`Mobile form does not contain all 13 slots (found ${await mobileRadios.count()})`)
  }
  const mobileLastSlot = mobileForm.getByRole("radio", { name: /^01:00/ })
  await mobileLastSlot.scrollIntoViewIfNeeded()
  await mobileLastSlot.click()
  if ((await mobileLastSlot.getAttribute("aria-checked")) !== "true") {
    throw new Error("Slot 01:00 was not selectable in mobile form")
  }
  await mobileForm
    .getByRole("button", { name: /^(Hủy|Quay lại)$/ })
    .first()
    .click()
  const mobileLeave = secondPage.getByRole("alertdialog", { name: /Bỏ đơn đang nhập/ })
  if (await mobileLeave.isVisible().catch(() => false))
    await mobileLeave.getByRole("button", { name: "Bỏ đơn" }).click()
  await mobileForm.waitFor({ state: "hidden" })
  await secondPage.getByRole("button", { name: "Đếm khách", exact: true }).click()
  const secondExport = secondPage.getByRole("dialog").getByLabel("Nội dung text booking")
  await secondExport.waitFor()
  const secondText = await secondExport.inputValue()
  if (!secondText.includes("Bàn khách quen O: 0") || !secondText.includes("Bàn khách mới N: 1")) {
    throw new Error("Second browser did not observe updated O/N statistics")
  }
  if (!secondText.includes("Khách vào trước 21:30: 5")) {
    throw new Error("Second browser did not observe expected_at statistics")
  }
  if (/0987|phone|ciphertext|hmac/i.test(secondText)) throw new Error("Sensitive phone data leaked in export")
  await secondContext.close()
  secondContext = null

  // Reassign to two same-zone tables for the updated party size.
  await page.reload({ waitUntil: "networkidle" })
  await chooseDate(page, tomorrow)
  detailSheet = await openBookingFromSearch(page, phoneLast3, guestName)
  await detailSheet.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  const reassignDialog = page.getByRole("dialog", { name: /Đổi .* sang bàn mới|Phân bàn/ })
  await reassignDialog.waitFor()
  const a1Btn = table(page, "A1")
  if ((await a1Btn.getAttribute("aria-pressed")) === "true") await activateTable(a1Btn)
  for (const code of ["A2", "A4"]) {
    const button = table(page, code)
    if ((await button.getAttribute("aria-pressed")) !== "true") await activateTable(button)
  }
  await reassignDialog.getByRole("button", { name: /Phân bàn|Đổi bàn/ }).click()
  await reassignDialog.waitFor({ state: "hidden" })
  await page.waitForFunction(
    (name) =>
      ["A2", "A4"].every((code) => {
        const node = document.querySelector(`[aria-label^="Bàn ${code},"]`)
        return (
          node?.getAttribute("data-search-highlighted") === "true" && node.getAttribute("aria-label")?.includes(name)
        )
      }),
    guestName,
  )
  detailSheet = await openBookingFromSearch(page, phoneLast3, guestName)
  await detailSheet.getByText("A2 + A4", { exact: true }).waitFor()
  await closeTopDialog(page)

  // Reload proves assignment persistence on the selected business date.
  await page.reload({ waitUntil: "networkidle" })
  await chooseDate(page, tomorrow)
  detailSheet = await openBookingFromSearch(page, phoneLast3, guestName)
  await detailSheet.getByText("A2 + A4", { exact: true }).waitFor()

  // Cancellation keeps the reason workflow and releases the Floor Projection.
  await detailSheet.getByRole("button", { name: "Hủy booking" }).click()
  const cancelDialog = page.getByRole("alertdialog")
  await cancelDialog.waitFor()
  await cancelDialog.locator("#confirm-note").fill("Kiểm thử Phase 2B")
  await cancelDialog.getByRole("button", { name: "Hủy booking" }).click()
  await cancelDialog.waitFor({ state: "hidden" })
  await waitUntil(() => floorReads > floorReadsBeforeMutations, "Floor State was not refetched after booking mutations")

  await page.reload({ waitUntil: "networkidle" })
  await chooseDate(page, tomorrow)
  const cancelled = await jsonRequest(page.context(), "GET", `/bookings/${booking.id}`)
  if (cancelled.booking.status !== "CANCELLED") throw new Error("Cancelled booking status was not persisted")
  await table(page, "A2").waitFor()
  const releasedFloor = await jsonRequest(page.context(), "GET", `/tables?date=${tomorrow}`)
  const releasedA2 = releasedFloor.tables.find((row) => row.id === 9502)
  if (releasedA2?.claim !== null || releasedA2?.displayState !== "EMPTY") {
    throw new Error("Cancelled booking still owns A2 in the server Floor Projection")
  }
  if (!/(trống|chưa đặt)/i.test((await table(page, "A2").getAttribute("aria-label")) ?? "")) {
    throw new Error("Cancelled booking did not release A2")
  }

  const cookies = await page.context().cookies(`${apiUrl}/api/v1`)
  const session = cookies.find((cookie) => cookie.name === "21gam_session")
  if (!session?.httpOnly) throw new Error("Session cookie is missing or not HttpOnly")
  await page.getByLabel(/Tài khoản:/).click()
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click()
  await page.getByText("Đăng nhập Lễ tân", { exact: true }).waitFor()

  console.log(
    JSON.stringify({
      login: "PASS",
      singleFloor: "PASS",
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
  else {
    const back = page.getByRole("button", { name: /Ca tối nay/ }).first()
    if (await back.count()) await back.click()
    else await page.keyboard.press("Escape")
  }
}
