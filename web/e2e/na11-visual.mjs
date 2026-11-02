import { execFileSync } from "node:child_process"
import { chromium } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const phase = process.env.NA11_PHASE ?? "after"
if (!["before", "after"].includes(phase)) throw new Error("NA11_PHASE must be before or after")
if (phase === "before") {
  const cwd = fileURLToPath(new URL("../", import.meta.url))
  const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8" }).trim()
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], { cwd, encoding: "utf8" }).trim()
  if (head !== "a37e6bc" || changed) throw new Error("Capture Before only from clean develop a37e6bc source")
}
const output = new URL(`.artifacts/na11/${phase}/`, import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
})
const manifest = {
  phase,
  base,
  baseline: "a37e6bc",
  browser: await browser.version(),
  fixture: "existing deterministic mock development fixture",
  fixedUtc: "2026-11-02T14:30:00.000Z",
  screenshots: [],
  findings: [],
}
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
async function quietAlerts(page) {
  for (let i = 0; i < 8; i++) {
    const acknowledge = page.getByRole("button", { name: "Đã xem, xử lý sau", exact: true })
    const close = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if (await acknowledge.isVisible().catch(() => false)) await acknowledge.click()
    else if (await close.isVisible().catch(() => false)) await close.click()
    else break
  }
}
try {
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" })
      await page.clock.setFixedTime(new Date(manifest.fixedUtc))
      await page.addInitScript(
        (theme) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme })),
        theme,
      )
      const capture = async (state) => {
        const filename = `${width}x${height}-${theme}-${state}.png`
        await page.screenshot({ path: fileURLToPath(new URL(filename, output)), animations: "disabled" })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        manifest.screenshots.push({ filename, width, height, theme, state, overflow })
        if (overflow) manifest.findings.push(`${filename}: document overflow`)
      }
      await page.goto(`${base}/floor`, { waitUntil: "networkidle" })
      // Acknowledge the existing synthetic 30-minute warning without mutating bookings.
      await quietAlerts(page)
      if (width >= 768 && phase === "before") {
        const map = page.getByRole("tab", { name: "Sơ đồ", exact: true })
        if (await map.isVisible().catch(() => false)) await map.click()
      }
      await table(page, "B5").waitFor()
      await capture("floor")
      await writeFile(new URL(`${width}x${height}-${theme}-floor.txt`, output), await page.locator("body").innerText())
      await table(page, "B5").focus()
      await table(page, "B5").press("Enter")
      await capture("empty-table")
      if (phase === "before") {
        const booking = page.getByRole("button", { name: /Đặt trước|Đặt bàn/, exact: false })
        if (
          await booking
            .first()
            .isVisible()
            .catch(() => false)
        )
          await booking.first().click()
        else {
          // Baseline mobile only offers walk-in from a free table; record that original path.
          const walkIn = page.getByRole("button", { name: "Mở bàn Walk-in", exact: true })
          if (await walkIn.isVisible().catch(() => false)) await walkIn.click()
        }
      }
      await capture("form")
      await writeFile(new URL(`${width}x${height}-${theme}-form.txt`, output), await page.locator("body").innerText())
      await page.goto(`${base}/floor`, { waitUntil: "networkidle" })
      await quietAlerts(page)
      if (width >= 768 && phase === "before") await page.getByRole("tab", { name: "Sơ đồ", exact: true }).click()
      await table(page, "A3").focus()
      await table(page, "A3").press("Enter")
      await capture("occupied-table")
      await page.goto(phase === "before" ? `${base}/waitlist` : `${base}/floor`, { waitUntil: "networkidle" })
      await quietAlerts(page)
      if (phase === "after")
        await page
          .getByRole("button", { name: /Bàn chờ/ })
          .first()
          .click()
      await capture("waitlist")
      await page.close()
    }
  }
} finally {
  await writeFile(new URL("manifest.json", output), JSON.stringify(manifest, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ phase, screenshots: manifest.screenshots.length, findings: manifest.findings }))
