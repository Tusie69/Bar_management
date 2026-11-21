/** Module 4 preparation queue responsive and interaction acceptance. */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-preparation-queue")
fs.mkdirSync(output, { recursive: true })
const chrome = process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const browser = await chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome } : {})
const viewports = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
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
    // L3: contract Giai doan 2 — nguoi goi va co van hanh, khong co ten khach.
    orderedByDisplayName: ticketId === 2 ? "Minh" : "Phuc vu",
    guestFlags: { vip: ticketId === 2, birthday: false, designated: ticketId === 2 },
    // L2: mock phải theo đúng hợp đồng mới — API trả số CÒN PHẢI LÀM kèm
    // cancelledQuantity và originalQuantity. Phiếu 2 mang thêm một dòng hủy một
    // phần và một dòng hủy toàn bộ để màn hình được kiểm cả ba trạng thái.
    lines: [
      { lineNo: 1, itemName: `Món ${ticketId}`, variantDisplayName: "Ly", quantity: 2, cancelledQuantity: 0, originalQuantity: 2, note: ticketId === 1 ? "Ít đá" : null, pendingCancellation: null },
      ...(ticketId === 2
        ? [
            { lineNo: 2, itemName: "Khay thịt muối", variantDisplayName: "Phần", quantity: 1, cancelledQuantity: 1, originalQuantity: 2, note: "Không hành", pendingCancellation: null },
            { lineNo: 3, itemName: "Khoai tây truffle", variantDisplayName: "Phần", quantity: 0, cancelledQuantity: 1, originalQuantity: 1, note: null, pendingCancellation: null },
            // L3: vua co phan da duyet huy, vua co yeu cau huy moi chua duyet.
            { lineNo: 4, itemName: "Negroni", variantDisplayName: "Ly", quantity: 2, cancelledQuantity: 1, originalQuantity: 4, note: null, pendingCancellation: { cancellationId: 11, quantity: 1 } },
          ]
        : []),
    ],
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

    // L2 — ba trạng thái hủy trên cùng một phiếu.
    const ticket2 = page.locator('[data-ticket-id="2"]')
    // Không hủy: con số nguyên như khách gọi, không nhãn.
    await expect(ticket2.locator('[data-line-no="1"]')).toContainText("2×")
    await expect(ticket2.locator('[data-line-no="1"][data-cancelled]')).toHaveCount(0)
    // Hủy 1 trong 2: hiện 1× kèm nhãn nói rõ chỉ làm 1, ghi chú vẫn còn.
    const partial = ticket2.locator('[data-line-no="2"]')
    await expect(partial).toHaveAttribute("data-cancelled", "partial")
    await expect(partial).toContainText("1×")
    await expect(partial).toContainText("Đã hủy 1, chỉ làm 1")
    await expect(partial).toContainText("Không hành")
    await expect(partial).toContainText("Phần")
    // Hủy toàn bộ: gạch ngang, làm mờ, và nói thẳng là không làm.
    const full = ticket2.locator('[data-line-no="3"]')
    await expect(full).toHaveAttribute("data-cancelled", "all")
    await expect(full).toContainText("Đã hủy toàn bộ, không làm")
    expect(await full.evaluate((node) => node.className)).toContain("opacity-60")
    expect(await full.locator("div").first().evaluate((node) => getComputedStyle(node).textDecorationLine))
      .toContain("line-through")
    // L3 — ngon ngu Bartender, metadata va co van hanh.
    await expect(page.getByText("Đang pha", { exact: true })).toBeVisible()
    await expect(page.getByText("Hoàn thành · chờ bàn giao", { exact: true })).toBeVisible()
    await expect(ticket2).toContainText("Đơn 2 · gọi lúc 19:00 · Minh")
    await expect(ticket2).not.toContainText("Phiên #")
    await expect(ticket2.getByText("VIP")).toBeVisible()
    await expect(ticket2.getByText("Chỉ định")).toBeVisible()
    await expect(ticket2.locator('[data-line-no="4"]')).toContainText("Đã hủy 1, chỉ làm 2")
    await expect(ticket2.locator('[data-line-no="4"]')).toContainText("Đang chờ duyệt hủy 1 phần")
    await expect(ticket2.getByRole("button", { name: "Bắt đầu pha" })).toBeVisible()
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
    const actionSize = await page.getByRole("button", { name: "Bắt đầu pha" }).first().evaluate((node) => node.getBoundingClientRect().height)
    expect(actionSize).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: path.join(output, `bar-after-cancellation-${viewport.width}x${viewport.height}.png`) })
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
