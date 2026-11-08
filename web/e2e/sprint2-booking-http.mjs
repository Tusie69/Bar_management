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
const snapshot = (ids) => JSON.parse(fixture("snapshot-entities", JSON.stringify(ids)).split("entity-snapshot=")[1]);
const cleanupCase = (ids) => fixture("cleanup-entities", JSON.stringify(ids));
const watchWrites = (page) => {
  const requests = []
  const listen = (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && request.url().includes("/api/v1/"))
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() })
  }
  page.on("request", listen)
  return { requests, stop: () => page.off("request", listen) }
}
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
  const targetText = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`
  const calendar = page.getByRole("button", { name: /Chọn ngày/ }).first()
  const currentText = await calendar.innerText()
  if (currentText.includes(targetText)) {
    return
  }
  await calendar.click()
  const target = page.locator(`[data-day="${month}/${day}/${year}"]`)
  for (let n = 0; n < 15 && !await target.count(); n++) {
    const shown = await page.locator("[data-day]").first().getAttribute("data-day")
    const shownDate = new Date(shown)
    await page.locator(new Date(year, month - 1, day) > shownDate ? ".rdp-button_next" : ".rdp-button_previous").click()
  }
  await target.click()
  await expect(calendar).toContainText(targetText)
  await expect(page.locator("[data-radix-popper-content-wrapper]")).toBeHidden()
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

  // Every hold case owns its IDs and its page. Failed assertions still release only that case.
  const holdCase = async (fn, { date = today, time = "22:00", name = "Khách Hôm Nay", offer = false, pure = false, linked = true } = {}) => {
    const ids = { bookingIds: [], entryIds: [] }
    let p
    try {
      let booking, entry
      if (!pure) {
        const created = await api(otherDevice, "POST", "/bookings", { guestName: name, partySize: 2,
          expectedAt: `${date}T${time}:00+07:00`, businessDate: date, sourceCode: "HOTLINE", classification: "UNCLASSIFIED" })
        assert.equal(created.status, 201, JSON.stringify(created))
        booking = created.body.booking
        ids.bookingIds.push(booking.id)
      }
      if (offer || pure) {
        ids.entryIds.push(9988)
        fixture("setup-case2-pure-hold", "A5", date, String(booking?.id ?? 0))
      } else if (linked) {
        const added = await api(otherDevice, "POST", "/waitlist", { kind: "ADVANCE_RESERVATION", reservationId: booking.id, businessDate: date, contactChannel: "IN_PERSON" })
        assert.equal(added.status, 201, JSON.stringify(added))
        entry = added.body.entry
        ids.entryIds.push(entry.id)
        const seated = await api(otherDevice, "POST", `/waitlist/${entry.id}/seat`, { version: entry.version, tableIds: [await tableIdOf(otherDevice, "A5")], arrived: false })
        assert.equal(seated.status, 200, JSON.stringify(seated))
      } else {
        assert.equal((await api(otherDevice, "POST", `/bookings/${booking.id}/assign`, { version: booking.version, tableIds: [await tableIdOf(otherDevice, "A5")] })).status, 200)
      }
      booking = booking && (await bookingsOf(otherDevice, date)).find((r) => r.id === booking.id)
      entry = (await waitlistOf(otherDevice, date)).find((e) => ids.entryIds.includes(e.id))
      p = await context.newPage()
      p.on("pageerror", (error) => pageErrors.push(error.message))
      await p.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
      await chooseDate(p, date)
      await expect(table(p, "A5")).toHaveAttribute("aria-label", /giữ|đặt|hạn/i)
      await fn({ p, ids, booking, entry, date })
    } finally {
      if (p) await p.close()
      if (ids.bookingIds.length || ids.entryIds.length) cleanupCase(ids)
    }
  }
  const openHeld = async (p, code = "A5", width = 390) => {
    await table(p, code).click()
    const detail = width < 768 ? p.getByRole("dialog", { name: `Chi tiết ${code}` }) : p.locator("aside").last()
    return width < 768 ? detail : p
  }
  const closeDetail = (p) => p.locator('button[aria-label="Quay lại"]').first().click()
  const labels = ["Quản lý đơn", "Xem booking", "Xem đơn chờ", "Đổi / Ghép bàn", "Đổi trạng thái", "Khách đã đến"]

  // The guard admits any `_test` database on 127.0.0.1, which is the suffix the
  // whole repo uses for throwaway databases, and refuses everything else before
  // it opens a connection. A fixed port is not part of it: 33306 rejected the
  // targets this suite passes in on its default 3306, this case included.
  await step("F11: Fixture target guard rejects non-test databases and remote hosts before connecting", async () => {
    for (const name of ["gam21_platform_it_test", "gam21_platform_e2e_test", "gam21_platform_test"])
      assert.match(runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-target"], { ...credentialEnv, DB_NAME: name }), /fixture-target-approved=1/)
    for (const target of [
      { DB_NAME: "gam21_platform_dev" }, { DB_NAME: "gam21_platform" }, { DB_NAME: "gam21_dev" }, { DB_NAME: "" },
      { DB_HOST: "localhost" }, { DB_HOST: "192.0.2.1" },
    ]) {
      const result = spawnSync(process.execPath, [pnpmCli, "--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-target"], { cwd: root, env: { ...credentialEnv, ...target }, encoding: "utf8", windowsHide: true })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr + result.stdout, /Refusing E2E fixture/)
      assert.doesNotMatch(result.stderr + result.stdout, /ECONNREFUSED|ETIMEDOUT/)
    }
  })

  await step("AT9b: Duplicate names resolve booking and entry IDs; view/cancel preserve held entities", () => holdCase(async ({ p, ids, booking, entry }) => {
    const twin = await api(otherDevice, "POST", "/bookings", { guestName: booking.guestName, partySize: 2, expectedAt: `${today}T19:00:00+07:00`, businessDate: today, sourceCode: "HOTLINE", classification: "UNCLASSIFIED" })
    assert.equal(twin.status, 201)
    ids.bookingIds.push(twin.body.booking.id)
    const before = snapshot(ids)
    assert.equal(before.entries[0].status, "HOLD_ACTIVE")
    assert.equal(before.bookings.find((r) => r.id === booking.id).status, "BOOKED")
    assert.equal(before.visits.length, 0)
    assert.equal(before.allocations.filter((r) => r.kind === "HOLD" && !r.released_at).length, 1)
    const writes = watchWrites(p)
    try {
      let detail = await openHeld(p)
      for (const label of labels) await expect(detail.getByRole("button", { name: label, exact: true })).toBeVisible()
      await detail.getByRole("button", { name: "Xem booking", exact: true }).click()
      // The detail's linked entry is an ID assertion even when two guest names are identical.
      await expect(p.getByRole("dialog", { name: "Chi tiết booking" }).getByText(`#${entry.id} (Đặt trước)`, { exact: true })).toBeVisible()
      await closeDetail(p)
      detail = await openHeld(p)
      await detail.getByRole("button", { name: "Xem đơn chờ", exact: true }).click()
      await expect(p.getByRole("dialog", { name: "Chi tiết mục chờ" }).getByText(`#${booking.id}`, { exact: true })).toBeVisible()
      await closeDetail(p)
      detail = await openHeld(p)
      await detail.getByRole("button", { name: "Đổi / Ghép bàn", exact: true }).click()
      await expect(table(p, "A5")).toHaveAttribute("aria-pressed", "true")
      assert.equal(writes.requests.length, 0)
      await p.getByRole("button", { name: "Hủy chọn bàn" }).click()
      detail = await openHeld(p)
      await detail.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
      await p.getByRole("dialog", { name: "Đổi trạng thái booking" }).getByRole("button", { name: "Đóng", exact: true }).click()
      detail = await openHeld(p)
      await detail.getByRole("button", { name: "Khách đã đến", exact: true }).click()
      const confirm = p.getByRole("alertdialog", { name: "Xác nhận khách đã đến" })
      await expect(confirm).toContainText(booking.guestName)
      await expect(confirm).toContainText("A5")
      await expect(confirm).toContainText("2 khách")
      await confirm.getByRole("button", { name: "Quay lại", exact: true }).click()
      await p.getByRole("dialog", { name: "Chi tiết A5" }).getByRole("button", { name: "Đóng", exact: true }).click()
      assert.deepEqual(writes.requests, [])
      assert.deepEqual(snapshot(ids), before)
      detail = await openHeld(p)
      await detail.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
      await p.getByRole("dialog", { name: "Đổi trạng thái booking" }).getByRole("button", { name: "Hủy booking", exact: true }).click()
      const cancelled = createdBy(p, `/bookings/${booking.id}/cancel`)
      await p.getByRole("alertdialog").getByRole("button", { name: "Hủy booking", exact: true }).click()
      const response = await cancelled
      assert.equal(response.status(), 200)
      assert.equal(response.request().postDataJSON().version, booking.version)
      assert.equal(writes.requests.length, 1)
      const after = snapshot(ids)
      assert.equal(after.bookings.find((r) => r.id === booking.id).status, "CANCELLED")
      assert.deepEqual(after.bookings.find((r) => r.id === twin.body.booking.id), before.bookings.find((r) => r.id === twin.body.booking.id))
      assert.equal(after.entries[0].status, "CANCELLED")
      assert.equal(after.visits.length, 0)
    } finally { writes.stop() }
  }))

  await step("AT9c: Merge full own target set retains HOLD and group; stale assign is exact 409", () => holdCase(async ({ p, ids, booking, entry }) => {
    const before = snapshot(ids)
    const detail = await openHeld(p)
    const writes = watchWrites(p)
    try {
      await detail.getByRole("button", { name: "Đổi / Ghép bàn", exact: true }).click()
      await expect(table(p, "A5")).toHaveAttribute("aria-pressed", "true")
      assert.notEqual(await table(p, "A5").getAttribute("aria-disabled"), "true")
      await table(p, "A6").click()
      const moved = createdBy(p, `/bookings/${booking.id}/assign`)
      await p.getByRole("button", { name: "Đổi bàn", exact: true }).click()
      const response = await moved
      assert.equal(response.status(), 200)
      assert.equal(response.request().postDataJSON().version, booking.version)
      const after = snapshot(ids)
      assert.equal(after.visits.length, before.visits.length)
      assert.equal(after.entries.find((r) => r.id === entry.id).status, "HOLD_ACTIVE")
      assert.equal(after.bookings[0].status, "BOOKED")
      const active = after.allocations.filter((r) => r.kind === "HOLD" && !r.released_at)
      assert.deepEqual(active.map((r) => r.table_id).sort(), [await tableIdOf(context, "A5"), await tableIdOf(context, "A6")].sort())
      assert(active.every((r) => r.group_id && r.group_id === active[0].group_id))
      assert.equal(after.groups.filter((g) => g.id === active[0].group_id && !g.dissolved_at).length, 1)
      assert.equal(writes.requests.length, 1)
      const stale = await api(otherDevice, "POST", `/bookings/${booking.id}/assign`, { tableIds: [await tableIdOf(context, "A5")], version: booking.version })
      assert.equal(stale.status, 409)
      assert.equal(JSON.parse(stale.body).error.code, "VERSION_CONFLICT")
      fs.writeFileSync(`${output}/hold-merge-entities.json`, JSON.stringify({ before, after }, null, 2))
    } finally { writes.stop() }
  }))

  await step("AT9d: HTTP linked/pure matrix blocks unsupported floor, card and booking-detail actions", async () => {
    fs.mkdirSync("e2e/.artifacts/waitlist-hold/after", { recursive: true })
    for (const pure of [true, false]) await holdCase(async ({ p, ids, booking, entry }) => {
      const before = snapshot(ids)
      for (const width of [360, 390, 768]) for (const theme of ["light", "dark"]) {
        await p.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
        await p.evaluate(async (theme) => (await import("/src/state/session.ts")).useSession.getState().setTheme(theme), theme)
        const writes = watchWrites(p)
        try {
          const detail = await openHeld(p, "A5", width)
          for (const label of ["Đổi / Ghép bàn", "Khách đã đến", ...(!pure ? ["Đổi trạng thái"] : [])]) await expect(detail.getByRole("button", { name: label, exact: true })).toBeDisabled()
          if (pure) await expect(detail.getByRole("button", { name: "Xem booking", exact: true })).toBeHidden()
          await p.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/http-${pure ? "pure" : "offer"}-floor-${width}-${theme}.png` })
          await detail.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
          if (width < 768) {
            const d = p.getByRole("dialog", { name: pure ? "Chi tiết mục chờ" : "Chi tiết booking" })
            await expect(d).toBeVisible()
            await expect(d.getByRole("button", { name: pure ? "Khách đã đến" : "Xếp bàn", exact: true })).toBeDisabled()
            if (pure) await expect(d.getByRole("button", { name: "Đổi / Ghép bàn", exact: true })).toBeDisabled()
            else await expect(d.getByRole("button", { name: "Đổi trạng thái", exact: true })).toBeDisabled()

            await closeDetail(p)
            const sheetClose = p.getByRole("dialog", { name: "Chi tiết A5" }).getByRole("button", { name: "Đóng", exact: true })
            if (await sheetClose.isVisible()) await sheetClose.click()
          } else {
            const d = p.getByRole("dialog").last()
            await expect(d).toContainText(pure ? `#${entry.id}` : `#${booking.id}`)
            if (!pure) {
              await expect(d.getByRole("button", { name: "Phân bàn", exact: true })).toBeDisabled()
              await expect(d.getByRole("button", { name: "Đưa vào danh sách chờ (đặt trước)", exact: true })).toBeHidden()
              await expect(d.getByRole("button", { name: "Hủy booking", exact: true })).toBeDisabled()
              await expect(d.getByRole("button", { name: /Khách đã tới: chọn bàn và check-in/ })).toBeDisabled()
            }
            await d.getByRole("button", { name: "Đóng", exact: true }).click()
            await expect(d).toBeHidden()
            const back = p.getByRole("button", { name: "Ca tối nay", exact: true })
            if (await back.isVisible()) await back.click()
          }
          await p.getByRole("button", { name: /^Bàn chờ/ }).first().click()
          if (width < 768) await expect(p.getByRole("button", { name: "Khách đã đến", exact: true }).first()).toBeDisabled()
          else {
            const card = p.locator(`#entry-${entry.id}`)
            await expect(card.getByRole("button", { name: "Khách đã đến", exact: true })).toBeDisabled()
            await expect(card.getByRole("button", { name: "Đổi / Ghép bàn", exact: true })).toBeDisabled()
          }
          assert.deepEqual(writes.requests, [])
          await p.keyboard.press("Escape")
          await p.reload({ waitUntil: "networkidle" })
        } finally { writes.stop() }
      }
      assert.deepEqual(snapshot(ids), before)
    }, { offer: !pure, pure })
  })

  await step("F13 AT5 AT6 AT7 AT9: pending/503 waitlist cannot mutate a linked HTTP offer", async () => {
    for (const width of [390, 768]) await holdCase(async ({ p, ids, booking }) => {
      await p.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
      const before = snapshot(ids)
      assert.equal(before.holds.filter((h) => h.status === "ACTIVE").length, 1)
      let release
      const gate = new Promise((resolve) => { release = resolve })
      const route = async (route) => {
        await gate
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_WAITLIST_UNAVAILABLE", message: "waitlist unavailable" } }) })
      }
      await p.route("**/api/v1/waitlist?**", route)
      const writes = watchWrites(p)
      try {
        await p.reload({ waitUntil: "domcontentloaded" })
        const floor = await openHeld(p, "A5", width)
        await expect(floor.getByRole("button", { name: "Khách đã đến", exact: true })).toBeDisabled()
        await floor.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
        const d = p.getByRole("dialog", { name: width < 768 ? "Chi tiết booking" : undefined }).last()
        const blocked = width < 768 ? ["Xếp bàn", "Đổi trạng thái", "Sửa booking"] : ["Phân bàn", "Hủy booking", "Không tới", "Khách đã tới: chọn bàn và check-in", "Sửa"]
        for (const label of blocked) await expect(d.getByRole("button", { name: label, exact: true })).toBeDisabled()
        await expect(d.getByRole("alert")).toHaveText("Đang tải đơn chờ")
        const failed = p.waitForResponse((r) => r.url().includes("/api/v1/waitlist?") && r.status() === 503)
        release()
        await failed
        await expect(d.getByRole("alert")).toHaveText("Không tải được đơn chờ")
        for (const label of blocked) await expect(d.getByRole("button", { name: label, exact: true })).toBeDisabled()
        await p.screenshot({ path: `${output}/f13-error-detail-${width}.png` })
        assert.deepEqual(writes.requests, [])
        assert.deepEqual(snapshot(ids), before)
        await p.unroute("**/api/v1/waitlist?**", route)
        await p.reload({ waitUntil: "networkidle" })
        const recovered = await openHeld(p, "A5", width)
        await recovered.getByRole("button", { name: "Xem booking", exact: true }).click()
        const detail = p.getByRole("dialog", { name: width < 768 ? "Chi tiết booking" : undefined }).last()
        await expect(detail).toContainText(width < 768 ? "Chưa có bàn" : `#${booking.id}`)
        await expect(detail.getByRole("button", { name: blocked[0], exact: true })).toBeDisabled()
        assert.deepEqual(writes.requests, [])
        const after = snapshot(ids)
        assert.deepEqual(after, before)
        assert.equal(after.holds.filter((h) => h.status === "ACTIVE").length, 1)
        assert.equal(after.allocations.filter((a) => a.kind === "HOLD" && !a.released_at).length, 1)
        assert.equal(after.visits.length, 0)
      } finally { release(); writes.stop() }
    }, { offer: true })
  })

  await step("F13 submit: a direct picker opened before a waitlist 503 sends zero writes", async () => {
    for (const width of [390, 768]) await holdCase(async ({ p, ids, booking }) => {
      await p.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
      await p.reload({ waitUntil: "networkidle" })
      const before = snapshot(ids)
      await table(p, "A5").click()
      if (width < 768) await p.getByRole("button", { name: "Xem booking", exact: true }).click()
      else await p.evaluate(async (r) => (await import("/src/state/ui.ts")).useUi.getState().openReservation(r.id, r.businessDate), booking)
      const d = p.getByRole("dialog", { name: width < 768 ? "Chi tiết booking" : undefined }).last()
      await d.getByRole("button", { name: width < 768 ? "Đổi / Ghép bàn" : "Đổi bàn", exact: true }).click()
      const route = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_WAITLIST_UNAVAILABLE", message: "waitlist unavailable" } }) })
      await p.route("**/api/v1/waitlist?**", route)
      const failed = p.waitForResponse((r) => r.url().includes("/api/v1/waitlist?") && r.status() === 503, { timeout: 25_000 })
      await failed
      const writes = watchWrites(p)
      try {
        await table(p, "A5").click()
        await table(p, "A6").click()
        await p.getByRole("button", { name: "Đổi bàn", exact: true }).click()
        await expect(p.getByText(/Đơn chờ đã thay đổi|Không tải được đơn chờ/).first()).toBeVisible()
        assert.deepEqual(writes.requests, [])
        assert.deepEqual(snapshot(ids), before)
        assert.deepEqual(snapshot(ids), before)
        assert.equal(before.holds.filter((h) => h.status === "ACTIVE").length, 1)
      } finally { writes.stop(); await p.unroute("**/api/v1/waitlist?**", route) }
    }, { linked: false })
  })

  await step("AT9e: Same-frame double confirm counts exactly one request and entity/group Visit", () => holdCase(async ({ p, ids, booking, entry }) => {
    const assigned = await api(otherDevice, "POST", `/bookings/${booking.id}/assign`, { version: booking.version, tableIds: [await tableIdOf(context, "A5"), await tableIdOf(context, "A6")] })
    assert.equal(assigned.status, 200)
    booking = assigned.body.booking
    await p.reload({ waitUntil: "networkidle" })
    const before = snapshot(ids)
    const detail = await openHeld(p)
    const writes = watchWrites(p)
    try {
      await detail.getByRole("button", { name: "Khách đã đến", exact: true }).click()
      const confirm = p.getByRole("alertdialog", { name: "Xác nhận khách đã đến" })
      assert.equal(writes.requests.length, 0)
      const checked = createdBy(p, `/bookings/${booking.id}/check-in`)
      await confirm.getByRole("button", { name: "Khách đã đến", exact: true }).evaluate((el) => { el.click(); el.click() })
      assert.equal((await checked).status(), 200)
      await expect(table(p, "A5")).toHaveAttribute("aria-label", /Có khách/)
      assert.equal(writes.requests.length, 1)
      assert.deepEqual(writes.requests[0], { path: `/api/v1/bookings/${booking.id}/check-in`, body: { version: booking.version } })
      const after = snapshot(ids)
      assert.equal(after.visits.length - before.visits.length, 1)
      assert.equal(after.bookings[0].status, "CHECKED_IN")
      assert.equal(after.entries.find((r) => r.id === entry.id).status, "SEATED")
      assert.equal(after.holds.filter((h) => h.status === "ACTIVE").length, 0)
      assert.equal(after.allocations.filter((a) => a.kind === "HOLD" && !a.released_at).length, 0)
      const usage = after.allocations.filter((a) => a.kind === "USAGE" && !a.released_at)
      assert.equal(usage.length, 2)
      assert(usage.every((a) => a.visit_id === after.visits[0].id && a.group_id && a.group_id === usage[0].group_id))
      assert.deepEqual(usage.map((a) => a.table_id).sort(), before.allocations.filter((a) => !a.released_at).map((a) => a.table_id).sort())
      const replay = await api(otherDevice, "POST", `/bookings/${booking.id}/check-in`, { version: booking.version })
      assert.equal(replay.status, 409)
      assert.equal(JSON.parse(replay.body).error.code, "VERSION_CONFLICT")
      const visit = await openHeld(p)
      await expect(visit.getByRole("button", { name: "Khách đã đến", exact: true })).toBeHidden()
      assert.deepEqual(snapshot(ids), after)
      fs.writeFileSync(`${output}/arrival-entities.json`, JSON.stringify({ before, after }, null, 2))
    } finally { writes.stop() }
  }))

  await step("AT13: Two authenticated sessions race the same held booking; one 200 and one 409", () => holdCase(async ({ ids, booking }) => {
    let requests = 0
    const checkin = (session) => { requests++; return api(session, "POST", `/bookings/${booking.id}/check-in`, { version: booking.version }) }
    const responses = await Promise.all([checkin(context), checkin(otherDevice)])
    assert.equal(requests, 2)
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
    assert.equal(JSON.parse(responses.find((r) => r.status === 409).body).error.code, "VERSION_CONFLICT")
    const after = snapshot(ids)
    assert.equal(after.visits.length, 1)
    assert.equal(after.entries[0].status, "SEATED")
    assert.equal(after.bookings[0].status, "CHECKED_IN")
  }))

  await step("AT13b: Desktop arrival keeps the confirmed version when another session changes the hold", () => holdCase(async ({ p, ids, booking }) => {
    await p.setViewportSize({ width: 768, height: 1024 })
    await p.reload({ waitUntil: "networkidle" })
    const detail = await openHeld(p, "A5", 768)
    await detail.getByRole("button", { name: "Khách đã đến", exact: true }).click()
    const confirm = p.getByRole("dialog", { name: /Xác nhận khách đã đến/ })
    const updated = await api(otherDevice, "POST", `/bookings/${booking.id}/assign`, { version: booking.version,
      tableIds: [await tableIdOf(context, "A5"), await tableIdOf(context, "A6")] })
    assert.equal(updated.status, 200, JSON.stringify(updated))
    const refreshed = p.waitForResponse(async (response) => {
      if (response.request().method() !== "GET" || !response.url().includes(`/bookings?date=${today}`)) return false
      const body = await response.json()
      return body.bookings?.some((r) => r.id === booking.id && r.version > booking.version)
    }, { timeout: 22_000 })
    await refreshed
    await expect(confirm).toContainText("A6", { timeout: 20_000 })
    const writes = watchWrites(p)
    try {
      const failed = createdBy(p, `/bookings/${booking.id}/check-in`)
      await confirm.getByRole("button", { name: "Khách đã đến", exact: true }).click()
      const response = await failed
      assert.equal(response.status(), 409)
      assert.equal((await response.json()).error.code, "VERSION_CONFLICT")
      assert.equal(response.request().postDataJSON().version, booking.version)
      await expect(p.getByRole("dialog", { name: /Dữ liệu vừa thay đổi/ }).or(p.getByRole("alertdialog", { name: /Dữ liệu vừa thay đổi/ }))).toBeVisible()
      assert.equal(writes.requests.length, 1)
      assert.equal(snapshot(ids).visits.length, 0)
    } finally { writes.stop() }
  }))

  await step("AT9f: Missing permission disables UI, sends zero writes and direct calls are exact 403", () => holdCase(async ({ p, ids, booking }) => {
    const before = snapshot(ids)
    try {
      fixture("revoke-permissions")
      await p.reload({ waitUntil: "networkidle" })
      const writes = watchWrites(p)
      try {
        const detail = await openHeld(p)
        for (const label of ["Khách đã đến", "Đổi / Ghép bàn"]) {
          const button = detail.getByRole("button", { name: label, exact: true })
          await expect(button).toBeDisabled()
          await button.evaluate((el) => el.click())
        }
        assert.deepEqual(writes.requests, [])
        for (const action of ["assign", "check-in"]) {
          const denied = await api(context, "POST", `/bookings/${booking.id}/${action}`, { version: booking.version, ...(action === "assign" ? { tableIds: [await tableIdOf(context, "A6")] } : {}) })
          assert.equal(denied.status, 403)
          assert.equal(JSON.parse(denied.body).error.code, "PERMISSION_DENIED")
        }
        assert.deepEqual(snapshot(ids), before)
      } finally { writes.stop() }
    } finally { fixture("restore-permissions") }
  }))

  await step("AT9g: External held assignment polls version and full target set before reload", () => holdCase(async ({ p, ids, booking }) => {
    const before = snapshot(ids)
    const detail = await openHeld(p)
    const writes = watchWrites(p)
    try {
      await detail.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
      const poll = p.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`/bookings?date=${today}`), { timeout: 22_000 })
      const moved = await api(otherDevice, "POST", `/bookings/${booking.id}/assign`, { version: booking.version, tableIds: [await tableIdOf(context, "A6")] })
      assert.equal(moved.status, 200)
      await poll
      await expect(p.getByRole("dialog", { name: "Chi tiết booking" }).getByText("A6", { exact: true })).toBeVisible({ timeout: 20_000 })
      assert.deepEqual(writes.requests, [])
      await p.reload({ waitUntil: "networkidle" })
      const refreshed = await openHeld(p, "A6")
      for (const label of labels) await expect(refreshed.getByRole("button", { name: label, exact: true })).toBeVisible()
      await refreshed.getByRole("button", { name: "Đổi / Ghép bàn", exact: true }).click()
      await expect(table(p, "A6")).toHaveAttribute("aria-pressed", "true")
      const after = snapshot(ids)
      assert(after.bookings[0].version > before.bookings[0].version)
      assert.equal(after.entries[0].status, "HOLD_ACTIVE")
      assert.equal(after.visits.length, 0)
    } finally { writes.stop() }
  }))

  await step("AT9h: Direct reservation actions and desktop detail picker stay unchanged", () => holdCase(async ({ p, booking }) => {
    let detail = await openHeld(p)
    for (const label of ["Khách đã đến", "Xem booking", "Đổi bàn", "Đổi trạng thái"]) await expect(detail.getByRole("button", { name: label, exact: true })).toBeVisible()
    await expect(detail.getByRole("button", { name: "Xem đơn chờ", exact: true })).toBeHidden()
    await p.setViewportSize({ width: 768, height: 1024 })
    await p.evaluate(async (id) => (await import("/src/state/ui.ts")).useUi.getState().openReservation(id, "2026-11-03"), booking.id)
    detail = p.getByRole("dialog").last()
    for (const label of ["Đổi bàn", "Sửa", "Hủy booking", "Không tới", "Check-in A5"]) await expect(detail.getByRole("button", { name: label, exact: true })).toBeVisible()
    await detail.getByRole("button", { name: "Đổi bàn", exact: true }).click()
    assert.deepEqual(await p.evaluate(async () => { const s = (await import("/src/state/ui.ts")).useUi.getState(); return { intent: s.pick.intent, preselected: s.pick.preselected, date: s.pick.targetDate } }), { intent: "assign", preselected: [await tableIdOf(context, "A5")], date: today })
  }, { linked: false }))

  await step("AT9i: Canonical HTTP 360/390/768 light/dark management and arrival screenshots", () => holdCase(async ({ p, ids, entry, date }) => {
    const before = snapshot(ids)
    for (const width of [360, 390, 768]) for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
      await p.evaluate(async (theme) => (await import("/src/state/session.ts")).useSession.getState().setTheme(theme), theme)
      const writes = watchWrites(p)
      try {
        const detail = await openHeld(p, "A5", width)
        for (const label of labels) await expect(detail.getByRole("button", { name: label, exact: true })).toBeVisible()
        await p.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/http-linked-floor-${width}-${theme}.png` })
        await detail.getByRole("button", { name: "Khách đã đến", exact: true }).click()
        const confirm = p.getByRole(width < 768 ? "alertdialog" : "dialog", { name: /Xác nhận khách đã đến/ })
        await expect(confirm).toContainText("A5")
        await expect(confirm).toContainText("2 khách")
        await p.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/http-linked-confirm-${width}-${theme}.png` })
        await confirm.getByRole("button", { name: "Quay lại", exact: true }).click()
        if (width < 768) await detail.getByRole("button", { name: "Đóng", exact: true }).click()
        else await p.getByRole("button", { name: "Ca tối nay", exact: true }).click()
        await p.getByRole("button", { name: /^Bàn chờ/ }).first().click()
        const card = width < 768 ? p.locator("div.rounded-\\[18px\\]").filter({ hasText: "Khách Hôm Nay" }) : p.locator(`#entry-${entry.id}`)
        await card.scrollIntoViewIfNeeded()
        await expect(card.getByRole("button", { name: "Quản lý đơn", exact: true })).toBeVisible()
        await p.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/http-linked-card-${width}-${theme}.png` })
        const currentUrl = p.url()
        await card.getByRole("button", { name: "Xem đơn chờ", exact: true }).click()
        const entryDetail = p.getByRole("dialog", { name: /Chi tiết mục chờ/ })
        await expect(entryDetail).toBeVisible()
        assert.equal(p.url(), currentUrl)
        if (width < 768) await closeDetail(p)
        else {
          await entryDetail.getByRole("button", { name: "Đóng", exact: true }).click()
          await expect(entryDetail).toBeHidden()
        }
        await p.keyboard.press("Escape")
        assert.deepEqual(writes.requests, [])
        await p.reload({ waitUntil: "networkidle" })
        await chooseDate(p, date)
      } finally { writes.stop() }
    }
    assert.deepEqual(snapshot(ids), before)
  }, { date: tomorrow }))

  await step("AT7: Desktop status submits cancel, late-confirm and no-show with exact IDs/version", async () => {
    for (const action of ["cancel", "late-confirm", "no-show"]) await holdCase(async ({ p, ids, booking }) => {
      if (action !== "cancel") fixture("set-booking-time", String(booking.id), `${today}T${action === "late-confirm" ? "11:50" : "11:00"}:00.000Z`)
      await p.setViewportSize({ width: 768, height: 1024 })
      await p.reload({ waitUntil: "networkidle" })
      const detail = await openHeld(p, "A5", 768)
      const writes = watchWrites(p)
      try {
        await detail.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
        const status = p.getByRole("dialog", { name: "Đổi trạng thái booking" })
        if (action === "cancel") {
          await expect(status.getByRole("button", { name: "Tới muộn", exact: true })).toBeDisabled()
          await expect(status.getByRole("button", { name: "Không tới", exact: true })).toBeDisabled()
        }
        assert.equal(writes.requests.length, 0)
        const sent = createdBy(p, `/bookings/${booking.id}/${action}`)
        await status.getByRole("button", { name: action === "cancel" ? "Hủy booking" : action === "no-show" ? "Không tới" : "Tới muộn", exact: true }).click()
        if (action !== "late-confirm") await p.getByRole("alertdialog").getByRole("button", { name: action === "cancel" ? "Hủy booking" : "Xác nhận không tới", exact: true }).click()
        const response = await sent
        assert.equal(response.status(), 200)
        assert.equal(response.request().postDataJSON().version, booking.version)
        assert.equal(writes.requests.length, 1)
        const after = snapshot(ids)
        assert.equal(after.visits.length, 0)
        assert.equal(after.bookings[0].status, action === "cancel" ? "CANCELLED" : action === "no-show" ? "NO_SHOW" : "BOOKED")
        assert.equal(after.entries[0].status, action === "late-confirm" ? "HOLD_ACTIVE" : "CANCELLED")
        assert.equal(after.allocations.filter((a) => a.kind === "HOLD" && !a.released_at).length, action === "late-confirm" ? 1 : 0)
      } finally { writes.stop() }
    })
  })

  await step("F12: Scoped case cleanup preserves a same-name different-day sentinel", () => holdCase(async ({ ids }) => {
    const sentinelBefore = snapshot(ids)
    await holdCase(async ({ ids: otherIds }) => {
      cleanupCase(otherIds)
      const empty = snapshot(otherIds)
      for (const rows of Object.values(empty)) assert.equal(rows.length, 0)
      assert.deepEqual(snapshot(ids), sentinelBefore)
    }, { date: tomorrow })
    assert.deepEqual(snapshot(ids), sentinelBefore)
  }))

  await step("F10: Selected-day calendar bug recorded separately; other day and year boundary close", async () => {
    const p = await context.newPage()
    try {
      await p.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
      const button = p.getByRole("button", { name: "Chọn ngày kinh doanh" }).first()
      await button.click()
      await p.locator('[data-selected="true"][data-day]').click()
      await expect(p.locator('[data-slot="popover-content"]')).toBeVisible()
      console.log("OPEN CALENDAR-SELECTED-DAY: selecting the current day keeps the popup open; separate task, unchanged")
      await p.locator('[data-day="11/4/2026"]').click()
      await expect(p.locator('[data-slot="popover-content"]')).toBeHidden()
      await chooseDate(p, "2026-12-31")
      await expect(button).toContainText("31/12")
      await chooseDate(p, "2027-01-01")
      await expect(button).toContainText("01/01")
      await expect(p.locator('[data-slot="popover-content"]')).toBeHidden()
    } finally { await p.close() }
  })

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
