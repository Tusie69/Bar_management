// C1 — cụm bàn on a phone and a tablet, against the real API and an isolated MySQL test database.
//
// What this covers that the unit tests cannot: that a receptionist can actually
// reach merge and split with a thumb on a 360px screen, that every control is big
// enough to hit, that the page does not scroll sideways, and that a second device
// sees a merge or a split in under two seconds without a reload.
//
// Env: DB_NAME must end in _test. Run: pnpm -C web e2e:c1
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const apiUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3102"
const webUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175"
const databaseName = process.env.DB_NAME ?? "gam21_platform_e2e_test"
const databasePort = process.env.DB_PORT ?? "3306"
if (!/_test$/.test(databaseName)) throw new Error("Refusing browser E2E: DB_NAME must end in _test")
if (!["gam21_platform_e2e_test", "gam21_platform_it_test", "gam21_platform_test"].includes(databaseName))
  throw new Error(`Refusing browser E2E: "${databaseName}" is not an approved disposable test database`)
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")
const output = process.env.C1_OUTPUT ?? "e2e/.artifacts/c1-table-group"
fs.mkdirSync(output, { recursive: true })

// 20:00 in Hanoi on 11/11, inside the business day so the floor is the live one
// and a 22:00 booking is neither in the past nor on another business date.
const fixedNow = "2026-11-11T13:00:00.000Z"
const businessDate = "2026-11-11"

/** Phones first, then tablets: the order the acceptance criteria name them. */
const viewports = [
  { label: "phone-360", width: 360, height: 800 },
  { label: "phone-390", width: 390, height: 844 },
  { label: "phone-430", width: 430, height: 932 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "tablet-1024", width: 1024, height: 1366 },
]
/** The two that run the whole flow; the rest check reach, size and layout. */
const fullFlow = new Set(["phone-390", "tablet-768"])
const MIN_TOUCH_PX = 44
const REALTIME_BUDGET_MS = 2000

const username = `c1_${Date.now()}`
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

/* ---------------- page helpers ---------------- */

const tableGlyph = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const mergeRegion = (page) => page.getByRole("region", { name: "Chế độ ghép bàn" })
const layoutActions = (page) => page.locator('[aria-label="Thao tác mặt bằng"]')

async function login(page) {
  await page.goto(webUrl, { waitUntil: "networkidle" })
  const form = page.getByRole("form", { name: /Đăng nhập/ }).first()
  const target = (await form.isVisible().catch(() => false)) ? form : page
  await target.getByLabel(/Tên đăng nhập|Tài khoản/).fill(username)
  await target.getByLabel(/Mật khẩu/).fill(password)
  await target.getByRole("button", { name: /Đăng nhập/ }).click()
  await expect(page.getByRole("button", { name: /Đăng nhập/ })).toHaveCount(0, { timeout: 20_000 })
  // The login form disappearing is not proof of a session: assert the API agrees,
  // otherwise a later fetch from the page fails with 401 far from the cause.
  await expect
    .poll(
      async () =>
        page.evaluate(async (base) => {
          const response = await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })
          if (!response.ok) return null
          const body = await response.json()
          return body.user?.username ?? null
        }, apiUrl),
      { timeout: 15_000 },
    )
    .toBe(username)
}

/** Closes whatever banner or toast is covering the floor, without asserting any. */
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
 * Opens a table's detail and waits for its layout actions. On the desktop layout a
 * second tap on an already-selected table deselects it, so this retries once
 * instead of assuming which state the previous step left behind.
 */
async function openTableDetail(page, code) {
  const actions = layoutActions(page).getByRole("button", { name: /^(Ghép bàn|Tách bàn)$/ })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      await actions
        .first()
        .isVisible()
        .catch(() => false)
    )
      return actions
    await tableGlyph(page, code).click()
    await page.waitForTimeout(150)
  }
  await expect(actions.first()).toBeVisible()
  return actions
}

/** Closes the table sheet on a phone, or the desktop detail panel. */
async function closeDetail(page, width) {
  const close = page.getByRole("button", { name: "Đóng", exact: true })
  if (await close.isVisible().catch(() => false)) {
    await close.click()
    return
  }
  if (width >= 768) await page.keyboard.press("Escape")
}

/**
 * Every control a thumb has to hit must be at least 44px on its short side.
 * Measured from the rendered box, not from the class names.
 */
async function assertTouchTargets(locator, label) {
  const count = await locator.count()
  assert.ok(count > 0, `${label}: no control found to measure`)
  const small = []
  for (let index = 0; index < count; index += 1) {
    const control = locator.nth(index)
    if (!(await control.isVisible().catch(() => false))) continue
    const box = await control.boundingBox()
    if (!box) continue
    const name = (await control.innerText().catch(() => "")).trim().slice(0, 40)
    if (Math.min(box.width, box.height) < MIN_TOUCH_PX) {
      small.push(`${name || "(no text)"} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
  }
  assert.deepEqual(small, [], `${label}: controls under ${MIN_TOUCH_PX}px`)
  return count
}

/** A phone must not scroll sideways, and must keep a gutter at the edges. */
async function assertNoSideScroll(page, width) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `width ${width}: page scrolls sideways (${metrics.scrollWidth} > ${metrics.clientWidth})`,
  )
}

const postTo = (page, path) =>
  page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1${path}`,
    { timeout: 20_000 },
  )

/** Reads the live cluster straight from the API, so assertions are not UI-only. */
async function clusterFromApi(page) {
  return page.evaluate(async (base) => {
    const response = await fetch(`${base}/api/v1/tables/groups`, { credentials: "include" })
    const body = await response.json()
    return body.groups ?? []
  }, apiUrl)
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

/* ---------------- the flow ---------------- */

/** Merge B3+B4+B5 through the floor, the way a receptionist does it. */
async function mergeThreeTables(page, width, label) {
  const actions = await openTableDetail(page, "B3")
  await expect(actions.first()).toHaveText(/Ghép bàn/)
  // AC08: the two layout actions are reachable and thumb-sized on this screen.
  await assertTouchTargets(actions, `${label} layout actions`)
  await actions.first().click()

  await tableGlyph(page, "B4").click()
  await tableGlyph(page, "B5").click()

  const region = mergeRegion(page)
  await expect(region).toBeVisible()
  // AC01/AC08: the chosen tables and the real total capacity are both on screen,
  // and nothing asks for a guest name, a phone or a party size.
  await expect(region).toContainText("B3 - B4 - B5")
  await expect(region).toContainText("tổng 12 chỗ")
  await expect(page.getByRole("form")).toHaveCount(0)
  await assertTouchTargets(region.getByRole("button"), `${label} merge panel`)

  const confirm = region.getByRole("button", { name: /Ghép \d+ bàn|Xác nhận ghép/ })
  const [response] = await Promise.all([postTo(page, "/tables/groups"), confirm.click()])
  assert.equal(response.status(), 201, `merge returned ${response.status()}`)
  const payload = await response.json()
  return payload.group
}

async function splitCluster(page, width, label) {
  await openTableDetail(page, "B3")
  const split = layoutActions(page).getByRole("button", { name: "Tách bàn", exact: true })
  await expect(split).toBeEnabled()
  await split.click()

  // AC08: splitting goes through a confirmation, never straight off a tap.
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await assertTouchTargets(dialog.getByRole("button"), `${label} split dialog`)

  const groups = await clusterFromApi(page)
  const groupId = groups[0].groupId
  const [response] = await Promise.all([
    postTo(page, `/tables/groups/${groupId}/dissolve`),
    dialog
      .getByRole("button", { name: /Tách thành bàn đơn|Tách bàn|Xác nhận/ })
      .first()
      .click(),
  ])
  assert.equal(response.status(), 200, `dissolve returned ${response.status()}`)
  return { groupId, releasedTables: (await response.json()).releasedTables }
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
    // Each viewport starts from the same seeded floor. Without this the booking and
    // the cluster left by the previous viewport change what the next one is looking
    // at, and a pass or a fail would depend on the order they ran in.
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

      await step(`${label} · floor reaches merge and split without scrolling sideways`, async () => {
        await assertNoSideScroll(page, width)
        await tableGlyph(page, "B3").click()
        const actions = layoutActions(page).getByRole("button", { name: /^(Ghép bàn|Tách bàn)$/ })
        await expect(actions).toHaveCount(2)
        const measured = await assertTouchTargets(actions, `${label} layout actions`)
        // The glyph itself is the primary target on a touch screen.
        const glyphBox = await tableGlyph(page, "B3").boundingBox()
        assert.ok(
          glyphBox && Math.min(glyphBox.width, glyphBox.height) >= 24,
          `${label}: table glyph ${JSON.stringify(glyphBox)} is too small to tap`,
        )
        await closeDetail(page, width)
        return { controls: measured, viewport: `${width}x${height}` }
      })

      if (!fullFlow.has(label)) {
        await page.screenshot({ path: `${output}/${label}-floor.png` })
        results.push({ name: `${label} · full flow`, result: "SKIP (covered on phone-390 and tablet-768)" })
        assert.deepEqual(pageErrors, [])
        continue
      }

      await step(`${label} · AC01 merge B3+B4+B5 with no guest details`, async () => {
        const group = await mergeThreeTables(page, width, label)
        assert.equal(group.totalCapacity, 12, "total capacity must come from the tables themselves")
        assert.deepEqual(group.tableCodes, ["B3", "B4", "B5"])
        assert.equal(group.status, "ACTIVE")
        await clearOverlays(page)
        await page.screenshot({ path: `${output}/${label}-merged.png` })
        return { groupCode: group.groupCode, displayCode: group.displayCode, totalCapacity: group.totalCapacity }
      })

      await step(`${label} · AC08 one tap on a member identifies the whole cluster`, async () => {
        await expect(page.locator('[data-combined-codes="B3 B4 B5"]')).toHaveCount(3)
        for (const code of ["B3", "B4", "B5"]) await expect(tableGlyph(page, code)).toBeVisible()
        // Tapping B5 selects the cluster, not just B5.
        await closeDetail(page, width)
        await openTableDetail(page, "B5")
        await layoutActions(page).getByRole("button", { name: "Ghép bàn", exact: true }).click()
        const region = mergeRegion(page)
        await expect(region).toContainText("B3 - B4 - B5")
        await page.getByRole("button", { name: "Hủy", exact: true }).first().click()
        await closeDetail(page, width)
        return { members: 3 }
      })

      await step(`${label} · AC09 a second device sees the split in under 2s`, async () => {
        const watcher = await browser.newContext({ viewport: { width, height }, hasTouch: true })
        const deviceB = await watcher.newPage()
        try {
          await login(deviceB)
          await clearOverlays(deviceB)
          await expect(deviceB.locator('[data-combined-codes="B3 B4 B5"]')).toHaveCount(3)

          const started = Date.now()
          const outcome = await splitCluster(page, width, label)
          // No reload on device B: it must learn from the stream.
          await expect(deviceB.locator('[data-combined-codes="B3 B4 B5"]')).toHaveCount(0, {
            timeout: REALTIME_BUDGET_MS,
          })
          const latencyMs = Date.now() - started
          assert.ok(latencyMs < REALTIME_BUDGET_MS, `device B took ${latencyMs}ms`)
          await deviceB.screenshot({ path: `${output}/${label}-device-b-after-split.png` })
          return { latencyMs, releasedTables: outcome.releasedTables, groupId: outcome.groupId }
        } finally {
          await watcher.close()
        }
      })

      await step(`${label} · AC02 the split left the tables single and re-mergeable`, async () => {
        const groups = await clusterFromApi(page)
        assert.deepEqual(groups, [], "no cluster may remain active after the split")
        await closeDetail(page, width)
        await clearOverlays(page)
        const group = await mergeThreeTables(page, width, label)
        assert.equal(group.totalCapacity, 12)
        await clearOverlays(page)
        return { groupCode: group.groupCode }
      })

      await step(`${label} · AC04 over capacity warns, and only saves once confirmed`, async () => {
        // 14 guests on a 12-seat cluster: the server refuses until someone says yes.
        const refused = await page.evaluate(
          async ({ base, date }) => {
            const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
            const send = (body) =>
              fetch(`${base}/api/v1/bookings/direct`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
                body: JSON.stringify(body),
              })
            const payload = {
              guestName: "Doan 14 khach",
              partySize: 14,
              expectedAt: `${date}T22:00:00+07:00`,
              businessDate: date,
              sourceCode: "HOTLINE",
              tableIds: [],
            }
            const catalog = await (await fetch(`${base}/api/v1/tables/catalog`, { credentials: "include" })).json()
            payload.tableIds = [catalog.tables.find((row) => row.code === "B3").id]
            const first = await send(payload)
            const firstBody = await first.json()
            const second = await send({ ...payload, capacityOverrideConfirmed: true })
            const secondBody = await second.json()
            return {
              refusedStatus: first.status,
              refusedCode: firstBody.error?.code,
              details: firstBody.error?.details,
              savedStatus: second.status,
              savedPartySize: secondBody.booking?.partySize,
              savedTableCodes: secondBody.booking?.tableCodes,
            }
          },
          { base: apiUrl, date: businessDate },
        )
        assert.equal(refused.refusedStatus, 409)
        assert.equal(refused.refusedCode, "CAPACITY_OVERRIDE_REQUIRED")
        assert.equal(refused.details.totalCapacity, 12)
        assert.equal(refused.details.requestedGuests, 14)
        assert.equal(refused.savedStatus, 201)
        assert.equal(refused.savedPartySize, 14)
        // Booking one member booked the whole cluster.
        assert.deepEqual(refused.savedTableCodes, ["B3", "B4", "B5"])
        return refused
      })

      await step(`${label} · AC06 a cluster serving a party is not offered the dissolve`, async () => {
        await page.reload({ waitUntil: "networkidle" })
        await clearOverlays(page)
        await openTableDetail(page, "B3")
        await layoutActions(page).getByRole("button", { name: "Tách bàn", exact: true }).click()

        // With a party on the cluster the dialog switches to the BA-021 split:
        // choose which tables stay. Dissolving the whole cluster is not offered,
        // which is how the UI keeps a seated party from losing its tables.
        const dialog = page.getByRole("dialog")
        await expect(dialog).toContainText("Chọn bàn giữ lại cho đoàn khách")
        await expect(dialog.getByRole("button", { name: "Tách thành bàn đơn", exact: true })).toHaveCount(0)
        for (const code of ["B3", "B4", "B5"]) await expect(dialog.getByText(code, { exact: true })).toBeVisible()
        await assertTouchTargets(dialog.getByRole("button"), `${label} in-use split dialog`)
        await page.screenshot({ path: `${output}/${label}-in-use-split-dialog.png` })
        await dialog.getByRole("button", { name: "Quay lại", exact: true }).click()

        // And the server refuses a dissolve even if a client sends one anyway.
        const refusal = await page.evaluate(async (base) => {
          const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
          const groups = await (await fetch(`${base}/api/v1/tables/groups`, { credentials: "include" })).json()
          const response = await fetch(`${base}/api/v1/tables/groups/${groups.groups[0].groupId}/dissolve`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
            body: "{}",
          })
          const body = await response.json()
          return { status: response.status, code: body.error?.code, visitId: body.error?.details?.visitId }
        }, apiUrl)
        assert.equal(refusal.status, 409)
        assert.equal(refusal.code, "TABLE_GROUP_IN_USE")
        assert.equal((await clusterFromApi(page)).length, 1, "the cluster must survive the refused dissolve")
        return refusal
      })

      assert.deepEqual(pageErrors, [], `page errors on ${label}`)
    } catch (error) {
      await page.screenshot({ path: `${output}/${label}-fail.png` }).catch(() => {})
      throw error
    } finally {
      await context.close()
    }
  }

  // AC05 lives outside the viewport loop: it changes the role, so it runs last.
  await step("AC05 without table.group.manage the merge control is refused", async () => {
    fixture("set-group-permission", "revoke")
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const page = await context.newPage()
    try {
      await login(page)
      await clearOverlays(page)
      const merge = (await openTableDetail(page, "B6")).filter({ hasText: /Ghép bàn/ }).first()
      // GuardedButton keeps the control visible but disabled, and names the missing
      // permission in a tooltip rather than failing silently on tap.
      await expect(merge).toBeDisabled()
      await expect(merge).toHaveAttribute("aria-disabled", "true")
      await merge.hover({ force: true })
      await expect(page.getByRole("tooltip")).toContainText("Cần quyền")
      await page.screenshot({ path: `${output}/permission-denied.png` })

      // §11: the refusal is the server's, not the browser's. A client that bypasses
      // the disabled button still gets 403.
      const direct = await page.evaluate(async (base) => {
        const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
        const response = await fetch(`${base}/api/v1/tables/groups`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
          body: JSON.stringify({ tableCodes: ["B3", "B4"] }),
        })
        const body = await response.json()
        return { status: response.status, code: body.error?.code }
      }, apiUrl)
      assert.equal(direct.status, 403)
      return { disabled: true, serverStatus: direct.status, serverCode: direct.code }
    } finally {
      fixture("set-group-permission", "grant")
      await context.close()
    }
  })

  await step("AC05 a spare table joins a cluster only after the warning is confirmed", async () => {
    fixture("set-spare", "B6", "1")
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const page = await context.newPage()
    try {
      await login(page)
      await clearOverlays(page)
      const attempt = await page.evaluate(async (base) => {
        const me = await (await fetch(`${base}/api/v1/auth/me`, { credentials: "include" })).json()
        const send = (body) =>
          fetch(`${base}/api/v1/tables/groups`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
            body: JSON.stringify(body),
          })
        const first = await send({ tableCodes: ["A1", "B6"] })
        const firstBody = await first.json()
        const second = await send({ tableCodes: ["A1", "B6"], spareOverrideConfirmed: true })
        const secondBody = await second.json()
        return {
          refusedStatus: first.status,
          refusedCode: firstBody.error?.code,
          spareTableCodes: firstBody.error?.details?.spareTableCodes,
          confirmedStatus: second.status,
          confirmedCode: secondBody.error?.code ?? null,
        }
      }, apiUrl)
      assert.equal(attempt.refusedStatus, 409)
      assert.equal(attempt.refusedCode, "SPARE_TABLE_OVERRIDE_REQUIRED")
      assert.deepEqual(attempt.spareTableCodes, ["B6"])
      // Confirming clears the spare gate. A1 and B6 sit in different zones, so the
      // cross-zone flag refuses next -- which is the point: one gate, not all of them.
      assert.equal(attempt.confirmedStatus, 409)
      assert.equal(attempt.confirmedCode, "CROSS_ZONE_MERGE_DISABLED")
      return attempt
    } finally {
      fixture("set-spare", "B6", "0")
      await context.close()
    }
  })
} finally {
  if (browser) await browser.close()
  try {
    fixture("set-group-permission", "grant")
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
console.log(`C1 table group mobile: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
