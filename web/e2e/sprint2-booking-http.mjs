// Receptionist booking flows on a phone against the real API and an isolated MySQL test database.
// Env: DB_NAME must end in _test. Run: pnpm -C web e2e:sprint2
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3101"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5174"
const databaseName = process.env.DB_NAME ?? "gam21_platform_test"
if (!/_test$/.test(databaseName)) throw new Error("Refusing browser E2E: DB_NAME must end in _test")
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")
const output = process.env.SPRINT2_OUTPUT ?? "e2e/.artifacts/sprint2-booking"
fs.mkdirSync(output, { recursive: true })

// 18:55 in Hanoi on 03/11. A 19:00 booking is inside the call window without being in the past.
const fixedNow = "2026-11-03T11:55:00.000Z"
const today = "2026-11-03"
const tomorrow = "2026-11-04"
const quickTimes = ["20:10", "21:30", "22:00", "23:45"]

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
  await page.addInitScript(() => {
    window.__ba023TelClicks = []
    const originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function click() {
      if (this.href.startsWith("tel:")) {
        window.__ba023TelClicks.push(this.href)
        return
      }
      return originalClick.call(this)
    }
  })
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
    data: { username, password, portal: "receptionist" },
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

  const callableBooking = async (code, phoneNumber, guestName) =>
    api(otherDevice, "POST", "/bookings/direct", {
      guestName,
      phoneNumber,
      partySize: 2,
      expectedAt: `${today}T19:00:00+07:00`,
      businessDate: today,
      sourceCode: "HOTLINE",
      classification: "UNCLASSIFIED",
      tableIds: [await tableIdOf(otherDevice, code)],
    })

  const exerciseCallControl = async (code, phoneNumber, width) => {
    const created = await callableBooking(code, phoneNumber, `Khách gọi ${code}`)
    assert.equal(created.status, 201, `callable booking rejected: ${JSON.stringify(created.body)}`)
    await page.setViewportSize({ width, height: width >= 900 ? 800 : 844 })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, code).click()
    const callResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/bookings/${created.body.booking.id}/call`,
    )
    await page.getByRole("button", { name: "Gọi khách", exact: true }).click()
    assert.equal((await callResponse).status(), 201)
    await expect(page.getByRole("button", { name: "Ghi kết quả cuộc gọi", exact: true })).toBeVisible()
    const telClicks = await page.evaluate(() => window.__ba023TelClicks)
    assert.equal(telClicks.at(-1), `tel:+84${phoneNumber.slice(1)}`)
    const body = await page.locator("body").innerText()
    assert(!body.includes(phoneNumber), `${width >= 900 ? "desktop" : "mobile"} UI leaked the full phone`)
    assert(!JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes(phoneNumber))
    assert(!JSON.stringify(await page.evaluate(() => ({ ...sessionStorage }))).includes(phoneNumber))
    await page.getByRole("button", { name: "Ghi kết quả cuộc gọi", exact: true }).click()
    const outcomeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/outcome"),
    )
    await page.getByRole("button", { name: "Không nghe máy", exact: true }).click()
    assert.equal((await outcomeResponse).status(), 200)
    const cancelled = await api(otherDevice, "POST", `/bookings/${created.body.booking.id}/cancel`, {
      version: created.body.booking.version,
      reasonNote: "Dọn fixture BA-023",
    })
    assert.equal(cancelled.status, 200)
    return { bookingId: created.body.booking.id, viewportWidth: width, phoneLast3: phoneNumber.slice(-3) }
  }

  await step("BA-023 desktop: receptionist call opens the controlled tel URI and records an outcome", async () =>
    exerciseCallControl("B6", "0905555666", 1280),
  )

  await step("BA-023 mobile: receptionist call opens the controlled tel URI without persisting the phone", async () =>
    exerciseCallControl("B5", "0907777888", 390),
  )

  await step("BA-004 desktop: phone-only booking submits through real HTTP without persisting a fake name", async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, "B6").click()
    const bookingForm = sheet(page)
    await bookingForm.getByLabel("Số điện thoại").fill("0901111222")
    await bookingForm.getByRole("group", { name: "Giờ nhanh" }).getByRole("button", { name: "21:30" }).click()
    const created = createdBy(page, "/bookings/direct")
    await bookingForm.getByRole("button", { name: "Đặt bàn B6", exact: true }).click()
    const response = await created
    assert.equal(response.status(), 201)
    assert.equal(response.request().postDataJSON().guestName, undefined)
    const { booking } = await response.json()
    assert.equal(booking.hasGuestName, false)
    assert.equal(booking.phoneLast3, "222")
    assert.equal(booking.guestName, "Khách")
    await expect(bookingForm).toBeHidden()
    assert(!(await page.locator("body").innerText()).includes("0901111222"), "desktop UI leaked the full phone")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, "A1").waitFor()
    return { phoneLast3: booking.phoneLast3, hasGuestName: booking.hasGuestName }
  })

  for (const width of [1280, 390]) {
    await step(`WF-01 ${width}: editing only the note preserves a phone-only booking`, async () => {
      const phoneNumber = width === 1280 ? "0909999909" : "0909999908"
      const created = await api(context, "POST", width === 1280 ? "/bookings" : "/bookings/direct", {
        phoneNumber,
        partySize: 2,
        expectedAt: `${today}T21:30:00+07:00`,
        businessDate: today,
        sourceCode: "HOTLINE",
        ...(width === 390 ? { tableIds: [await tableIdOf(context, "B4")] } : {}),
      })
      assert.equal(created.status, 201)
      let booking = created.body.booking
      assert.equal(booking.hasGuestName, false)
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
      await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
      if (width === 1280) {
        await page.getByRole("textbox", { name: "Tìm 3 số cuối SĐT", exact: true }).fill(phoneNumber.slice(-3))
        await page.getByRole("button", { name: /Khách · \*\*\*909/ }).click()
        await page.getByRole("button", { name: "Sửa", exact: true }).click()
      } else {
        await table(page, "B4").click()
        await page.getByRole("button", { name: "Xem booking", exact: true }).click()
        await page.getByRole("button", { name: "Sửa booking", exact: true }).click()
      }
      const editor = page.getByRole("dialog", { name: "Sửa booking", exact: true })
      await expect(editor.getByLabel("Tên khách", { exact: true })).toHaveValue("")
      const note = `Ghi chú WF-01 ${width}`
      await editor.getByLabel("Ghi chú", { exact: true }).fill(note)
      await page.screenshot({ path: `${output}/wf-01-editor-${width}.png` })
      const updated = page.waitForResponse((response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/api/v1/bookings/${booking.id}`,
      )
      await editor.getByRole("button", { name: "Lưu thay đổi", exact: true }).click()
      const response = await updated
      assert.equal(response.status(), 200)
      assert(!Object.hasOwn(response.request().postDataJSON(), "guestName"), "unchanged fallback must be omitted")
      booking = (await response.json()).booking
      assert.equal(booking.hasGuestName, false)
      assert.equal(booking.guestName, "Khách")
      assert.equal(booking.note, note)
      const fresh = await api(context, "GET", `/bookings/${booking.id}`)
      assert.equal(fresh.status, 200)
      assert.equal(fresh.body.booking.hasGuestName, false)
      assert.equal(fresh.body.booking.guestName, "Khách")
      assert.equal(fresh.body.booking.note, note)
      await expect(editor).toBeHidden()
      assert(!(await page.locator("body").innerText()).includes(phoneNumber), "editor leaked the full phone")

      if (width === 390) {
        await step("WF-01: an intentional name edit is sent in the PUT payload", async () => {
          await page.getByRole("button", { name: "Sửa booking", exact: true }).click()
          await expect(editor.getByLabel("Tên khách", { exact: true })).toHaveValue("")
          await editor.getByLabel("Tên khách", { exact: true }).fill("Tên khách mới")
          const renamed = page.waitForResponse((res) =>
            res.request().method() === "PUT" && new URL(res.url()).pathname === `/api/v1/bookings/${booking.id}`,
          )
          await editor.getByRole("button", { name: "Lưu thay đổi", exact: true }).click()
          const renamedResponse = await renamed
          assert.equal(renamedResponse.status(), 200)
          assert.equal(renamedResponse.request().postDataJSON().guestName, "Tên khách mới")
          booking = (await renamedResponse.json()).booking
          await expect(editor).toBeHidden()
        })
      }
      const cancelled = await api(context, "POST", `/bookings/${booking.id}/cancel`, { version: booking.version })
      assert.equal(cancelled.status, 200)
      return { viewportWidth: width, hasGuestName: fresh.body.booking.hasGuestName }
    })
  }

  await step("WF-01: editing only the note preserves the real name Khách", async () => {
    const created = await api(context, "POST", "/bookings", {
      guestName: "Khách",
      phoneNumber: "0909999907",
      partySize: 2,
      expectedAt: `${today}T21:30:00+07:00`,
      businessDate: today,
      sourceCode: "HOTLINE",
    })
    assert.equal(created.status, 201)
    const booking = created.body.booking
    assert.equal(booking.hasGuestName, true)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("textbox", { name: "Tìm 3 số cuối SĐT", exact: true }).fill("907")
    await page.getByRole("button", { name: /Khách · \*\*\*907/ }).click()
    await page.getByRole("button", { name: "Sửa", exact: true }).click()
    const editor = page.getByRole("dialog", { name: "Sửa booking", exact: true })
    await expect(editor.getByLabel("Tên khách", { exact: true })).toHaveValue("Khách")
    await editor.getByLabel("Ghi chú", { exact: true }).fill("Giữ tên thật")
    const updated = page.waitForResponse((response) =>
      response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/v1/bookings/${booking.id}`,
    )
    await editor.getByRole("button", { name: "Lưu thay đổi", exact: true }).click()
    const response = await updated
    assert.equal(response.status(), 200)
    assert.equal(response.request().postDataJSON().guestName, "Khách")
    const saved = (await response.json()).booking
    assert.equal(saved.hasGuestName, true)
    assert.equal(saved.guestName, "Khách")
    const fresh = await api(context, "GET", `/bookings/${booking.id}`)
    assert.equal(fresh.status, 200)
    assert.equal(fresh.body.booking.hasGuestName, true)
    assert.equal(fresh.body.booking.guestName, "Khách")
    assert.equal(fresh.body.booking.note, "Giữ tên thật")
    await expect(editor).toBeHidden()
    assert.equal((await api(context, "POST", `/bookings/${booking.id}/cancel`, { version: saved.version })).status, 200)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, "A1").waitFor()
  })

  await step("AT1 AT4 AT6 AT7: tap A1 opens its sheet, 22:30 in 3 taps, venue quick times, saved on A1", async () => {
    await table(page, "A1").click()
    const form = sheet(page)
    await expect(form).toHaveAccessibleName("Tạo đặt bàn A1")
    assert.deepEqual(
      await form.getByRole("group", { name: "Giờ nhanh" }).getByRole("button").allTextContents(),
      ["21:30", "22:00", "23:45"],
    )
    const taps = counter()
    await pickTime(form, "22", "30", taps.click)
    await expect(form.locator('[data-wheel="Phút"] [data-value]')).toHaveText(["00", "15", "30", "45"])
    await expect(form.locator('[data-wheel="Phút"] [data-value="35"]')).toHaveCount(0)
    await expect(form.getByRole("group", { name: "Giờ nhanh" }).getByRole("button", { name: "20:10" })).toHaveCount(0)
    assert(taps.n <= 3, `22:30 took ${taps.n} taps`)
    await form.getByLabel("Tên khách").fill("Khách 2230")
    const created = createdBy(page, "/bookings/direct")
    await form.getByRole("button", { name: "Đặt bàn A1", exact: true }).click()
    const response = await created
    assert.equal(response.status(), 201)
    const { booking } = await response.json()
    assert.deepEqual(booking.tableCodes, ["A1"], "A1 must not be replaced")
    assert.equal(instant(booking.expectedAt), instant(`${today}T22:30:00+07:00`))
    assert.equal(booking.businessDate, today)
    await expect(form).toBeHidden()
    await expect.poll(async () => (await floorRow(context, today, "A1")).state).not.toBe("AVAILABLE")
    return { taps: taps.n, tableCodes: booking.tableCodes }
  })

  await step("BA-004 mobile: phone-only table-first booking renders masked on the floor", async () => {
    await table(page, "B5").click()
    const form = sheet(page)
    await form.getByLabel("Số điện thoại").fill("0903333444")
    await form.getByRole("group", { name: "Giờ nhanh" }).getByRole("button", { name: "21:30" }).click()
    const created = createdBy(page, "/bookings/direct")
    await form.getByRole("button", { name: "Đặt bàn B5", exact: true }).click()
    const response = await created
    assert.equal(response.status(), 201)
    assert.equal(response.request().postDataJSON().guestName, undefined)
    const { booking } = await response.json()
    assert.equal(booking.hasGuestName, false)
    assert.equal(booking.phoneLast3, "444")
    await expect(form).toBeHidden()
    const floor = await floorRow(context, today, "B5")
    assert.equal(floor.claim.guestName, "Khách đặt")
    assert.equal(floor.claim.phoneLast3, "444")
    assert(!(await page.locator("body").innerText()).includes("0903333444"), "mobile UI leaked the full phone")
    return { displayName: floor.claim.guestName, phoneLast3: floor.claim.phoneLast3 }
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
      await pickTime(form, "21", "15")
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
      await expect(form.getByRole("button", { name: /đang chọn 21:15/ })).toBeVisible()
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
    await form.getByRole("radio", { name: "2 khách", exact: true }).click()
    const added = createdBy(page, "/waitlist")
    await form.getByRole("button", { name: "Thêm vào Bàn chờ", exact: true }).click()
    assert.equal((await added).status(), 201)
    await expect(form).toBeHidden()
    const entries = await waitlistOf(context, today)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].kind, "WALK_IN")
    assert.equal(entries[0].status, "WAITING")
    assert(JSON.stringify(entries[0]).includes("Khách chờ cửa"))
    await page.getByRole("button", { name: /^Bàn chờ/ }).click()
    await dialog.getByRole("button", { name: "Chuyển bàn", exact: true }).click()
    await page.locator('[aria-label^="Ghế Bar 11,"]').click()
    await page.locator('[aria-label^="Ghế Bar 12,"]').click()
    await expect(page.getByText("Mở bàn Bar 11 + Bar 12 cho Khách chờ cửa?")).toBeVisible()
    const seated = page.waitForResponse(response => response.request().method() === "POST" && /\/waitlist\/\d+\/seat$/.test(new URL(response.url()).pathname))
    await page.getByRole("button", { name: "Xác nhận mở bàn", exact: true }).click()
    const response = await seated
    assert.equal(response.status(), 200)
    assert.equal(response.request().postDataJSON().arrived, true)
    assert.equal((await waitlistOf(context, today))[0].status, "SEATED")
    const floor = await floorRow(context, today, "BAR11")
    assert.equal(floor.state, "IN_USE")
    assert.equal(floor.activeVisit.displayName, "Khách chờ cửa")
    assert.equal(typeof floor.activeVisit.id, "number")
    const second = await floorRow(context, today, "BAR12")
    assert.equal(second.state, "IN_USE")
    assert.equal(second.activeVisit.id, floor.activeVisit.id)
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
