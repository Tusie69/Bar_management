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

    const toolbarCreate = page.getByRole("group", { name: "Tạo mới" })
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()

    const form = page.locator('[role="form"]')
    await form.waitFor({ state: "visible" })

    await form.getByRole("radio", { name: "6 khách", exact: true }).click()
    await form.locator("#qf-name").fill("Guest switching type")
    await form.locator("#qf-phone").fill("0901234567")
    await form.locator("#qf-note").fill("Gần cửa sổ")

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

    // Switch back to Walk-in and verify dirty leave-confirm still triggers.
    await toolbarCreate.getByRole("button", { name: "Walk-in", exact: true }).click()
    await form.locator("h2", { hasText: /Walk-in/ }).waitFor({ state: "visible" })
    await form.getByRole("button", { name: "Đóng form", exact: true }).click()

    const confirmDialog = page.getByRole("alertdialog", { name: "Bỏ đơn đang nhập" })
    await confirmDialog.waitFor({ state: "visible" })
    await confirmDialog.getByRole("button", { name: "Tiếp tục nhập", exact: true }).click()
    await confirmDialog.waitFor({ state: "detached" })
    assert.equal(await form.locator("#qf-name").inputValue(), "Guest switching type")

    await form.getByRole("button", { name: "Đóng form", exact: true }).click()
    await confirmDialog.waitFor({ state: "visible" })
    await confirmDialog.getByRole("button", { name: "Bỏ đơn", exact: true }).click()
    await form.waitFor({ state: "detached" })

    // Reopen after full close: must start a fresh empty session.
    await toolbarCreate.getByRole("button", { name: "Tạo đặt bàn", exact: true }).click()
    await form.waitFor({ state: "visible" })
    assert.equal(await form.locator("#qf-name").inputValue(), "")
    assert.equal(await form.locator("#qf-phone").inputValue(), "")
    assert.equal(await form.locator("#qf-note").inputValue(), "")

    let midExitFresh = null
    if (viewport.width < 1024) {
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
