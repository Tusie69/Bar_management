/** Module 4 preparation queue responsive and interaction acceptance. */
import fs from "node:fs"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const chrome = process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const browser = await chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome } : {})
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]

const session = {
  user: { id: 41, username: "bar_e2e", displayName: "Bar E2E", organizationId: 1, venueId: 1, roles: ["BAR"], accessLevel: null },
  permissions: ["preparation.bar.read", "preparation.bar.transition", "preparation.print.retry"],
  csrfToken: "preparation-e2e-csrf",
  portal: "preparation",
  mustChangePassword: false,
}

function ticket(ticketId, status, version) {
  return {
    ticketId, orderId: ticketId + 100, visitId: 50 + ticketId, visitSequence: ticketId,
    station: "BAR", status, version, submittedAt: "2030-10-24T12:00:00.000Z",
    acceptedAt: null, startedAt: null, readyAt: null, collectedAt: null,
    waitSeconds: ticketId * 60, tableCodes: [`A${ticketId}`],
    lines: [{ lineNo: 1, itemName: `Món ${ticketId}`, variantDisplayName: "Ly", quantity: 2, note: ticketId === 1 ? "Ít đá" : null }],
  }
}

let failures = 0
for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width <= 1024 })
  const page = await context.newPage()
  let firstStatus = "SUBMITTED"
  let firstVersion = 1
  let transitionCount = 0
  let retryCount = 0
  const printEnabled = viewport.width === 1280
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: session }))
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/preparation/BAR/tickets", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await route.fulfill({ json: {
      station: "BAR", changeCursor: String(firstVersion), generatedAt: new Date().toISOString(),
      printing: { enabled: printEnabled }, limit: 200,
      tickets: [ticket(1, firstStatus, firstVersion), ticket(2, "ACCEPTED", 2), ticket(3, "PREPARING", 3), ticket(4, "READY", 4)],
    } })
  })
  await page.route("**/api/v1/preparation/BAR/tickets/1/transition", async (route) => {
    transitionCount += 1
    const payload = route.request().postDataJSON()
    if (payload.toStatus !== "ACCEPTED" || payload.expectedVersion !== 1) throw new Error("Invalid transition payload")
    firstStatus = "ACCEPTED"
    firstVersion = 2
    await route.fulfill({ json: { ticket: ticket(1, firstStatus, firstVersion), changeCursor: "2" } })
  })
  await page.route("**/api/v1/preparation/BAR/tickets/*/print-retry", async (route) => {
    retryCount += 1
    await route.fulfill({ json: { outboxId: 1, status: "PENDING", retryRequestCount: 1 } })
  })

  try {
    await page.goto(`${base}/chebien`)
    await expect(page.getByRole("heading", { name: "Hàng đợi Bar" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Các trạng thái hàng đợi" })).toBeVisible()
    await expect(page.getByText("Ít đá")).toBeVisible()
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width)
    await page.getByRole("button", { name: "Tiếp nhận" }).click()
    await expect.poll(() => transitionCount).toBe(1)
    await expect(page.locator('[data-ticket-id="1"]')).toContainText("Món 1")
    const retry = page.getByRole("button", { name: "Yêu cầu in lại" })
    if (printEnabled) {
      await expect(retry.first()).toBeVisible()
      await retry.first().click()
      await expect.poll(() => retryCount).toBe(1)
    } else {
      await expect(retry).toHaveCount(0)
    }
    const actionSize = await page.getByRole("button", { name: "Bắt đầu làm" }).first().evaluate((node) => node.getBoundingClientRect().height)
    expect(actionSize).toBeGreaterThanOrEqual(44)
    console.log(`PASS preparation ${viewport.width}x${viewport.height}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL preparation ${viewport.width}x${viewport.height}:`, error)
  } finally {
    await context.close()
  }
}

await browser.close()
if (failures) process.exitCode = 1
