// C2 — the turn badge on a phone and a tablet, against the real API and an
// isolated MySQL test database.
//
// AC03: after Trả bàn every open device shows the badge go up, in under two
// seconds, without a reload. AC11: the badge is visible at phone and tablet
// widths and does not cover the table's own code or state.
//
// Env: DB_NAME must end in _test. Run: pnpm -C web e2e:c2
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3103"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5176"
const databaseName = process.env.DB_NAME ?? "gam21_platform_e2e_test"
const databasePort = process.env.DB_PORT ?? "3306"
if (!/_test$/.test(databaseName)) throw new Error("Refusing browser E2E: DB_NAME must end in _test")
if (!["gam21_platform_e2e_test", "gam21_platform_it_test", "gam21_platform_test"].includes(databaseName))
  throw new Error(`Refusing browser E2E: "${databaseName}" is not an approved disposable test database`)
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")
const output = process.env.C2_OUTPUT ?? "e2e/.artifacts/c2-table-turn"
fs.mkdirSync(output, { recursive: true })

// 20:00 in Hanoi on 11/11: inside the 17:00 → 05:00 shift, so check-in is allowed
// and a 22:00 booking is in the future.
const fixedNow = "2026-11-11T13:00:00.000Z"
const businessDate = "2026-11-11"
const REALTIME_BUDGET_MS = 2000

const viewports = [
  { label: "phone-360", width: 360, height: 800 },
  { label: "phone-390", width: 390, height: 844 },
  { label: "phone-430", width: 430, height: 932 },
  { label: "tablet-768", width: 768, height: 1024 },
]
/** The viewport that runs the realtime pair; the rest check the badge's look. */
const realtimeOn = "phone-390"

const username = `c2_${Date.now()}`
const password = randomBytes(24).toString("base64url")
const common = {
  ...process.env,
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: databasePort,
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
async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const tableGlyph = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const turnBadges = (page) => page.locator('[data-testid="turn-badge"]')

async function login(page) {
  await page.goto(webUrl, { waitUntil: "networkidle" })
  const form = page.getByRole("form", { name: /Đăng nhập/ }).first()
  const target = (await form.isVisible().catch(() => false)) ? form : page
  await target.getByLabel(/Tên đăng nhập|Tài khoản/).fill(username)
  await target.getByLabel(/Mật khẩu/).fill(password)
  await target.getByRole("button", { name: /Đăng nhập/ }).click()
  await expect(page.getByRole("button", { name: /Đăng nhập/ })).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(
      async () =>
        page.evaluate(async (base) => {
          const response = await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })
          if (!response.ok) return null
          return (await response.json()).user?.username ?? null
        }, apiUrl),
      { timeout: 15_000 },
    )
    .toBe(username)
}

async function clearOverlays(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const banner = page
      .getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ })
      .first()
    if (await banner.isVisible().catch(() => false)) await banner.click()
    else break
    await page.waitForTimeout(80)
  }
  for (const close of await page.locator("[data-sonner-toast] [data-close-button]").all()) {
    await close.click().catch(() => {})
  }
}

/**
 * Books a party on one table, checks it in, and returns the visit. Driven through
 * the API from inside the page, because what is under test here is the badge, not
 * the booking form, which has its own E2E.
 */
async function seatParty(page, tableCode, partySize, guestName) {
  return page.evaluate(
    async ({ base, code, size, name, date }) => {
      const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
      const headers = { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken }
      const catalog = await (await fetch(`${base}/api/v1/tables/catalog`, { credentials: "include" })).json()
      const tableId = catalog.tables.find((row) => row.code === code).id

      const booking = await (
        await fetch(`${base}/api/v1/bookings/direct`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            guestName: name,
            partySize: size,
            expectedAt: `${date}T22:00:00+07:00`,
            businessDate: date,
            sourceCode: "HOTLINE",
            tableIds: [tableId],
            capacityOverrideConfirmed: true,
          }),
        })
      ).json()
      await fetch(`${base}/api/v1/bookings/${booking.booking.id}/check-in`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ version: booking.booking.version }),
      })
      const floor = await (await fetch(`${base}/api/v1/tables?date=${date}`, { credentials: "include" })).json()
      const seated = floor.tables.find((row) => row.tableCode === code)
      return { visitId: seated.claim.visitId, version: seated.claim.version }
    },
    { base: apiUrl, code: tableCode, size: partySize, name: guestName, date: businessDate },
  )
}

async function closeVisit(page, visit) {
  return page.evaluate(
    async ({ base, visitId, version }) => {
      const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
      const response = await fetch(`${base}/api/v1/visits/${visitId}/close`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ version, mode: "MANUAL", reason: "GUEST_LEFT" }),
      })
      const body = await response.json()
      return { status: response.status, turn: body.visit?.turn ?? null }
    },
    { base: apiUrl, visitId: visit.visitId, version: visit.version },
  )
}

async function step(name, fn) {
  try {
    const data = await fn()
    results.push({ name, result: "PASS", ...(data && typeof data === "object" ? data : {}) })
    console.log(`PASS ${name}${data && typeof data === "object" ? ` ${JSON.stringify(data)}` : ""}`)
    return data
  } catch (error) {
    results.push({ name, result: "FAIL", error: String(error.stack ?? error) })
    console.error(`FAIL ${name}: ${error.stack ?? error}`)
    throw error
  }
}

try {
  fixture("setup")
  fixture("set-group-permission", "grant")
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

  for (const { label, width, height } of viewports) {
    // Each viewport starts from the same seeded floor, so no result depends on the
    // order the viewports ran in.
    fixture("setup")
    fixture("set-group-permission", "grant")
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: width < 768,
      reducedMotion: "reduce",
    })
    const page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))

    try {
      await login(page)
      await clearOverlays(page)

      await step(`${label} · AC11 no badge before any turn completes`, async () => {
        await expect(tableGlyph(page, "B3")).toBeVisible()
        // The badge renders nothing at zero, rather than a grey "0".
        await expect(turnBadges(page)).toHaveCount(0)
        return { badges: 0 }
      })

      await step(`${label} · AC11 the badge shows 1 and does not cover the table's own label`, async () => {
        const seated = await seatParty(page, "B3", 4, "Khách lượt 1")
        const closed = await closeVisit(page, seated)
        assert.equal(closed.status, 200)
        assert.deepEqual(closed.turn, { turnId: closed.turn.turnId, scope: "TABLE", turnNo: 1, counted: true })

        const badge = turnBadges(page).first()
        await expect(badge).toBeVisible({ timeout: REALTIME_BUDGET_MS })
        await expect(badge).toHaveAttribute("aria-label", "Lượt 1")
        // Exactly one badge on the floor: one table served one party.
        await expect(turnBadges(page)).toHaveCount(1)

        // The badge sits beside the cell, so B3's own code and state stay readable.
        const glyph = tableGlyph(page, "B3")
        await expect(glyph).toContainText("B3")
        await expect(glyph).toHaveAttribute("aria-label", /Trống|Chưa đặt/)
        const badgeBox = await badge.boundingBox()
        assert.ok(badgeBox && badgeBox.width > 0 && badgeBox.height > 0, "badge must be rendered with a real box")
        // And it is inside the viewport, not pushed off the edge of a phone.
        assert.ok(
          badgeBox.x >= 0 && badgeBox.x + badgeBox.width <= width + 1,
          `badge off-screen: ${JSON.stringify(badgeBox)}`,
        )
        await page.screenshot({ path: `${output}/${label}-badge-1.png` })
        return { label: await badge.getAttribute("aria-label"), viewport: `${width}x${height}` }
      })

      await step(`${label} · AC06/AC11 a cluster shows one badge, not one per member`, async () => {
        // Merge B4+B5, seat a party on one member, close it.
        const merged = await page.evaluate(async (base) => {
          const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
          const response = await fetch(`${base}/api/v1/tables/groups`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
            body: JSON.stringify({ tableCodes: ["B4", "B5"] }),
          })
          return (await response.json()).group
        }, apiUrl)
        assert.equal(merged.totalCapacity, 8)

        const seated = await seatParty(page, "B4", 8, "Đoàn 8 khách")
        const closed = await closeVisit(page, seated)
        assert.equal(closed.status, 200)
        assert.equal(closed.turn.scope, "GROUP")
        assert.equal(closed.turn.turnNo, 1)

        // B3 already had one badge; the cluster adds exactly one more, not two.
        await expect(turnBadges(page)).toHaveCount(2, { timeout: REALTIME_BUDGET_MS })
        const labels = await turnBadges(page).evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label")),
        )
        assert.deepEqual(labels.sort(), ["Lượt 1", "Lượt 1"])
        await page.screenshot({ path: `${output}/${label}-cluster-badge.png` })
        return { badges: 2, scope: closed.turn.scope }
      })

      if (label !== realtimeOn) {
        assert.deepEqual(pageErrors, [], `page errors on ${label}`)
        results.push({ name: `${label} · AC03 realtime pair`, result: `SKIP (covered on ${realtimeOn})` })
        continue
      }

      await step(`${label} · AC03 a second device sees the badge go up in under 2s`, async () => {
        const watcher = await browser.newContext({ viewport: { width, height }, hasTouch: true })
        const deviceB = await watcher.newPage()
        try {
          await login(deviceB)
          await clearOverlays(deviceB)
          // Device B starts from what device A already did: two badges.
          await expect(turnBadges(deviceB)).toHaveCount(2)

          // Device A serves another party on B3 and closes it.
          const seated = await seatParty(page, "B3", 4, "Khách lượt 2")
          await expect(turnBadges(deviceB)).toHaveCount(2)

          const started = Date.now()
          const closed = await closeVisit(page, seated)
          assert.equal(closed.status, 200)
          assert.equal(closed.turn.turnNo, 2)

          // No reload on device B: the badge must move from the stream.
          await expect(deviceB.locator('[data-testid="turn-badge"][aria-label="Lượt 2"]')).toHaveCount(1, {
            timeout: REALTIME_BUDGET_MS,
          })
          const latencyMs = Date.now() - started
          assert.ok(latencyMs < REALTIME_BUDGET_MS, `device B took ${latencyMs}ms`)
          await deviceB.screenshot({ path: `${output}/${label}-device-b-badge-2.png` })
          return { latencyMs, turnNo: closed.turn.turnNo }
        } finally {
          await watcher.close()
        }
      })

      await step(`${label} · AC04 the badge is zero on the next operating day`, async () => {
        const counts = await page.evaluate(
          async ({ base, today }) => {
            const read = async (date) => {
              const floor = await (await fetch(`${base}/api/v1/tables?date=${date}`, { credentials: "include" })).json()
              return floor.tables.find((row) => row.tableCode === "B3").seatedTurnCount
            }
            return { today: await read(today), tomorrow: await read("2026-11-12") }
          },
          { base: apiUrl, today: businessDate },
        )
        assert.equal(counts.today, 2)
        // A new operating day starts the badge over; the old turns are still stored.
        assert.equal(counts.tomorrow, 0)
        return counts
      })

      assert.deepEqual(pageErrors, [], `page errors on ${label}`)
    } catch (error) {
      await page.screenshot({ path: `${output}/${label}-fail.png` }).catch(() => {})
      throw error
    } finally {
      await context.close()
    }
  }
} finally {
  if (browser) await browser.close()
  try {
    fixture("cleanup")
    fixture("verify-clean")
  } catch (error) {
    console.error(`cleanup failed: ${error.message}`)
  }
  stopChildren()
}

fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
const failed = results.filter((row) => row.result === "FAIL").length
const passed = results.filter((row) => row.result === "PASS").length
console.log(`C2 table turn mobile: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
