// Playwright E2E verification & screenshots for Reception "Sửa booking" inline edit page (mock mode).
// Usage (from web/): VITE_API_MODE=mock node e2e/booking-edit.mjs
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const evidenceDir =
  process.env.BOOKING_EDIT_EVIDENCE_DIR || path.join(__dirname, ".artifacts", `booking-edit-${randomUUID()}`)
fs.mkdirSync(evidenceDir, { recursive: true })

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
  const port = Number(process.env.PW_PORT || 5230)
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

async function setSession(page, userId, theme = "light") {
  await page.evaluate(
    ([uid, th]) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: th }))
    },
    [userId, theme],
  )
}

async function resetMockDemo(page) {
  await page.evaluate(async () => {
    const { demo } = await import("/src/services/index.ts")
    demo?.reset()
  })
}

async function openFloor(page, baseUrl, userId = 1, theme = "light") {
  await page.goto(`${baseUrl}/floor`, { waitUntil: "domcontentloaded" })
  await setSession(page, userId, theme)
  await page.reload({ waitUntil: "networkidle" })
  await page.locator('[role="button"][aria-label^="Bàn B4,"]').first().waitFor({ state: "visible" })
}

async function settle(page, ms = 350) {
  await page.waitForTimeout(ms)
}

async function openTableSheet(page, code) {
  const btn = page.locator(`[role="button"][aria-label^="Bàn ${code},"]`).first()
  await btn.click()
  const sheet = page.locator('[data-mobile-table-sheet="true"][role="dialog"]')
  await expect(sheet).toBeVisible()
  return sheet
}

async function assertLayoutAndTargets(page, containerSelector, label) {
  const metrics = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return { missing: true }
    const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1
    const rootOverflow = root.scrollWidth > root.clientWidth + 1
    const smallTargets = []
    for (const el of root.querySelectorAll("button, input, textarea, select")) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 43.5) {
        smallTargets.push({
          tag: el.tagName,
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
          h: Math.round(rect.height),
        })
      }
    }
    return { missing: false, docOverflow, rootOverflow, smallTargets }
  }, containerSelector)
  assert(!metrics.missing, `${label}: container ${containerSelector} missing`)
  assert(!metrics.docOverflow, `${label}: document horizontal overflow`)
  assert(!metrics.rootOverflow, `${label}: edit dialog horizontal overflow`)
  assert.deepEqual(metrics.smallTargets, [], `${label}: touch targets < 44px: ${JSON.stringify(metrics.smallTargets)}`)
}

let server
let browser

try {
  const started = await startMockViteServer()
  server = started.server
  const baseUrl = started.baseUrl
  browser = await launchBrowser()

  // 1. Phone 390x844 (light) — complete end-to-end edit flow
  const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx390.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`)
  })

  await openFloor(page, baseUrl, 1, "light")
  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })

  // Table sheet shows "Sửa booking" for user with reservation.update
  const b4Sheet = await openTableSheet(page, "B4")
  const editBtn = b4Sheet.getByRole("button", { name: "Sửa booking", exact: true })
  await expect(editBtn).toBeVisible()
  assert.equal(await b4Sheet.getByRole("button", { name: "Xem booking", exact: true }).count(), 0)
  await editBtn.click()

  const editPage = page.getByRole("dialog", { name: "Sửa booking", exact: true })
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: "Quay lại", exact: true })).toBeVisible()

  // Empty fields show "(Trống)"
  const emptyCount = await editPage.getByText("(Trống)", { exact: true }).count()
  assert(emptyCount >= 3, `Expected empty fields to show "(Trống)", got ${emptyCount}`)
  await expect(editPage.getByRole("button", { name: /Danh xưng/ })).toContainText("(Trống)")
  await expect(editPage.getByRole("button", { name: /Đặc điểm/ })).toContainText("(Trống)")
  await expect(editPage.getByRole("button", { name: /Ghi chú/ })).toContainText("(Trống)")

  // Save button disabled at start
  const saveBtn = editPage.getByRole("button", { name: "Lưu thay đổi", exact: true })
  const cancelBtn = editPage.getByRole("button", { name: "Hủy", exact: true })
  await expect(saveBtn).toBeDisabled()
  await expect(cancelBtn).toBeEnabled()

  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-light-empty")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-empty.png") })

  // Tap "Ghi chú" to edit in place (no separate dialog)
  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  const noteInput = editPage.getByLabel("Ghi chú", { exact: true })
  await expect(noteInput).toBeVisible()
  await expect(noteInput).toBeFocused()
  await noteInput.fill("Khách cần bàn yên tĩnh")
  await expect(saveBtn).toBeEnabled()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-dirty.png") })

  // Reverting value makes Save disabled again
  await noteInput.fill("")
  await expect(saveBtn).toBeDisabled()

  // Inline note phone privacy validation
  await noteInput.fill("Gọi 0901234567")
  await expect(editPage.getByText("Không ghi số điện thoại vào ghi chú", { exact: true })).toBeVisible()
  await expect(saveBtn).toBeDisabled()

  // Edit multiple fields (note + honorific via keyboard — B04)
  await noteInput.fill("Sinh nhật nhẹ")
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("button", { name: "Xong", exact: true }).click()
  const honorificRowBtn = editPage.getByRole("button", { name: /Danh xưng/ })
  await honorificRowBtn.focus()
  await expect(honorificRowBtn).toBeFocused()
  await page.keyboard.press("Enter")
  const mrRadio = editPage.getByRole("radio", { name: "Mr", exact: true })
  await expect(mrRadio).toBeFocused()
  await page.keyboard.press("Space")
  await expect(mrRadio).toHaveAttribute("aria-checked", "true")
  const doneBtn = editPage.getByRole("button", { name: "Xong", exact: true })
  await doneBtn.focus()
  await page.keyboard.press("Enter")
  await expect(honorificRowBtn).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(editPage.getByRole("button", { name: "Quay lại", exact: true })).not.toBeFocused()

  // Top-left back with edits opens confirm dialog
  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  const confirmDlg = page.getByRole("alertdialog")
  await expect(confirmDlg).toBeVisible()
  await expect(confirmDlg.getByText("Những thay đổi bạn vừa thực hiện sẽ không được lưu lại.")).toBeVisible()
  const stayBtn = confirmDlg.getByRole("button", { name: "Ở lại", exact: true })
  const agreeBtn = confirmDlg.getByRole("button", { name: "Đồng ý", exact: true })
  await expect(stayBtn).toBeVisible()
  await expect(agreeBtn).toBeVisible()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-confirm-leave.png") })

  // "Ở lại" closes dialog and keeps edits
  await stayBtn.click()
  await expect(confirmDlg).toBeHidden()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /Ghi chú/ })).toContainText("Sinh nhật nhẹ")

  // Escape with edits opens confirm dialog, then "Đồng ý" discards and leaves
  await page.keyboard.press("Escape")
  await expect(confirmDlg).toBeVisible()
  await agreeBtn.click()
  await expect(confirmDlg).toBeHidden()
  await expect(editPage).toBeHidden()

  // Reopen B4 -> verify edits were discarded
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /Ghi chú/ })).toContainText("(Trống)")

  // "Hủy" discards without prompt
  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Sẽ hủy")
  await cancelBtn.click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeHidden()

  // Reopen, edit, and save -> toast "Đã lưu thay đổi" and persists
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await editPage.getByRole("button", { name: /Danh xưng/ }).click()
  await editPage.getByRole("radio", { name: "Ms", exact: true }).click()
  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Khách VIP tầng 1")
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()

  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  await expect(editPage).toBeHidden()

  // Reopen B4 -> verify persisted changes
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /Danh xưng/ })).toContainText("Ms")
  await expect(editPage.getByRole("button", { name: /Ghi chú/ })).toContainText("Khách VIP tầng 1")

  // B02: Separate "Đổi bàn" flow + dirty guard before table change
  await expect(editPage.getByText("Lưu ngay khi chọn bàn", { exact: true })).toBeVisible()
  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Sửa trước khi đổi bàn")
  await editPage.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  const tableGuardDlg = page.getByRole("alertdialog", { name: "Lưu hoặc bỏ thay đổi trước khi đổi bàn?" })
  await expect(tableGuardDlg).toBeVisible()
  await tableGuardDlg.getByRole("button", { name: "Ở lại", exact: true }).click()
  await expect(tableGuardDlg).toBeHidden()
  await expect(editPage.getByLabel("Ghi chú", { exact: true })).toHaveValue("Sửa trước khi đổi bàn")

  await editPage.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await expect(tableGuardDlg).toBeVisible()
  await tableGuardDlg.getByRole("button", { name: "Bỏ thay đổi", exact: true }).click()
  await expect(editPage).toBeHidden()
  // Map table picker opens with B4 preselected; pick B5 instead and confirm
  await expect(page.getByText("Đổi bàn cho", { exact: false })).toBeVisible()
  await page.locator('[role="button"][aria-label^="Bàn B4,"], [role="button"][aria-label^="Bàn B4:"]').first().click()
  await page.locator('[role="button"][aria-label^="Bàn B5,"], [role="button"][aria-label^="Bàn B5:"]').first().click()
  await page.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await expect(page.getByText(/Phân bàn B5/)).toBeVisible()
  // Returns to Sửa booking with updated table and clean save button
  await expect(editPage).toBeVisible()
  await expect(editPage.getByText("B5", { exact: true })).toBeVisible()
  await expect(saveBtn).toBeDisabled()

  // B03: Back/Escape while save is pending does not open discard dialog or leave (delayed success + delayed 409)
  await page.evaluate(async () => {
    const { api, ApiError } = await import("/src/services/index.ts")
    const origUpdate = api.updateReservation.bind(api)
    window.__gmBookingEditOrigUpdate = origUpdate
    window.__gmDelayControl = { mode: "resolve", calls: 0, release: null }
    api.updateReservation = (input) => {
      window.__gmDelayControl.calls += 1
      return new Promise((resolve, reject) => {
        window.__gmDelayControl.release = () => {
          if (window.__gmDelayControl.mode === "conflict") {
            reject(new ApiError(409, "VERSION_CONFLICT", "Booking đã được người khác cập nhật.", { by: "Quản lý" }))
            return
          }
          origUpdate(input).then(resolve, reject)
        }
      })
    }
  })

  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Lưu chờ mạng")
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(editPage.getByRole("button", { name: /Đang lưu/ })).toBeDisabled()
  await expect(editPage.getByRole("button", { name: "Quay lại", exact: true })).toBeDisabled()

  await page.goBack()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeVisible()

  await page.evaluate(() => window.__gmDelayControl.release())
  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  await expect(editPage).toBeHidden()
  const callCount = await page.evaluate(() => window.__gmDelayControl.calls)
  assert.equal(callCount, 1, "Expected exactly one updateReservation call")

  // B03 delayed 409 -> Back blocked while pending, works again once 409 acknowledged
  await (await openTableSheet(page, "B5")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await editPage.getByRole("button", { name: /Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Ghi chú gặp xung đột")
  await page.evaluate(() => {
    window.__gmDelayControl.mode = "conflict"
  })
  await saveBtn.click()
  await expect(editPage.getByRole("button", { name: /Đang lưu/ })).toBeDisabled()
  await page.goBack()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeVisible()

  await page.evaluate(() => window.__gmDelayControl.release())
  const conflictDlg = page.getByRole("alertdialog", { name: "Dữ liệu vừa thay đổi" })
  await expect(conflictDlg).toBeVisible()
  await conflictDlg.getByRole("button", { name: "Đã hiểu, xem dữ liệu mới", exact: true }).click()
  await expect(conflictDlg).toBeHidden()
  await expect(editPage.getByLabel("Ghi chú", { exact: true })).toHaveValue("Ghi chú gặp xung đột")

  // Restore mock API and verify Back works again after 409 acknowledgement
  await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    if (window.__gmBookingEditOrigUpdate) {
      api.updateReservation = window.__gmBookingEditOrigUpdate
    }
  })
  await page.goBack()
  await expect(confirmDlg).toBeVisible()
  await agreeBtn.click()
  await expect(editPage).toBeHidden()

  // B01-R1: Two-session remote date change keeps both clean and dirty editors mounted
  const runRemoteDateChange = async ({ tableCode, dirtyNote }) => {
    await (await openTableSheet(page, tableCode)).getByRole("button", { name: "Sửa booking", exact: true }).click()
    await expect(editPage).toBeVisible()
    const idBadge = await editPage.locator("header span", { hasText: /^#\d+$/ }).textContent()
    const targetId = Number((idBadge || "").replace("#", ""))
    assert(Number.isInteger(targetId) && targetId > 0, `Expected booking id badge on ${tableCode}, got ${idBadge}`)

    if (dirtyNote) {
      await editPage.getByRole("button", { name: /Ghi chú/ }).click()
      await editPage.getByLabel("Ghi chú", { exact: true }).fill(dirtyNote)
      await expect(saveBtn).toBeEnabled()
    } else {
      await expect(saveBtn).toBeDisabled()
    }

    const remoteMove = await page.evaluate(async (id) => {
      const { api, clock } = await import("/src/services/index.ts")
      const { addDays, atBusinessTime, businessDateOf, fmtTime } = await import("/src/lib/time.ts")
      const currentBd = businessDateOf(clock.now())
      const rows = await api.listReservations({ businessDate: currentBd })
      const booking = rows.find((item) => item.id === id)
      if (!booking) throw new Error(`Booking #${id} not found on ${currentBd}`)
      const nextBd = addDays(currentBd, 1)
      await api.updateReservation({
        id: booking.id,
        version: booking.version,
        expectedAt: atBusinessTime(nextBd, fmtTime(booking.expectedAt)),
      })
      const remoteRows = await api.listReservations({ businessDate: nextBd })
      const remoteBooking = remoteRows.find((item) => item.id === id)
      if (!remoteBooking) throw new Error(`Remote move failed for #${id}`)

      const origList = api.listReservations.bind(api)
      window.__gmOrigListReservations = origList
      window.__gmMissingRowRefreshCount = 0
      api.listReservations = async (params) => {
        const res = await origList(params)
        if (params?.businessDate === currentBd && !res.some((item) => item.id === id)) {
          window.__gmMissingRowRefreshCount += 1
        }
        return res
      }
      return { currentBd, nextBd, remoteVersion: remoteBooking.version }
    }, targetId)

    await page.waitForFunction(() => (window.__gmMissingRowRefreshCount || 0) >= 1, null, { timeout: 20_000 })
    assert.equal(await editPage.getByText("Không tìm thấy booking", { exact: true }).count(), 0)
    await expect(editPage).toBeVisible()

    if (dirtyNote) {
      await expect(editPage.getByLabel("Ghi chú", { exact: true })).toHaveValue(dirtyNote)
      await page.goBack()
      await expect(confirmDlg).toBeVisible()
      await stayBtn.click()
      await expect(confirmDlg).toBeHidden()
      await expect(editPage.getByLabel("Ghi chú", { exact: true })).toHaveValue(dirtyNote)

      await saveBtn.click()
      const conflictDlg2 = page.getByRole("alertdialog", { name: "Dữ liệu vừa thay đổi" })
      await expect(conflictDlg2).toBeVisible()
      await conflictDlg2.getByRole("button", { name: "Đã hiểu, xem dữ liệu mới", exact: true }).click()
      await expect(conflictDlg2).toBeHidden()
      await expect(editPage.getByLabel("Ghi chú", { exact: true })).toHaveValue(dirtyNote)

      const persisted = await page.evaluate(
        async ({ id, nextBd }) => {
          const { api } = await import("/src/services/index.ts")
          const rows = await api.listReservations({ businessDate: nextBd })
          return rows.find((item) => item.id === id) ?? null
        },
        { id: targetId, nextBd: remoteMove.nextBd },
      )
      assert(persisted, `Booking #${targetId} missing on remote date ${remoteMove.nextBd}`)
      assert.equal(persisted.version, remoteMove.remoteVersion)
      assert.equal(persisted.businessDate, remoteMove.nextBd)

      await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
      await expect(confirmDlg).toBeVisible()
      await agreeBtn.click()
      await expect(editPage).toBeHidden()
    } else {
      await expect(saveBtn).toBeDisabled()
      await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
      await expect(page.getByRole("alertdialog")).toHaveCount(0)
      await expect(editPage).toBeHidden()
    }

    await page.evaluate(async () => {
      const { api } = await import("/src/services/index.ts")
      if (window.__gmOrigListReservations) {
        api.listReservations = window.__gmOrigListReservations
        delete window.__gmOrigListReservations
      }
      delete window.__gmMissingRowRefreshCount
    })
  }

  await runRemoteDateChange({ tableCode: "A5", dirtyNote: null })
  await runRemoteDateChange({ tableCode: "B5", dirtyNote: "Ghi chú giữ lại khi đổi ngày" })

  // PR17-01: "Lưu & đổi bàn" after date change when target-date waitlist returns 503, then retry "Đổi bàn"
  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  const pr17Id = Number(((await editPage.locator("header span", { hasText: /^#\d+$/ }).textContent()) || "").slice(1))
  assert(Number.isInteger(pr17Id) && pr17Id > 0, "Expected valid booking id for PR17-01 check")

  const pr17Dates = await page.evaluate(async () => {
    const { api, ApiError, clock } = await import("/src/services/index.ts")
    const { addDays, businessDateOf, fmtDayMonth } = await import("/src/lib/time.ts")
    const today = businessDateOf(clock.now())
    const tomorrow = addDays(today, 1)
    const origUpdate = api.updateReservation.bind(api)
    const origAssign = api.assignTables.bind(api)
    const origListWaitlist = api.listWaitlist.bind(api)
    window.__gmPr17Probe = {
      updateCalls: 0,
      assignCalls: 0,
      failWaitlist: true,
      origUpdate,
      origAssign,
      origListWaitlist,
    }
    api.updateReservation = (input) => {
      window.__gmPr17Probe.updateCalls += 1
      return origUpdate(input)
    }
    api.assignTables = (...args) => {
      window.__gmPr17Probe.assignCalls += 1
      return origAssign(...args)
    }
    api.listWaitlist = async (date) => {
      if (window.__gmPr17Probe.failWaitlist && date === tomorrow) {
        throw new ApiError(503, "SERVICE_UNAVAILABLE", "Simulated 503 waitlist after saving booking")
      }
      return origListWaitlist(date)
    }
    return { today, tomorrow, dayLabel: fmtDayMonth(tomorrow) }
  })

  await editPage.getByRole("button", { name: /^Ngày đặt/ }).click()
  await editPage
    .getByRole("button", { name: new RegExp(pr17Dates.dayLabel.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&") + "$") })
    .click()
  await editPage.getByRole("button", { name: /^Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("PR17-01: save before pick")
  await editPage.getByRole("button", { name: "Xong", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Lưu & đổi bàn", exact: true }).click()

  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  const retryPickBtn = editPage.getByRole("button", { name: "Thử lại đổi bàn", exact: true })
  await expect(retryPickBtn).toBeVisible()
  await expect(editPage.getByRole("alert")).toContainText("Đã lưu thay đổi")
  await expect(saveBtn).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Ngày đặt/ })).toContainText(pr17Dates.dayLabel)
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toContainText("PR17-01: save before pick")
  assert.equal(await page.getByText(/Xếp bàn cho|Đổi bàn cho/).count(), 0)
  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-pr17-01-picker-503")

  const pr17After503 = await page.evaluate(
    async ({ id, today, tomorrow }) => {
      const { api } = await import("/src/services/index.ts")
      const oldList = await api.listReservations({ businessDate: today })
      const nextList = await api.listReservations({ businessDate: tomorrow })
      return {
        updateCalls: window.__gmPr17Probe.updateCalls,
        assignCalls: window.__gmPr17Probe.assignCalls,
        stillOnOldDate: oldList.some((item) => item.id === id),
        savedOnTarget: nextList.find((item) => item.id === id) ?? null,
      }
    },
    { id: pr17Id, today: pr17Dates.today, tomorrow: pr17Dates.tomorrow },
  )
  assert.equal(pr17After503.updateCalls, 1)
  assert.equal(pr17After503.assignCalls, 0)
  assert.equal(pr17After503.stillOnOldDate, false)
  assert.equal(pr17After503.savedOnTarget?.businessDate, pr17Dates.tomorrow)
  assert.equal(pr17After503.savedOnTarget?.note, "PR17-01: save before pick")

  // Recover waitlist query and retry only the "Đổi bàn" step
  await page.evaluate(() => {
    window.__gmPr17Probe.failWaitlist = false
  })
  await retryPickBtn.click()
  await expect(page.getByText(/Xếp bàn cho|Đổi bàn cho/)).toBeVisible()
  await page.locator('[role="button"][aria-label^="Bàn B4,"], [role="button"][aria-label^="Bàn B4:"]').first().click()
  await page.getByRole("button", { name: /^(Xếp bàn|Đổi bàn)$/ }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByText("B4", { exact: true })).toBeVisible()
  await expect(saveBtn).toBeDisabled()

  const pr17FinalCounts = await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    const counts = {
      updateCalls: window.__gmPr17Probe.updateCalls,
      assignCalls: window.__gmPr17Probe.assignCalls,
    }
    api.updateReservation = window.__gmPr17Probe.origUpdate
    api.assignTables = window.__gmPr17Probe.origAssign
    api.listWaitlist = window.__gmPr17Probe.origListWaitlist
    delete window.__gmPr17Probe
    return counts
  })
  assert.equal(pr17FinalCounts.updateCalls, 1)
  assert.equal(pr17FinalCounts.assignCalls, 1)

  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeHidden()

  // PR17-01 (booking read 503 -> retry read -> server version) & PR17-02 (slow booking read disables fields until synced)
  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  const pr17Round2Id = Number(
    ((await editPage.locator("header span", { hasText: /^#\d+$/ }).textContent()) || "").slice(1),
  )
  assert(Number.isInteger(pr17Round2Id) && pr17Round2Id > 0, "Expected valid booking id for PR17 round 2 checks")

  const pr17Round2 = await page.evaluate(async () => {
    const { api, ApiError, clock } = await import("/src/services/index.ts")
    const { addDays, businessDateOf, fmtDayMonth } = await import("/src/lib/time.ts")
    const today = businessDateOf(clock.now())
    const tomorrow = addDays(today, 1)
    const origUpdate = api.updateReservation.bind(api)
    const origAssign = api.assignTables.bind(api)
    const origList = api.listReservations.bind(api)
    const origWaitlist = api.listWaitlist.bind(api)

    let releaseRead = null
    window.__gmPr17Round2 = {
      updateCalls: 0,
      assignCalls: [],
      mode: "fail-booking",
      enteredRead: false,
      releaseRead: () => releaseRead?.(),
      origUpdate,
      origAssign,
      origList,
      origWaitlist,
    }
    api.updateReservation = (input) => {
      window.__gmPr17Round2.updateCalls += 1
      return origUpdate(input)
    }
    api.assignTables = (id, version, tableIds, overrideReason) => {
      window.__gmPr17Round2.assignCalls.push({ id, version, tableIds })
      return origAssign(id, version, tableIds, overrideReason)
    }
    api.listReservations = async (params) => {
      if (params?.businessDate === tomorrow) {
        if (window.__gmPr17Round2.mode === "fail-booking") {
          throw new ApiError(503, "SERVICE_UNAVAILABLE", "Simulated 503 target booking read")
        }
        if (window.__gmPr17Round2.mode === "slow-booking") {
          window.__gmPr17Round2.enteredRead = true
          await new Promise((resolve) => {
            releaseRead = resolve
          })
        }
      }
      return origList(params)
    }
    api.listWaitlist = async (date) => {
      if (window.__gmPr17Round2.mode !== "ok" && date === tomorrow) {
        throw new ApiError(503, "SERVICE_UNAVAILABLE", "Simulated 503 waitlist before/during slow booking read")
      }
      return origWaitlist(date)
    }
    return { today, tomorrow, dayLabel: fmtDayMonth(tomorrow) }
  })

  await editPage.getByRole("button", { name: /^Ngày đặt/ }).click()
  await editPage
    .getByRole("button", { name: new RegExp(pr17Round2.dayLabel.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&") + "$") })
    .click()
  await editPage.getByRole("button", { name: /^Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("PR17-01: booking read recovery")
  await editPage.getByRole("button", { name: "Xong", exact: true }).click()
  await editPage.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Lưu & đổi bàn", exact: true }).click()

  // Booking query failed after PUT: saved state shown, save & Đổi bàn & edit fields disabled, read retry offered
  const retryReadBtn = editPage.getByRole("button", { name: "Thử lại đọc booking", exact: true })
  await expect(retryReadBtn).toBeVisible()
  await expect(editPage.getByRole("alert")).toContainText("Đã lưu thay đổi")
  await expect(saveBtn).toBeDisabled()
  await expect(editPage.getByRole("button", { name: "Đổi bàn", exact: true })).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Tên khách/ })).toBeDisabled()

  // Recover booking read -> switch to slow-read mode (with waitlist 503) to also exercise PR17-02 in-flight lock
  await page.evaluate(() => {
    window.__gmPr17Round2.mode = "slow-booking"
  })
  await retryReadBtn.click()
  await expect.poll(() => page.evaluate(() => window.__gmPr17Round2.enteredRead)).toBe(true)

  // While slow booking read is syncing: busy hint visible, all edit fields and writes remain disabled
  await expect(editPage.getByText(/Đang đồng bộ dữ liệu đặt bàn/)).toBeVisible()
  await expect(saveBtn).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Tên khách/ })).toBeDisabled()

  // Release slow booking read -> waitlist 503 keeps editor open, version is now synced, fields re-enabled
  await page.evaluate(() => window.__gmPr17Round2.releaseRead())
  const retryPickAfterSlowBtn = editPage.getByRole("button", { name: "Thử lại đổi bàn", exact: true })
  await expect(retryPickAfterSlowBtn).toBeVisible()
  await expect(editPage.getByRole("button", { name: /^Tên khách/ })).toBeEnabled()
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toBeEnabled()

  // Typing after sync is preserved (not overwritten)
  await editPage.getByRole("button", { name: /^Ghi chú/ }).click()
  const noteAfterSync = editPage.getByLabel("Ghi chú", { exact: true })
  await noteAfterSync.fill("PR17-02: typed after sync")
  await expect(noteAfterSync).toHaveValue("PR17-02: typed after sync")
  await expect(saveBtn).toBeEnabled()

  // Discard post-sync local note edit via "Đổi bàn" -> "Bỏ thay đổi" (or revert and retry) to verify 1 PUT + 1 assign with server version
  await noteAfterSync.fill("PR17-01: booking read recovery")
  await editPage.getByRole("button", { name: "Xong", exact: true }).click()
  await expect(saveBtn).toBeDisabled()
  await page.evaluate(() => {
    window.__gmPr17Round2.mode = "ok"
  })
  await retryPickAfterSlowBtn.click()
  await expect(page.getByText(/Xếp bàn cho|Đổi bàn cho/)).toBeVisible()
  await page.locator('[role="button"][aria-label^="Bàn B4,"], [role="button"][aria-label^="Bàn B4:"]').first().click()
  await page.getByRole("button", { name: /^(Xếp bàn|Đổi bàn)$/ }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByText("B4", { exact: true })).toBeVisible()

  const pr17Round2Result = await page.evaluate(
    async ({ id, tomorrow }) => {
      const { api } = await import("/src/services/index.ts")
      const rows = await api.listReservations({ businessDate: tomorrow })
      const serverAfterAssign = rows.find((item) => item.id === id) ?? null
      const summary = {
        updateCalls: window.__gmPr17Round2.updateCalls,
        assignCalls: window.__gmPr17Round2.assignCalls,
        serverVersionAfterAssign: serverAfterAssign?.version ?? null,
      }
      api.updateReservation = window.__gmPr17Round2.origUpdate
      api.assignTables = window.__gmPr17Round2.origAssign
      api.listReservations = window.__gmPr17Round2.origList
      api.listWaitlist = window.__gmPr17Round2.origWaitlist
      delete window.__gmPr17Round2
      return summary
    },
    { id: pr17Round2Id, tomorrow: pr17Round2.tomorrow },
  )
  assert.equal(pr17Round2Result.updateCalls, 1)
  assert.equal(pr17Round2Result.assignCalls.length, 1)
  assert.equal(pr17Round2Result.assignCalls[0].version, pr17Round2Result.serverVersionAfterAssign - 1)

  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeHidden()
  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })

  // 1b. Choice controls parity with FormScreen (390 light): Nguồn, Icon, Loại khách, Số khách (<=6 & >6), Ngày, Giờ, Danh xưng
  await (await openTableSheet(page, "B3")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()

  // Nguồn đặt: Hotline pre-selected, WK disabled; Hotline -> Social -> revert disables save -> Social + IG
  await editPage.getByRole("button", { name: /^Nguồn đặt/ }).click()
  await expect(editPage.getByRole("radio", { name: "Hotline", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(editPage.getByRole("button", { name: "WK (chưa hỗ trợ)", exact: true })).toBeDisabled()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-source.png") })

  await editPage.getByRole("radio", { name: "Social", exact: true }).click()
  await expect(editPage.getByRole("radio", { name: "Social", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(editPage.getByText("Vui lòng chọn nền tảng mạng xã hội.", { exact: true })).toBeVisible()
  await expect(saveBtn).toBeDisabled()
  await editPage.getByLabel("Chọn nền tảng", { exact: true }).selectOption("FB")
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("radio", { name: "Hotline", exact: true }).click()
  await expect(saveBtn).toBeDisabled()
  await editPage.getByRole("radio", { name: "Social", exact: true }).click()
  await editPage.getByLabel("Chọn nền tảng", { exact: true }).selectOption("IG")
  await expect(saveBtn).toBeEnabled()

  // Đặc điểm (IconPicker): multi-select chips
  await editPage.getByRole("button", { name: /^Đặc điểm/ }).click()
  await editPage.getByRole("checkbox", { name: /Bàn sếp/ }).click()
  await editPage.getByRole("checkbox", { name: "Sinh nhật", exact: true }).click()
  await expect(editPage.getByRole("checkbox", { name: /Bàn sếp/ })).toHaveAttribute("aria-checked", "true")
  await expect(editPage.getByRole("checkbox", { name: "Sinh nhật", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-icons.png") })

  // Loại khách: 2-button toggle control matching form.tsx
  await editPage.getByRole("button", { name: /^Loại khách/ }).click()
  assert.equal(await editPage.getByRole("radio", { name: "Chưa phân loại", exact: true }).count(), 0)
  const returningRadio = editPage.getByRole("radio", { name: "Đã từng đặt bàn", exact: true })
  const newRadio = editPage.getByRole("radio", { name: "Chưa từng đặt bàn", exact: true })
  await returningRadio.click()
  await expect(returningRadio).toHaveAttribute("aria-checked", "true")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-classification.png") })
  // Tapping active option again unselects back to UNCLASSIFIED
  await returningRadio.click()
  await expect(returningRadio).toHaveAttribute("aria-checked", "false")
  await newRadio.click()
  await expect(newRadio).toHaveAttribute("aria-checked", "true")

  // Số khách: GuestPicker (1-6 chips + "số khác..."), no Stepper
  await editPage.getByRole("button", { name: /^Số khách/ }).click()
  assert.equal(await editPage.getByLabel("Tăng số khách", { exact: true }).count(), 0)
  await expect(editPage.getByRole("radio", { name: "4 khách", exact: true })).toHaveAttribute("aria-checked", "true")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-guests.png") })
  await editPage.getByRole("radio", { name: "6 khách", exact: true }).click()
  await expect(editPage.getByRole("radio", { name: "6 khách", exact: true })).toHaveAttribute("aria-checked", "true")

  // Ngày đặt: current day pressed
  await editPage.getByRole("button", { name: /^Ngày đặt/ }).click()
  await expect(editPage.getByRole("button", { name: /^Hôm nay/ })).toHaveAttribute("aria-pressed", "true")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-date.png") })

  // Giờ hẹn: BookingTimePicker quick chips + wheel
  await editPage.getByRole("button", { name: /^Giờ hẹn/ }).click()
  await expect(editPage.getByRole("button", { name: /Chọn giờ bằng con lăn/ })).toBeVisible()
  await editPage.getByRole("button", { name: "22:00", exact: true }).click()
  await expect(editPage.getByRole("button", { name: "22:00", exact: true })).toHaveAttribute("aria-pressed", "true")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-time.png") })

  // Danh xưng: HonorificPicker
  await editPage.getByRole("button", { name: /^Danh xưng/ }).click()
  await editPage.getByRole("radio", { name: "Mr", exact: true }).click()
  await expect(editPage.getByRole("radio", { name: "Mr", exact: true })).toHaveAttribute("aria-checked", "true")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-honorific.png") })

  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-light-choices")

  // Save all choice edits and verify persistence after reopen
  await saveBtn.click()
  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  await expect(editPage).toBeHidden()

  await (await openTableSheet(page, "B3")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /^Danh xưng/ })).toContainText("Mr")
  await expect(editPage.getByRole("button", { name: /^Loại khách/ })).toContainText("Chưa từng đặt bàn")
  await expect(editPage.getByRole("button", { name: /^Số khách/ })).toContainText("6 khách")
  await expect(editPage.getByRole("button", { name: /^Giờ hẹn/ })).toContainText("22:00")
  await expect(editPage.getByRole("button", { name: /^Nguồn đặt/ })).toContainText("Social · IG")
  await expect(editPage.getByRole("button", { name: /^Đặc điểm/ })).toContainText("⭐ Bàn sếp")
  await expect(editPage.getByRole("button", { name: /^Đặc điểm/ })).toContainText("🎂 Sinh nhật")

  // Revert-to-original on every choice field disables save again
  await expect(saveBtn).toBeDisabled()
  await editPage.getByRole("button", { name: /^Nguồn đặt/ }).click()
  await editPage.getByRole("radio", { name: "Hotline", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("radio", { name: "Social", exact: true }).click()
  await editPage.getByLabel("Chọn nền tảng", { exact: true }).selectOption("IG")
  await expect(saveBtn).toBeDisabled()

  await editPage.getByRole("button", { name: /^Đặc điểm/ }).click()
  await editPage.getByRole("checkbox", { name: /Bàn sếp/ }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("checkbox", { name: /Bàn sếp/ }).click()
  await expect(saveBtn).toBeDisabled()

  await editPage.getByRole("button", { name: /^Số khách/ }).click()
  await editPage.getByRole("radio", { name: "2 khách", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("radio", { name: "6 khách", exact: true }).click()
  await expect(saveBtn).toBeDisabled()

  await editPage.getByRole("button", { name: /^Loại khách/ }).click()
  await editPage.getByRole("radio", { name: "Đã từng đặt bàn", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("radio", { name: "Chưa từng đặt bàn", exact: true }).click()
  await expect(saveBtn).toBeDisabled()

  await editPage.getByRole("button", { name: /^Giờ hẹn/ }).click()
  await editPage.getByRole("button", { name: "22:30", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  await editPage.getByRole("button", { name: "22:00", exact: true }).click()
  await expect(saveBtn).toBeDisabled()

  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(editPage).toBeHidden()

  // Party size > 6 (B21 has 8 guests): opens with "số khác..." focused and pre-filled
  await (await openTableSheet(page, "B21")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await editPage.getByRole("button", { name: /^Số khách/ }).click()
  const otherGuestInput = editPage.getByPlaceholder("số khác...", { exact: true })
  await expect(otherGuestInput).toHaveValue("8")
  await expect(otherGuestInput).toBeFocused()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-choice-guests-other.png") })

  // PR17-I01 (B21): legacy source Zalo -> Hotline -> restore Zalo (clean-state & note preserved)
  await expect(saveBtn).toBeDisabled()
  await editPage.getByRole("button", { name: /^Nguồn đặt/ }).click()
  const zaloRadio = editPage.getByRole("radio", { name: "Zalo", exact: true })
  await expect(zaloRadio).toHaveAttribute("aria-checked", "true")
  await editPage.getByRole("radio", { name: "Hotline", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  const restoreSourceBtn = editPage.getByRole("button", { name: /Khôi phục: Zalo/ })
  await expect(restoreSourceBtn).toBeVisible()
  await expect(restoreSourceBtn).toContainText("Đã lưu")
  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-restore-source")
  await restoreSourceBtn.scrollIntoViewIfNeeded()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-restore-source.png") })
  await restoreSourceBtn.click()
  await expect(zaloRadio).toHaveAttribute("aria-checked", "true")
  await expect(restoreSourceBtn).toHaveCount(0)
  await expect(saveBtn).toBeDisabled()

  // With a note edit: Zalo -> Hotline -> restore Zalo keeps note, saves, source stays Zalo
  await editPage.getByRole("button", { name: /^Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Giữ ghi chú với Zalo")
  await editPage.getByRole("button", { name: /^Nguồn đặt/ }).click()
  await editPage.getByRole("radio", { name: "Hotline", exact: true }).click()
  await editPage.getByRole("button", { name: /Khôi phục: Zalo/ }).click()
  await expect(zaloRadio).toHaveAttribute("aria-checked", "true")
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toContainText("Giữ ghi chú với Zalo")
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  await expect(editPage).toBeHidden()
  await (await openTableSheet(page, "B21")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /^Nguồn đặt/ })).toContainText("Zalo")
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toContainText("Giữ ghi chú với Zalo")
  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(editPage).toBeHidden()

  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })

  // PR17-I02 (B3): original past time 21:05 (mock clock 21:30) -> 22:30 -> restore 21:05 without unlocking past times
  await (await openTableSheet(page, "B3")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(saveBtn).toBeDisabled()
  await expect(editPage.getByRole("button", { name: /^Giờ hẹn/ })).toContainText("21:05")
  await editPage.getByRole("button", { name: /^Giờ hẹn/ }).click()
  const wheelToggle = editPage.getByRole("button", { name: /Chọn giờ bằng con lăn/ })
  await expect(wheelToggle).toHaveAttribute("aria-label", /21:05/)
  await editPage.getByRole("button", { name: "22:30", exact: true }).click()
  await expect(saveBtn).toBeEnabled()
  const restoreTimeBtn = editPage.getByRole("button", { name: /Giờ ban đầu: 21:05/ })
  await expect(restoreTimeBtn).toBeVisible()
  await expect(restoreTimeBtn).toContainText("Đã lưu")
  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-restore-time")
  await restoreTimeBtn.scrollIntoViewIfNeeded()
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-light-restore-time.png") })
  // Confirm other past times remain locked in the wheel
  await wheelToggle.click()
  const hourWheel = editPage.getByRole("spinbutton", { name: "Giờ", exact: true })
  const minuteWheel = editPage.getByRole("spinbutton", { name: "Phút", exact: true })
  await hourWheel.locator('[data-value="21"]').click()
  await expect(minuteWheel.locator('[data-value="05"]')).toBeDisabled()
  await restoreTimeBtn.click()
  await expect(restoreTimeBtn).toHaveCount(0)
  await expect(wheelToggle).toHaveAttribute("aria-label", /21:05/)
  await expect(saveBtn).toBeDisabled()

  // With a note edit: 21:05 -> 22:30 -> restore 21:05 keeps note and saves 21:05
  await editPage.getByRole("button", { name: /^Ghi chú/ }).click()
  await editPage.getByLabel("Ghi chú", { exact: true }).fill("Giữ ghi chú 21:05")
  await editPage.getByRole("button", { name: /^Giờ hẹn/ }).click()
  await editPage.getByRole("button", { name: "22:30", exact: true }).click()
  await editPage.getByRole("button", { name: /Giờ ban đầu: 21:05/ }).click()
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toContainText("Giữ ghi chú 21:05")
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(page.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
  await expect(editPage).toBeHidden()
  await (await openTableSheet(page, "B3")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: /^Giờ hẹn/ })).toContainText("21:05")
  await expect(editPage.getByRole("button", { name: /^Ghi chú/ })).toContainText("Giữ ghi chú 21:05")
  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(editPage).toBeHidden()

  await resetMockDemo(page)
  await page.reload({ waitUntil: "networkidle" })

  // 2. Phone 390x844 (dark) screenshot & layout check
  await setSession(page, 1, "dark")
  await page.reload({ waitUntil: "networkidle" })
  await (await openTableSheet(page, "B4")).getByRole("button", { name: "Sửa booking", exact: true }).click()
  await expect(editPage).toBeVisible()
  await expect(editPage.getByRole("button", { name: "Đổi bàn", exact: true })).toBeVisible()
  await assertLayoutAndTargets(page, '[role="dialog"][aria-label="Sửa booking"]', "390-dark")
  await settle(page)
  await page.screenshot({ path: path.join(evidenceDir, "phone-390-dark-edit.png") })
  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()

  // 3. Waitlist entry shows "Sửa booking" when HOLD_ACTIVE has linked reservation
  await page.getByRole("button", { name: /^Bàn chờ,/ }).click()
  const waitSheet = page.getByRole("dialog", { name: /Bàn chờ ảo/ })
  await expect(waitSheet).toBeVisible()
  const firstTransferBtn = waitSheet.getByRole("button", { name: "Chuyển bàn", exact: true }).first()
  await firstTransferBtn.click()
  await page.locator('[role="button"][aria-label^="Bàn C5,"], [role="button"][aria-label^="Bàn C5:"]').first().click()
  await page.getByRole("button", { name: "Xác nhận chuyển bàn", exact: true }).click()
  await page
    .locator('[role="button"][aria-label^="Bàn C5, Đang giữ cho khách chờ"]')
    .first()
    .waitFor({ state: "visible" })

  // Table sheet for waitlist_hold + linked reservation shows "Sửa booking" (map.tsx ~768)
  const c5Sheet = await openTableSheet(page, "C5")
  await expect(c5Sheet.getByRole("button", { name: "Sửa booking", exact: true })).toBeVisible()
  await c5Sheet.getByRole("button", { name: "Đóng", exact: true }).click()

  // Waitlist card shows "Sửa booking" (wait.tsx ~316)
  await page.getByRole("button", { name: /^Bàn chờ,/ }).click()
  await expect(waitSheet).toBeVisible()
  await expect(waitSheet.getByRole("button", { name: "Sửa booking", exact: true }).first()).toBeVisible()
  await waitSheet.getByRole("button", { name: "Sửa booking", exact: true }).first().click()
  await expect(editPage).toBeVisible()
  await editPage.getByRole("button", { name: "Quay lại", exact: true }).click()
  await expect(editPage).toBeHidden()
  await waitSheet.getByRole("button", { name: "Đóng", exact: true }).first().click()

  // 4. Read-only role (userId 4 = CSKH / CUSTOMER_CARE) still sees "Xem booking"
  await openFloor(page, baseUrl, 4, "light")
  const roSheet = await openTableSheet(page, "B4")
  await expect(roSheet.getByRole("button", { name: "Xem booking", exact: true })).toBeVisible()
  assert.equal(await roSheet.getByRole("button", { name: "Sửa booking", exact: true }).count(), 0)
  await roSheet.getByRole("button", { name: "Xem booking", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Chi tiết booking", exact: true })).toBeVisible()
  assert.equal(await page.getByRole("button", { name: "Sửa booking", exact: true }).count(), 0)
  await page.getByRole("button", { name: "Quay lại", exact: true }).click()

  // 5. Desktop 1440x900 + Tablet 820x1180 + Small phone 375x667 checks
  for (const vp of [
    { width: 375, height: 667, name: "375" },
    { width: 430, height: 932, name: "430" },
    { width: 820, height: 1180, name: "820" },
    { width: 1440, height: 900, name: "1440" },
  ]) {
    const vpCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const vpPage = await vpCtx.newPage()
    vpPage.on("pageerror", (e) => errors.push(`vp-${vp.name} pageerror: ${e.message}`))
    await openFloor(vpPage, baseUrl, 1, "light")
    const sheet = await openTableSheet(vpPage, "A5")
    await expect(sheet.getByRole("button", { name: "Sửa booking", exact: true })).toBeVisible()
    await sheet.getByRole("button", { name: "Sửa booking", exact: true }).click()
    const vpEdit = vpPage.getByRole("dialog", { name: "Sửa booking", exact: true })
    await expect(vpEdit).toBeVisible()
    await expect(vpEdit.getByRole("button", { name: "Lưu thay đổi", exact: true })).toBeDisabled()
    await assertLayoutAndTargets(vpPage, '[role="dialog"][aria-label="Sửa booking"]', `vp-${vp.name}`)

    if (vp.width === 1440) {
      await settle(vpPage)
      await vpPage.screenshot({ path: path.join(evidenceDir, "desktop-1440-edit.png") })
      await vpEdit.getByRole("button", { name: /Ghi chú/ }).click()
      await vpEdit.getByLabel("Ghi chú", { exact: true }).fill("Test 1440")
      await expect(vpEdit.getByRole("button", { name: "Lưu thay đổi", exact: true })).toBeEnabled()
      await vpEdit.getByRole("button", { name: "Lưu thay đổi", exact: true }).click()
      await expect(vpPage.getByText("Đã lưu thay đổi", { exact: true })).toBeVisible()
    }
    await vpCtx.close()
  }

  assert.deepEqual(errors, [], `Console/page errors detected: ${errors.join("; ")}`)
  console.log(JSON.stringify({ status: "PASS", port: Number(process.env.PW_PORT || 5230), evidenceDir }))
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
}
