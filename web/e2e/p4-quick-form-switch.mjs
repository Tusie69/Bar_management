// Regression test for P4-05: switching an open QuickForm between Booking and Walk-in
// preserves entered shared fields and dirty state on both tablet (768x1024) and desktop (1440x900).
// Usage: node web/e2e/p4-quick-form-switch.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const evidenceDir = process.env.P4_EVIDENCE_DIR || ""

function launchBrowser() {
  const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  return chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : fs.existsSync(defaultChrome)
        ? { executablePath: defaultChrome }
        : {},
  )
}

async function startMockViteServer() {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = "mock"
  process.env.VITE_API_BASE_URL = ""
  const port = Number(process.env.PW_PORT || 5204)
  try {
    const server = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      server: { port, host: "127.0.0.1", strictPort: true, open: false },
    })
    await server.listen()
    const addr = server.httpServer?.address()
    assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` }
  } finally {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevBase
  }
}

async function dismissAlerts(page) {
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ }).first()
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
  }
}

async function installApiSpies(page) {
  await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    const origGetAvailability = api.getAvailability.bind(api)
    const origCreateReservation = api.createReservation.bind(api)
    const origSeatWalkIn = api.seatWalkIn.bind(api)
    const origAddWaitlist = api.addWaitlist.bind(api)

    window.__p4Spy = {
      availCalls: [],
      bookingCreates: [],
      walkInSeats: [],
      waitlistAdds: [],
    }

    api.getAvailability = async (at, partySize) => {
      const res = await origGetAvailability(at, partySize)
      window.__p4Spy.availCalls.push({ at: at.toISOString(), partySize, resPartySize: res.partySize })
      return res
    }
    api.createReservation = async (input) => {
      const res = await origCreateReservation(input)
      window.__p4Spy.bookingCreates.push({
        reservationId: res.reservationId,
        contactName: input.contactName,
        partySize: input.partySize,
      })
      return res
    }
    api.seatWalkIn = async (input) => {
      const res = await origSeatWalkIn(input)
      window.__p4Spy.walkInSeats.push({
        visitId: res.visitId,
        contactName: input.contactName,
        guestCount: input.guestCount,
      })
      return res
    }
    api.addWaitlist = async (input) => {
      const res = await origAddWaitlist(input)
      window.__p4Spy.waitlistAdds.push({
        entryId: res.entryId,
        kind: input.kind,
        contactName: input.contactName,
        partySize: input.partySize,
      })
      return res
    }
  })
}

async function readAvailabilitySummary(page) {
  const locator = page.locator("span", { hasText: /^Khả dụng / }).first()
  await locator.waitFor({ state: "visible" })
  return (await locator.textContent())?.trim() ?? ""
}

async function runViewportSwitchCase(browser, baseUrl, viewport, results) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width <= 1024 })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
  })
  try {
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.locator('[aria-label^="Bàn "]').first().waitFor({ state: "visible" })
    await dismissAlerts(page)
    await installApiSpies(page)

    const toolbarCreate = page.getByRole("group", { name: "Tạo mới" })
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()

    const form = page.locator('[role="form"]')
    await form.waitFor({ state: "visible" })

    const initialSummary = await readAvailabilitySummary(page)
    assert.match(
      initialSummary,
      /· 4 khách$/,
      `${viewport.width}x${viewport.height}: new booking should default to 4 guests`,
    )

    await form.getByRole("radio", { name: "6 khách", exact: true }).click()
    await form.locator("#qf-name").fill("Guest switching type")
    await form.locator("#qf-phone").fill("0901234567")
    await form.locator("#qf-note").fill("Gần cửa sổ")

    await page.waitForFunction(() => window.__p4Spy.availCalls.some((c) => c.partySize === 6))
    const chosenSummary = await readAvailabilitySummary(page)
    assert.match(chosenSummary, /· 6 khách$/, `${viewport.width}x${viewport.height}: summary should reflect 6 guests`)

    // Switch Đặt bàn -> Walk-in while the form stays open.
    await toolbarCreate.getByRole("button", { name: "Walk-in", exact: true }).click()
    await form.locator("h2", { hasText: /Walk-in/ }).waitFor({ state: "visible" })

    const walkInName = await form.locator("#qf-name").inputValue()
    const walkInPhone = await form.locator("#qf-phone").inputValue()
    const walkInPartyChecked = await form
      .getByRole("radio", { name: "6 khách", exact: true })
      .getAttribute("aria-checked")
    assert.equal(
      walkInName,
      "Guest switching type",
      `${viewport.width}x${viewport.height}: name lost on booking -> walk-in`,
    )
    assert.equal(walkInPhone, "0901234567", `${viewport.width}x${viewport.height}: phone lost on booking -> walk-in`)
    assert.equal(walkInPartyChecked, "true", `${viewport.width}x${viewport.height}: party lost on booking -> walk-in`)

    if (evidenceDir) {
      await page.screenshot({
        path: path.join(evidenceDir, `p4-05-after-booking-to-walkin-${viewport.width}x${viewport.height}.png`),
      })
    }

    // Clear recorded availability queries so the next switch records the exact party queried.
    await page.evaluate(() => {
      window.__p4Spy.availCalls = []
    })

    // Switch Walk-in -> Đặt bàn while still open.
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
    await form.locator("h2", { hasText: /Tạo đặt bàn|Đặt bàn/ }).waitFor({ state: "visible" })

    const backName = await form.locator("#qf-name").inputValue()
    const backPhone = await form.locator("#qf-phone").inputValue()
    const backNote = await form.locator("#qf-note").inputValue()
    const backPartyChecked = await form
      .getByRole("radio", { name: "6 khách", exact: true })
      .getAttribute("aria-checked")
    assert.equal(
      backName,
      "Guest switching type",
      `${viewport.width}x${viewport.height}: name lost on walk-in -> booking`,
    )
    assert.equal(backPhone, "0901234567", `${viewport.width}x${viewport.height}: phone lost on walk-in -> booking`)
    assert.equal(backNote, "Gần cửa sổ", `${viewport.width}x${viewport.height}: note lost on walk-in -> booking`)
    assert.equal(backPartyChecked, "true", `${viewport.width}x${viewport.height}: party lost on walk-in -> booking`)

    // P4-07: Khả dụng summary and availability query must both stay at 6 guests.
    const backSummary = await readAvailabilitySummary(page)
    assert.match(
      backSummary,
      /· 6 khách$/,
      `${viewport.width}x${viewport.height}: Khả dụng summary diverged after switch (${backSummary})`,
    )
    await page.waitForFunction(() => window.__p4Spy.availCalls.length > 0)
    const backAvailParties = await page.evaluate(() => window.__p4Spy.availCalls.map((c) => c.partySize))
    assert.equal(
      backAvailParties.at(-1),
      6,
      `${viewport.width}x${viewport.height}: availability queried party ${backAvailParties.at(-1)} instead of 6`,
    )

    if (evidenceDir) {
      await page.screenshot({
        path: path.join(evidenceDir, `p4-07-after-walkin-to-booking-${viewport.width}x${viewport.height}.png`),
      })
    }

    // Switch back to Walk-in and verify dirty leave-confirm still triggers.
    await toolbarCreate.getByRole("button", { name: "Walk-in", exact: true }).click()
    await form.locator("h2", { hasText: /Walk-in/ }).waitFor({ state: "visible" })
    await form.getByRole("button", { name: "Đóng form", exact: true }).click()

    const confirmDialog = page.getByRole("alertdialog", { name: "Bỏ đơn đang nhập" })
    await confirmDialog.waitFor({ state: "visible" })
    await confirmDialog.getByRole("button", { name: "Tiếp tục nhập", exact: true }).click()
    await confirmDialog.waitFor({ state: "detached" })
    assert.equal(await form.locator("#qf-name").inputValue(), "Guest switching type")

    // Switch back to Đặt bàn and save; persisted booking must have partySize 6.
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
    await form.locator("h2", { hasText: /Tạo đặt bàn|Đặt bàn/ }).waitFor({ state: "visible" })
    assert.match(
      await readAvailabilitySummary(page),
      /· 6 khách$/,
      `${viewport.width}x${viewport.height}: summary diverged before save`,
    )
    await form.getByRole("button", { name: "Lưu đặt bàn", exact: true }).click()
    await form.waitFor({ state: "detached" })

    const savedBookingCheck = await page.evaluate(async () => {
      const created = window.__p4Spy.bookingCreates.at(-1)
      if (!created) return { created: null, persistedPartySize: null }
      const { api, clock } = await import("/src/services/index.ts")
      const { businessDateOf } = await import("/src/lib/time.ts")
      const rows = await api.listReservations({ businessDate: businessDateOf(clock.now()) })
      const row = rows.find((r) => r.id === created.reservationId)
      return { created, persistedPartySize: row?.partySize ?? null }
    })
    assert.equal(
      savedBookingCheck.created?.partySize,
      6,
      `${viewport.width}x${viewport.height}: saved booking payload partySize`,
    )
    assert.equal(
      savedBookingCheck.persistedPartySize,
      6,
      `${viewport.width}x${viewport.height}: persisted booking partySize`,
    )

    // Reopen after full close: must start a fresh empty session with default 4 guests.
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
    await form.waitFor({ state: "visible" })
    assert.equal(await form.locator("#qf-name").inputValue(), "")
    assert.equal(await form.locator("#qf-phone").inputValue(), "")
    assert.equal(await form.locator("#qf-note").inputValue(), "")
    assert.equal(
      await form.getByRole("radio", { name: "4 khách", exact: true }).getAttribute("aria-checked"),
      "true",
      `${viewport.width}x${viewport.height}: reopened fresh booking should default to 4 guests`,
    )
    assert.match(
      await readAvailabilitySummary(page),
      /· 4 khách$/,
      `${viewport.width}x${viewport.height}: reopened fresh booking summary should default to 4 guests`,
    )

    // Choose 5 guests in Đặt bàn, switch to Walk-in, and save Walk-in; persisted waitlist entry must have partySize 5.
    await form.getByRole("radio", { name: "5 khách", exact: true }).click()
    await form.locator("#qf-name").fill("Walkin switched guest")
    await toolbarCreate.getByRole("button", { name: "Walk-in", exact: true }).click()
    await form.locator("h2", { hasText: /Walk-in/ }).waitFor({ state: "visible" })
    assert.equal(
      await form.getByRole("radio", { name: "5 khách", exact: true }).getAttribute("aria-checked"),
      "true",
      `${viewport.width}x${viewport.height}: 5 guests lost on booking -> walk-in`,
    )
    await form.getByRole("button", { name: "Thêm vào danh sách chờ", exact: true }).click()
    await form.waitFor({ state: "detached" })

    const savedWalkInCheck = await page.evaluate(async () => {
      const created = window.__p4Spy.waitlistAdds.at(-1)
      if (!created) return { created: null, persistedPartySize: null }
      const { api, clock } = await import("/src/services/index.ts")
      const { businessDateOf } = await import("/src/lib/time.ts")
      const rows = await api.listWaitlist(businessDateOf(clock.now()))
      const row = rows.find((r) => r.id === created.entryId)
      return { created, persistedPartySize: row?.partySize ?? null }
    })
    assert.equal(
      savedWalkInCheck.created?.partySize,
      5,
      `${viewport.width}x${viewport.height}: saved walk-in payload partySize`,
    )
    assert.equal(
      savedWalkInCheck.persistedPartySize,
      5,
      `${viewport.width}x${viewport.height}: persisted walk-in partySize`,
    )

    // Reopen after saving and verify dirty discard confirm still works.
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
    await form.waitFor({ state: "visible" })
    await form.locator("#qf-name").fill("Discard check")
    await form.getByRole("button", { name: "Đóng form", exact: true }).click()
    await confirmDialog.waitFor({ state: "visible" })
    await confirmDialog.getByRole("button", { name: "Bỏ đơn", exact: true }).click()
    await form.waitFor({ state: "detached" })

    let midExitFresh = null
    if (viewport.width < 1024) {
      await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
      await form.waitFor({ state: "visible" })
      await form.locator("#qf-name").fill("Mid exit stale")
      await form.getByRole("button", { name: "Đóng form", exact: true }).click()
      await confirmDialog.waitFor({ state: "visible" })
      await confirmDialog.getByRole("button", { name: "Bỏ đơn", exact: true }).click()
      await page.waitForTimeout(20)
      await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
      await page.waitForTimeout(350)
      await form.waitFor({ state: "visible" })
      const reopenedName = await form.locator("#qf-name").inputValue()
      assert.equal(reopenedName, "", "Mid-exit reopen must start a fresh form without stale name")
      assert.equal(
        await form.getByRole("radio", { name: "4 khách", exact: true }).getAttribute("aria-checked"),
        "true",
        "Mid-exit reopen must start with default 4 guests",
      )
      midExitFresh = reopenedName === ""
    }

    assert.deepEqual(errors, [], `Console/page errors at ${viewport.width}x${viewport.height}: ${errors.join(" | ")}`)
    results.push({
      viewport: `${viewport.width}x${viewport.height}`,
      walkInName,
      walkInPhone,
      walkInPartyChecked,
      backName,
      backPhone,
      backNote,
      backPartyChecked,
      backSummary,
      backAvailParty: backAvailParties.at(-1),
      savedBookingParty: savedBookingCheck.persistedPartySize,
      savedWalkInParty: savedWalkInCheck.persistedPartySize,
      midExitFresh,
      status: "PASS",
    })
    console.log(`PASS ${viewport.width}x${viewport.height} quick-form switch`)
  } finally {
    await ctx.close()
  }
}

const externalBase = process.env.E2E_BASE_URL
const serverInfo = externalBase ? null : await startMockViteServer()
const baseUrl = externalBase || serverInfo.baseUrl
const browser = await launchBrowser()
const results = []

try {
  if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true })
  await runViewportSwitchCase(browser, baseUrl, { width: 768, height: 1024 }, results)
  await runViewportSwitchCase(browser, baseUrl, { width: 1440, height: 900 }, results)
  if (evidenceDir) {
    fs.writeFileSync(path.join(evidenceDir, "p4-05-switch-results.json"), JSON.stringify(results, null, 2))
  }
} finally {
  await browser.close()
  await serverInfo?.server.close()
}
