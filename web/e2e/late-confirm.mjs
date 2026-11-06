import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)

const cases = [
  { name: "mobile-dark", width: 390, height: 844, path: "/floor", theme: "dark" },
  { name: "tablet-light", width: 834, height: 1112, path: "/floor", theme: "light" },
  { name: "desktop-dark", width: 1440, height: 900, path: "/floor", theme: "dark" },
]

for (const item of cases) {
  const page = await browser.newPage({ viewport: { width: item.width, height: item.height } })
  await page.addInitScript(
    ({ theme }) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme })),
    { theme: item.theme },
  )
  await page.goto(base + item.path, { waitUntil: "networkidle" })
  await page.evaluate(async () => {
    const { demo } = await import("/src/services/index.ts")
    demo?.reset()
  })
  await page.reload({ waitUntil: "networkidle" })
  const defer = page.getByRole("button", { name: "Đã xem, xử lý sau" })
  if (await defer.isVisible()) await defer.click()

  const table = page.locator('[aria-label^="Bàn B3,"], [aria-label^="Bàn B3:"]').first()
  if (!(await table.count())) {
    const labels = await page.locator("[aria-label]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")).filter(Boolean))
    throw new Error(`${item.name}: B3 not found; body=${(await page.locator("body").innerText()).slice(0, 500)}; labels=${labels.slice(0, 30).join(" | ")}`)
  }
  await table.click()
  const action = page.getByRole("button", { name: "Tới muộn", exact: true })
  await action.waitFor()
  await action.click()
  const dialog = page.getByRole("alertdialog")
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Tới muộn", exact: true }).click()
  await table.waitFor()
  await page.waitForFunction(() => {
    const node = document.querySelector('[aria-label^="Bàn B3,"], [aria-label^="Bàn B3:"]')
    return node?.getAttribute("aria-label")?.includes("Không tới (đã báo tới muộn)")
  })
  const label = await table.getAttribute("aria-label")
  if (!label?.includes("Không tới (đã báo tới muộn)")) throw new Error(`${item.name}: state did not update: ${label}`)
  if (item.width < 768) await expect(page.getByText("Không tới · đã báo muộn · 15 phút", { exact: true })).toBeVisible()
  const state = () => page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const catalog = await api.getCatalog()
    const id = catalog.tables.find(t => t.code === "B3").id
    return (await api.getFloorState(clock.now())).tables.find(t => t.tableId === id).state
  })
  assert.equal(await state(), "late_confirmed")

  if (item.name === "mobile-dark") {
    await page.evaluate(async () => {
      const { clock } = await import("/src/services/index.ts")
      clock.advance(5)
    })
    await page.waitForFunction(() => {
      const node = document.querySelector('[aria-label^="Bàn B3,"], [aria-label^="Bàn B3:"]')
      return node?.getAttribute("aria-label")?.includes("Không tới")
    }, undefined, { timeout: 20_000 })
    const afterThreshold = await table.getAttribute("aria-label")
    if (!afterThreshold?.includes("Không tới")) throw new Error(`Option A did not switch to NO_SHOW: ${afterThreshold}`)
    assert.equal(await state(), "noshow", "Option A threshold must still override late confirmation")

    const deferNoShow = page.getByRole("button", { name: "Đã xem, xử lý sau" })
    if (await deferNoShow.isVisible()) await deferNoShow.click()
    await page.getByRole("button", { name: "Khách đã đến", exact: true }).click()
    await page.waitForFunction(() => {
      const node = document.querySelector('[aria-label^="Bàn B3,"], [aria-label^="Bàn B3:"]')
      return node?.getAttribute("aria-label")?.includes("Có khách")
    })
    assert.equal(await state(), "seated", "arrival still checks the booking in")
  }
  await page.close()
  console.log(`PASS ${item.name}`)
}

await browser.close()
