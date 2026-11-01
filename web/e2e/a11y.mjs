// Accessibility audit (axe-core, WCAG 2 A/AA + best practices) for every page and the main
// dialogs, in both themes. Run against a dev server:  npm run dev  ->  npm run a11y
import fs from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "@playwright/test"
const require = createRequire(import.meta.url)
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
let failures = 0
async function audit(page, label) {
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
const scenarios = [
  ["floor", "/floor", idle],
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
]
for (const theme of ["dark", "light"]) {
  for (const [name, route, act] of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    // userId 3 = Chủ quán (owner) so every page, including reports, is reachable.
    await page.addInitScript(
      ([t]) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: t })),
      [theme],
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
