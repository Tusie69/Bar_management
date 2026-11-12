import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
import fs from "node:fs"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const output = "e2e/.artifacts/frontend-sprint/p1"
const borderOutput = "e2e/.artifacts/frontend-sprint/G1/border"
fs.mkdirSync(output, { recursive: true })
fs.mkdirSync(borderOutput, { recursive: true })
const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : fs.existsSync(defaultChrome)
      ? { executablePath: defaultChrome }
      : {},
)
const results = []
let failures = 0
const glyph = (page, code) => page.locator(`[aria-label^="Bàn ${code},"]`).first()
const seat = (page, n) => page.locator(`[aria-label^="Ghế Bar ${n},"]`).first()
async function dismiss(page) {
  for (let i = 0; i < 6; i++) {
    const button = page
      .getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ })
      .first()
    if (await button.isVisible()) await button.click()
    await page.waitForTimeout(100)
  }
}
try {
  for (const theme of ["light", "dark"])
    for (const width of [360, 390, 430, 768, 1024, 1366, 1920]) {
      const page = await browser.newPage({
        viewport: { width, height: width < 768 ? 900 : 1080 },
        reducedMotion: "reduce",
      })
      const errors = []
      page.on("pageerror", (e) => errors.push(e.message))
      try {
        await page.addInitScript(
          ({ theme }) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme })),
          { theme },
        )
        await page.goto(`${base}/floor`, { waitUntil: "networkidle" })
        await page.evaluate(async () => {
          const { api, clock } = await import("/src/services/index.ts")
          assertMock(api.mode)
          function assertMock(mode) {
            if (mode !== "mock") throw new Error("P1 preview test requires mock")
          }
          const catalog = await api.getCatalog()
          const id = catalog.tables.find((t) => t.code === "B6").id
          const c = (await api.getFloorState(clock.now())).tables.find((s) => s.tableId === id).claim
          if (c?.visitId) await api.endVisit(c.visitId, c.version)
        })
        await dismiss(page)
        await expect(glyph(page, "B6")).toHaveAttribute("aria-label", /Trống|Chưa đặt/)
        await glyph(page, "B5").click()
        await expect(page.getByRole("form")).toHaveCount(0)
        const actions = page
          .locator('[aria-label="Thao tác mặt bằng"]')
          .getByRole("button", { name: /^(Ghép bàn|Tách bàn)$/ })
        await expect(actions.first()).toHaveText(/Ghép bàn/)
        await actions.first().click()
        await glyph(page, "B6").click()
        await glyph(page, "B7").click()
        await expect(page.getByRole("form")).toHaveCount(0)
        await expect(page.getByRole("region", { name: "Chế độ ghép bàn" })).toContainText("B5 - B6 - B7")
        await page.getByRole("button", { name: /Ghép \d+ bàn|Xác nhận ghép/ }).click()
        const members = page.locator('[data-combined-codes="B5 B6 B7"]')
        await expect(members).toHaveCount(3)
        await expect(glyph(page, "B5")).toBeVisible()
        await expect(glyph(page, "B6")).toBeVisible()
        await expect(glyph(page, "B7")).toBeVisible()
        await expect(glyph(page, "B5")).not.toHaveAttribute("data-group-color")
        await expect(glyph(page, "B5").locator('rect[stroke-width="3"]')).toHaveCount(1)
        if (width < 768) await page.getByRole("button", { name: "Đóng", exact: true }).click()
        else await page.getByRole("button", { name: /Ca tối nay/ }).click()
        for (const button of await page.locator("[data-sonner-toast] [data-close-button]").all()) await button.click()
        if ([360, 390, 768, 1366].includes(width)) {
          await page.screenshot({ path: `${output}/combined-${theme}-${width}.png` })
          if (theme === "light") {
            await page.screenshot({ path: `${borderOutput}/border-light-${width}.png` })
          }
        }
        if (width === 390 || width === 1366) {
          await glyph(page, "B5").click()
          await expect(page.getByRole("form")).toHaveCount(0)
          await page.getByRole("button", { name: "Tách bàn", exact: true }).click()
          await page.getByRole("button", { name: "Tách thành bàn đơn", exact: true }).click()
          await expect(page.locator('[data-combined-codes="B5 B6 B7"]')).toHaveCount(0)
          await expect(glyph(page, "B5")).toBeVisible()
          const close = page.getByRole("button", { name: "Đóng", exact: true })
          if (await close.isVisible()) await close.click()
          else await page.getByRole("button", { name: /Ca tối nay/ }).click()
          await page.getByRole("button", { name: "Ghép bàn", exact: true }).click()
          await seat(page, 2).click()
          await seat(page, 3).click()
          await page.getByRole("button", { name: /Ghép \d+ bàn|Xác nhận ghép/ }).click()
          const pair = page.locator('[data-combined-codes="BAR02 BAR03"]')
          await expect(pair).toHaveCount(2)
          const dashed = page.locator('[data-combined-codes="BAR02 BAR03"] circle[stroke-dasharray="5 3"]')
          if ((await dashed.count()) === 0) {
            await seat(page, 2).click()
          }
          await expect(dashed).toHaveCount(2)
          await expect(dashed.first()).toHaveAttribute("stroke", "#64748B")
          if (width < 768) {
            const btn = page.getByRole("button", { name: "Tạo đặt trước", exact: true })
            if (await btn.isVisible()) await btn.click()
          } else {
            const btn = page.getByRole("button", { name: "Đặt bàn", exact: true })
            if (await btn.isVisible()) await btn.click()
          }
          const form = page.getByRole("form", { name: /Tạo đặt bàn|Đặt bàn/ })
          if (await form.isVisible()) {
            const guestBtn = form.getByRole("button", { name: "2", exact: true })
            if (await guestBtn.isVisible()) await guestBtn.click()
            await form.getByLabel("Tên khách", { exact: true }).fill("Khách đôi P1")
            const timeBtn = form.getByRole("button", { name: "22:30", exact: true })
            if (await timeBtn.isVisible()) await timeBtn.click()
            await form.getByRole("button", { name: /Đặt bàn/ }).click()
          }
        }
        assert.deepEqual(errors, [])
        results.push({ theme, width, result: "PASS" })
      } catch (e) {
        failures++
        results.push({ theme, width, result: "FAIL", error: e.message })
        console.error(`FAIL P1 ${theme} ${width}: ${e.message}`)
        await page.screenshot({ path: `${output}/fail-${theme}-${width}.png` })
      } finally {
        await page.close()
      }
    }
} finally {
  await browser.close()
}
fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
console.log(`P1 merge: ${results.length - failures} passed, ${failures} failed`)
if (failures) process.exitCode = 1
