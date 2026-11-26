/**
 * TU-45 — E2E chốt bill, ở bản đã build, trên sáu bề ngang.
 *
 * Bảy điều phải đúng:
 *
 * 1. Màn 1 lọc theo ba nhóm và số đếm đi theo dữ liệu, không theo trang đang lọc.
 * 2. Một CỤM BÀN GHÉP chỉ có MỘT thẻ, và thẻ đó mang đủ mã bàn.
 * 3. Màn 2 hiện đủ Tạm tính → VAT → Làm tròn → Khách phải trả, bằng con số của
 *    máy chủ, không tính lại ở trình duyệt.
 * 4. Nhãn "Đang phát triển" HIỆN RA cho Giảm giá, Tách bill, Hoá đơn điện tử —
 *    khoá chứ không biến mất.
 * 5. Nút Chốt bill khoá khi còn lý do, và LÝ DO hiện ngay cạnh nút.
 * 6. Một lần bấm = một request, kể cả khi bấm thêm trong lúc đang ghi nhận.
 * 7. Không tràn ngang ở 320px, và bản in 80mm nói "CHƯA PHẢI HOÁ ĐƠN".
 *
 * Chạy: `pnpm --filter @21gam/web e2e:tu45` với dev server ở 5191.
 * Mọi API bị chặn ở tầng mạng, nên script không cần database và không ghi gì.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-tu45-bill")
const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }

// 320 có trong danh sách vì mockup NA-44 có artboard riêng cho nó: màn thu tiền
// phải đọc được trên máy cũ nhất còn dùng trong quán.
const viewports = [
  { name: "320x640", width: 320, height: 640 },
  { name: "360x800", width: 360, height: 800 },
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
]

const BUSINESS_DATE = "2030-01-01"
const SINGLE_VISIT = 41
const GROUP_VISIT = 42
const EMPTY_VISIT = 43

const session = {
  user: {
    id: 5,
    username: "thungan_ui",
    displayName: "Thu ngân UI",
    organizationId: 1,
    venueId: 1,
    roles: ["CASHIER"],
    accessLevel: null,
  },
  permissions: ["order.read", "order.create", "payment.collect", "visit.mark_paid"],
  csrfToken: "e2e-token",
  portal: "cashier",
  mustChangePassword: false,
}

const notAvailable = [
  { feature: "DISCOUNT", status: "IN_DEVELOPMENT", label: "Giảm giá" },
  { feature: "SPLIT_BILL", status: "IN_DEVELOPMENT", label: "Tách bill" },
  { feature: "E_INVOICE", status: "IN_DEVELOPMENT", label: "Hóa đơn điện tử" },
]

const paymentMethods = [
  { method: "CASH", available: true, label: "Tiền mặt" },
  { method: "BANK_TRANSFER", available: true, label: "Chuyển khoản QR" },
  { method: "CREDIT", available: false, label: "Ghi nợ", status: "IN_DEVELOPMENT", reason: "Đang phát triển" },
]

/** Bộ số T2 của `bill-total.test.ts`: 209.600 → VAT 20.960 → 230.560 → 231.000. */
const amounts = {
  subtotalVnd: 209_600,
  vatRateBasisPoints: 1000,
  vatVnd: 20_960,
  preRoundTotalVnd: 230_560,
  roundingAdjustmentVnd: 440,
  totalVnd: 231_000,
}

const lines = [
  {
    lineNo: 1,
    sourceOrderLineId: 901,
    itemCode: "MACALLAN_12",
    itemName: "MACALLAN 12",
    variantDisplayName: "Ly",
    unitCode: "GLASS",
    note: null,
    quantity: 2,
    unitPriceVnd: 100_000,
    amountVnd: 200_000,
  },
  {
    lineNo: 2,
    sourceOrderLineId: 902,
    itemCode: "PEANUT",
    itemName: "ĐẬU PHỘNG",
    variantDisplayName: "Phần",
    unitCode: "PORTION",
    note: null,
    quantity: 1,
    unitPriceVnd: 9_600,
    amountVnd: 9_600,
  },
]

const charges = [
  {
    sequenceNo: 1,
    chargeCode: "ITEM_SUBTOTAL",
    basisAmountVnd: 0,
    rateBasisPoints: null,
    signedAmountVnd: 209_600,
    explanation: "Tạm tính 3 món",
  },
  {
    sequenceNo: 2,
    chargeCode: "VAT",
    basisAmountVnd: 209_600,
    rateBasisPoints: 1000,
    signedAmountVnd: 20_960,
    explanation: "VAT 10%",
  },
  {
    sequenceNo: 3,
    chargeCode: "FINAL_ROUNDING",
    basisAmountVnd: 230_560,
    rateBasisPoints: null,
    signedAmountVnd: 440,
    explanation: "Làm tròn lên nghìn",
  },
]

function preview(visitId, overrides = {}) {
  return {
    preview: {
      visitId,
      tableCodes: visitId === GROUP_VISIT ? ["A1", "A2"] : ["A6"],
      groupSymbol: visitId === GROUP_VISIT ? "G01" : null,
      orderCount: 1,
      lines,
      charges,
      ...amounts,
      previewedAt: "2030-01-01T14:00:00.000Z",
      blockers: [],
      notAvailable,
      ...overrides,
    },
  }
}

function closedBill(visitId) {
  return {
    bill: {
      id: 7,
      billCode: "B300101-0007",
      shortCode: "B0007",
      visitId,
      businessDate: BUSINESS_DATE,
      revision: 1,
      status: "AWAITING_PAYMENT",
      tableCodes: visitId === GROUP_VISIT ? ["A1", "A2"] : ["A6"],
      groupSymbol: visitId === GROUP_VISIT ? "G01" : null,
      orderCount: 1,
      lineCount: lines.length,
      itemCount: 3,
      lines,
      charges,
      ...amounts,
      closedBy: { userId: 5, displayName: "Thu ngân UI" },
      closedAt: "2030-01-01T14:01:00.000Z",
      paidBy: null,
      paidAt: null,
      qr: {
        provider: "VIETQR_DYNAMIC",
        payload:
          "00020101021238570010A00000072701270006970407011310390000741202080208QRIBFTTA5204000053037045406231000" +
          "5802VN5913CONG TY 21GAM6226082221GAM B300101-00076304ABCD",
        transferNote: "21GAM B300101-0007",
        beneficiary: { bankBin: "970407", accountNumber: "1039••••7412", accountName: "CONG TY 21GAM" },
        amountVnd: amounts.totalVnd,
        isDemo: true,
      },
      paymentMethods,
      notAvailable,
      version: 1,
    },
  }
}

const billList = {
  businessDate: BUSINESS_DATE,
  counts: { all: 3, serving: 2, awaitingPayment: 1 },
  items: [
    {
      billId: null,
      billCode: null,
      shortCode: null,
      visitId: SINGLE_VISIT,
      status: "SERVING",
      tableCodes: ["A6"],
      groupSymbol: null,
      orderCount: 1,
      itemCount: 3,
      startedAt: "2030-01-01T13:00:00.000Z",
      closedAt: null,
      ...amounts,
    },
    {
      billId: 7,
      billCode: "B300101-0007",
      shortCode: "B0007",
      visitId: GROUP_VISIT,
      status: "AWAITING_PAYMENT",
      tableCodes: ["A1", "A2"],
      groupSymbol: "G01",
      orderCount: 2,
      itemCount: 5,
      startedAt: "2030-01-01T12:30:00.000Z",
      closedAt: "2030-01-01T13:55:00.000Z",
      ...amounts,
    },
    {
      billId: null,
      billCode: null,
      shortCode: null,
      visitId: EMPTY_VISIT,
      status: "SERVING",
      tableCodes: ["A5"],
      groupSymbol: null,
      orderCount: 0,
      itemCount: 0,
      startedAt: "2030-01-01T13:40:00.000Z",
      closedAt: null,
      subtotalVnd: 0,
      vatRateBasisPoints: 1000,
      vatVnd: 0,
      preRoundTotalVnd: 0,
      roundingAdjustmentVnd: 0,
      totalVnd: 0,
    },
  ],
}

async function readOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: [...document.querySelectorAll("button,main,section,li,table")]
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 30),
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.right > document.documentElement.clientWidth + 1)
      .map(({ label, right }) => ({ label, right: Math.round(right) })),
  }))
}

await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch(launchOptions)
const failures = []

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  })
  // SSE không có chỗ trong một script chặn mạng: để nguyên thì mỗi trang treo
  // một kết nối không bao giờ trả lời và `networkidle` không bao giờ tới.
  await context.addInitScript(() => {
    class QuietEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: QuietEventSource })
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date("2030-01-01T14:00:00.000Z"))

  const closeRequests = []
  let holdCloseMs = 0
  let billClosed = false

  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: session }))
  await page.route("**/api/v1/tables/catalog*", (route) => route.fulfill({ json: { tables: [], zones: [] } }))
  await page.route("**/api/v1/bills?*", (route) => route.fulfill({ json: billList }))
  await page.route("**/api/v1/bills/preview?*", (route) => {
    const visitId = Number(new URL(route.request().url()).searchParams.get("visitId"))
    if (visitId === EMPTY_VISIT) {
      return route.fulfill({
        json: preview(visitId, {
          lines: [],
          subtotalVnd: 0,
          vatVnd: 0,
          preRoundTotalVnd: 0,
          roundingAdjustmentVnd: 0,
          totalVnd: 0,
          blockers: [{ code: "BILL_EMPTY", message: "Bàn chưa gọi món nào, nên chưa có gì để xuất hoá đơn." }],
        }),
      })
    }
    if (visitId === GROUP_VISIT && billClosed) {
      return route.fulfill({
        json: preview(visitId, {
          blockers: [
            {
              code: "BILL_ALREADY_OPEN",
              message: "Phiên đã có bill B300101-0007 đang chờ thanh toán.",
              context: { billId: 7, billCode: "B300101-0007" },
            },
          ],
        }),
      })
    }
    return route.fulfill({ json: preview(visitId) })
  })
  await page.route("**/api/v1/bills/7", (route) => route.fulfill({ json: closedBill(GROUP_VISIT) }))
  await page.route("**/api/v1/bills", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    closeRequests.push(route.request().postDataJSON())
    if (holdCloseMs) await new Promise((resolve) => setTimeout(resolve, holdCloseMs))
    billClosed = true
    await route.fulfill({ status: 201, json: closedBill(GROUP_VISIT) })
  })

  // ---------------------------------------------------- Màn 1: Phiên đang mở

  await page.goto(`${base}/thanh-toan`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: "Phiên đang mở" })).toBeVisible()

  // Số đếm đi theo dữ liệu của quán, không theo trang đang lọc.
  await expect(page.getByRole("radio", { name: "Tất cả (3)" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Đang phục vụ (2)" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Chờ thanh toán (1)" })).toBeVisible()

  // Cụm bàn ghép: MỘT thẻ, mang đủ mã bàn và ký hiệu cụm.
  const groupCard = page.getByRole("button", { name: /A1 \+ A2 · G01/ })
  await expect(groupCard).toHaveCount(1)
  await expect(groupCard).toContainText("Chờ thanh toán")
  await expect(groupCard).toContainText("B0007")

  // Lọc "Chờ thanh toán" chỉ còn cụm đó.
  await page.getByRole("radio", { name: "Chờ thanh toán (1)" }).click()
  await expect(page.getByRole("button", { name: /A6/ })).toHaveCount(0)
  await expect(groupCard).toBeVisible()
  await page.getByRole("radio", { name: "Tất cả (3)" }).click()

  await page.screenshot({ path: path.join(output, `${viewport.name}-list.png`) })

  // ------------------------------------------- Màn 2: bàn chưa gọi món (rỗng)

  await page.goto(`${base}/thanh-toan/phien/${EMPTY_VISIT}`, { waitUntil: "networkidle" })
  await expect(page.getByText("Bàn chưa gọi món nào, nên chưa có gì để tính.")).toBeVisible()
  const blockedButton = page.getByRole("button", { name: /Xuất hóa đơn/ })
  await expect(blockedButton).toBeDisabled()
  // Nút vô hiệu luôn có LÝ DO đọc được ngay cạnh nó.
  await expect(page.getByText("Bàn chưa gọi món nào, nên chưa có gì để xuất hoá đơn.")).toBeVisible()
  await page.screenshot({ path: path.join(output, `${viewport.name}-empty.png`) })

  // --------------------------------- Màn 2 + Màn 3: tạm tính và nhãn chưa làm

  await page.goto(`${base}/thanh-toan/phien/${GROUP_VISIT}`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: "A1 + A2 · G01" })).toBeVisible()

  // Bốn dòng tiền, đúng con số máy chủ gửi.
  await expect(page.getByText("Tạm tính", { exact: true })).toBeVisible()
  await expect(page.getByText("209.600đ")).toBeVisible()
  await expect(page.getByText("VAT 10%", { exact: true })).toBeVisible()
  await expect(page.getByText("20.960đ")).toBeVisible()
  await expect(page.getByText("Làm tròn lên nghìn", { exact: true })).toBeVisible()
  await expect(page.getByText("440đ")).toBeVisible()
  await expect(page.getByText("Khách phải trả")).toBeVisible()
  await expect(page.getByText("231.000đ")).toBeVisible()

  // Nhãn "Đang phát triển" HIỆN RA, khoá chứ không biến mất.
  for (const label of ["Giảm giá", "Tách bill", "Hóa đơn điện tử"]) {
    await expect(page.getByText(`${label} · Đang phát triển`)).toBeVisible()
  }

  // Bản in 80mm nói rõ nó chưa phải hoá đơn.
  await page.getByRole("tab", { name: "Bản in 80mm" }).click()
  const paper = page.getByTestId("bill-print-80mm")
  await expect(paper).toContainText("TẠM TÍNH – CHƯA PHẢI HÓA ĐƠN")
  await expect(paper).toContainText("KHÁCH PHẢI TRẢ")
  await page.screenshot({ path: path.join(output, `${viewport.name}-print.png`) })
  await page.getByRole("tab", { name: "Trên màn hình" }).click()

  // In chỉ mô phỏng, và nó nói thẳng điều đó.
  await page.getByRole("button", { name: /In hóa đơn/ }).click()
  await expect(page.getByText("Chưa nối máy in thật — lần in này chỉ mô phỏng.")).toBeVisible()

  // --------------------------------- một lần bấm = một request, nút khoá ngay

  holdCloseMs = 600
  const closeButton = page.getByRole("button", { name: /Xuất hóa đơn/ })
  await closeButton.click()
  await expect(page.getByRole("button", { name: /Đang ghi nhận/ })).toBeDisabled()
  await page
    .getByRole("button", { name: /Đang ghi nhận/ })
    .click({ force: true, trial: true })
    .catch(() => {})
  await expect(page.getByText(/Đã xuất hóa đơn B300101-0007/)).toBeVisible({ timeout: 10_000 })
  holdCloseMs = 0

  if (closeRequests.length !== 1) {
    failures.push(`${viewport.name}: một lần bấm phải là một request, nhận ${closeRequests.length}`)
  }
  // Tổng người bấm vừa nhìn phải đi kèm, nếu không bill chốt ở một con số khác.
  if (closeRequests[0]?.expectedTotalVnd !== 231_000) {
    failures.push(`${viewport.name}: thiếu expectedTotalVnd trong yêu cầu xuất hoá đơn`)
  }
  if (typeof closeRequests[0]?.idempotencyKey !== "string") {
    failures.push(`${viewport.name}: thiếu mã chống trùng trong yêu cầu xuất hoá đơn`)
  }

  // Sau khi xuất hoá đơn: Phiên sang Chờ thanh toán, nút Xuất hoá đơn biến mất,
  // và màn chọn phương thức của Thu ngân xuất hiện (TN-02 → TN-07). Tài khoản
  // của test có `payment.collect`, nên panel thu tiền hiện.
  await expect(page.getByText("Chờ thanh toán").first()).toBeVisible()
  await expect(page.getByRole("button", { name: /Xuất hóa đơn/ })).toHaveCount(0)
  await expect(page.getByTestId("payment-methods")).toBeVisible()
  // Ghi nợ hiện nhưng khoá, kèm nhãn (CH-05, TN-10-K0).
  await expect(page.getByRole("button", { name: /Ghi nợ/ })).toBeDisabled()
  await expect(page.getByText("Ghi nợ").first()).toBeVisible()
  await page.screenshot({ path: path.join(output, `${viewport.name}-closed.png`) })

  // ------------------------------------------------------ không tràn ngang

  const overflow = await readOverflow(page)
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    failures.push(
      `${viewport.name}: tràn ngang ${overflow.scrollWidth} > ${overflow.clientWidth}` +
        ` — ${JSON.stringify(overflow.overflow.slice(0, 3))}`,
    )
  }

  await context.close()
}

await browser.close()

if (failures.length > 0) {
  console.error(`TU-45 E2E thất bại:\n${failures.map((line) => `  - ${line}`).join("\n")}`)
  process.exit(1)
}
console.log(`TU-45 E2E đạt trên ${viewports.length} bề ngang. Ảnh: ${output}`)
