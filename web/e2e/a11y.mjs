// Accessibility audit (axe-core, WCAG 2 A/AA + best practices) for every page and the main
// dialogs, in both themes. Run against a dev server:  npm run dev  ->  npm run a11y
import fs from "node:fs"
import { createRequire } from "node:module"
import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
const require = createRequire(import.meta.url)
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
let failures = 0
async function audit(page, label) {
  // Sample the settled UI after finite dialog and button transitions complete.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})))
  })
  await page.addScriptTag({ content: axeSrc })
  const res = await page.evaluate(async () => {
    const out = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "best-practice"],
    })
    return out.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      sample: v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(0, 2).join(" ")),
    }))
  })
  if (res.length) failures++
  console.log(label, res.length ? "" : "OK")
  for (const v of res) console.log("  ", v.impact, v.id, v.n, JSON.stringify(v.sample).slice(0, 600))
}
const idle = async () => {}
const mergeSelection = async (p) => {
  await p.getByRole("button", { name: "Ghép bàn", exact: true }).click()
  await p.locator('[aria-label^="Bàn B5,"]').first().click()
  await p.locator('[aria-label^="Bàn B7,"]').first().click()
}

const scenarios = [
  ["floor", "/floor", idle],
  ["reception-merge-mode", "/floor", mergeSelection, 1],
  ["reception-combined-cell", "/floor", async (p) => { await mergeSelection(p); await p.getByRole("button", { name: /Ghép \d+ bàn|Xác nhận ghép/ }).click(); await p.locator('[data-combined-codes="B5 B7"]').first().waitFor() }, 1],
  ["overview", "/overview", idle],
  ["reservations", "/reservations", idle],
  ["waitlist", "/waitlist", idle],
  ["guests", "/guests", idle],
  ["reports", "/reports", idle],
  ["settings", "/settings", idle],
  [
    "booking",
    "/floor",
    async (p) => {
      await p.getByRole("button", { name: "Tạo đặt bàn" }).first().click()
      await p.waitForTimeout(500)
    },
  ],
  [
    "walkin",
    "/floor",
    async (p) => {
      await p
        .getByRole("button", { name: /Walk-in/ })
        .first()
        .click()
      await p.waitForTimeout(500)
    },
  ],
  [
    "table-seated",
    "/floor",
    async (p) => {
      await p.locator('[aria-label^="Bàn A3,"]').first().click()
      await p.waitForTimeout(500)
    },
  ],
  [
    "table-free",
    "/floor",
    async (p) => {
      await p.locator('[aria-label^="Bàn B5,"]').first().click()
      await p.waitForTimeout(500)
    },
  ],
  [
    "timeline",
    "/reservations",
    async (p) => {
      await p.getByRole("radio", { name: /Lịch/ }).first().click()
      await p.waitForTimeout(500)
    },
  ],
  ["reception-floor", "/floor", idle, 1],
  [
    "reception-walkin",
    "/floor",
    async (p) => {
      await p.locator('[aria-label^="Bàn B5,"]').first().click()
      await p.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
      await p.waitForTimeout(500)
    },
    1,
  ],
  ["reception-mobile-floor", "/floor", idle, 1, { viewport: { width: 390, height: 844 }, hasTouch: true }],
  [
    "reception-mobile-booking-sheet",
    "/floor",
    async (page) => {
      const deferAlert = page.getByRole("button", { name: "Đã xem, xử lý sau" })
      if (await deferAlert.isVisible()) await deferAlert.click()
      await page.locator('[aria-label^="Bàn B5,"]').click()
      await page.getByRole("button", { name: "Tạo đặt trước", exact: true }).click()
      await page.getByRole("button", { name: /Chọn giờ bằng con lăn/ }).click()
      const submit = page.getByRole("button", { name: "Đặt bàn B5", exact: true })
      await expect(submit).toBeEnabled()
      await expect(submit).toHaveCSS("opacity", "1")
    },
    1,
    { viewport: { width: 390, height: 844 }, hasTouch: true },
  ],
  [
    "reception-mobile-walkin",
    "/floor",
    async (p) => {
      const deferAlert = p.getByRole("button", { name: "Đã xem, xử lý sau" })
      if (await deferAlert.isVisible()) await deferAlert.click()
      await p.locator('[aria-label^="Ghế Bar 13,"]').first().click()
      await p.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
      const form = p.getByRole("form", { name: /^(Tạo đặt bàn|Mở bàn Walk-in)/ })
      await form.getByRole("radio", { name: "2 khách" }).click()
      await p.waitForTimeout(500)
    },
    1,
    { viewport: { width: 390, height: 844 }, hasTouch: true },
  ],
]
for (const width of [360, 390, 430]) for (const action of ["Tạo đặt trước", "Mở bàn Walk-in"]) {
  scenarios.push([
    `owner-mobile-form ${action} ${width}`, "/floor", async (page) => {
      for (const name of ["Đã xem, xử lý sau", "Đóng thông báo"]) {
        const button = page.getByRole("button", { name, exact: true })
        if (await button.isVisible()) await button.click()
      }
      await page.locator('[aria-label^="Bàn B5,"]').first().click()
      await page.getByRole("button", { name: action, exact: true }).click()
      const form = page.getByRole("dialog", { name: "Tạo đơn đặt bàn", exact: true })
      await expect(form).toBeVisible()
      const regions = await page.getByRole("region", { name: /Khách quầy bar/ }).evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("aria-label")))
      assert.equal(regions.length, 2)
      assert.equal(new Set(regions).size, 2, `Duplicate Bar landmarks: ${regions.join(", ")}`)
      const scroll = form.getByRole("region", { name: /Khách quầy bar/ })
      await scroll.scrollIntoViewIfNeeded()
      await scroll.focus()
      await expect(scroll).toBeFocused()
      fs.mkdirSync("e2e/.artifacts/rereview4-fixes", { recursive: true })
      const theme = await page.locator("html").getAttribute("class")
      await page.screenshot({ path: `e2e/.artifacts/rereview4-fixes/${theme?.includes("dark") ? "dark" : "light"}-${action === "Tạo đặt trước" ? "booking" : "walkin"}-${width}.png` })
    }, 3, { viewport: { width, height: 844 }, hasTouch: true },
  ])
}
for (const theme of ["dark", "light"]) {
  for (const [name, route, act, userId = 3, pageOptions = {}] of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...pageOptions })
    await page.addInitScript(
      ([t, uid]) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: t })),
      [theme, userId],
    )
    await page.goto(base + route, { waitUntil: "networkidle" })
    await page.waitForTimeout(600)
    await act(page)
    await audit(page, `${theme} ${name}`)
    await page.close()
  }
}
await browser.close()
console.log(failures ? `\n${failures} views with violations` : "\nNO VIOLATIONS")
process.exit(failures ? 1 : 0)
