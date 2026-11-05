import { chromium, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3117"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5192"
const database = process.env.DB_NAME ?? "gam21_platform_test"
if (!/_test$/.test(database)) throw new Error("NA-11 HTTP E2E requires an isolated *_test database")
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error("Run through pnpm exec node")
const fixedNow = "2026-11-03T12:00:00.000Z"
const today = "2026-11-03"
const tomorrow = "2026-11-04"
const username = `na11_${Date.now()}`
const password = randomBytes(24).toString("base64url")
const common = {
  ...process.env,
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: process.env.DB_PORT ?? "33317",
  DB_NAME: database,
  DB_USER: process.env.DB_USER ?? "gam21",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "gam21_test",
  ORGANIZATION_ID: "1",
  VENUE_ID: "1",
  NO_SHOW_WORKER_ENABLED: "false",
  BUSINESS_DAY_WORKER_ENABLED: "false",
  E2E_FIXED_NOW: fixedNow,
  E2E_USERNAME: username,
  E2E_PASSWORD: password,
}
const output = new URL(".artifacts/na11/http/", import.meta.url)
await mkdir(output, { recursive: true })
const children = []
const results = []
let browser
let activePage
function run(args) {
  const result = spawnSync(process.execPath, [pnpm, ...args], {
    cwd: root,
    env: common,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}
function start(args, env) {
  const child = spawn(process.execPath, [pnpm, ...args], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  child.stdout.on("data", (data) => {
    log += data
  })
  child.stderr.on("data", (data) => {
    log += data
  })
  children.push({ child, log: () => log })
}
async function ready(url) {
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Server not ready: ${url}`)
}
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const bookingForm = (page) =>
  page
    .getByRole("dialog", { name: /Tạo đặt bàn|Tạo đơn đặt bàn/ })
    .or(page.getByRole("form", { name: /Tạo đặt bàn|Tạo đơn đặt bàn/ }))
    .last()
async function login(page) {
  await page.goto(webUrl, { waitUntil: "networkidle" })
  if (
    await page
      .getByLabel("Tên đăng nhập")
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByLabel("Tên đăng nhập").fill(username)
    await page.getByLabel("Mật khẩu").fill(password)
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  }
  await table(page, "A1").waitFor()
}
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
async function closeDialog(page) {
  const dialog = page.getByRole("dialog").last()
  const close = dialog.getByRole("button", { name: /^(Đóng|Close|Quay lại)$/ }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  else await page.keyboard.press("Escape")
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
try {
  run(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "setup"])
  start(["--filter", "@21gam/api", "exec", "tsx", "src/server.ts"], {
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
  start(
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
  await Promise.all([ready(`${apiUrl}/api/v1/health`), ready(webUrl)])
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: "en-US" })
  const page = await context.newPage()
  activePage = page
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await login(page)
  await jsonRequest(context, "POST", "/waitlist", {
    kind: "WALK_IN",
    guestName: "NA11 waiting guest",
    partySize: 2,
    businessDate: today,
    contactChannel: "IN_PERSON",
  })

  for (const [width, height] of [
    [360, 800],
    [375, 812],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, "A1").waitFor()
    await expect(page.getByRole("button", { name: "Tạo mới", exact: true })).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: /Điều hướng.*(mobile|di động)/i })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Đặt bàn", exact: true })).toHaveCount(0)
    const dateBox = await calendar(page).boundingBox()
    const searchBox = await page.getByRole("textbox", { name: "Tìm 3 số cuối SĐT" }).boundingBox()
    const countBox = await page.getByRole("button", { name: "Đếm khách", exact: true }).boundingBox()
    const bellBox = await page
      .getByRole("button", { name: /Thông báo/ })
      .first()
      .boundingBox()
    if (
      !dateBox ||
      !searchBox ||
      !countBox ||
      !bellBox ||
      Math.abs(dateBox.y + dateBox.height / 2 - searchBox.y - searchBox.height / 2) > 1 ||
      Math.abs(dateBox.y + dateBox.height / 2 - countBox.y - countBox.height / 2) > 1 ||
      dateBox.x < searchBox.x + searchBox.width ||
      countBox.x < dateBox.x + dateBox.width ||
      dateBox.x - searchBox.x - searchBox.width > 16 ||
      countBox.x - dateBox.x - dateBox.width > 16 ||
      bellBox.y + bellBox.height > dateBox.y
    )
      throw new Error(`Search, calendar and guest count must share the toolbar below alerts at ${width}`)
    await expect(page.getByRole("group", { name: "Điều khiển thu phóng" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Phóng to|Thu nhỏ/ })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Chú giải trạng thái bàn", exact: true })).toHaveCount(1)
    await expect(calendar(page).locator("../..").getByRole("button", { name: /Bàn chờ/ })).toHaveCount(0)
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error(`Overflow at ${width}`)
    await page.locator('svg button[aria-label^="Bàn chờ"]').click()
    await expect(page.getByRole("dialog", { name: "Bàn chờ ảo", exact: true })).toBeVisible()
    await expect(page.getByText("NA11 waiting guest", { exact: true }).first()).toBeVisible()
    await closeDialog(page)
    await page.getByRole("button", { name: "Đếm khách", exact: true }).click()
    await expect(page.getByLabel("Nội dung text booking")).toHaveValue(/THỐNG KÊ/)
    await closeDialog(page)
    await table(page, "A1").tap()
    const form = bookingForm(page)
    await expect(form).toContainText("A1")
    await expect(form.getByText(/Đặt trước|Đặt bàn/).first()).toBeVisible()
    await page.screenshot({
      path: fileURLToPath(new URL(`${width}x${height}-form.png`, output)),
      animations: "disabled",
    })
    await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
    await table(page, "A10").focus()
    await table(page, "A10").press("Enter")
    await expect(bookingForm(page)).toHaveCount(0)
    await page.keyboard.press("Escape")
    await table(page, "A3").focus()
    await table(page, "A3").press("Enter")
    await expect(bookingForm(page)).toHaveCount(0)
    results.push({
      check: "responsive single floor / overlays / valid table binding / spare-oos guards",
      viewport: `${width}x${height}`,
      result: "PASS",
    })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${webUrl}/floor`, { waitUntil: "networkidle" })
  const dateRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tables" &&
      new URL(response.url()).searchParams.get("date") === tomorrow,
  )
  await chooseDate(page, tomorrow)
  await dateRead
  await table(page, "A1").tap()
  const form = bookingForm(page)
  const name = "NA11 mobile booking"
  await form.getByLabel("Tên khách", { exact: true }).fill(name)
  await form.getByLabel("Số điện thoại", { exact: true }).fill("0987654789")
  await form.getByRole("radio", { name: /^21:00/ }).click()
  const birthday = form.getByRole("checkbox", { name: "Sinh nhật", exact: true })
  const metadataEnabled = (await birthday.count()) > 0
  if (process.env.NA11_REQUIRE_NA14 === "1" && !metadataEnabled)
    throw new Error("NA-14 metadata controls missing in combined build")
  if (metadataEnabled) {
    await birthday.check()
    await form.getByLabel("Loại khách").click()
    await page.getByRole("option", { name: "Khách quen (O)" }).click()
  }
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /^\/api\/v1\/bookings(?:\/direct)?$/.test(new URL(response.url()).pathname),
  )
  await form.getByRole("button", { name: /^(Đặt bàn|Xác nhận đặt bàn)$/ }).click()
  const createdResponse = await creation
  expect(new URL(createdResponse.url()).pathname).toBe("/api/v1/bookings/direct")
  expect(createdResponse.status()).toBe(201)
  const { booking: created } = await createdResponse.json()
  expect(created.businessDate).toBe(tomorrow)
  expect(created.tableCodes).toEqual(["A1"])
  if (metadataEnabled) expect(created).toMatchObject({ guestType: "REGULAR", isBirthday: true, lateConfirmedAt: null })
  await expect(form).toBeHidden()
  expect(new URL(page.url()).pathname).toBe("/floor")
  await expect(table(page, "A1")).toHaveAttribute("aria-label", /Đã đặt|Đang đặt/)
  await jsonRequest(context, "POST", "/bookings/direct", {
    guestName: "NA11 duplicate suffix",
    partySize: 2,
    expectedAt: `${tomorrow}T21:30:00+07:00`,
    businessDate: tomorrow,
    sourceCode: "HOTLINE",
    phoneNumber: "0901234789",
    tableIds: [9502],
  })
  const search = page.getByRole("textbox", { name: /3 số cuối/ })
  const searches = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/bookings/search")
      searches.push(new URL(request.url()).searchParams.get("q"))
  })
  await search.fill("78")
  expect(searches).toEqual([])
  const searchRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/bookings/search")
  await search.fill("789")
  const searched = await (await searchRead).json()
  expect(searched.bookings).toHaveLength(2)
  await expect(table(page, "A1")).toHaveAttribute("aria-pressed", "true")
  await expect(table(page, "A2")).toHaveAttribute("aria-pressed", "true")
  expect(searches.every((q) => /^\d{3}$/.test(q))).toBe(true)
  expect(await page.locator("body").innerText()).not.toContain("0987654789")
  await search.fill("7899")
  expect((await search.inputValue()).length).toBeLessThanOrEqual(3)
  await search.fill("")
  await page
    .getByRole("button", { name: /Bàn chờ/ })
    .first()
    .click()
  await expect(page.getByText("NA11 waiting guest", { exact: true })).toHaveCount(0)
  await closeDialog(page)
  results.push({
    check: "future business date, direct booking, real duplicate last3 search, no cross-day waitlist placeholder",
    result: "PASS",
  })

  // A second browser must observe an external reservation edit through the existing poll.
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" })
  const second = await secondContext.newPage()
  await login(second)
  const secondRead = second.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tables" &&
      new URL(response.url()).searchParams.get("date") === tomorrow,
  )
  await chooseDate(second, tomorrow)
  const secondInitial = await (await secondRead).json()
  expect(secondInitial.tables.find((row) => row.id === 9501)?.claim?.guestName).toBe(name)
  const externalPoll = second.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tables" &&
      new URL(response.url()).searchParams.get("date") === tomorrow,
  )
  await jsonRequest(context, "PUT", `/bookings/${created.id}`, {
    guestName: "NA11 edited from other client",
    partySize: 3,
    expectedAt: created.expectedAt,
    businessDate: tomorrow,
    sourceCode: "HOTLINE",
    version: created.version,
  })
  const externalPayload = await (await externalPoll).json()
  expect(externalPayload.tables.find((row) => row.id === 9501)?.claim?.guestName).toBe("NA11 edited from other client")
  await expect(table(second, "A1")).toHaveAttribute("aria-label", /NA11 edited from other client/, { timeout: 20_000 })
  await secondContext.close()
  const read = await jsonRequest(context, "GET", `/bookings/${created.id}`)
  if (metadataEnabled)
    expect(read.booking).toMatchObject({ guestType: "REGULAR", isBirthday: true, lateConfirmedAt: null })
  expect(JSON.stringify(read)).not.toMatch(/phoneNumber|ciphertext|hmac/i)
  expect(errors).toEqual([])
  results.push({ check: "two browser polling / cache invalidation / masked phone contract", result: "PASS" })

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height })
    await chooseDate(page, "2026-11-15")
    await expect(calendar(page)).toContainText("15/11")
    // Existing API intentionally keeps unreleased earlier holds occupied; use a never-allocated table.
    await table(page, "A4").tap()
    const futureForm = bookingForm(page)
    await expect(futureForm).toContainText("15/11")
    if (await futureForm.evaluate((node) => node.scrollWidth > node.clientWidth + 1))
      throw new Error(`Far-future form overflow at ${width}`)
    await futureForm
      .getByRole("button", { name: /^(Quay lại|Hủy)$/ })
      .first()
      .click()
    await expect(calendar(page)).toContainText("15/11")
  }
  results.push({
    check: "calendar date more than seven days ahead survives mobile/tablet form and overlay close",
    result: "PASS",
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await table(page, "B3").focus()
  await table(page, "B3").press("Enter")
  const desktopDraft = bookingForm(page)
  await desktopDraft.getByLabel("Tên khách", { exact: true }).fill("NA11 preserved draft")
  await expect(table(page, "B4")).toHaveAttribute("aria-disabled", "false")
  await table(page, "B4").focus()
  await table(page, "B4").press("Enter")
  await expect(desktopDraft.getByRole("button", { name: "Bỏ B3", exact: true })).toBeVisible()
  await expect(desktopDraft.getByRole("button", { name: "Bỏ B4", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(desktopDraft).toBeVisible()
  await expect(desktopDraft.getByLabel("Tên khách", { exact: true })).toHaveValue("NA11 preserved draft")
  await desktopDraft.getByRole("button", { name: "Hủy", exact: true }).click()
  results.push({
    check: "desktop map multi-selection and Escape retain draft fields until explicit cancel",
    result: "PASS",
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await chooseDate(page, today)
  await jsonRequest(context, "POST", "/bookings/direct", {
    guestName: "NA11 arrival",
    partySize: 2,
    expectedAt: `${today}T21:00:00+07:00`,
    businessDate: today,
    sourceCode: "HOTLINE",
    tableIds: [9505],
  })
  await expect(table(page, "A4")).toHaveAttribute("aria-label", /Đã đặt|Đang đặt/, { timeout: 20_000 })
  await table(page, "A4").tap()
  await page.getByRole("button", { name: "Khách đã đến", exact: true }).click()
  await expect(table(page, "A4")).toHaveAttribute("aria-label", /Có khách,.*2 khách(?:,|$)/)
  await expect(table(page, "A4").locator("text")).toContainText(["A4", "2 khách"])
  await expect(table(page, "A4")).not.toContainText(/\d+\s*(?:phút|giờ|['’′])/)
  await page.keyboard.press("Escape")
  await table(page, "B3").tap()
  const walkForm = bookingForm(page)
  await walkForm.getByRole("tab", { name: "Walk-in", exact: true }).click()
  await walkForm.getByLabel("Tên khách", { exact: true }).fill("NA11 walk-in")
  await walkForm.getByRole("button", { name: /^Mở bàn B3$/ }).click()
  await expect(table(page, "B3")).toHaveAttribute("aria-label", /Có khách,.*4 khách(?:,|$)/)
  await expect(table(page, "B3").locator("text")).toContainText(["B3", "4 khách"])
  await expect(table(page, "B3")).not.toContainText(/\d+\s*(?:phút|giờ|['’′])/)
  await table(page, "B3").tap()
  await page.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await table(page, "B4").focus()
  await table(page, "B4").press("Enter")
  await page.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await expect(table(page, "B4")).toHaveAttribute("aria-label", /NA11 walk-in/)
  await table(page, "B4").focus()
  await table(page, "B4").press("Enter")
  await page.getByRole("button", { name: "Ghép bàn", exact: true }).click()
  await table(page, "B3").tap()
  await page.getByRole("button", { name: "Ghép bàn", exact: true }).click()
  await expect(table(page, "B3")).toHaveAttribute("aria-label", /nhóm G\d{2,}, 2 bàn/)
  const groupCode = (await table(page, "B3").getAttribute("aria-label")).match(/nhóm (G\d{2,})/)[1]
  await expect(table(page, "B4")).toHaveAttribute("aria-label", new RegExp(`nhóm ${groupCode}, 2 bàn`))
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Đếm khách", exact: true }).click()
  const guestCountText = page.getByLabel("Nội dung text booking")
  await expect(guestCountText).toHaveValue(/Tổng khách đặt: 2(?:\r?\n|$)/)
  await expect(guestCountText).toHaveValue(/Tổng khách đã đến: 2(?:\r?\n|$)/)
  await expect(guestCountText).not.toHaveValue(/NA11 walk-in/)
  await closeDialog(page)
  results.push({
    check: "real receptionist check-in / walk-in / move / merge through existing map actions",
    result: "PASS",
  })

  const auth = await (await context.request.get(`${apiUrl}/api/v1/auth/me`)).json()
  const headers = { Origin: webUrl, "X-CSRF-Token": auth.csrfToken }
  const raceBody = {
    guestName: "NA11 race",
    partySize: 1,
    expectedAt: `${today}T22:00:00+07:00`,
    businessDate: today,
    sourceCode: "HOTLINE",
    tableIds: [9508],
  }
  const race = await Promise.all(
    [1, 2].map((i) =>
      context.request.post(`${apiUrl}/api/v1/bookings/direct`, {
        headers,
        data: { ...raceBody, guestName: `${raceBody.guestName} ${i}` },
      }),
    ),
  )
  expect(race.map((response) => response.status()).sort()).toEqual([201, 409])
  const reveal = await context.request.post(`${apiUrl}/api/v1/bookings/${created.id}/phone:reveal`, {
    headers,
    data: {},
  })
  expect(reveal.status()).toBe(403)
  const capacity = await context.request.post(`${apiUrl}/api/v1/bookings/direct`, {
    headers,
    data: { ...raceBody, partySize: 5, tableIds: [9505] },
  })
  expect(capacity.status()).toBe(409)
  expect((await capacity.json()).error.code).toBe("INSUFFICIENT_TABLE_CAPACITY")
  for (const path of ["/reservations", "/waitlist", "/reports"]) {
    await page.goto(`${webUrl}${path}`, { waitUntil: "networkidle" })
    expect(new URL(page.url()).pathname).toBe("/floor")
  }
  results.push({
    check: "concurrent allocation protection / capacity / forbidden phone reveal / receptionist legacy route redirects",
    result: "PASS",
  })
  expect(errors).toEqual([])
  console.log(JSON.stringify({ checks: results, errors }))
} catch (error) {
  results.push({ result: "FAIL", message: String(error) })
  if (activePage)
    await activePage
      .screenshot({ path: fileURLToPath(new URL("failure.png", output)), animations: "disabled" })
      .catch(() => {})
  throw error
} finally {
  await writeFile(new URL("results.json", output), JSON.stringify(results, null, 2))
  if (browser) await browser.close()
  for (const { child, log } of children.reverse()) {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    await writeFile(new URL(`server-${child.pid}.log`, output), log())
  }
  run(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "cleanup"])
  console.log(run(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-clean"]))
}
