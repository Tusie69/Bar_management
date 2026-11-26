// E2E mock verification for NA-45/46 payment flows across 390, 820, and 1440 viewports.
// Artifacts (screenshots) are written strictly inside web/e2e/.artifacts/.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { createServer as createViteServer } from "vite"

const ARTIFACTS_DIR = path.resolve("e2e/.artifacts")
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })

const BASE_PORT = Number(process.env.E2E_PORT ?? 43920)
const HTTP_CHECK_PORT = Number(process.env.E2E_HTTP_PORT ?? BASE_PORT)
const PROVIDED_BASE = process.env.E2E_BASE_URL
const base = PROVIDED_BASE ?? `http://127.0.0.1:${BASE_PORT}`

async function startOwnedVite(port, modeEnv = null) {
  const prevMode = process.env.VITE_API_MODE
  const prevUrl = process.env.VITE_API_BASE_URL
  if (modeEnv) {
    process.env.VITE_API_MODE = modeEnv.mode
    process.env.VITE_API_BASE_URL = modeEnv.baseUrl
  } else {
    delete process.env.VITE_API_MODE
    delete process.env.VITE_API_BASE_URL
  }
  try {
    const server = await createViteServer({
      configFile: path.resolve("vite.config.ts"),
      clearScreen: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port, strictPort: true },
    })
    await server.listen()
    return server
  } finally {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevUrl === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevUrl
  }
}

let viteServer = null
if (!PROVIDED_BASE) {
  viteServer = await startOwnedVite(BASE_PORT)
}

const launchOptions = {
  headless: true,
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "820", width: 820, height: 1180 },
  { name: "1440", width: 1440, height: 900 },
]

const browser = await chromium.launch(launchOptions)

async function openRole(vp, userId, startPath = "/payment", extraOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...extraOptions,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  await page.addInitScript((uid) => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
  }, userId)
  await page.goto(`${base}${startPath}`, { waitUntil: "networkidle" })
  await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
  await page.goto(`${base}${startPath}`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

async function assertNoOverflow(page, label) {
  const ov = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    const root = document.querySelector(".pay-root")
    const rootOverflow = root ? root.scrollWidth - root.clientWidth : 0
    return { docOverflow, rootOverflow }
  })
  assert(ov.docOverflow <= 1, `${label}: document horizontal overflow ${ov.docOverflow}px`)
  assert(ov.rootOverflow <= 1, `${label}: .pay-root horizontal overflow ${ov.rootOverflow}px`)
}

async function assertFeedbackNoOverlap(
  page,
  label,
  buttonNames = [],
  { feedbackSelector = '[data-testid="pay-feedback"], [data-sonner-toast]', expectedText = null } = {},
) {
  const waiter = expectedText
    ? page.locator(feedbackSelector).filter({ hasText: expectedText }).first()
    : page.locator(feedbackSelector).first()
  await waiter.waitFor({ state: "visible", timeout: 5000 })
  const check = await page.evaluate(
    ({ names, fbSel, expText }) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const hdr = document.querySelector(".pay-hdr")?.getBoundingClientRect()
      const minTop = hdr ? hdr.bottom - 0.5 : 0
      const fbNodes = [...document.querySelectorAll(fbSel)]
        .filter((el) => {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0
        })
        .map((el) => ({
          text: el.textContent?.trim() ?? "",
          rect: el.getBoundingClientRect(),
        }))
      if (fbNodes.length === 0) {
        return { ok: false, reason: `no visible feedback matched ${fbSel}` }
      }
      if (expText && !fbNodes.some((n) => n.text.includes(expText))) {
        return {
          ok: false,
          reason: `expected feedback containing "${expText}", got ${JSON.stringify(fbNodes.map((n) => n.text))}`,
        }
      }
      for (const fb of fbNodes) {
        if (fb.rect.top < minTop || fb.rect.bottom > vh + 0.5 || fb.rect.left < -0.5 || fb.rect.right > vw + 0.5) {
          return {
            ok: false,
            reason: `feedback "${fb.text}" outside viewport (${JSON.stringify(fb.rect)}, minTop=${minTop}, vw=${vw}, vh=${vh})`,
          }
        }
      }

      const visibleButtons = [...document.querySelectorAll("button")].filter((btn) => {
        const cs = getComputedStyle(btn)
        const r = btn.getBoundingClientRect()
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0
      })

      const targets = []
      const h1 = document.querySelector(".pay-ph h1, .pay-ok-hd h1")
      if (h1) targets.push({ name: "h1", rect: h1.getBoundingClientRect(), checkHit: false })

      for (const reqName of names) {
        const matching = visibleButtons.filter((b) => (b.textContent?.trim() ?? "").includes(reqName))
        if (matching.length === 0) {
          return { ok: false, reason: `required target button "${reqName}" not found` }
        }
        for (const btn of matching) {
          const rect = btn.getBoundingClientRect()
          if (rect.top < minTop || rect.bottom > vh + 0.5 || rect.left < -0.5 || rect.right > vw + 0.5) {
            return { ok: false, reason: `target button "${reqName}" outside viewport (${JSON.stringify(rect)})` }
          }
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const hitEl = document.elementFromPoint(cx, cy)
          if (!hitEl || (hitEl !== btn && !btn.contains(hitEl))) {
            return {
              ok: false,
              reason: `target button "${reqName}" center (${cx.toFixed(1)},${cy.toFixed(1)}) blocked by ${hitEl?.tagName ?? "null"}`,
            }
          }
          targets.push({ name: btn.textContent?.trim() ?? reqName, rect, checkHit: true })
        }
      }

      for (const fb of fbNodes) {
        for (const t of targets) {
          const hit =
            fb.rect.left < t.rect.right - 0.5 &&
            fb.rect.right > t.rect.left + 0.5 &&
            fb.rect.top < t.rect.bottom - 0.5 &&
            fb.rect.bottom > t.rect.top + 0.5
          if (hit) {
            return { ok: false, reason: `feedback "${fb.text}" overlapped "${t.name}"` }
          }
        }
      }
      return { ok: true, count: fbNodes.length }
    },
    { names: buttonNames, fbSel: feedbackSelector, expText: expectedText },
  )
  assert(check.ok, `${label}: ${check.reason}`)
}

async function assertCleanCashierShell(page, label) {
  const counts = await page.evaluate(() => ({
    headers: document.querySelectorAll("header").length,
    payBells: document.querySelectorAll('button[aria-label*="Thông báo thanh toán"]').length,
    recBells: document.querySelectorAll('button[aria-label*="Cần xử lý"]').length,
    bottomNavs: document.querySelectorAll('nav[aria-label="Điều hướng chính"]').length,
    sidebars: document.querySelectorAll("[data-sidebar]").length,
  }))
  assert.equal(counts.headers, 1, `${label}: expected 1 header, got ${counts.headers}`)
  assert.equal(counts.payBells, 1, `${label}: expected 1 payment bell, got ${counts.payBells}`)
  assert.equal(counts.recBells, 0, `${label}: unexpected reception bell`)
  assert.equal(counts.bottomNavs, 0, `${label}: unexpected BottomNav`)
  assert.equal(counts.sidebars, 0, `${label}: unexpected AppSidebar`)
  await expect(page.getByText("Thông báo thu tiền")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Theo dõi đơn đặt bàn" })).toHaveCount(0)
}

const results = []
try {
  for (const vp of VIEWPORTS) {
    // 1. S1 List, notifications unread dot on PAID, A10/BAR01 & G05/G06 clearance, scroll-to-top on S3,
    //    Cash (short/exact/over), S7 success, Back lock on S4, floor sync on /floor
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment")
      try {
        await expect(page.getByText("Xin chào,").first()).toBeVisible()
        await expect(page.getByText("Thu ngân · Thu ngân").first()).toBeVisible()
        await assertCleanCashierShell(page, `${vp.name} S1`)
        await assertNoOverflow(page, `${vp.name} S1`)

        // Sort order check: G02 (awaiting payment) first, G04 (requested) second
        const rowCodes = await page.locator(".pay-sess b").allTextContents()
        const orderedCodes = rowCodes.filter((c) => ["G02", "G04", "A3", "A2", "BAR01"].includes(c))
        assert.deepEqual(orderedCodes, ["G02", "G04", "A3", "A2", "BAR01"], `${vp.name}: unexpected sort order ${orderedCodes}`)

        // Cluster G02 never renders "B11 + B12"; G06 (no mock lines) shows "Chưa có dữ liệu" instead of "0đ"
        const listText = await page.locator(".pay-sess-col").textContent()
        assert(!listText.includes("B11 + B12"), `${vp.name}: cluster must show G02, never B11 + B12`)
        const g06Row = page.locator(".pay-sess", { hasText: "G06" })
        await expect(g06Row.getByText("Chưa có dữ liệu")).toBeVisible()
        await expect(g06Row.getByText("0đ", { exact: true })).toHaveCount(0)
        const g06TileText = await page.locator('[aria-label^="BAR10,"]').textContent()
        assert(!g06TileText?.includes("0k"), `${vp.name}: G06 tile without lines must hide amount`)

        // Notifications bell: unread dot -> open clears unread -> stays cleared until new PAID event
        const bell = page.getByRole("button", { name: /Thông báo thanh toán/ })
        await expect(page.getByTestId("pay-ntf-unread-dot")).toBeVisible()
        await bell.click()
        await expect(page.getByRole("dialog", { name: "Thông báo thanh toán" })).toBeVisible()
        await expect(page.getByText("Đã hủy món").first()).toBeVisible()
        await expect(page.getByText("Gọi thanh toán").first()).toBeVisible()
        await expect(page.getByText("Chờ thanh toán").first()).toBeVisible()
        await bell.click()
        await expect(page.getByTestId("pay-ntf-unread-dot")).toHaveCount(0)

        // Floor map: BOTH A10 and BAR01 selectors MUST exist and A10 must stay clear of BAR01;
        // AND G05 / G06 cluster pills must NOT overlap any bar seat (e.g. BAR07, BAR13)
        const clearance = await page.evaluate(() => {
          const a10 = document.querySelector('[aria-label^="Bàn A10,"]')?.getBoundingClientRect()
          const bar1 = document.querySelector('[aria-label^="BAR01,"]')?.getBoundingClientRect()
          if (!a10 || !bar1) return { ok: false, reason: `missing selector a10=${Boolean(a10)} bar1=${Boolean(bar1)}` }
          if (a10.right > bar1.left + 0.5) return { ok: false, reason: `a10.right=${a10.right}, bar1.left=${bar1.left}` }
          const seats = [...document.querySelectorAll(".pay-ft-seat")].map((el) => ({
            label: el.textContent?.trim() ?? "",
            rect: el.getBoundingClientRect(),
          }))
          const tags = [...document.querySelectorAll(".pay-f-cltag")].map((el) => ({
            tag: el.textContent?.trim() ?? "",
            rect: el.getBoundingClientRect(),
          }))
          for (const t of tags) {
            for (const s of seats) {
              const overlap =
                t.rect.left < s.rect.right - 0.5 &&
                t.rect.right > s.rect.left + 0.5 &&
                t.rect.top < s.rect.bottom - 0.5 &&
                t.rect.bottom > s.rect.top + 0.5
              if (overlap) {
                return { ok: false, reason: `cluster tag ${t.tag} overlaps bar seat ${s.label}` }
              }
            }
          }
          return { ok: true }
        })
        assert(clearance.ok, `${vp.name}: map clearance failed: ${clearance.reason}`)

        // NA45C-08: at 1440 desktop, S1 list panel stretches to match map panel bottom edge
        if (vp.width >= 960) {
          const panelDiff = await page.evaluate(() => {
            const list = document.querySelector(".pay-sess-col")?.getBoundingClientRect()
            const map = document.querySelector("#floor-map")?.getBoundingClientRect()
            return list && map ? Math.abs(list.bottom - map.bottom) : 999
          })
          assert(panelDiff <= 2, `${vp.name}: S1 list/map bottom diff ${panelDiff}px > 2px`)
        }

        // NA45C-11: selecting bar-seat cluster G05 uses clean cluster frame without per-seat rings or neighbor clipping
        const g05Row = page.locator(".pay-sess", { hasText: "G05" })
        await g05Row.click()
        await page.waitForTimeout(700)
        const g05RingCheck = await page.evaluate(() => {
          const selFrame = document.querySelector(".pay-f-cl.pay-f-cl-sel")?.getBoundingClientRect()
          const s4 = document.querySelector('[aria-label^="Ghế bar 4,"]')?.getBoundingClientRect()
          const s5 = document.querySelector('[aria-label^="BAR05,"]')?.getBoundingClientRect()
          const s6 = document.querySelector('[aria-label^="BAR06,"]')?.getBoundingClientRect()
          const s7 = document.querySelector('[aria-label^="Ghế bar 7,"]')?.getBoundingClientRect()
          const seatSelRings = [...document.querySelectorAll(".pay-ft-seat.pay-ft-sel")].length
          if (!selFrame || !s4 || !s5 || !s6 || !s7) return { ok: false, reason: "missing G05 map nodes" }
          if (seatSelRings > 0) return { ok: false, reason: `found ${seatSelRings} seat selection rings inside G05` }
          if (s6.bottom > s5.top + 0.5) return { ok: false, reason: "seat 6 overlaps seat 5" }
          if (selFrame.top < s7.bottom - 0.5) return { ok: false, reason: `G05 frame overlaps seat 7 (${selFrame.top} < ${s7.bottom})` }
          if (selFrame.bottom > s4.top + 0.5) return { ok: false, reason: `G05 frame overlaps seat 4 (${selFrame.bottom} > ${s4.top})` }
          return { ok: true }
        })
        assert(g05RingCheck.ok, `${vp.name}: NA45C-11 G05 check failed: ${g05RingCheck.reason}`)
        await page.getByRole("button", { name: "Toàn sơ đồ", exact: true }).click()
        await page.waitForTimeout(700)

        // First tap on A3 selects (and scrolls offscreen map into view on 820px); second tap opens S2 detail
        const a3Row = page.locator(".pay-sess", { hasText: "A3" })
        await a3Row.click()
        await expect(page.getByText("Chạm lần nữa để mở chi tiết")).toBeVisible()
        await page.waitForTimeout(700)
        const mapVisibleAfterPick = await page.evaluate((vh) => {
          const el = document.getElementById("floor-map")
          if (!el) return false
          const r = el.getBoundingClientRect()
          return r.top < vh && r.bottom > 0
        }, vp.height)
        assert(mapVisibleAfterPick, `${vp.name}: #floor-map should be scrolled into view after row pick`)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s1-list.png`) })
        await a3Row.click()

        // S2 detail: cancelled Margarita hidden, Mojito making warning visible, rounding shown separately
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        await assertNoOverflow(page, `${vp.name} S2`)
        const a3VisitId = new URL(page.url()).pathname.split("/")[2]
        assert(/^\d+$/.test(a3VisitId), `${vp.name}: expected numeric visitId for A3, got ${a3VisitId}`)
        await expect(page.getByText("Tiger Crystal")).toBeVisible()
        await expect(page.getByText("Mojito")).toBeVisible()
        await expect(page.getByText("Margarita")).toHaveCount(0)
        await expect(page.getByText(/dòng món đã hủy/)).toHaveCount(0)
        // NA45C-03: making warning MUST remain visible on ALL viewports (including phones 320/390)
        await expect(page.getByText("1 món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.")).toBeVisible()
        await expect(page.getByText("Làm tròn lên nghìn (bước cuối)")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s2-detail.png`) })

        // NA45-03 & NA45-12: from /payment, opening direct URL /cash on SERVING bill redirects with replace
        // back to S2 detail; a single browser Back returns straight to /payment without looping.
        const a3Url = page.url()
        await page.getByRole("button", { name: "Phiên đang mở" }).click()
        await expect(page).toHaveURL(/\/payment$/)
        await page.goto(`${base}/payment/${a3VisitId}/cash`, { waitUntil: "networkidle" })
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        await expect(page.getByText(/chưa xuất hóa đơn/).first()).toBeVisible()
        await page.goBack({ waitUntil: "networkidle" })
        assert.equal(new URL(page.url()).pathname, "/payment", `${vp.name}: Back after prebill redirect should return to /payment`)
        await page.goto(a3Url, { waitUntil: "networkidle" })
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()

        // NA45-06: scroll down on S2, click Xem tạm tính -> S3 must scroll to top so back & 80mm toggle are in viewport
        // AND S3 toggle sits on the same row as the Back button. VM-03/VM-04: preview stays state-free and has NO QR.
        await page.evaluate(() => {
          const root = document.querySelector(".pay-root")
          if (root) root.scrollTop = 450
        })
        await page.getByRole("button", { name: "Xem tạm tính" }).click()
        await expect(page.getByRole("button", { name: "Trên màn hình" })).toBeVisible()
        await expect(page.getByRole("button", { name: "Bản in 80mm" })).toBeVisible()
        await expect(page.getByText("Tạm tính – chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()
        await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)
        await assertNoOverflow(page, `${vp.name} S3`)
        const scrollCheck = await page.evaluate((vh) => {
          const root = document.querySelector(".pay-root")
          const backBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Chi tiết Phiên"))
          const printBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Bản in 80mm"))
          const bRect = backBtn?.getBoundingClientRect()
          const pRect = printBtn?.getBoundingClientRect()
          const sameRow = Boolean(bRect && pRect && Math.min(bRect.bottom, pRect.bottom) > Math.max(bRect.top, pRect.top))
          return {
            scrollTop: root?.scrollTop ?? -1,
            backVisible: Boolean(bRect && bRect.top >= 0 && bRect.bottom <= vh),
            printVisible: Boolean(pRect && pRect.top >= 0 && pRect.bottom <= vh),
            sameRow,
          }
        }, vp.height)
        assert.equal(scrollCheck.scrollTop, 0, `${vp.name}: S3 scrollTop should be 0, got ${scrollCheck.scrollTop}`)
        assert(scrollCheck.backVisible && scrollCheck.printVisible, `${vp.name}: S3 header controls not in viewport: ${JSON.stringify(scrollCheck)}`)
        assert(scrollCheck.sameRow, `${vp.name}: S3 toggle should be on the same row as Back button`)

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s3-preview.png`) })
        await page.getByRole("button", { name: "Bản in 80mm" }).click()
        await expect(page.getByLabel("Bản in tạm tính khổ 80mm")).toBeVisible()

        // Issue invoice from S3 -> returns to S2 with issued bill, then Thu tiền -> S4 method
        await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await expect(page.getByRole("heading", { name: "Chọn phương thức thanh toán" })).toBeVisible()
        await assertNoOverflow(page, `${vp.name} S4`)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s4-method.png`) })

        // S5 cash: short -> exact -> over -> confirm -> S7 success
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await expect(page.getByRole("heading", { name: "Thanh toán tiền mặt" })).toBeVisible()
        await assertNoOverflow(page, `${vp.name} S5`)
        const cashInput = page.getByLabel("Khách đưa")
        await cashInput.fill("100000")
        await expect(page.getByText("Còn thiếu")).toBeVisible()
        const confirmCashBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
        await expect(confirmCashBtn).toBeDisabled()

        // Exact chip (231.000) has no "vừa đủ" sub-label
        const exactChip = page.getByRole("button", { name: "231.000", exact: true })
        await exactChip.click()
        await expect(page.locator("#pay-cash-res").getByText("Vừa đủ")).toBeVisible()
        await expect(page.locator("#pay-cash-res").getByText("0đ", { exact: true })).toBeVisible()

        // Over (500.000)
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await expect(page.getByText("Tiền thừa trả khách")).toBeVisible()
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s5-cash.png`) })

        await confirmCashBtn.click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await expect(page.getByText("Trống", { exact: true }).first()).toBeVisible()
        await assertNoOverflow(page, `${vp.name} S7`)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s7-success-cash.png`) })

        // NA45-03: Browser Back to S5 & S4 on PAID bill must lock all money actions
        await page.goBack({ waitUntil: "networkidle" })
        await expect(page.getByText("Bill này đã thanh toán").first()).toBeVisible()
        await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toBeDisabled()
        await page.goBack({ waitUntil: "networkidle" })
        await expect(page.getByText("Bill này đã thanh toán").first()).toBeVisible()
        await expect(page.getByRole("button", { name: /Tiền mặt/ })).toBeDisabled()
        await expect(page.getByRole("button", { name: /Chuyển khoản QR/ })).toBeDisabled()

        // Back to S1: A3 is gone from open list, A3 tile is Trống, and PAID notification turns unread dot back on
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await expect(page.locator(".pay-sess", { hasText: "A3" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: /^Bàn A3, trống$/ })).toBeVisible()
        await expect(page.getByTestId("pay-ntf-unread-dot")).toBeVisible()

        // Verify A3 is ALSO released on operational /floor (switch to Owner in same MockGamApi session)
        await page.getByRole("button", { name: /Tài khoản:/ }).click()
        await page.getByRole("menuitemradio", { name: /Chủ sở hữu/ }).click()
        if (vp.width < 768) {
          await page.getByRole("button", { name: /Tài khoản:/ }).click()
          await page.getByRole("menuitem", { name: /Về Tổng quan/ }).click()
          await page.getByRole("button", { name: "Sơ đồ", exact: true }).click()
        } else {
          await page.locator('a[href="/floor"]').first().click()
        }
        await expect(page.locator('[aria-label*="A3"][aria-label*="Trống"]').first()).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} cash flow + floor sync`)
      } finally {
        await context.close()
      }
    }

    // 2. Network error + same-amount/same-button retry, VERSION_CONFLICT vs DUPLICATE_PAYMENT, QR manual confirm
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment")
      try {
        // Network error on Cash (G04), then retry with SAME button & SAME amount reuses exact idempotency key
        await page.locator(".pay-sess", { hasText: "G04" }).click()
        await page.locator(".pay-sess", { hasText: "G04" }).click()
        await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        const keysBeforeRetry = await page.evaluate(() => window.__21gamPaymentMock.getAttemptKeys().length)
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "net" }))
        const confirmBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
        await confirmBtn.click()
        await expect(page.getByText("Không gửi được tới máy chủ")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-net.png`) })
        // Retry with the exact same button and amount (same idempotency key path)
        await confirmBtn.click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        const retryKeys = await page.evaluate(
          (n) => window.__21gamPaymentMock.getAttemptKeys().slice(n),
          keysBeforeRetry,
        )
        assert.equal(retryKeys.length, 2, `${vp.name}: expected 2 confirm attempts on retry, got ${retryKeys.length}`)
        assert.equal(retryKeys[0], retryKeys[1], `${vp.name}: retry must reuse identical idempotency key`)

        // VERSION_CONFLICT on BAR01: must reload bill and NOT claim "already paid", then retry succeeds
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "BAR01" }).click()
        await page.locator(".pay-sess", { hasText: "BAR01" }).click()
        const barVisitId = new URL(page.url()).pathname.split("/")[2]
        await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await page.evaluate((id) => window.__21gamPaymentMock.bumpVersion(id), barVisitId)
        await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
        await expect(page.getByText("Bill vừa được cập nhật")).toBeVisible()
        await expect(page.getByText("Bill này đã được thanh toán trên thiết bị khác")).toHaveCount(0)
        // Confirm again against reloaded bill succeeds
        await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

        // Separate QR manual confirm on G02 (already AWAITING_PAYMENT), check-tx locked Đang phát triển
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "G02" }).click()
        await page.locator(".pay-sess", { hasText: "G02" }).click()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await expect(page.getByText("Techcombank")).toBeVisible()
        await expect(page.getByRole("button", { name: /Kiểm tra giao dịch/ })).toBeDisabled()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s6-qr.png`) })

        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await expect(page.getByText("Chụp màn hình chuyển khoản của khách")).toBeVisible()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await expect(page.getByText("Chuyển khoản QR · xác nhận tay")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s7-success-qr.png`) })

        // Duplicate 409 fault on A2: marks PAID, releases A2, shows "đã được thanh toán trên thiết bị khác"
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "A2" }).click()
        await page.locator(".pay-sess", { hasText: "A2" }).click()
        await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "dup" }))
        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByText("Bill này đã được thanh toán trên thiết bị khác")).toBeVisible()
        await expect(page.getByRole("button", { name: "Xác nhận đã nhận tiền" })).toBeDisabled()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-dup.png`) })
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await expect(page.getByRole("button", { name: /^Bàn A2, trống$/ })).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} QR/error console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} retry + 409 conflict/dup + qr`)
      } finally {
        await context.close()
      }
    }

    // 3. Reduced motion (NA45-05) & loading lock across 390, 820, 1440
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment", { reducedMotion: "reduce" })
      try {
        // Trigger zoom on A3 selection and verify 0.6s duration on .pay-fview and .pay-fsz
        await page.locator(".pay-sess", { hasText: "A3" }).click()
        const zoomTiming = await page.evaluate(() => {
          const fview = document.querySelector(".pay-fpanel.mv .pay-fview")
          const fsz = document.querySelector(".pay-fpanel.mv .pay-fsz")
          return {
            fviewDur: fview ? getComputedStyle(fview).animationDuration : null,
            fszDur: fsz ? getComputedStyle(fsz).animationDuration : null,
          }
        })
        assert.equal(zoomTiming.fviewDur, "0.6s", `${vp.name}: .pay-fview reduced-motion duration was ${zoomTiming.fviewDur}`)
        assert.equal(zoomTiming.fszDur, "0.6s", `${vp.name}: .pay-fsz reduced-motion duration was ${zoomTiming.fszDur}`)

        // Loading skeleton + .pay-spin runs infinitely at 1.2s under reducedMotion: "reduce",
        // and pay buttons remain locked (not rendered/enabled) until bill finishes loading.
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ billDelayMs: 1200 }))
        await page.locator(".pay-sess", { hasText: "A3" }).click()
        const spin = page.locator(".pay-spin").first()
        await spin.waitFor({ state: "visible" })
        await expect(page.getByText(/Đang tải dữ liệu bill/)).toBeVisible()
        await expect(page.getByRole("button", { name: "Xem tạm tính" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: "Thu tiền" })).toHaveCount(0)
        const spinTiming = await spin.evaluate((el) => {
          const cs = getComputedStyle(el)
          return { dur: cs.animationDuration, iter: cs.animationIterationCount }
        })
        assert.deepEqual(
          spinTiming,
          { dur: "1.2s", iter: "infinite" },
          `${vp.name}: .pay-spin reduced-motion timing was ${JSON.stringify(spinTiming)}`,
        )
        await expect(page.getByText("Tiger Crystal")).toBeVisible()
        await expect(page.getByRole("button", { name: "Xuất hóa đơn" }).first()).toBeEnabled()

        assert.deepEqual(errors, [], `${vp.name} reducedMotion console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} reduced motion + loading lock`)
      } finally {
        await context.close()
      }
    }
  }

  // 4. Unified single-mock cross-role A3 flow (Cashier <-> Waiter share exact A3 visitId) + S4-S7 blocked
  {
    const { context, page, errors } = await openRole(VIEWPORTS[2], 5, "/payment")
    try {
      const a3Row = page.locator(".pay-sess", { hasText: "A3" })
      await a3Row.click()
      await a3Row.click()
      await expect(page.getByText("Tiger Crystal")).toBeVisible()
      await expect(page.getByText("231.000đ").first()).toBeVisible()
      const cashierA3Id = new URL(page.url()).pathname.split("/")[2]
      assert(/^\d+$/.test(cashierA3Id), `Cashier A3 visitId must be numeric, got ${cashierA3Id}`)

      // Switch to Waiter in the SAME page & MockGamApi instance via TopBar AccountMenu
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitemradio", { name: /Phục vụ 1/ }).click()
      await expect(page).toHaveURL(/\/phucvu/)

      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await page.getByRole("button", { name: /Xem tạm tính & xuất hóa đơn/ }).click()
      const waiterA3Id = new URL(page.url()).pathname.split("/")[3]
      assert.equal(waiterA3Id, cashierA3Id, `Waiter and Cashier A3 visitId mismatch: ${waiterA3Id} vs ${cashierA3Id}`)
      await expect(page.getByText("Tiger Crystal")).toBeVisible()
      await expect(page.getByText("231.000đ").first()).toBeVisible()

      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("HÓA ĐƠN", { exact: true })).toBeVisible()

      // Verify the single MockGamApi dataset has exactly 1 updated A3 row with AWAITING_PAYMENT + issuedAt
      const openA3Rows = await page.evaluate(async () => {
        const rows = await window.__21gamPaymentMock.listOpen()
        return rows.filter((r) => r.code === "A3")
      })
      assert.equal(openA3Rows.length, 1, `Expected 1 A3 open row, got ${openA3Rows.length}`)
      assert.equal(openA3Rows[0].visitId, cashierA3Id)
      assert.equal(openA3Rows[0].status, "AWAITING_PAYMENT")
      assert.ok(openA3Rows[0].issuedAt, "Expected issuedAt on A3 after Waiter issueInvoice")

      assert.deepEqual(errors, [], `Cross-role A3 console errors: ${errors.join(" | ")}`)
      results.push("PASS 1440 unified single-mock A3 Cashier <-> Waiter request sync")
    } finally {
      await context.close()
    }
  }

  // 5. Waiter flow at 390 + S4-S7 blocked under BOTH /payment and /phucvu
  {
    const { context, page, errors } = await openRole(VIEWPORTS[0], 6, "/phucvu")
    try {
      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await page.getByRole("button", { name: /Xem tạm tính & xuất hóa đơn/ }).click()
      const waiterVisitId = new URL(page.url()).pathname.split("/")[3]
      assert(/^\d+$/.test(waiterVisitId), `Waiter A3 visitId must be numeric, got ${waiterVisitId}`)

      // Waiter ?view=preview on SERVING A3 stays state-free (no QR, TẠM TÍNH) and never redirects/mutates
      await page.goto(`${base}/phucvu/phien/${waiterVisitId}/thanh-toan?view=preview`, { waitUntil: "networkidle" })
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn").first()).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)
      await page.getByRole("button", { name: "Chi tiết Phiên" }).click()

      await expect(page.getByRole("button", { name: "Thu tiền" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Chốt bill & thu tiền" })).toHaveCount(0)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "payment-390-waiter-pa-a.png") })

      // S3 preview is reachable for Waiter to show guest, without collect button
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("TẠM TÍNH", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Thu tiền" })).toHaveCount(0)

      // Issue invoice works for Waiter without exposing money confirmation actions
      await page.getByRole("button", { name: "Chi tiết Phiên" }).click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("HÓA ĐƠN", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)

      // Prove S4-S7 money routes are blocked under BOTH /payment and /phucvu
      for (const forbiddenUrl of [
        "/payment",
        `/payment/${waiterVisitId}/method`,
        `/payment/${waiterVisitId}/cash`,
        `/payment/${waiterVisitId}/qr`,
        `/payment/${waiterVisitId}/success`,
      ]) {
        await page.goto(`${base}${forbiddenUrl}`, { waitUntil: "networkidle" })
        assert(
          new URL(page.url()).pathname.startsWith("/phucvu"),
          `Waiter direct URL ${forbiddenUrl} should redirect to /phucvu, got ${page.url()}`,
        )
      }
      for (const moneyView of ["method", "cash", "qr", "success"]) {
        await page.goto(`${base}/phucvu/phien/${waiterVisitId}/thanh-toan?view=${moneyView}`, {
          waitUntil: "networkidle",
        })
        await expect(page.getByRole("heading", { name: "Chọn phương thức thanh toán" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Thanh toán tiền mặt" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Chuyển khoản QR" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)
      }

      assert.deepEqual(errors, [], `Waiter PA-A console errors: ${errors.join(" | ")}`)
      results.push("PASS 390 waiter PA-A + S4-S7 blocked under /payment and /phucvu")
    } finally {
      await context.close()
    }
  }

  // 6. NA45-11: TopBar outside /payment preserves deviceLabel & non-greeting header at 1440px
  {
    for (const roleCheck of [
      { userId: 3, deviceLabel: "Laptop văn phòng", name: "Owner" },
      { userId: 4, deviceLabel: "Điện thoại CSKH", name: "CustomerCare" },
    ]) {
      const { context, page, errors } = await openRole(VIEWPORTS[2], roleCheck.userId, "/floor")
      try {
        await expect(page.locator("header").getByText(roleCheck.deviceLabel)).toBeVisible()
        await expect(page.locator("header").getByText("Xin chào,")).toHaveCount(0)
        assert.deepEqual(errors, [], `${roleCheck.name} /floor console errors: ${errors.join(" | ")}`)
        results.push(`PASS 1440 ${roleCheck.name} /floor TopBar deviceLabel preserved`)
      } finally {
        await context.close()
      }
    }
  }

  // 7. NA45-14: Newly seated visit -> release -> open bill (CLOSED_UNPAID) -> undo (visible + live) -> redo (CLOSED_UNPAID)
  {
    const { context, page, errors } = await openRole(VIEWPORTS[2], 3, "/floor")
    try {
      const c1Tile = page.locator('[aria-label^="Bàn C1,"], [aria-label^="Bàn C1:"]').first()
      await c1Tile.click()
      await page.getByRole("button", { name: /^Mở .*C1.* cho \d+ khách$/ }).click()
      await expect(c1Tile).toHaveAttribute("aria-label", /Đã tới|Có khách/)

      const c1VisitId = await page.evaluate(() => window.__21gamPaymentMock.visitIdForTable("C1"))
      assert.ok(c1VisitId && /^\d+$/.test(c1VisitId), `Expected numeric C1 visitId, got ${c1VisitId}`)

      // Release C1 BEFORE ever opening its payment bill (sheet stays open on C1 after Walk-in)
      await page.getByRole("button", { name: /Nhả bàn \(khách rời\)/ }).click()
      await page.getByRole("button", { name: "Nhả bàn", exact: true }).click()
      await expect(c1Tile).toHaveAttribute("aria-label", /Trống/)

      // Client-side nav to /payment, verify C1 absent, then open /payment/:c1VisitId (CLOSED_UNPAID)
      await page.locator('a[href="/payment"]').first().click()
      await expect(page).toHaveURL(/\/payment$/)
      await expect(page.locator(".pay-sess", { hasText: "C1" })).toHaveCount(0)

      await page.evaluate((id) => {
        window.history.pushState({}, "", `/payment/${id}`)
        window.dispatchEvent(new PopStateEvent("popstate"))
      }, c1VisitId)
      await expect(page.getByText("Đã trả bàn · chưa thu")).toBeVisible()
      await expect(page.getByText("Phiên đã trả bàn nhưng chưa ghi nhận thu tiền")).toBeVisible()
      await expect(page.getByRole("button", { name: "Xem tạm tính" })).toBeDisabled()

      // Undo release: bill returns to live SERVING state and C1 reappears in S1
      await page.locator("header").getByRole("button", { name: "Hoàn tác", exact: true }).click()
      await expect(page.getByText("Đang phục vụ")).toBeVisible()
      await expect(page.getByText("Đã trả bàn · chưa thu")).toHaveCount(0)
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      const c1Row = page.locator(".pay-sess", { hasText: "C1" })
      await expect(c1Row).toHaveCount(1)
      await expect(c1Row.getByText("Chưa có dữ liệu")).toBeVisible()

      // Redo release: C1 leaves S1 and bill shows CLOSED_UNPAID again
      await page.locator("header").getByRole("button", { name: "Làm lại", exact: true }).click()
      await expect(page.locator(".pay-sess", { hasText: "C1" })).toHaveCount(0)
      await page.evaluate((id) => {
        window.history.pushState({}, "", `/payment/${id}`)
        window.dispatchEvent(new PopStateEvent("popstate"))
      }, c1VisitId)
      await expect(page.getByText("Đã trả bàn · chưa thu")).toBeVisible()

      assert.deepEqual(errors, [], `NA45-14 undo/redo console errors: ${errors.join(" | ")}`)
      results.push("PASS 1440 NA45-14 release -> open bill -> undo -> redo sync")
    } finally {
      await context.close()
    }
  }

  // 8. Cashier shell isolation, reception route redirects, sticky S2 action bar (<960px),
  //    390/320 zero overflow, ADMIN/BAR demo users, and Owner clean /payment layout
  {
    const { context, page, errors } = await openRole(VIEWPORTS[0], 5, "/")
    try {
      await expect(page).toHaveURL(/\/payment$/)
      await assertCleanCashierShell(page, "390 landing")
      await assertNoOverflow(page, "390 landing")

      // Reception routes redirect CASHIER back to /payment
      for (const route of ["/floor", "/home", "/overview", "/reservations", "/waitlist", "/guests", "/reports", "/settings"]) {
        await page.goto(`${base}${route}`, { waitUntil: "networkidle" })
        assert.equal(new URL(page.url()).pathname, "/payment", `CASHIER on ${route} must redirect to /payment`)
      }

      // Sticky S2 action bar on long bill (G02) at 390px and 820px
      for (const s2Vp of [VIEWPORTS[0], VIEWPORTS[1]]) {
        await page.setViewportSize({ width: s2Vp.width, height: s2Vp.height })
        await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
        const g02Row = page.locator(".pay-sess", { hasText: "G02" })
        await g02Row.click()
        await g02Row.click()
        await expect(page.getByText("Chivas 18")).toBeVisible()
        const collectVisible = await page.evaluate((vh) => {
          const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Thu tiền"))
          if (!btn) return false
          const r = btn.getBoundingClientRect()
          return r.top >= 0 && r.bottom <= vh + 1
        }, s2Vp.height)
        assert(collectVisible, `${s2Vp.name}: sticky S2 collect button must remain in viewport on long bill G02`)
        await assertNoOverflow(page, `${s2Vp.name} G02 sticky S2`)
      }

      // 320px full S1->S7 route overflow + NA45C-04/NA45C-09 viewport-bounded active feedback clearance + cash retry at 320 & 390
      for (const narrowVp of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(narrowVp)
        await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
        await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
        await assertNoOverflow(page, `${narrowVp.width} S1`)

        // Cash error + full cash retry on G04 at 320/390 (NA45C-09)
        const g04 = page.locator(".pay-sess", { hasText: "G04" })
        await g04.click()
        await g04.click()
        await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
        await assertFeedbackNoOverlap(page, `${narrowVp.width} S2 invoice issued`, ["Xem tạm tính", "Thu tiền"], {
          expectedText: "Đã xuất hóa đơn",
        })
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await assertNoOverflow(page, `${narrowVp.width} S5`)
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "net" }))
        const cashConfirmBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
        await cashConfirmBtn.click()
        await expect(page.getByText("Không gửi được tới máy chủ")).toBeVisible()
        await assertNoOverflow(page, `${narrowVp.width} S5 err`)
        // Retry cash submission to completion at 320/390
        await cashConfirmBtn.click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await assertFeedbackNoOverlap(
          page,
          `${narrowVp.width} S7 cash retry success`,
          ["Về danh sách Phiên", "In biên nhận"],
          { expectedText: "Đã ghi nhận thanh toán" },
        )

        // Back to S1 -> A3: S3 preview (state-free), issue invoice, S6 QR scrolled copy, S7 scrolled print (NA45C-04)
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        const a3 = page.locator(".pay-sess", { hasText: "A3" })
        await a3.click()
        await a3.click()
        await expect(page.getByText("1 món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.")).toBeVisible()
        await assertNoOverflow(page, `${narrowVp.width} S2`)
        await page.getByRole("button", { name: "Xem tạm tính" }).click()
        await assertNoOverflow(page, `${narrowVp.width} S3 screen`)
        await page.getByRole("button", { name: "Bản in 80mm" }).click()
        await assertNoOverflow(page, `${narrowVp.width} S3 80mm`)

        await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
        await page.getByRole("button", { name: "Thu tiền" }).click()
        await assertNoOverflow(page, `${narrowVp.width} S4`)

        // QR copy feedback scrolled into view + manual confirm + S7 scrolled-to-bottom print feedback at 320/390
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await assertNoOverflow(page, `${narrowVp.width} S6`)
        const copyBtn = page.getByRole("button", { name: "Chép" })
        await copyBtn.scrollIntoViewIfNeeded()
        await copyBtn.click()
        await assertFeedbackNoOverlap(
          page,
          `${narrowVp.width} S6 copy`,
          ["Chép", "Xác nhận đã nhận tiền"],
          { feedbackSelector: '[data-testid="pay-qr-copy-status"]', expectedText: "Đã chép nội dung" },
        )
        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await assertFeedbackNoOverlap(
          page,
          `${narrowVp.width} S7 success`,
          ["Về danh sách Phiên", "In biên nhận"],
          { expectedText: "Đã ghi nhận thanh toán" },
        )
        // Scroll S7 receipt to bottom before clicking In biên nhận (NA45C-04 repro case)
        await page.evaluate(() => {
          const root = document.querySelector(".pay-root")
          if (root) root.scrollTop = root.scrollHeight
        })
        await page.getByRole("button", { name: /In biên nhận/ }).click()
        await assertFeedbackNoOverlap(
          page,
          `${narrowVp.width} S7 print`,
          ["Về danh sách Phiên", "In biên nhận"],
          { feedbackSelector: '[data-testid="pay-receipt-print-status"]', expectedText: "chưa nối máy in thật" },
        )
        await assertNoOverflow(page, `${narrowVp.width} S7`)
      }

      // 1024x768 transition check (>=960px two-column layout)
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
      await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
      await assertNoOverflow(page, "1024 S1")
      const twoColS1 = await page.evaluate(() => {
        const list = document.querySelector(".pay-sess-col")?.getBoundingClientRect()
        const map = document.querySelector("#floor-map")?.getBoundingClientRect()
        return Boolean(list && map && list.right <= map.left + 1)
      })
      assert(twoColS1, "1024 S1 should use side-by-side two-column layout")
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await expect(page.locator(".pay-pane-bill")).toBeVisible()
      const twoColS2 = await page.evaluate(() => {
        const bill = document.querySelector(".pay-pane-bill")?.getBoundingClientRect()
        const act = document.querySelector(".pay-pane-act")?.getBoundingClientRect()
        return Boolean(bill && act && bill.right <= act.left + 1)
      })
      assert(twoColS2, "1024 S2 should use side-by-side split layout")

      // ADMIN (7) and BAR (8) exist in mock AccountMenu and enforce role rules
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await expect(page.getByRole("menuitemradio", { name: /Quản trị viên/ })).toBeVisible()
      await expect(page.getByRole("menuitemradio", { name: /Bartender/ })).toBeVisible()
      await page.getByRole("menuitemradio", { name: /Quản trị viên/ }).click()
      await expect(page).toHaveURL(/\/payment/)
      const adminA3 = page.locator(".pay-sess", { hasText: "A3" })
      await adminA3.click()
      await adminA3.click()
      await expect(page.getByRole("button", { name: "Xuất hóa đơn" }).first()).toBeVisible()

      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitemradio", { name: /Bartender/ }).click()
      await expect(page).toHaveURL(/\/chebien/)
      await expect(page.getByText("Thu tiền")).toHaveCount(0)

      assert.deepEqual(errors, [], `Cashier shell / role isolation console errors: ${errors.join(" | ")}`)
      results.push("PASS cashier shell isolation + 320/390 feedback clearance + 1024 split + ADMIN/BAR")
    } finally {
      await context.close()
    }
  }

  // 9. Owner at 390px reaches /payment via AccountSheet "Thu tiền" and gets clean payment layout
  {
    const { context, page, errors } = await openRole(VIEWPORTS[0], 3, "/home")
    try {
      await page.getByRole("button", { name: /Tài khoản/ }).click()
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await expect(page).toHaveURL(/\/payment$/)
      await expect(page.getByText("Xin chào,").first()).toBeVisible()
      await expect(page.locator(".pay-sess-col")).toBeVisible()
      await assertCleanCashierShell(page, "390 Owner /payment")
      await assertNoOverflow(page, "390 Owner /payment")

      assert.deepEqual(errors, [], `Owner 390 /payment console errors: ${errors.join(" | ")}`)
      results.push("PASS 390 Owner /payment clean layout (no duplicate header/bell/BottomNav)")
    } finally {
      await context.close()
    }
  }

  // 10. NA45C-01: Cashier filters reception realtime toasts while preserving data sync & payment feedback
  {
    const { context, page, errors } = await openRole(VIEWPORTS[2], 5, "/payment")
    try {
      await page.evaluate(async () => {
        const { api, clock, demo } = await import("/src/services/index.ts")
        await demo.simulateRemoteActivity()
        clock.advance(15)
        await api.getFloorState(clock.now())
      })
      await page.waitForTimeout(250)
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
      await expect(page.getByText(/Thiết bị khác:/)).toHaveCount(0)
      await expect(page.getByText(/Cảnh báo tự động/)).toHaveCount(0)

      // Confirm payment on A3 -> payment feedback displays & open list refreshes without A3
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
      await page.getByRole("button", { name: "Thu tiền" }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.getByRole("button", { name: "500.000", exact: true }).click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByTestId("pay-feedback")).toContainText("Đã ghi nhận thanh toán")
      await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
      await expect(page.locator(".pay-sess", { hasText: "A3" })).toHaveCount(0)
      assert.deepEqual(errors, [], `NA45C-01 Cashier realtime console errors: ${errors.join(" | ")}`)
    } finally {
      await context.close()
    }

    // Verify reception-capable account still receives realtime alerts
    const rec = await openRole(VIEWPORTS[2], 1, "/floor")
    try {
      await rec.page.evaluate(async () => {
        const { demo } = await import("/src/services/index.ts")
        await demo.simulateRemoteActivity()
      })
      await expect(rec.page.locator("[data-sonner-toast]").filter({ hasText: /Thiết bị khác:/ })).toBeVisible()
      assert.deepEqual(rec.errors, [], `NA45C-01 Reception realtime console errors: ${rec.errors.join(" | ")}`)
      results.push("PASS NA45C-01 Cashier filters reception toasts while keeping sync & Reception alerts")
    } finally {
      await rec.context.close()
    }
  }

  // 11. NA45C-02: Payment bell & header nav locked during delayed confirm (390 & 1440, success & error)
  for (const lockVp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const { context, page, errors } = await openRole(lockVp, 5, "/payment")
    try {
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await page.locator(".pay-sess", { hasText: "A3" }).click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
      await page.getByRole("button", { name: "Thu tiền" }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.getByRole("button", { name: "500.000", exact: true }).click()
      const a3CashPath = new URL(page.url()).pathname

      await page.evaluate(async () => {
        const { paymentApi } = await import("/src/services/payment/index.ts")
        const orig = paymentApi.confirmCash.bind(paymentApi)
        window.__delayedConfirmCount = 0
        paymentApi.confirmCash = async (...args) => {
          window.__delayedConfirmCount += 1
          await new Promise((r) => setTimeout(r, 1200))
          return orig(...args)
        }
      })

      // Test notification popover opened BEFORE submission, then confirm starts
      const bell = page.getByRole("button", { name: /Thông báo thanh toán/ })
      await bell.click()
      await expect(page.getByRole("dialog", { name: "Thông báo thanh toán" })).toBeVisible()
      const confirmCashBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
      await confirmCashBtn.focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Đang ghi nhận…" })).toBeDisabled()
      await expect(page.getByRole("button", { name: /Chọn phương thức/ })).toBeDisabled()
      if ((await page.getByRole("dialog", { name: "Thông báo thanh toán" }).count()) === 0) {
        await bell.click()
      }
      const g04Ntf = page.getByRole("dialog", { name: "Thông báo thanh toán" }).locator("button", { hasText: "G04" })
      await expect(g04Ntf).toBeDisabled()
      await g04Ntf.click({ force: true })
      assert.equal(new URL(page.url()).pathname, a3CashPath, `${lockVp.name}: bell bypassed pending lock`)

      // Wait for delayed confirm to complete on A3 -> redirects to A3 success, only 1 call
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      assert.equal(new URL(page.url()).pathname, a3CashPath.replace(/\/cash$/, "/success"))
      const attempts = await page.evaluate(() => window.__delayedConfirmCount)
      assert.equal(attempts, 1, `${lockVp.name}: expected 1 delayed confirm call, got ${attempts}`)

      // Bell unlocks after pending state clears and can navigate to G04
      if ((await page.getByRole("dialog", { name: "Thông báo thanh toán" }).count()) === 0) {
        await bell.click()
      }
      await expect(g04Ntf).toBeEnabled()
      await g04Ntf.click()
      await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
      await expect(page.getByText("G04").first()).toBeVisible()

      // Delayed network error stays on original G04 pending step
      await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
      await page.getByRole("button", { name: "Thu tiền" }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.getByRole("button", { name: "500.000", exact: true }).click()
      const g04CashPath = new URL(page.url()).pathname
      await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "net" }))
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("button", { name: "Đang ghi nhận…" })).toBeDisabled()
      await bell.click()
      await expect(page.getByRole("dialog", { name: "Thông báo thanh toán" }).locator("button", { hasText: "G02" }).first()).toBeDisabled()
      await expect(page.getByText("Không gửi được tới máy chủ")).toBeVisible()
      assert.equal(new URL(page.url()).pathname, g04CashPath, `${lockVp.name}: delayed error left original bill`)

      assert.deepEqual(errors, [], `NA45C-02 (${lockVp.name}) console errors: ${errors.join(" | ")}`)
      results.push(`PASS ${lockVp.name} NA45C-02 delayed confirm bell lock + recovery`)
    } finally {
      await context.close()
    }
  }

  // 12. NA45C-07: Offscreen zoomed map scrolls cleanly below header on 820x680 and scrolled 390x844 (both motion prefs)
  for (const motion of ["no-preference", "reduce"]) {
    // 820x680 where map starts below fold
    {
      const { context, page, errors } = await openRole({ width: 820, height: 680 }, 5, "/payment", {
        reducedMotion: motion,
      })
      try {
        const before = await page.evaluate(() => {
          const el = document.getElementById("floor-map")
          return el ? el.getBoundingClientRect().top : -1
        })
        assert(before >= 680 - 1, `820x680 (${motion}): expected #floor-map offscreen initially, got top=${before}`)
        const a3 = page.locator(".pay-sess", { hasText: "A3" })
        await a3.click()
        await page.waitForTimeout(750)
        const after = await page.evaluate(() => {
          const el = document.getElementById("floor-map")
          const hdr = document.querySelector(".pay-hdr")?.getBoundingClientRect()
          if (!el || !hdr) return null
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, hdrBottom: hdr.bottom }
        })
        assert(
          after && after.top >= after.hdrBottom - 1 && after.top < 680 && after.bottom > after.hdrBottom,
          `820x680 (${motion}): zoomed map not below header: ${JSON.stringify(after)}`,
        )
        await a3.click()
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        assert.deepEqual(errors, [], `NA45C-07 820x680 (${motion}) errors: ${errors.join(" | ")}`)
      } finally {
        await context.close()
      }
    }

    // 390x568 phone scrolled down past map so map is offscreen above
    {
      const { context, page, errors } = await openRole({ width: 390, height: 568 }, 5, "/payment", {
        reducedMotion: motion,
      })
      try {
        await page.evaluate(() => {
          const root = document.querySelector(".pay-root")
          if (root) root.scrollTop = root.scrollHeight
        })
        const before = await page.evaluate(() => {
          const el = document.getElementById("floor-map")
          const hdr = document.querySelector(".pay-hdr")?.getBoundingClientRect()
          return el && hdr ? { bottom: el.getBoundingClientRect().bottom, hdrBottom: hdr.bottom } : null
        })
        assert(
          before && before.bottom <= before.hdrBottom + 1,
          `390x568 (${motion}): expected #floor-map scrolled offscreen above, got ${JSON.stringify(before)}`,
        )
        const bar1 = page.locator(".pay-sess", { hasText: "BAR01" })
        await bar1.click()
        await page.waitForTimeout(750)
        const after = await page.evaluate(() => {
          const el = document.getElementById("floor-map")
          const hdr = document.querySelector(".pay-hdr")?.getBoundingClientRect()
          if (!el || !hdr) return null
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, hdrBottom: hdr.bottom }
        })
        assert(
          after && after.top >= after.hdrBottom - 1 && after.top < 568 && after.bottom > after.hdrBottom,
          `390x568 (${motion}): zoomed map not below header: ${JSON.stringify(after)}`,
        )
        await bar1.click()
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        assert.deepEqual(errors, [], `NA45C-07 390x568 (${motion}) errors: ${errors.join(" | ")}`)
      } finally {
        await context.close()
      }
    }
    results.push(`PASS NA45C-07 offscreen map scroll below header (${motion})`)
  }

  // 14. NA45C-05: Standalone routes (/duyet-huy-mon, /chebien, /phucvu, /admin/overview) redirect CASHIER to /payment
  //     at 390 and 1440, while preserving OWNER / WAITER / BAR access
  {
    for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
      const { context, page, errors } = await openRole(vp, 5, "/payment")
      try {
        for (const standaloneRoute of ["/duyet-huy-mon", "/chebien", "/phucvu", "/admin/overview"]) {
          await page.goto(`${base}${standaloneRoute}`, { waitUntil: "networkidle" })
          assert.equal(
            new URL(page.url()).pathname,
            "/payment",
            `${vp.name}: CASHIER on ${standaloneRoute} must redirect to /payment`,
          )
          await assertCleanCashierShell(page, `${vp.name} NA45C-05 ${standaloneRoute}`)
          await expect(page.getByText("Phê duyệt hủy món")).toHaveCount(0)
        }
        assert.deepEqual(errors, [], `NA45C-05 (${vp.name}) Cashier errors: ${errors.join(" | ")}`)
      } finally {
        await context.close()
      }
    }

    const ownerCtx = await openRole(VIEWPORTS[2], 3, "/duyet-huy-mon")
    try {
      assert.equal(new URL(ownerCtx.page.url()).pathname, "/duyet-huy-mon")
      await expect(ownerCtx.page.getByText("Phê duyệt hủy món").first()).toBeVisible()
      await ownerCtx.page.goto(`${base}/admin/overview`, { waitUntil: "networkidle" })
      assert.equal(new URL(ownerCtx.page.url()).pathname, "/admin/overview")
      assert.deepEqual(ownerCtx.errors, [], `NA45C-05 Owner errors: ${ownerCtx.errors.join(" | ")}`)
      results.push("PASS NA45C-05 Cashier standalone redirects (/duyet-huy-mon etc.) + Owner preserved")
    } finally {
      await ownerCtx.context.close()
    }
  }

  // Close mock Vite before starting HTTP-mode Vite so HTTP_CHECK_PORT can reuse BASE_PORT (e.g. 43943).
  if (viteServer) {
    await viteServer.close()
    viteServer = null
  }

  // 13. NA45C-06: HTTP-mode auth stub goes /thungan/login -> /payment directly (never /floor), logout returns to /thungan/login
  {
    const httpBase = `http://127.0.0.1:${HTTP_CHECK_PORT}`
    const httpVite = await startOwnedVite(HTTP_CHECK_PORT, { mode: "http", baseUrl: httpBase })
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await ctx.newPage()
      let signedIn = false
      let portalMode = "cashier"
      const paymentApiRequests = []
      const framePaths = []
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) framePaths.push(new URL(frame.url()).pathname)
      })
      await page.route("**/api/v1/**", async (route) => {
        const req = route.request()
        const urlPath = new URL(req.url()).pathname
        if (urlPath.includes("/payment")) paymentApiRequests.push(urlPath)
        const headers = { "access-control-allow-origin": httpBase, "access-control-allow-credentials": "true" }
        const makeSession = () => ({
          user: {
            id: portalMode === "cashier" ? 5 : 6,
            username: portalMode === "cashier" ? "thungan1" : "phucvu1",
            displayName: portalMode === "cashier" ? "Thu ngân" : "Phục vụ 1",
            organizationId: 1,
            venueId: 1,
            roles: [portalMode === "cashier" ? "CASHIER" : "WAITER"],
            accessLevel: null,
          },
          roles: [portalMode === "cashier" ? "CASHIER" : "WAITER"],
          permissions: portalMode === "cashier" ? ["payment.collect", "order.read"] : ["order.read"],
          csrfToken: "csrf-stub",
          portal: portalMode,
          expiresAt: "2026-12-01T00:00:00.000Z",
        })
        if (urlPath === "/api/v1/auth/me") {
          return signedIn
            ? route.fulfill({ status: 200, headers, json: makeSession() })
            : route.fulfill({ status: 401, headers, json: { error: { code: "AUTH_REQUIRED", message: "Login" } } })
        }
        if (urlPath === "/api/v1/auth/login") {
          signedIn = true
          return route.fulfill({ status: 200, headers, json: makeSession() })
        }
        if (urlPath === "/api/v1/auth/logout") {
          signedIn = false
          return route.fulfill({ status: 204, headers })
        }
        return route.fulfill({ status: 200, headers, json: {} })
      })

      await page.goto(`${httpBase}/thungan/login`, { waitUntil: "networkidle" })
      framePaths.length = 0
      await page.getByLabel("Tên đăng nhập", { exact: true }).fill("thungan1")
      await page.getByLabel("Mật khẩu", { exact: true }).fill("secret")
      await Promise.all([
        page.waitForURL((u) => new URL(u).pathname === "/payment"),
        page.getByRole("button", { name: /Đăng nhập/ }).click(),
      ])
      await expect(page.getByRole("heading", { name: "Thu tiền chưa kết nối máy chủ" })).toBeVisible()
      assert(!framePaths.includes("/floor"), `Cashier login touched /floor: ${JSON.stringify(framePaths)}`)
      assert.deepEqual(paymentApiRequests, [], `Unexpected PaymentApi requests in HTTP fallback: ${paymentApiRequests}`)

      // Account menu works and logs out cleanly back to /thungan/login
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Đăng xuất/ }).click()
      await expect(page).toHaveURL(/\/thungan\/login$/)

      // Spot-check Waiter portal still navigates directly to /phucvu
      portalMode = "waiter"
      await page.goto(`${httpBase}/phucvu/login`, { waitUntil: "networkidle" })
      framePaths.length = 0
      await page.getByLabel("Tên đăng nhập", { exact: true }).fill("phucvu1")
      await page.getByLabel("Mật khẩu", { exact: true }).fill("secret")
      await Promise.all([
        page.waitForURL((u) => new URL(u).pathname === "/phucvu"),
        page.getByRole("button", { name: /Đăng nhập/ }).click(),
      ])
      assert(!framePaths.includes("/floor"), `Waiter login touched /floor: ${JSON.stringify(framePaths)}`)
      await ctx.close()
      results.push("PASS NA45C-06 HTTP login /thungan/login -> /payment direct (never /floor) + logout")
    } finally {
      await httpVite.close()
    }
  }

  console.log(results.join("\n"))
} finally {
  await browser.close()
  if (viteServer) await viteServer.close()
}
