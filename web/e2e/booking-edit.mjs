// Playwright E2E verification & screenshots for Reception "Sửa booking" inline edit page (mock mode).
// Usage (from web/): VITE_API_MODE=mock node e2e/booking-edit.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const evidenceDir =
  process.env.BOOKING_EDIT_EVIDENCE_DIR || "D:\\GAM-APP\\docs\\Sprint4\\evidence\\hung-booking-edit-2026-11-19"
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
