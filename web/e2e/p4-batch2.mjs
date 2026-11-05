// Mock browser regressions for the merged label, role controls and waiting marker.
import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
import fs from "node:fs"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5198"
const only = process.env.P4_CASE
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" })
const results = []
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"]`).first()
async function snapshot(page) {
  return page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const catalog = await api.getCatalog()
    const floor = await api.getFloorState(clock.now())
    return floor.tables.map(row => ({ ...row, code: catalog.tables.find(t => t.id === row.tableId).code }))
  })
}
async function dismiss(page) {
  for (let i = 0; i < 10; i++) {
    const button = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ }).first()
    if (!await button.isVisible()) break
    await button.click()
  }
}
async function advance(page, minutes) {
  await page.evaluate(async minutes => { const { clock } = await import("/src/services/index.ts"); clock.advance(minutes) }, minutes)
  await dismiss(page)
}
async function run(name, userId, width, fn) {
  if (only && only !== name) return
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: true, reducedMotion: "reduce" })
  const errors = []
  page.on("pageerror", e => errors.push(e.message))
  await page.clock.install({ time: new Date("2026-11-04T14:30:00Z") })
  await page.addInitScript(userId => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId, theme: "light" })), userId)
  try {
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    await table(page, "A5").waitFor()
    await dismiss(page)
    await fn(page)
    assert.deepEqual(errors, [], "browser errors")
    results.push({ name, result: "PASS" })
    console.log(`PASS ${name}`)
  } finally { await page.close() }
}

try {
  await run("labels and manual threshold", 3, 1280, async page => {
    // B3 starts 25 minutes late in the seed. A5 starts 10 minutes late.
    assert.equal((await snapshot(page)).find(t => t.code === "B3").state, "late")
    await expect(table(page, "B3")).toHaveAttribute("aria-label", /Bàn B3, Không tới,/)
    await expect(table(page, "B3")).toContainText("+25'")
    await table(page, "B3").click()
    await expect(page.getByRole("button", { name: "Check-in B3", exact: true })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Không tới", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Tới muộn", exact: true }).click()
    await expect(table(page, "B3")).toHaveAttribute("aria-label", /Không tới \(đã báo tới muộn\)/)
    await expect(page.getByText("Khách đã báo sẽ tới muộn", { exact: true })).toBeVisible()
    assert.equal((await snapshot(page)).find(t => t.code === "B3").state, "late_confirmed")
    await advance(page, 4)
    await expect(table(page, "B3")).toContainText("+29'")
    await expect(page.getByRole("button", { name: "Không tới", exact: true })).toBeDisabled()
    await advance(page, 1)
    assert.equal((await snapshot(page)).find(t => t.code === "B3").state, "noshow")
    await expect(table(page, "B3")).toContainText("+30'")
    await expect(page.getByRole("button", { name: "Không tới", exact: true })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Check-in B3", exact: true })).toBeEnabled()
    await advance(page, 45)
    assert.equal((await snapshot(page)).find(t => t.code === "B3").state, "noshow", "no automatic cancellation")
    await expect(table(page, "B3")).toHaveAttribute("aria-label", /Không tới/)
  })
  await run("combined legend and group", 3, 1280, async page => {
    await table(page, "B3").click()
    await page.getByRole("button", { name: "Tới muộn", exact: true }).click()
    await expect(table(page, "B3")).toHaveAttribute("aria-label", /đã báo tới muộn/)
    // Advancing A5 to late leaves B3 confirmed and A7/A6 a shared no-show group.
    await advance(page, 1)
    const rows = await snapshot(page)
    assert(rows.some(t => t.state === "late_confirmed"), "confirmed fixture exists")
    assert(rows.some(t => t.state === "noshow" && t.claim?.groupId), "no-show group fixture exists")
    assert(rows.some(t => t.state === "hold_overdue"), "overdue hold fixture exists")
    const combined = rows.filter(t => ["late", "late_confirmed", "noshow", "hold_overdue"].includes(t.state))
    const expected = new Set(combined.map(t => t.claim?.groupId ? `group:${t.claim.groupId}` : `table:${t.tableId}`)).size
    assert(expected < combined.length, "fixture proves group deduplication")
    const legend = page.getByRole("region", { name: "Chú giải trạng thái bàn", exact: true })
    const chip = legend.getByText("Không tới", { exact: true })
    await expect(chip).toHaveCount(1)
    await expect(chip.locator("..")).toHaveText(`Không tới${expected}`)
    for (const row of rows.filter(t => t.state === "hold_overdue")) await expect(table(page, row.code)).toContainText("quá hạn")
    // A5 is not late yet at +11; advance to +16 to cover the unconfirmed late bucket too.
    await advance(page, 5)
    const after = (await snapshot(page)).filter(t => ["late", "late_confirmed", "noshow", "hold_overdue"].includes(t.state))
    assert(after.some(t => t.state === "late"), "late fixture exists")
    await expect(chip.locator("..")).toHaveText(`Không tới${new Set(after.map(t => t.claim?.groupId ? `group:${t.claim.groupId}` : `table:${t.tableId}`)).size}`)
  })
  for (const width of [768, 1024, 1280, 1440]) {
    await run(`receptionist ${width}`, 1, width, async page => {
      await expect(page.getByRole("button", { name: "Xem khả dụng", exact: true })).toHaveCount(0)
      await expect(page.getByRole("group", { name: "Sơ đồ bàn, trạng thái hiện tại", exact: true })).toBeVisible()
    })
  }
  await run("owner availability", 3, 1280, async page => {
    await page.getByRole("button", { name: "Xem khả dụng", exact: true }).click()
    await expect(page.getByRole("group", { name: /^Sơ đồ khả dụng lúc/ })).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "Xem trước" })).toBeVisible()
    await page.getByRole("button", { name: "Về Live", exact: true }).click()
    await expect(page.getByRole("group", { name: "Sơ đồ bàn, trạng thái hiện tại", exact: true })).toBeVisible()
  })
  for (const width of [390, 1280]) {
    await run(`waiting marker zones ${width}`, 1, width, async page => {
      const waiting = await page.evaluate(async () => {
        const { api, clock } = await import("/src/services/index.ts")
        const { businessDateOf } = await import("/src/lib/time.ts")
        return (await api.listWaitlist(businessDateOf(clock.now()))).filter(row => ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"].includes(row.status))
      })
      assert(waiting.length > 0, "nonzero real waiting fixture")
      for (const zone of ["Tất cả", "Khu A", "Khu B", "Khu C", "Bar"]) {
        await page.getByRole("tab", { name: zone, exact: true }).click()
        const marker = page.getByRole("button", { name: /^Bàn chờ(?:,|$)/ })
        await expect(marker).toHaveCount(1)
        await expect(marker).toHaveAttribute("aria-label", `Bàn chờ, ${waiting.length} khách đang chờ`)
        await expect(marker).toHaveText(`Bàn chờ +${waiting.length}`)
        await expect(marker).toBeInViewport({ ratio: 1 })
        const inSvg = await marker.evaluate(node => !!node.closest("svg"))
        assert.equal(inSvg, zone === "Tất cả", `${zone}: marker placement`)
        if (zone !== "Tất cả") {
          const before = await marker.boundingBox()
          const canvas = page.locator('svg[role="group"]')
          const box = await canvas.boundingBox()
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20); await page.mouse.up()
          const after = await marker.boundingBox()
          assert(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, `${zone}: overlay stays fixed during pan`)
          await expect(marker).toBeInViewport({ ratio: 1 })
        }
        await marker.click()
        const sheet = page.getByRole("dialog", { name: "Bàn chờ ảo", exact: true })
        await expect(sheet).toBeVisible()
        await expect(sheet).toContainText(waiting[0].displayName)
        await page.keyboard.press("Escape")
        await expect(sheet).toBeHidden()
        await expect(page.getByRole("button", { name: /zoom|full\s*screen|phóng to|thu nhỏ|toàn màn hình|^[+−-]$/i })).toHaveCount(0)
        await expect(page.getByRole("group", { name: /zoom|thu phóng|toàn màn hình/i })).toHaveCount(0)
      }
    })
  }
  assert(results.length > 0, "P4_CASE must select an existing regression")
} finally {
  fs.mkdirSync("e2e/.artifacts/batch2", { recursive: true })
  fs.writeFileSync("e2e/.artifacts/batch2/p4-results.json", JSON.stringify(results, null, 2))
  await browser.close()
}
