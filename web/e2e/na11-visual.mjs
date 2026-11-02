import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { chromium, expect } from "@playwright/test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
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
const axeSrc = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
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
        await page.waitForLoadState("networkidle")
        if (phase === "after" && ["empty-table", "form"].includes(state)) {
          await expect(page.getByText("Đang kiểm tra lại bàn đã chọn...", { exact: true })).toBeHidden()
          const submit = page.getByRole("dialog").last().locator("footer button")
          if (await submit.count()) {
            await expect(submit).toBeEnabled()
            await expect.poll(() => submit.evaluate((node) => getComputedStyle(node).opacity)).toBe("1")
          }
        }
        const filename = `${width}x${height}-${theme}-${state}.png`
        await page.screenshot({ path: fileURLToPath(new URL(filename, output)), animations: "disabled" })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        manifest.screenshots.push({ filename, width, height, theme, state, overflow })
        if (overflow) manifest.findings.push(`${filename}: document overflow`)
        if (phase === "after") {
          await page.addScriptTag({ content: axeSrc })
          const violations = await page.evaluate(async () => {
            const result = await window.axe.run(document, {
              resultTypes: ["violations"],
              runOnly: ["wcag2a", "wcag2aa", "best-practice"],
            })
            return result.violations.map(({ id, impact, nodes }) => ({
              id,
              impact,
              targets: nodes.map((node) => node.target),
            }))
          })
          if (violations.length) manifest.findings.push({ filename, violations })
        }
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
        const booking = page.getByRole("button", { name: /Đặt trước|Đặt bàn/i, exact: false })
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
  if (phase === "after") {
    const owner = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
    await owner.clock.setFixedTime(new Date(manifest.fixedUtc))
    await owner.addInitScript(() =>
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" })),
    )
    await owner.goto(`${base}/floor`, { waitUntil: "networkidle" })
    await quietAlerts(owner)
    await owner.getByRole("button", { name: "Tạo mới", exact: true }).click()
    await owner.getByRole("button", { name: /Tạo đặt trước/ }).click()
    const ownerForm = owner.getByRole("dialog", { name: "Tạo đơn đặt bàn" })
    await expect(ownerForm.getByText("Đang kiểm tra lại bàn đã chọn...", { exact: true })).toHaveCount(0)
    await ownerForm.getByLabel("Tên khách", { exact: true }).fill("NA11 owner unassigned booking")
    await expect(ownerForm.locator("footer button")).toBeEnabled()
    await ownerForm.locator("footer button").click()
    await expect(ownerForm).toBeHidden()
    await owner.close()

    const pending = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
    await pending.clock.setFixedTime(new Date(manifest.fixedUtc))
    await pending.addInitScript(() =>
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" })),
    )
    await pending.goto(`${base}/floor`, { waitUntil: "networkidle" })
    await quietAlerts(pending)
    await table(pending, "B5").waitFor()
    // Freeze mock latency so the actual selected-table availability request stays pending.
    await pending.clock.pauseAt(new Date(manifest.fixedUtc))
    await table(pending, "B5").click({ force: true })
    const pendingForm = pending.getByRole("dialog", { name: "Tạo đơn đặt bàn" })
    const loading = pendingForm.getByText("Đang kiểm tra lại bàn đã chọn...", { exact: true })
    await expect(loading).toBeVisible()
    await expect(pendingForm.locator("footer button")).toBeDisabled()
    expect(await loading.evaluate((node) => getComputedStyle(node).animationName)).toBe("none")
    await pending.close()
  }
} finally {
  await writeFile(new URL("manifest.json", output), JSON.stringify(manifest, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ phase, screenshots: manifest.screenshots.length, findings: manifest.findings }))
if (manifest.findings.length) throw new Error("Visual geometry/accessibility findings need review; see manifest")
