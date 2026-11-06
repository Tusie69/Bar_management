// Receptionist booking flows on a phone against the real API and an isolated MySQL test database.
// Env: DB_NAME must end in _test. Run: pnpm -C web e2e:sprint2
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import fs from "node:fs"
import { chromium, expect } from "@playwright/test"

const root = new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3101"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5174"
const databaseName = process.env.DB_NAME ?? "gam21_platform_test"
if (!/_test$/.test(databaseName)) throw new Error("Refusing browser E2E: DB_NAME must end in _test")
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")
const output = process.env.SPRINT2_OUTPUT ?? "e2e/.artifacts/sprint2-booking"
fs.mkdirSync(output, { recursive: true })

// 19:00 in Hanoi on 03/11. Today's 22:35 is still ahead; tomorrow is 04/11.
const fixedNow = "2026-11-03T12:00:00.000Z"
const today = "2026-11-03"
const tomorrow = "2026-11-04"
const quickTimes = ["20:15", "21:30", "22:00", "23:45"]

const username = `sprint2_${Date.now()}`
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
const results = []
let browser

function run(command, args, env = common) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}
const runPnpm = (args, env = common) => run(process.execPath, [pnpmCli, ...args], env)
const fixture = (...args) =>
  runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", ...args], credentialEnv)
function startPnpm(args, env) {
  const child = spawn(process.execPath, [pnpmCli, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  children.push(child)
}
function stopChildren() {
  for (const child of children.reverse())
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
}
async function waitFor(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const sheet = (page) => page.getByRole("form", { name: /^(Tạo đặt bàn|Mở bàn Walk-in)/ })
const instant = (iso) => new Date(iso).toISOString()

async function api(context, method, path, body) {
  const me = await context.request.get(`${apiUrl}/api/v1/auth/me`)
  const { csrfToken } = await me.json()
  const response = await context.request.fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: { Origin: webUrl, "X-CSRF-Token": csrfToken },
    ...(body ? { data: body } : {}),
  })
  return { status: response.status(), body: response.ok() ? await response.json() : await response.text() }
}
const tableIdOf = async (context, code) =>
  (await api(context, "GET", "/tables/catalog")).body.tables.find((row) => row.code === code).id
const floorRow = async (context, date, code) =>
  (await api(context, "GET", `/tables?date=${date}`)).body.tables.find((row) => row.code === code)
const bookingsOf = async (context, date) => (await api(context, "GET", `/bookings?date=${date}`)).body.bookings
const waitlistOf = async (context, date) => (await api(context, "GET", `/waitlist?date=${date}`)).body.entries

async function step(name, fn) {
  try {
    const data = await fn()
    results.push({ name, result: "PASS", ...data })
    console.log(`PASS ${name}${data ? ` ${JSON.stringify(data)}` : ""}`)
  } catch (error) {
    results.push({ name, result: "FAIL", error: String(error.stack ?? error) })
    console.error(`FAIL ${name}: ${error.stack ?? error}`)
    throw error
  }
}

/** Counts real taps so the "at most N" acceptance limits are measured, not assumed. */
const counter = () => {
  let n = 0
  return {
    click: async (locator) => {
      n += 1
      await locator.click()
    },
    get n() {
      return n
    },
  }
}

async function chooseDate(page, date) {
  const [year, month, day] = date.split("-").map(Number)
  const calendar = page.getByRole("button", { name: /Chọn ngày/ }).first()
  await calendar.click()
  await page.locator(`[data-day="${month}/${day}/${year}"]`).click()
  await expect(calendar).toContainText(`${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`)
}

async function pickTime(form, hour, minute, tap = (locator) => locator.click()) {
  await tap(form.getByRole("button", { name: /Chọn giờ bằng con lăn/ }))
  await tap(form.locator(`[data-wheel="Giờ"] [data-value="${hour}"]`))
  await tap(form.locator(`[data-wheel="Phút"] [data-value="${minute}"]`))
  await expect(form.getByRole("button", { name: new RegExp(`đang chọn ${hour}:${minute}`) })).toBeVisible()
}

const createdBy = (page, path) =>
  page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1${path}`,
  )

try {
  fixture("setup")
  fixture("set-quick-times", JSON.stringify(quickTimes))
  startPnpm(["--filter", "@21gam/api", "exec", "tsx", "src/server.ts"], {
    ...common,
    PORT: new URL(apiUrl).port,
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
  startPnpm(
    [
      "--filter",
      "@21gam/web",
      "exec",
      "vite",
      "--mode",
      "test",
      "--host",
      "127.0.0.1",
      "--port",
      new URL(webUrl).port,
      "--strictPort",
    ],
    {
      ...process.env,
      VITE_API_MODE: "http",
      VITE_API_BASE_URL: apiUrl,
      VITE_VENUE_ID: "1",
      VITE_E2E_FIXED_NOW: fixedNow,
    },
  )
  await Promise.all([waitFor(`${apiUrl}/api/v1/health`), waitFor(webUrl)])

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.goto(webUrl, { waitUntil: "networkidle" })
  await page.getByLabel("Tên đăng nhập").fill(username)
  await page.getByLabel("Mật khẩu").fill(password)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await table(page, "A1").waitFor()

  // A second signed-in device for the same venue.
  const otherDevice = await browser.newContext()
  const login = await otherDevice.request.post(`${apiUrl}/api/v1/auth/login`, {
    headers: { Origin: webUrl },
    data: { username, password },
  })
  assert(login.ok(), `second device login failed: ${login.status()}`)
  const directBooking = async (code, date, time, guestName) =>
    api(otherDevice, "POST", "/bookings/direct", {
      guestName,
      partySize: 2,
      expectedAt: `${date}T${time}:00+07:00`,
      businessDate: date,
      sourceCode: "HOTLINE",
      classification: "UNCLASSIFIED",
      tableIds: [await tableIdOf(otherDevice, code)],
    })

  await step("AT1 AT4 AT6 AT7: tap A1 opens its sheet, 22:35 in 3 taps, venue quick times, saved on A1", async () => {
    await table(page, "A1").click()
    const form = sheet(page)
    await expect(form).toHaveAccessibleName("Tạo đặt bàn A1")
    assert.deepEqual(
      await form.getByRole("group", { name: "Giờ nhanh" }).getByRole("button").allTextContents(),
      quickTimes,
    )
    const taps = counter()
    await pickTime(form, "22", "35", taps.click)
    assert(taps.n <= 3, `22:35 took ${taps.n} taps`)
    await form.getByLabel("Tên khách").fill("Khách 2235")
    const created = createdBy(page, "/bookings/direct")
    await form.getByRole("button", { name: "Đặt bàn A1", exact: true }).click()
    const response = await created
    assert.equal(response.status(), 201)
    const { booking } = await response.json()
    assert.deepEqual(booking.tableCodes, ["A1"], "A1 must not be replaced")
    assert.equal(instant(booking.expectedAt), instant(`${today}T22:35:00+07:00`))
    assert.equal(booking.businessDate, today)
    await expect(form).toBeHidden()
    await expect.poll(async () => (await floorRow(context, today, "A1")).state).not.toBe("AVAILABLE")
    return { taps: taps.n, tableCodes: booking.tableCodes }
  })

  await step("AT2: changing the date re-checks the table for that date", async () => {
    const taken = await directBooking("B3", tomorrow, "21:00", "Giữ B3 ngày mai")
    assert.equal(taken.status, 201)
    await table(page, "B3").click()
    const form = sheet(page)
    await expect(form.getByRole("button", { name: "Đặt bàn B3", exact: true })).toBeEnabled()
    await form.getByRole("combobox", { name: "Ngày", exact: true }).click()
    await page.getByRole("option", { name: /04\/11/ }).click()
    await expect(form.getByRole("alert")).toContainText("B3 đã có khách đặt trong ngày 04/11")
    await expect(form.getByRole("button", { name: /^Đặt bàn/ })).toHaveCount(0)
    await page.screenshot({ path: `${output}/b3-unavailable-http.png` })
    await form.getByRole("combobox", { name: "Ngày", exact: true }).click()
    await page.getByRole("option", { name: /03\/11/ }).click()
    await expect(form.getByRole("button", { name: "Đặt bàn B3", exact: true })).toBeEnabled()
    await form.getByRole("button", { name: "Đóng form" }).click()
    await expect(form).toBeHidden()
  })

  await step(
    "AT3 AT5 AT13: other device takes A2 mid-entry, backend refuses, data stays, another table saves",
    async () => {
      await table(page, "A2").click()
      const form = sheet(page)
      await form.getByLabel("Tên khách").fill("Khách tranh bàn")
      await form.getByLabel("Số điện thoại").fill("0987654111")
      await pickTime(form, "21", "10")
      await expect(form.getByRole("button", { name: "Đặt bàn A2", exact: true })).toBeEnabled()
      assert.equal((await directBooking("A2", today, "21:00", "Thiết bị khác")).status, 201)

      const refused = createdBy(page, "/bookings/direct")
      await form.getByRole("button", { name: "Đặt bàn A2", exact: true }).click()
      assert.equal((await refused).status(), 409, "the backend guard must refuse the second booking")
      const conflict = page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog", { name: /thay đổi|không còn trống/i }))
        .first()
      await conflict.waitFor()
      await page.screenshot({ path: `${output}/conflict-http.png` })
      await conflict.getByRole("button").first().click()
      await expect(form.getByRole("button", { name: "Chọn bàn khác", exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(form.getByRole("alert")).toContainText("A2 đã có khách đặt")
      assert.equal((await bookingsOf(context, today)).filter((row) => row.tableCodes.includes("A2")).length, 1)

      await form.getByRole("button", { name: "Chọn bàn khác", exact: true }).click()
      await table(page, "A4").click()
      await expect(form).toHaveAccessibleName("Tạo đặt bàn A4")
      await expect(form.getByLabel("Tên khách")).toHaveValue("Khách tranh bàn")
      await expect(form.getByLabel("Số điện thoại")).toHaveValue("0987654111")
      await expect(form.getByRole("button", { name: /đang chọn 21:10/ })).toBeVisible()
      const saved = createdBy(page, "/bookings/direct")
      await form.getByRole("button", { name: "Đặt bàn A4", exact: true }).click()
      const { booking } = await (await saved).json()
      assert.deepEqual(booking.tableCodes, ["A4"])
      await expect(form).toBeHidden()
    },
  )

  await step("AT12: 00:30 stays on business date 03/11, 23:30 on 04/11", async () => {
    await table(page, "B3").click()
    let form = sheet(page)
    await form.getByLabel("Tên khách").fill("Khách 0030")
    await pickTime(form, "00", "30")
    await expect(form.getByText("00:30 là sáng 04/11, vẫn thuộc ngày kinh doanh 03/11.")).toBeVisible()
    let created = createdBy(page, "/bookings/direct")
    await form.getByRole("button", { name: "Đặt bàn B3", exact: true }).click()
    const early = (await (await created).json()).booking
    assert.equal(instant(early.expectedAt), instant(`${tomorrow}T00:30:00+07:00`))
    assert.equal(early.businessDate, today)
    await expect(form).toBeHidden()

    await chooseDate(page, tomorrow)
    await table(page, "A4").click()
    form = sheet(page)
    await form.getByLabel("Tên khách").fill("Khách 2330")
    await pickTime(form, "23", "30")
    created = createdBy(page, "/bookings/direct")
    await form.getByRole("button", { name: "Đặt bàn A4", exact: true }).click()
    const late = (await (await created).json()).booking
    assert.equal(instant(late.expectedAt), instant(`${tomorrow}T23:30:00+07:00`))
    assert.equal(late.businessDate, tomorrow)
    await expect(form).toBeHidden()
    return { early: early.businessDate, late: late.businessDate }
  })

  await step(
    "AT8 AT9: booking without table enters Bàn chờ as ADVANCE_RESERVATION, moves to A2 in 4 taps, no Visit",
    async () => {
      const marker = page.getByRole("button", { name: /^Bàn chờ/ })
      await marker.click()
      const dialog = page.getByRole("dialog", { name: /Bàn chờ/ })
      await dialog.getByRole("button", { name: "Nhận booking", exact: true }).click()
      const form = sheet(page)
      await expect(form.getByRole("heading", { name: "Nhận booking vào Bàn chờ" })).toBeVisible()
      await form.getByLabel("Tên khách").fill("Khách Bàn chờ")
      await form.getByLabel("Số điện thoại").fill("0987654222")
      await form.getByRole("group", { name: "Giờ nhanh" }).getByRole("button", { name: "22:00" }).click()
      const added = createdBy(page, "/waitlist")
      await form.getByRole("button", { name: "Lưu vào Bàn chờ", exact: true }).click()
      assert.equal((await added).status(), 201)
      await expect(form).toBeHidden()

      const [entry] = await waitlistOf(context, tomorrow)
      assert.equal(entry.kind, "ADVANCE_RESERVATION")
      assert.equal(entry.status, "WAITING")
      const booking = (await bookingsOf(context, tomorrow)).find((row) => row.id === entry.reservationId)
      assert.deepEqual(booking.tableCodes, [], "a waiting booking holds no physical table")
      assert.equal((await floorRow(context, tomorrow, "A2")).state, "AVAILABLE")
      await expect(marker).toContainText("+1")
      await page.screenshot({ path: `${output}/waitlist-marker-http.png` })

      const taps = counter()
      await taps.click(marker)
      await expect(dialog.getByText("Khách Bàn chờ")).toBeVisible()
      await page.screenshot({ path: `${output}/waitlist-sheet-http.png` })
      await taps.click(dialog.getByRole("button", { name: "Chuyển bàn", exact: true }))
      await taps.click(table(page, "A2"))
      await expect(page.getByText("Chuyển Khách Bàn chờ vào A2?")).toBeVisible()
      await page.screenshot({ path: `${output}/waitlist-confirm-http.png` })
      const seated = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && /\/waitlist\/\d+\/seat$/.test(new URL(response.url()).pathname),
      )
      await taps.click(page.getByRole("button", { name: "Xác nhận chuyển bàn", exact: true }))
      assert.equal((await seated).status(), 200)
      assert(taps.n <= 4, `assignment took ${taps.n} taps`)

      const [after] = await waitlistOf(context, tomorrow)
      assert.equal(after.status, "HOLD_ACTIVE")
      assert.deepEqual((await bookingsOf(context, tomorrow)).find((row) => row.id === entry.reservationId).tableCodes, [
        "A2",
      ])
      assert.equal(
        (await floorRow(context, tomorrow, "A2")).activeVisit ?? null,
        null,
        "assignment must not create a Visit",
      )
      await expect(table(page, "A2")).toHaveAttribute("aria-label", /Khách Bàn chờ/)
      await expect(marker).not.toContainText("+1")
      return { taps: taps.n }
    },
  )

  await step("AT10: Walk-in on a free table creates Visit and allocation", async () => {
    await chooseDate(page, today)
    await table(page, "B4").click()
    const form = sheet(page)
    await form.getByRole("tab", { name: "Walk-in", exact: true }).click()
    await form.getByLabel(/Tên hoặc đặc điểm/).fill("Khách vãng lai")
    await page.screenshot({ path: `${output}/walkin-http.png` })
    const opened = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/visits|walk-in/.test(new URL(response.url()).pathname),
    )
    await form.getByRole("button", { name: "Mở bàn ngay", exact: true }).click()
    assert.equal((await opened).status(), 201)
    await expect(form).toBeHidden()
    const row = await floorRow(context, today, "B4")
    assert.equal(row.activeVisit.displayName, "Khách vãng lai")
    return { state: row.state }
  })

  await step("AT11: Walk-in without a table enters Bàn chờ as WALK_IN", async () => {
    await page.getByRole("button", { name: /^Bàn chờ/ }).click()
    const dialog = page.getByRole("dialog", { name: /Bàn chờ/ })
    await dialog.getByRole("button", { name: "Walk-in", exact: true }).last().click()
    const form = sheet(page)
    await form.getByLabel(/Tên hoặc đặc điểm/).fill("Khách chờ cửa")
    const added = createdBy(page, "/waitlist")
    await form.getByRole("button", { name: "Thêm vào Bàn chờ", exact: true }).click()
    assert.equal((await added).status(), 201)
    await expect(form).toBeHidden()
    const entries = await waitlistOf(context, today)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].kind, "WALK_IN")
    assert.equal(entries[0].status, "WAITING")
    assert(JSON.stringify(entries[0]).includes("Khách chờ cửa"))
  })

  assert.deepEqual(pageErrors, [], "browser errors")
  assert(!(await page.locator("body").innerText()).includes("0987654111"), "full phone leaked into the UI")
} finally {
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
  if (browser) await browser.close()
  stopChildren()
  try {
    fixture("cleanup")
    console.log(fixture("verify-clean"))
  } catch (cleanupError) {
    console.error(cleanupError)
    process.exitCode = 1
  }
}
