// End-to-end flows as a receptionist / owner would run them on a tablet (1280x800).
// Run against a dev server:  npm run dev  ->  npm run e2e
// Env: E2E_BASE_URL (default http://127.0.0.1:5173), PW_CHROMIUM_PATH (optional custom Chromium binary).
import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
import fs from "node:fs"
const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : fs.existsSync(defaultChrome)
      ? { executablePath: defaultChrome }
      : {},
)
fs.mkdirSync("e2e/.artifacts", { recursive: true })
let failures = 0
const results = []
async function flow(name, userId, fn, pageOptions = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...pageOptions })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160))
  })
  await page.addInitScript(
    (u) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: u, theme: "dark" })),
    userId,
  )
  try {
    await fn(page)
    if (errors.length) throw new Error("console errors: " + errors.join(" | "))
    results.push(`PASS ${name}`)
  } catch (e) {
    failures++
    console.error(`[${name}] ${e.stack || e.message}`)
    results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`)
    await page.screenshot({ path: `e2e/.artifacts/fail-${name.replace(/\W+/g, "_")}.png` })
  }
  await page.close()
}
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"], [data-combined-codes~="${code}"]`).first()
const barSeat = (page, number) =>
  page.locator(`[aria-label^="Ghế Bar ${number},"], [aria-label^="Ghế Bar ${number}:"], [data-combined-codes~="BAR${String(number).padStart(2, "0")}"]`).first()
const expectLabel = async (loc, re) => {
  for (let i = 0; i < 25; i++) {
    if (re.test(await loc.getAttribute("aria-label"))) return
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error(`label ${await loc.getAttribute("aria-label")} !~ ${re}`)
}
const selectTomorrow = async (page) => {
  const tomorrow = await page.evaluate(async () => {
    const { clock } = await import("/src/services/index.ts")
    const { addDays, businessDateOf } = await import("/src/lib/time.ts")
    return addDays(businessDateOf(clock.now()), 1)
  })
  const [year, month, day] = tomorrow.split("-").map(Number)
  await page.getByRole("button", { name: "Chọn ngày kinh doanh" }).click()
  await page.locator(`[data-day="${month}/${day}/${year}"]`).click()
}
const expectOccupied = async (loc, guests) => {
  await expectLabel(loc, new RegExp(`(?:Đã tới|Có khách),.*\\b${guests} khách(?:,|$)`))
  if (/\d+\s*(?:phút|giờ|['’′])/.test(await loc.textContent())) throw new Error("Occupied glyph still shows elapsed time")
  if ((await loc.locator("text").allTextContents()).some((t) => /\b\d+\s*khách\b/i.test(t))) {
    throw new Error("Occupied table must not display 'N khách' text inside the cell")
  }
}

// UI-FIX regression: check the visible geometry, including clipping ancestors.
for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1024, 800], [1280, 800], [1440, 900]]) {
    for (const userId of width >= 768 ? [1, 3] : [1]) {
      await flow(`floor bounds and controls ${theme} ${width} user ${userId}`, userId, async (page) => {
        await page.addInitScript(({ theme, userId }) => localStorage.setItem("21gam.session.v1", JSON.stringify({ userId, theme })), { theme, userId })
        await page.goto(base + "/floor", { waitUntil: "networkidle" })
        for (let i = 0; i < 10; i++) {
          const dismiss = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ }).first()
          if (!await dismiss.isVisible()) break
          await dismiss.click()
        }
        if (userId === 1) assert.equal(await page.getByRole("tablist", { name: "Lọc khu" }).count(), 0, "Receptionist has no zone tabs")
        for (const phase of userId === 1 ? ["load"] : ["load", "Tất cả"]) {
          if (phase === "Tất cả") {
            await page.getByRole("tab", { name: "Bar", exact: true }).click()
            await page.getByRole("tab", { name: "Tất cả", exact: true }).click()
          }
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(400)
          if ([360, 390, 768, 1280].includes(width)) {
            const outside = await page.locator('svg[role="group"]').evaluate((svg) => {
              const canvas = svg.getBoundingClientRect()
              const camera = svg.querySelector(":scope > g")
              const labels = [...camera.querySelectorAll("text")]
              const parts = [["floor frame", camera.querySelector(":scope > rect")]]
              for (const name of ["QUẦY BAR", "KHU PHA CHẾ", "LỐI VÀO"]) {
                const label = labels.find((el) => el.textContent.trim() === name)
                parts.push([name, label], [`${name} fixture`, label?.parentElement.querySelector("path")])
              }
              return parts.flatMap(([name, el]) => {
                if (!el) return [`${name} missing`]
                const r = el.getBoundingClientRect()
                return r.width <= 0 || r.height <= 0 || r.left < canvas.left - 0.1 || r.top < canvas.top - 0.1 || r.right > canvas.right + 0.1 || r.bottom > canvas.bottom + 0.1
                  ? [`${name} outside canvas: ${JSON.stringify({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, canvas: canvas.toJSON() })}`] : []
              })
            })
            if (outside.length) throw new Error(`${phase}: ${outside.join("; ")}`)
          }
          const forbidden = page.getByRole("button", { name: /zoom|full\s*screen|phóng to|thu nhỏ|toàn màn hình|^[+−-]$/i })
            .or(page.getByRole("group", { name: /zoom|full\s*screen|thu phóng|toàn màn hình/i }))
          if (await forbidden.count()) throw new Error(`${phase}: zoom/fullscreen control present`)
          if (width >= 768 && userId === 1) assert.equal(await page.getByRole("button", { name: "Xem khả dụng", exact: true }).count(), 0, "Receptionist has no availability button")
          if (width >= 768 && userId === 3) {
            const clipping = await page.getByRole("button", { name: "Xem khả dụng", exact: true }).evaluate((button) => {
              const r = button.getBoundingClientRect()
              if (button.scrollWidth > button.clientWidth) return "label scrollWidth exceeds clientWidth"
              for (let el = button.parentElement; el; el = el.parentElement) {
                const style = getComputedStyle(el)
                const box = el.getBoundingClientRect()
                if (/(auto|hidden|scroll|clip)/.test(style.overflowX) && (el.scrollWidth > el.clientWidth || r.left < box.left - 0.1 || r.right > box.right + 0.1)) return "ancestor clips Xem khả dụng horizontally"
                if (/(auto|hidden|scroll|clip)/.test(style.overflowY) && (r.top < box.top - 0.1 || r.bottom > box.bottom + 0.1)) return "ancestor clips Xem khả dụng vertically"
              }
              return null
            })
            if (clipping) throw new Error(`${phase}: ${clipping}`)
          }
        }
      }, { viewport: { width, height }, reducedMotion: "reduce", hasTouch: width < 768 })
    }
  }
}

await flow("walk-in from table panel, then undo", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
  await page.getByRole("radio", { name: "4 khách" }).click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(table(page, "B5"), 4)
  await page.getByText("Bản mô phỏng").first().waitFor()
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).first().click()
  await expectLabel(table(page, "B5"), /Trống|Chưa đặt/)
})

await flow("inline walk-in suggests a table (3 taps)", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
  await page.getByRole("radio", { name: "4 khách" }).click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(table(page, "B5"), 4)
})

await flow(
  "mobile walk-in selects multiple Bar seats on the canonical map",
  1,
  async (page) => {
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    const deferAlert = page.getByRole("button", { name: "Đã xem, xử lý sau" })
    if (await deferAlert.isVisible()) await deferAlert.click()
    await barSeat(page, 13).click()
    await page.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
    const form = page.getByRole("form", { name: /^(Tạo đặt bàn|Mở bàn Walk-in)/ })
    await form.getByRole("radio", { name: "2 khách" }).click()
    if (await form.getByRole("radiogroup", { name: "Bàn trống" }).count()) {
      throw new Error("Walk-in still renders the legacy table-chip list")
    }
    // P1 leaves capacity to staff; the map accepts another seat without a client-side shortage gate.
    await expect(form.getByRole("button", { name: "Mở bàn ngay" })).toBeEnabled()
    await barSeat(page, 15).click()
    await form.getByText("Bar 13 + Bar 15 đang trống · 2 chỗ, đủ 2 khách").waitFor()
    if (await form.getByRole("button", { name: "Mở bàn ngay" }).isDisabled()) {
      throw new Error("Walk-in action stayed disabled after enough Bar seats were selected")
    }
  },
  { viewport: { width: 390, height: 844 }, hasTouch: true },
)

await flow("check-in reserved booking A5", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "A5").click()
  await page.getByRole("button", { name: /Check-in A5/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Check-in", exact: true }).click()
  await expectOccupied(table(page, "A5"), 3)
})

await flow("move seated party B7? -> combine B5 + B7 then split", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: /Mở Bàn B5/ }).click()
  await expectOccupied(table(page, "B5"), 2)
  await page.locator('[aria-label="Thao tác mặt bằng"]').getByRole("button", { name: "Ghép bàn", exact: true }).click()
  await table(page, "B7").click()
  await page.getByRole("button", { name: /Ghép \d+ bàn|Xác nhận ghép/ }).click()
  await expect(page.locator('[data-combined-codes="B5 B7"]')).toHaveCount(2)
  await expectOccupied(table(page, "B7"), 2)
  await page.getByRole("button", { name: "Tách bàn" }).click()
  await page.getByRole("dialog").getByRole("checkbox").nth(1).click()
  await page.getByRole("button", { name: /Tách và nhả B7/ }).click()
  await expectLabel(table(page, "B7"), /Trống|Chưa đặt/)
  await expectOccupied(table(page, "B5"), 2)
})

await flow("booking flow end-to-end for tomorrow with table", 3, async (page) => {
  await page.goto(base + "/reservations", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Đặt bàn mới/ }).click()
  await page.getByRole("button", { name: "Ngày mai" }).click()
  await page.getByRole("button", { name: /Chọn giờ bằng con lăn/ }).click()
  await page.locator('[data-wheel="Giờ"] [data-value="20"]').click()
  await page.locator('[data-wheel="Phút"] [data-value="30"]').click()
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByRole("button", { name: /^Bàn C4[, :]/ }).first().click()
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByLabel("Tên khách").fill("Khách E2E")
  await page.getByLabel("Số điện thoại").fill("0912345678")
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByRole("button", { name: /Xác nhận đặt bàn/ }).click()
  await page
    .getByText(/Booking 20:30 · 2 khách · giữ C4/)
    .first()
    .waitFor()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByText("Khách E2E").first().waitFor()
  const html = await page.content()
  if (html.includes("0912345678") || html.includes("912345678")) throw new Error("full phone leaked to DOM")
})

await flow("BR-01 BR-02: book a mixed layout group and project its birthday before and after check-in", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Ghép bàn", exact: true }).click()
  await table(page, "B5").click()
  await barSeat(page, 15).click()
  await page.getByRole("button", { name: "Ghép 2 bàn", exact: true }).click()
  await expect(table(page, "B5")).toHaveAttribute("data-is-group", "true")
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Tạo đặt trước", exact: true }).click()
  const form = page.getByRole("form")
  await form.getByLabel("Tên khách", { exact: true }).fill("Mixed birthday group")
  await form.getByRole("checkbox", { name: "Sinh nhật", exact: true }).click()
  await form.getByRole("button", { name: "Đặt bàn B5 + Bar 15", exact: true }).click()
  await expect(form).toBeHidden()
  const booking = await page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const { businessDateOf } = await import("/src/lib/time.ts")
    return (await api.listReservations({ businessDate: businessDateOf(clock.now()) })).find((r) => r.displayName === "Mixed birthday group")
  })
  assert(booking)
  assert.deepEqual(booking.tableIds, [13, 115])
  assert.equal(booking.isBirthday, true)
  await expect(table(page, "B5").locator('[data-icon="cake"]')).toBeVisible()
  await page.screenshot({ path: "e2e/.artifacts/codex-fix/mixed-group-birthday-booked-390.png" })
  const readClaims = () => page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    return (await api.getFloorState(clock.now())).tables.filter((t) => [13, 115].includes(t.tableId)).map((t) => t.claim)
  })
  for (const claim of await readClaims()) {
    assert.equal(claim.reservationId, booking.id)
    assert(claim.flags.includes("BIRTHDAY"))
  }
  await page.evaluate(async (r) => {
    const { api, clock } = await import("/src/services/index.ts")
    await api.checkIn({ reservationId: r.id, version: r.version, guestCount: r.partySize })
    clock.advance(0)
  }, booking)
  for (const claim of await readClaims()) {
    assert.equal(claim.reservationId, booking.id)
    assert(claim.visitId)
    assert(claim.flags.includes("BIRTHDAY"))
  }
  await expect(table(page, "B5").locator('[data-icon="cake"]')).toBeVisible()
  await page.screenshot({ path: "e2e/.artifacts/codex-fix/mixed-group-birthday-seated-390.png" })
}, { viewport: { width: 390, height: 844 }, hasTouch: true })

await flow("validation: booking needs name or phone, note without phone", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Tạo đặt bàn" }).click()
  await page.getByLabel("Ghi chú").fill("goi 0901234567")
  await page.getByRole("button", { name: "Lưu đặt bàn" }).click()
  await page.getByRole("alert").filter({ hasText: "Cần ít nhất tên hoặc số điện thoại" }).waitFor()
  await page.getByRole("alert").filter({ hasText: "Không ghi số điện thoại vào ghi chú" }).waitFor()
})

await flow("conflict: another device takes the table at confirm", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "Gài xung đột lần xác nhận tới" }).click()
  await page.keyboard.press("Escape")
  await table(page, "B7").click()
  await page.getByRole("button", { name: /Mở Bàn B7/ }).click()
  await page.getByText("Bàn không còn trống").waitFor()
  await page
    .getByText(/iPad cửa/)
    .first()
    .waitFor()
})

await flow("undo blocked after remote edit (conflict UX)", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: /Mở Bàn B5/ }).click()
  await expectOccupied(table(page, "B5"), 2)
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "iPad cửa thao tác ngay" }).click()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).first().click()
  await page.getByText("Không thể hoàn tác").first().waitFor()
})

await flow("time warp: A5 becomes late after +15', no auto cancel after +60'", 3, async (page) => {
  const state = () => page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const catalog = await api.getCatalog()
    const id = catalog.tables.find(t => t.code === "A5").id
    return (await api.getFloorState(clock.now())).tables.find(t => t.tableId === id).state
  })
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "15'" }).click()
  await page.keyboard.press("Escape")
  await expectLabel(table(page, "A5"), /Tới muộn/)
  assert.equal(await state(), "late")
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.keyboard.press("Escape")
  await expectLabel(table(page, "A5"), /Tới muộn/)
  assert.equal(await state(), "noshow", "warning must keep the booking and table held")
})

await flow(
  "call customer: mobile opens tel flow and keeps a manual outcome action",
  3,
  async (page) => {
    await page.addInitScript(() => {
      const click = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        if (this.href.startsWith("tel:")) {
          window.__lastTelUri = this.href
          return
        }
        return click.call(this)
      }
    })
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    await page.evaluate(async () => {
      const { demo } = await import("/src/services/index.ts")
      demo?.reset()
    })
    await page.reload({ waitUntil: "networkidle" })
    const blockingAlert = page.getByRole("alertdialog")
    if (await blockingAlert.count()) {
      await blockingAlert.getByRole("button", { name: "Đã xem, xử lý sau", exact: true }).click()
    }
    await table(page, "A5").click()
    for (const width of [360, 375, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : width === 375 ? 812 : 800 })
      await page.getByRole("button", { name: "Gọi khách", exact: true }).waitFor()
    }
    await page.screenshot({ path: "e2e/.artifacts/call-customer-mobile-390.png" })
    await page.getByRole("button", { name: "Gọi khách", exact: true }).click()
    await page.evaluate(async () => {
      const { clock } = await import("/src/services/index.ts")
      clock.advance(60)
    })
    await page.waitForTimeout(16_000)
    await page.getByRole("button", { name: "Ghi kết quả cuộc gọi", exact: true }).waitFor()
    await page.getByRole("button", { name: "Gọi khách", exact: true }).waitFor({ state: "detached" })
    for (let index = 0; index < 20; index += 1) {
      const noShowAlert = page.getByRole("alertdialog")
      if (!(await noShowAlert.isVisible().catch(() => false))) break
      await noShowAlert.getByRole("button", { name: "Đã xem, xử lý sau", exact: true }).click()
      await page.waitForTimeout(100)
    }
    await page.getByRole("button", { name: "Ghi kết quả cuộc gọi", exact: true }).click()
    const outcome = page.getByRole("dialog", { name: "Kết quả cuộc gọi" })
    await outcome.getByRole("button", { name: "Không nghe máy", exact: true }).click()
    await outcome.waitFor({ state: "hidden" })
  },
  {
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  },
)

// BA-023 removed the user-agent gate: the client no longer refuses a desktop or
// tablet browser and lets the OS decide whether a dialer can handle tel:. This
// flow guards that decision, so the old "unsupported device" notice cannot come
// back. Sprint 2 HTTP E2E covers the same capability against the real backend.
await flow(
  "call customer: tablet starts the call instead of refusing the device",
  3,
  async (page) => {
    // Observe the synthetic tel: anchor click without letting it navigate.
    await page.addInitScript(() => {
      window.__telClicks = []
      const originalClick = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function click() {
        if (this.href.startsWith("tel:")) {
          window.__telClicks.push(this.href)
          return
        }
        return originalClick.call(this)
      }
    })
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    await page.evaluate(async () => {
      const { demo } = await import("/src/services/index.ts")
      demo?.reset()
    })
    await page.reload({ waitUntil: "networkidle" })
    await table(page, "A5").click()
    await page.getByRole("button", { name: "Gọi khách", exact: true }).click()

    // The call starts: the outcome action replaces the call button.
    await page.getByRole("button", { name: "Ghi kết quả cuộc gọi", exact: true }).waitFor()
    await page.getByRole("button", { name: "Gọi khách", exact: true }).waitFor({ state: "detached" })
    const telClicks = await page.evaluate(() => window.__telClicks)
    assert.equal(telClicks.length, 1, "tablet did not open a tel: URI")
    assert.match(telClicks[0], /^tel:\+?\d+$/)

    // The device-gating notice must not reappear, and the full number stays off screen.
    const body = await page.locator("body").innerText()
    assert(!body.includes("không hỗ trợ gọi trực tiếp"), "device gating notice came back")
    assert(!body.includes(telClicks[0].replace("tel:", "")), "tablet UI leaked the full phone")
    await page.screenshot({ path: "e2e/.artifacts/call-customer-tablet-768.png" })
  },
  { viewport: { width: 768, height: 1024 } },
)

await flow("waitlist: claim, accept offer -> hold, then seat when guest arrives", 3, async (page) => {
  await page.goto(base + "/waitlist", { waitUntil: "networkidle" })
  const card = page.locator("li", { hasText: "Chị mặc váy đỏ" }).first()
  await card.getByRole("button", { name: "Nhận liên hệ" }).click()
  const dlg = page.getByRole("dialog", { name: /Kết quả liên hệ/ })
  await dlg.getByRole("button", { name: /^B5/ }).click()
  await dlg.getByRole("button", { name: "Ghi kết quả" }).click()
  await card.getByText("Đang giữ bàn").waitFor()

  // Acceptance 4: pure waitlist entry without reservation hides "Xem booking" and opens entry detail
  const xemBookingBtn = card.getByRole("button", { name: "Xem booking" })
  assert.equal(await xemBookingBtn.count(), 0, "Pure waitlist hold must hide 'Xem booking'")
  await card.getByRole("button", { name: "Xem đơn chờ" }).click()
  const entryDlg = page.getByRole("dialog").filter({ hasText: "Chi tiết mục chờ" })
  await entryDlg.waitFor()
  await page.keyboard.press("Escape")
  await entryDlg.waitFor({ state: "hidden" })

  // Acceptance 10 & 11: arrival shows confirm, cancelling leaves everything held
  await card.getByRole("button", { name: "Khách đã đến" }).click()
  const confirmDlg = page.getByRole("dialog").filter({ hasText: "Xác nhận khách đã đến" }).last()
  await confirmDlg.waitFor()
  assert(await confirmDlg.getByText("Chị mặc váy đỏ").first().isVisible(), "Confirm dialog shows guest name")
  await confirmDlg.getByRole("button", { name: "Quay lại" }).click()
  await confirmDlg.waitFor({ state: "hidden" })
  await card.getByText("Đang giữ bàn").waitFor()

  // Acceptance 12: confirm arrival seats entry
  await card.getByRole("button", { name: "Khách đã đến" }).click()
  await confirmDlg.waitFor()
  await confirmDlg.getByRole("button", { name: "Khách đã đến", exact: true }).click()
  await page.getByText("Đã đóng trong ca").waitFor()
})

await flow("receptionist cannot reveal phone; owner can", 3, async (page) => {
  await page.goto(base + "/guests", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Xem số" }).first().click()
  await page.getByRole("dialog").getByRole("button", { name: "Xem số" }).click()
  await page
    .getByText(/^0\d{3} \d{3} \d{3}$/)
    .first()
    .waitFor()
})

await flow("receptionist sees no reveal button and no reports", 1, async (page) => {
  await page.goto(base + "/guests", { waitUntil: "networkidle" })
  await page.waitForURL("**/floor")
  if (await page.getByRole("button", { name: "Xem số" }).count()) throw new Error("reveal visible for receptionist")
  await page.goto(base + "/reports", { waitUntil: "networkidle" })
  await page.waitForURL("**/floor")
  if (await page.getByRole("link", { name: "Báo cáo" }).count())
    throw new Error("reports navigation visible for receptionist")
})

await flow("availability tomorrow: B3 reserved, A3 free", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await selectTomorrow(page)
  await page.waitForTimeout(600)
  const b3 = await table(page, "B3").getAttribute("aria-label")
  const a3 = await table(page, "A3").getAttribute("aria-label")
  if (!/Đã đặt|Đang đặt/.test(b3)) throw new Error("B3 should be reserved tomorrow: " + b3)
  if (!/Trống|Chưa đặt/.test(a3)) throw new Error("A3 should be free tomorrow: " + a3)
})

await flow("inline form: occupied table is refused, free table is picked on the map", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
  await page.getByRole("radio", { name: "4 khách" }).click()
  await table(page, "A3").click()
  await page
    .getByText(/A3: không trống/)
    .first()
    .waitFor()
  await page.getByRole("button", { name: "Bỏ B5" }).waitFor()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(table(page, "B5"), 4)
})

await flow("cancel booking requires confirmation with reason", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B4").click()
  await page.getByRole("button", { name: "Hủy booking" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Hủy booking" }).click()
  await expectLabel(table(page, "B4"), /Trống|Chưa đặt/)
})

await flow("direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Mở điều khiển thời gian/ }).click()
  await page.getByRole("button", { name: "Nạp lại dữ liệu mẫu" }).click()
  await page.keyboard.press("Escape")

  await page.goto(base + "/waitlist", { waitUntil: "networkidle" })
  const card = page.locator("li", { hasText: "Nhóm áo xanh" }).first()
  await card.waitFor()
  await card.getByRole("button", { name: "Khách nhận bàn ngay" }).click()

  const seatDialog = page.getByRole("dialog").filter({ hasText: "Gán giữ bàn cho khách" })
  await seatDialog.waitFor()
  if (await seatDialog.getByLabel("Tăng số khách").count()) {
    throw new Error("Stepper increment control should not be present in seat waitlist dialog")
  }
  await seatDialog.getByText("4 khách", { exact: false }).waitFor()

  await seatDialog.locator("button", { hasText: "B7" }).first().click()
  await seatDialog.getByRole("button", { name: "Xác nhận giữ bàn" }).click()
  await seatDialog.waitFor({ state: "hidden" })

  await card.getByText("Đang giữ bàn", { exact: true }).waitFor()
  await card.getByText("B7").first().waitFor()

  await card.getByRole("button", { name: "Khách đã đến" }).click()
  const checkInDialog = page.getByRole("dialog").filter({ hasText: "Xác nhận khách đã đến" }).last()
  await checkInDialog.waitFor()
  await checkInDialog.getByRole("button", { name: "Khách đã đến", exact: true }).click()
  await checkInDialog.waitFor({ state: "hidden" })
  await page.getByText("Đã đóng trong ca").waitFor()
})

await flow("direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)", 3, async (page) => {
  await page.setViewportSize({ width: 390, height: 844 })

  const cases = [
    { kind: "WALK_IN", name: "Chị mặc váy đỏ" },
    { kind: "ADVANCE_RESERVATION", name: "Lý Mỹ Anh" },
  ]

  for (const tc of cases) {
    await page.goto(base + "/waitlist", { waitUntil: "networkidle" })
    await page.evaluate(async () => {
      const { demo } = await import("/src/services/index.ts")
      demo?.reset()
    })
    await page.reload({ waitUntil: "networkidle" })

    const dismissAlert = page.getByRole("button", { name: "Đã xem, xử lý sau" })
    if (await dismissAlert.isVisible()) await dismissAlert.click()
    const closeToast = page.getByRole("button", { name: "Đóng thông báo" })
    if (await closeToast.isVisible()) await closeToast.click()

    // 1. Establish reservation-backed direct assignment for target entry with B5+B7 (group)
    const assignment = await page.evaluate(async (targetName) => {
      const { api, clock } = await import("/src/services/index.ts")
      const { businessDateOf } = await import("/src/lib/time.ts")
      const bd = businessDateOf(clock.now())
      const wl = await api.listWaitlist(bd)
      const target = wl.find((e) => e.displayName === targetName)
      if (!target) throw new Error(`Target waitlist entry ${targetName} not found`)

      // Tables B5 (id 13) and B7 (id 10) in Zone B form a group
      const seatRes = await api.seatWaitlist({
        entryId: target.id,
        version: target.version,
        guestCount: target.partySize,
        tableIds: [13, 10],
      })

      const updatedWl = await api.listWaitlist(bd)
      const updatedEntry = updatedWl.find((e) => e.id === target.id)
      const reservations = await api.listReservations({ businessDate: bd })
      const booking = reservations.find((r) => r.id === seatRes.reservationId)
      const visits = await api.listVisits(bd)
      const bookingVisits = visits.filter((v) => v.id === booking?.visitId)

      return {
        targetId: target.id,
        reservationId: seatRes.reservationId,
        groupId: seatRes.groupId,
        entry: updatedEntry,
        booking,
        bookingVisitsCount: bookingVisits.length,
        businessDate: bd,
      }
    }, tc.name)

    // Assert reservation-backed lifecycle after assignment
    if (!assignment.entry || assignment.entry.status !== "HOLD_ACTIVE") {
      throw new Error(`Target ${tc.name} should be HOLD_ACTIVE after assignment`)
    }
    if (!assignment.entry.reservationId || assignment.entry.reservationId !== assignment.reservationId) {
      throw new Error(`Target ${tc.name} missing reservationId after assignment`)
    }
    if (assignment.entry.hold !== null) {
      throw new Error(`Target ${tc.name} should not have an offer hold after direct assignment`)
    }
    if (!assignment.booking || assignment.booking.status !== "BOOKED") {
      throw new Error(`Booking for ${tc.name} should be BOOKED before arrival`)
    }
    if (assignment.bookingVisitsCount !== 0) {
      throw new Error(`Booking for ${tc.name} should have zero visits before arrival`)
    }

    // 2. Pin mobile actions strictly to target entry's card
    const card = page.locator("div.rounded-\\[18px\\]", { hasText: tc.name })
    await card.getByText("Đang giữ bàn").waitFor()
    await card.getByText("Đang giữ B5 + B7").waitFor()

    // Acceptance 3: "Xem booking" opens linked reservation detail, showing guest name
    await card.getByRole("button", { name: "Xem booking" }).click()
    const backBtn = page.locator('button[aria-label="Quay lại"]').first()
    await backBtn.waitFor()
    assert(await page.getByText(tc.name).first().isVisible(), `Detail must show booking for ${tc.name}`)
    await backBtn.click()
    await card.getByText("Đang giữ bàn").waitFor()

    // Acceptance 5: "Đổi / Ghép bàn" opens table picker, cancel returns without mutating
    await card.getByRole("button", { name: "Đổi / Ghép bàn" }).click()
    const cancelPick = page.getByRole("button", { name: "Hủy chọn bàn" })
    await cancelPick.waitFor()
    await cancelPick.click()
    await page.locator('nav[aria-label="Điều hướng chính"]').getByRole("button", { name: /Đơn chờ/ }).click()
    await card.getByText("Đang giữ bàn").waitFor()

    // Acceptance 7: "Đổi trạng thái" opens StatusDialog, close returns without mutating
    await card.getByRole("button", { name: "Đổi trạng thái" }).click()
    const statusDlg = page.getByRole("dialog", { name: "Đổi trạng thái booking" })
    await statusDlg.waitFor()
    await statusDlg.getByRole("button", { name: "Đóng", exact: true }).click()
    await statusDlg.waitFor({ state: "hidden" })
    await card.getByText("Đang giữ bàn").waitFor()

    // Acceptance 10 & 11: "Khách đã đến" opens ConfirmDialog, cancel leaves card held
    await card.getByRole("button", { name: "Khách đã đến" }).click()
    const confirmDlg = page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: "Xác nhận khách đã đến" }).last()
    await confirmDlg.waitFor()
    assert(await confirmDlg.getByText(tc.name).first().isVisible(), "ConfirmDialog shows guest name")
    assert(await confirmDlg.getByText("B5 + B7").first().isVisible(), "ConfirmDialog shows table codes")
    await confirmDlg.getByRole("button", { name: "Quay lại", exact: true }).click()
    await confirmDlg.waitFor({ state: "hidden" })
    await card.getByText("Đang giữ bàn").waitFor()

    // Acceptance 12 & 13: Confirm check-in transitions to SEATED, double tap adds no second visit
    await card.getByRole("button", { name: "Khách đã đến" }).click()
    await confirmDlg.waitFor()
    await confirmDlg.getByRole("button", { name: "Khách đã đến", exact: true }).click()
    await card.getByText("Đã nhận bàn").first().waitFor()

    // 4. Assert arrival check-in lifecycle and group preservation
    const arrival = await page.evaluate(
      async ({ targetId, reservationId, businessDate }) => {
        const { api } = await import("/src/services/index.ts")
        const bd = businessDate
        const wl = await api.listWaitlist(bd)
        const entry = wl.find((e) => e.id === targetId)
        const reservations = await api.listReservations({ businessDate: bd })
        const booking = reservations.find((r) => r.id === reservationId)
        const visits = await api.listVisits(bd)
        const bookingVisits = visits.filter((v) => v.id === booking?.visitId)

        return {
          entry,
          booking,
          bookingVisits,
        }
      },
      { targetId: assignment.targetId, reservationId: assignment.reservationId, businessDate: assignment.businessDate },
    )

    if (!arrival.entry || arrival.entry.status !== "SEATED") {
      throw new Error(`Target ${tc.name} should be SEATED after arrival check-in`)
    }
    if (!arrival.booking || arrival.booking.status !== "CHECKED_IN") {
      throw new Error(`Booking for ${tc.name} should be CHECKED_IN after arrival check-in`)
    }
    if (arrival.bookingVisits.length !== 1) {
      throw new Error(`Exactly one visit should exist for ${tc.name} (found ${arrival.bookingVisits.length})`)
    }
    const visit = arrival.bookingVisits[0]
    if (!visit.groupId) {
      throw new Error(`Group should be preserved on visit for ${tc.name}`)
    }
    if (!visit.tableIds.includes(13) || !visit.tableIds.includes(10) || visit.tableIds.length !== 2) {
      throw new Error(`Visit tables [${visit.tableIds}] should preserve both B5 and B7 for ${tc.name}`)
    }
  }
})

await flow("mobile booking creation with classification and Zalo export (phone 390px)", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Mở điều khiển thời gian/ }).click()
  await page.getByRole("button", { name: "Nạp lại dữ liệu mẫu" }).click()
  await page.keyboard.press("Escape")

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + "/reservations", { waitUntil: "networkidle" })

  const dismissAlert = page.getByRole("button", { name: "Đã xem, xử lý sau" })
  if (await dismissAlert.isVisible()) await dismissAlert.click()
  const closeToast = page.getByRole("button", { name: "Đóng thông báo" })
  if (await closeToast.isVisible()) await closeToast.click()

  await page.getByRole("button", { name: "Tạo mới" }).click()
  await page.getByRole("button", { name: "Tạo đặt trước" }).click()

  await page.getByPlaceholder("Ví dụ: Chị Lan").fill("Khách Mobile E2E")
  await page.getByPlaceholder("09xx xxx xxx").fill("0988776655")
  const classTrigger = page.locator("#bk-classification")
  if (await classTrigger.isVisible()) {
    await classTrigger.click()
    await page.getByRole("option", { name: "Khách quen (O)" }).click()
  } else {
    await page.getByRole("radio", { name: "Khách quen (O)" }).or(page.getByRole("button", { name: "Khách quen (O)" })).click()
  }
  await page.getByRole("button", { name: "Đặt bàn" }).click()

  await page.getByText("Khách Mobile E2E").first().waitFor()

  const dismissAlert2 = page.getByRole("button", { name: "Đã xem, xử lý sau" })
  if (await dismissAlert2.isVisible()) await dismissAlert2.click()
  const closeToast2 = page.getByRole("button", { name: "Đóng thông báo" })
  if (await closeToast2.isVisible()) await closeToast2.click()

  await page.getByRole("button", { name: "Xuất text Zalo" }).click()
  const exportDialog = page.getByRole("dialog").last()
  const exportInput = exportDialog.getByLabel("Nội dung text booking")
  await exportInput.waitFor()
  const text = await exportInput.inputValue()
  if (!text.includes("Khách Mobile E2E")) throw new Error("Created booking missing from Zalo export")
  if (!text.includes("Bàn khách quen O: 1")) throw new Error("Classification not reflected in Zalo export")
  if (/0988|776655/i.test(text)) throw new Error("Sensitive phone leaked in export")
  await page.keyboard.press("Escape")
})

await flow("bar seat: single walk-in from table detail", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await barSeat(page, 13).click()
  await page.getByRole("button", { name: "Mở bàn Walk-in", exact: true }).click()
  await page.getByRole("radio", { name: "1 khách" }).click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(barSeat(page, 13), 1)
})

await flow("bar seat: multi-seat booking without capacity warning & group reservation", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await barSeat(page, 8).click()
  await page.getByRole("button", { name: "Đặt bàn", exact: true }).click()
  // Capacity is left to staff, including a two-guest booking on one Bar seat.
  await page.getByRole("radio", { name: "2 khách" }).click()
  await page.getByText(/Bar 8 còn trống.*1 chỗ/).waitFor()

  // Select adjacent Bar 7 to exercise the multi-table reservation path.
  await barSeat(page, 7).click()
  await page.getByText(/2 chỗ, đủ 2 khách/).waitFor()

  // Draft inputs
  await page.locator("#qf-name").fill("Khách Bar Ghép")
  await page.locator("#qf-phone").fill("0912345678")
  await page.getByRole("button", { name: /^Đặt bàn Bar 8 \+ Bar 7$/ }).click()

  // K1: Bar seats stay separate circle glyphs with 3px border, dashed selection ring, and no arc connector.
  const cell = page.locator('[data-combined-codes~="BAR07"][data-combined-codes~="BAR08"]')
  await expect(cell).toHaveCount(2)
  await expectLabel(cell.first(), /Đã đặt|Đang đặt|Sắp tới/)
  await expect(page.locator("[data-group-arc]")).toHaveCount(0)
  await expect(cell.first().locator('circle[stroke-width="3"]')).toHaveCount(1)
  await cell.first().click()
  await expect(cell.first()).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-combined-codes~="BAR07"][data-combined-codes~="BAR08"] circle[data-selection-ring="1"]')).toHaveCount(2)
  await cell.first().click()
  await expect(cell.first()).toHaveAttribute("aria-pressed", "false")
  await expect(page.locator('[data-combined-codes~="BAR07"][data-combined-codes~="BAR08"] circle[data-selection-ring="1"]')).toHaveCount(0)

})

await flow("reservation assignment: date-aware availability in both directions (MD-01)", 3, async (page) => {
  await page.goto(base + "/reservations", { waitUntil: "networkidle" })

  // Advance to tomorrow
  await page.getByRole("button", { name: "Ngày sau" }).click()

  // Seed target bookings for tomorrow in the active in-memory mock instance
  await page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const { businessDateOf, addDays, atBusinessTime } = await import("/src/lib/time.ts")
    const today = businessDateOf(clock.now())
    const tomorrow = addDays(today, 1)

    // Direction 1: Table B7 (id 10) is free today, but held tomorrow at 22:00
    await api.createReservation({
      contactName: "Khách giữ B7 mai",
      partySize: 4,
      expectedAt: atBusinessTime(tomorrow, "22:00"),
      sourceCode: "HOTLINE",
      tableIds: [10],
    })

    // Tomorrow unassigned 3-person booking needing assignment
    await api.createReservation({
      contactName: "Khách phân bàn mai",
      partySize: 3,
      expectedAt: atBusinessTime(tomorrow, "22:00"),
      sourceCode: "HOTLINE",
    })
  })

  await page.getByText("Khách phân bàn mai").first().waitFor()
  await page.getByText("Khách phân bàn mai").first().click()

  let detail = page.getByRole("dialog").filter({ hasText: "Khách phân bàn mai" })
  await detail.waitFor()
  await detail.getByRole("button", { name: "Phân bàn", exact: true }).click()

  // On floor picker: wait for availability query to settle: table C4 becomes available
  const c4 = page.locator('[aria-label^="Bàn C4:"][aria-disabled="false"]').first()
  await c4.waitFor()

  // Direction 1: Table B7 held tomorrow must be disabled/unavailable
  const b7 = page.locator('[aria-label^="Bàn B7:"]').first()
  await b7.waitFor()
  const b7Disabled = await b7.getAttribute("aria-disabled")
  if (b7Disabled !== "true") throw new Error("Table B7 held tomorrow should be disabled during tomorrow assignment")

  // Direction 2: Table C4 free tomorrow must be available
  const c4Disabled = await c4.getAttribute("aria-disabled")
  if (c4Disabled === "true") throw new Error("Table C4 free tomorrow should be available during tomorrow assignment")

  // Select C4 and confirm initial assignment
  await c4.click()
  if ((await c4.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Table C4 was not selected after click")
  }
  await page.getByRole("button", { name: "Phân bàn" }).click()

  // Verify assignment in details
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.waitForURL("**/reservations")
  await selectTomorrow(page)
  await page.getByRole("cell").filter({ hasText: "Khách phân bàn mai" }).click()
  detail = page.getByRole("dialog").filter({ hasText: "Khách phân bàn mai" })
  await detail.getByText("C4", { exact: true }).waitFor()

  // Reassignment retaining source table C4 and adding A2
  await detail.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  const a2 = page.locator('[aria-label^="Bàn A2:"][aria-disabled="false"]').first()
  await a2.waitFor()
  await a2.click()
  await page.getByRole("button", { name: /Phân bàn|Đổi bàn/ }).click()

  // Verify reassignment in details
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.waitForURL("**/reservations")
  await selectTomorrow(page)
  await page.getByRole("cell").filter({ hasText: "Khách phân bàn mai" }).click()
  detail = page.getByRole("dialog").filter({ hasText: "Khách phân bàn mai" })
  await detail.getByText("C4 + A2", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
})

await flow(
  "direct booking: validate same zone and kind in floor quick-form and booking sheet (MD-05)",
  3,
  async (page) => {
    // 1. Floor quick-form validation
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    await barSeat(page, 8).click()
    await page.getByRole("button", { name: "Đặt trước" }).click()
    // QuickForm is open with Ghế Bar 8 (BAR_SEAT in Zone D)
    // Attempt to select Bàn B7 (TABLE in Zone B) on canvas: B7 is disabled
    const b7Floor = table(page, "B7")
    await b7Floor.waitFor()
    const b7FloorDisabled = await b7Floor.getAttribute("aria-disabled")
    if (b7FloorDisabled !== "true") {
      throw new Error("Table B7 of different kind/zone should be disabled on floor in Bar 8 direct draft")
    }
    await b7Floor.click({ force: true })
    const hasB7 = await page.getByRole("button", { name: /Bàn B7/ }).count()
    if (hasB7 > 1) {
      throw new Error("Table B7 of different kind/zone should not be added to Bar 8 direct draft")
    }
    await page.keyboard.press("Escape")

    // 2. Booking sheet validation
    await page.goto(base + "/reservations", { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Đặt bàn mới" }).click()
    const sheet = page.getByRole("dialog").last()
    await sheet.getByText("Đặt bàn mới", { exact: true }).waitFor()
    // Step 0: click Tiếp
    await sheet.getByRole("button", { name: "Ngày mai" }).click()
    await sheet.getByRole("button", { name: /Chọn giờ bằng con lăn/ }).click()
    await sheet.locator('[data-wheel="Giờ"] [data-value="19"]').click()
    await sheet.locator('[data-wheel="Phút"] [data-value="00"]').click()
    await sheet.getByRole("button", { name: "Tiếp" }).click()
    // Step 1: select first suggested table
    const firstSuggestion = sheet.locator("section").filter({ hasText: "Gợi ý" }).getByRole("button").first()
    await firstSuggestion.waitFor()
    await firstSuggestion.click()

    // Cross-kind/zone seat Ghế Bar 8 (Zone BAR, BAR_SEAT) must be disabled on canvas
    const cross = sheet.locator('[aria-label^="Ghế Bar 8:"]').first()
    await cross.waitFor()
    const crossDisabled = await cross.getAttribute("aria-disabled")
    if (crossDisabled !== "true") {
      throw new Error("Cross-kind/zone seat Bar 8 should be disabled in booking sheet")
    }
    await cross.click({ force: true })
    const crossPressed = await cross.getAttribute("aria-pressed")
    if (crossPressed === "true") {
      throw new Error("Cross-kind/zone seat Bar 8 should not be selected in booking sheet")
    }
    await page.keyboard.press("Escape")
  },
)

await flow("booking pickers: keyboard navigation across expired selected time (MD-04)", 3, async (page) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + "/reservations", { waitUntil: "networkidle" })
  await page.evaluate(async () => {
    const { demo } = await import("/src/services/index.ts")
    demo?.reset()
  })
  await page.reload({ waitUntil: "networkidle" })

  const dismissAlert = page.getByRole("button", { name: "Đã xem, xử lý sau" })
  if (await dismissAlert.isVisible()) await dismissAlert.click()
  const closeToast = page.getByRole("button", { name: "Đóng thông báo" })
  if (await closeToast.isVisible()) await closeToast.click()

  // Open the first booking's edit dialog
  await page.locator("article").first().click()
  await page.getByRole("button", { name: "Sửa booking" }).click()
  const editDialog = page.getByRole("dialog", { name: /Sửa booking/ })
  await editDialog.waitFor()

  // Advance scenario clock so that the booking's selected time slot is now past
  await page.evaluate(async () => {
    const { clock } = await import("/src/services/index.ts")
    clock.advance(180) // advance 3 hours
  })

  // The wheel is reachable by keyboard, skips expired values and keeps the selection in step.
  const wheelButton = editDialog.getByRole("button", { name: /Chọn giờ bằng con lăn/ })
  await wheelButton.click()
  const hours = editDialog.getByRole("spinbutton", { name: "Giờ", exact: true })
  const tabstops = await editDialog.getByRole("spinbutton").evaluateAll(nodes =>
    nodes.filter(node => node.tabIndex === 0).length)
  if (tabstops !== 2 || await editDialog.locator('[data-wheel] [data-value]').evaluateAll(nodes => nodes.some(node => node.tabIndex !== -1))) {
    throw new Error("Only the two wheel columns may enter the tab order")
  }
  await wheelButton.focus()
  await page.keyboard.press("Tab")
  if ((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) !== "Giờ") {
    throw new Error("Tab from the wheel button did not land on the hour wheel")
  }
  await page.keyboard.press("Home")
  const first = await hours.getAttribute("aria-valuetext")
  if (await editDialog.locator(`[data-wheel="Giờ"] [data-value="${first}"]`).isDisabled()) {
    throw new Error("Home selected an expired hour")
  }
  await page.keyboard.press("End")
  if ((await hours.getAttribute("aria-valuetext")) !== "01") throw new Error("End key did not select hour 01")
  if (!(await wheelButton.getAttribute("aria-label")).includes("01:00")) {
    throw new Error("Hour 01 must clamp the minute to 01:00")
  }

  await page.keyboard.press("Escape")
})

async function dismissHoldAlerts(page) {
  for (let i = 0; i < 12; i++) {
    const dismiss = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ }).first()
    if (!await dismiss.isVisible()) break
    await dismiss.click({ force: true })
  }
}
async function mockHeldFixture(page, kind) {
  return page.evaluate(async (kind) => {
    const { api, clock } = await import("/src/services/index.ts")
    const { businessDateOf } = await import("/src/lib/time.ts")
    const bd = businessDateOf(clock.now())
    let e = (await api.listWaitlist(bd)).find((e) => kind === "pure" ? e.id === 4 : e.kind === "ADVANCE_RESERVATION" && e.status === "WAITING")
    if (kind === "reservation") await api.seatWaitlist({ entryId: e.id, version: e.version, guestCount: e.partySize, tableIds: [13] })
    if (kind === "offer") {
      await api.claimWaitlist(e.id, e.version)
      e = (await api.listWaitlist(bd)).find((x) => x.id === e.id)
      await api.recordContact({ entryId: e.id, version: e.version, channel: "ZALO_MANUAL", outcome: "ACCEPTED", offeredTableIds: [13] })
    }
    e = (await api.listWaitlist(bd)).find((x) => x.id === e.id)
    const r = (await api.listReservations({ businessDate: bd })).find((r) => r.id === e.reservationId)
    window.holdWrites = []
    for (const key of ["seatWaitlist", "checkIn", "moveClaim", "assignTables", "cancelWaitlist", "cancelReservation", "markNoShow", "confirmLate"]) {
      const original = api[key].bind(api)
      api[key] = (...args) => { window.holdWrites.push({ key, args }); return original(...args) }
    }
    clock.advance(0)
    return { e, r, bd, code: kind === "pure" ? "A4" : "B5" }
  }, kind)
}

await flow("R4 F01 F06: desktop linked reservation resolves management and full booking picker", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await dismissHoldAlerts(page)
  const { e, r } = await mockHeldFixture(page, "reservation")
  await table(page, "B5").click()
  for (const label of ["Quản lý đơn", "Xem booking", "Xem đơn chờ", "Đổi / Ghép bàn", "Đổi trạng thái", "Khách đã đến"])
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Xem đơn chờ", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText(`#${e.id}`)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Đổi / Ghép bàn", exact: true }).click()
  assert.deepEqual(await page.evaluate(async () => { const p = (await import("/src/state/ui.ts")).useUi.getState().pick; return { intent: p.intent, own: p.preselected, date: p.targetDate, expected: p.targetExpectedAt, exclude: p.excludeIds ?? [] } }),
    { intent: "assign", own: r.tableIds, date: r.businessDate, expected: r.expectedAt, exclude: [] })
  assert.notEqual(await table(page, "B5").getAttribute("aria-disabled"), "true")
  await page.getByRole("button", { name: "Hủy chọn bàn" }).click()
  assert.deepEqual(await page.evaluate(() => window.holdWrites), [])
}, { viewport: { width: 768, height: 1024 } })

for (const width of [390, 768]) await flow(`R4 F07: linked offer booking detail moves one offer at ${width}`, 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await dismissHoldAlerts(page)
  const { e, r } = await mockHeldFixture(page, "offer")
  await dismissHoldAlerts(page)
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
  const detail = page.getByRole("dialog", { name: width < 768 ? "Chi tiết booking" : undefined }).last()
  await expect(detail).toBeVisible()
  await detail.getByRole("button", { name: width < 768 ? "Đổi / Ghép bàn" : "Đổi bàn", exact: true }).click()
  await table(page, "B5").click()
  await table(page, "B7").click()
  await page.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.holdWrites.length)).toBe(1)
  await expect(page.getByRole("button", { name: "Hủy chọn bàn" })).toBeHidden()
  const result = await page.evaluate(async ({ e, r }) => {
    const { api } = await import("/src/services/index.ts")
    return { calls: window.holdWrites, holds: [...api.db.holds.values()].filter((h) => h.status === "ACTIVE" && (h.waitlistEntryId === e.id || h.reservationId === r.id)),
      allocations: [...api.db.allocations.values()].filter((a) => a.holdId === e.hold.id && !a.releasedAt).map((a) => a.tableId) }
  }, { e, r })
  assert.equal(result.calls[0].key, "moveClaim")
  assert.deepEqual(result.calls[0].args[0].claim, { waitlistEntryId: e.id, version: e.hold.version })
  assert.equal(result.holds.length, 1)
  assert.equal(result.holds[0].holdKind, "WAITLIST_OFFER")
  assert.deepEqual(result.allocations, [10])
}, { viewport: { width, height: width === 768 ? 1024 : 844 } })

for (const width of [390, 768]) for (const surface of ["floor", "card", "detail"]) await flow(`F14 AT7 AT9: offer no-show threshold ${surface} ${width}`, 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await dismissHoldAlerts(page)
  const { e, r } = await mockHeldFixture(page, "offer")
  await page.evaluate(async (r) => {
    const { clock } = await import("/src/services/index.ts")
    clock.advance((new Date(r.expectedAt).getTime() - clock.now().getTime()) / 60000 + 29)
  }, r)
  await page.waitForTimeout(500)
  await dismissHoldAlerts(page)
  let openStatus
  if (surface === "card") {
    await page.getByRole("button", { name: /^Bàn chờ/ }).first().click()
    const card = width < 768 ? page.locator("div.rounded-\\[18px\\]").filter({ hasText: e.displayName }) : page.locator(`#entry-${e.id}`)
    openStatus = () => card.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
    await openStatus()
  } else {
    await table(page, "B5").click()
    if (surface === "detail") {
      await page.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
      if (width < 768) openStatus = () => page.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
    } else openStatus = () => page.getByRole("button", { name: "Đổi trạng thái", exact: true }).click()
    if (openStatus) await openStatus()
  }
  const noShow = page.getByRole("button", { name: width < 768 ? /^Khách không tới/ : "Không tới", exact: width >= 768 })
  await expect(noShow).toHaveCount(0)
  if (openStatus) await page.getByRole("dialog", { name: "Đổi trạng thái booking" }).getByRole("button", { name: "Đóng", exact: true }).click()
  let cancelBtn
  if (surface === "card") {
    const card = width < 768 ? page.locator("div.rounded-\\[18px\\]").filter({ hasText: e.displayName }) : page.locator(`#entry-${e.id}`)
    await card.getByRole("button", { name: "Quản lý đơn", exact: true }).click()
    cancelBtn = page.getByRole("dialog").last().getByRole("button", { name: "Hủy booking", exact: true })
  } else if (surface === "detail" && width < 768) {
    cancelBtn = page.getByRole("dialog").last().getByRole("button", { name: "Hủy booking", exact: true })
  } else {
    cancelBtn = page.getByRole("button", { name: "Hủy booking", exact: true })
  }
  await expect(cancelBtn).toBeVisible()
  await page.evaluate(async () => {
    const { PERMISSION_MATRIX } = await import("/src/domain/access.ts")
    window.savedCancelPermission = [...PERMISSION_MATRIX["reservation.cancel"]]
    PERMISSION_MATRIX["reservation.cancel"] = []
    ;(await import("/src/state/session.ts")).useSession.setState((s) => ({ permissions: [...s.permissions] }))
    ;(await import("/src/services/index.ts")).clock.advance(0)
  })
  await expect(cancelBtn).toBeDisabled()
  await page.evaluate(async () => {
    ;(await import("/src/domain/access.ts")).PERMISSION_MATRIX["reservation.cancel"] = window.savedCancelPermission
    ;(await import("/src/state/session.ts")).useSession.setState((s) => ({ permissions: [...s.permissions] }))
    ;(await import("/src/services/index.ts")).clock.advance(0)
  })
  await expect(cancelBtn).toBeEnabled()
  await cancelBtn.click()
  const confirm = page.getByRole("alertdialog")
  await confirm.getByRole("button", { name: "Hủy booking", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.holdWrites.length)).toBe(1)
  await expect.poll(() => page.evaluate(async (id) => (await import("/src/services/index.ts")).api.db.reservations.get(id).status, r.id)).toBe("CANCELLED")
  const result = await page.evaluate(async ({ e, r }) => {
    const { api } = await import("/src/services/index.ts")
    return { calls: window.holdWrites, status: api.db.reservations.get(r.id).status,
      active: [...api.db.holds.values()].filter((h) => h.id === e.hold.id && h.status === "ACTIVE").length,
      allocations: [...api.db.allocations.values()].filter((a) => a.holdId === e.hold.id && !a.releasedAt).length,
      visits: [...api.db.visits.values()].filter((v) => v.reservationId === r.id).length }
  }, { e, r })
  assert.deepEqual(result.calls, [{ key: "cancelReservation", args: width < 768 ? [r.id, r.version, "CUSTOMER_REQUEST"] : [r.id, r.version, "CUSTOMER_REQUEST", ""] }])
  assert.equal(result.status, "CANCELLED")
  assert.equal(result.active, 0)
  assert.equal(result.allocations, 0)
  assert.equal(result.visits, 0)
}, { viewport: { width, height: width === 768 ? 1024 : 844 } })

for (const width of [390, 768]) await flow(`R4 F04: pure arrival checks each permission before open and at submit ${width}`, 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await dismissHoldAlerts(page)
  await mockHeldFixture(page, "pure")
  await table(page, "A4").click()
  for (const permission of ["visit.checkin", "waitlist.accept_offer", "reservation.create", "table.assign"]) {
    await page.evaluate(async (permission) => {
      const { PERMISSION_MATRIX } = await import("/src/domain/access.ts")
      window.savedPermission = [...PERMISSION_MATRIX[permission]]
      PERMISSION_MATRIX[permission] = PERMISSION_MATRIX[permission].filter((r) => r !== "OWNER_ADMIN")
      ;(await import("/src/services/index.ts")).clock.advance(0)
    }, permission)
    const arrival = page.getByRole("button", { name: "Khách đã đến", exact: true })
    await expect(arrival).toBeDisabled()
    await arrival.evaluate((el) => el.click())
    assert.deepEqual(await page.evaluate(() => window.holdWrites), [])
    await page.evaluate(async (permission) => {
      ;(await import("/src/domain/access.ts")).PERMISSION_MATRIX[permission] = window.savedPermission
      ;(await import("/src/services/index.ts")).clock.advance(0)
    }, permission)
    await expect(arrival).toBeEnabled()
    await arrival.click()
    const confirm = page.getByRole(width < 768 ? "alertdialog" : "dialog", { name: /Xác nhận khách đã đến/ })
    await page.evaluate(async (permission) => {
      const { PERMISSION_MATRIX } = await import("/src/domain/access.ts")
      PERMISSION_MATRIX[permission] = PERMISSION_MATRIX[permission].filter((r) => r !== "OWNER_ADMIN")
    }, permission)
    await confirm.getByRole("button", { name: "Khách đã đến", exact: true }).click()
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /thiếu quyền nhận khách/ }).first()).toBeVisible()
    assert.deepEqual(await page.evaluate(() => window.holdWrites), [])
    if (width === 768) await confirm.getByRole("button", { name: "Quay lại", exact: true }).click()
    await page.evaluate(async (permission) => {
      ;(await import("/src/domain/access.ts")).PERMISSION_MATRIX[permission] = window.savedPermission
      ;(await import("/src/services/index.ts")).clock.advance(0)
    }, permission)
  }
  if (width === 768) {
    await page.getByRole("button", { name: "Ca tối nay", exact: true }).click()
    await page.getByRole("button", { name: /^Bàn chờ/ }).first().click()
    await page.evaluate(async () => {
      const { PERMISSION_MATRIX } = await import("/src/domain/access.ts")
      PERMISSION_MATRIX["reservation.create"] = PERMISSION_MATRIX["reservation.create"].filter((r) => r !== "OWNER_ADMIN")
      ;(await import("/src/services/index.ts")).clock.advance(0)
    })
    await expect(page.locator("#entry-4").getByRole("button", { name: "Khách đã đến", exact: true })).toBeDisabled()
  }
}, { viewport: { width, height: width === 768 ? 1024 : 844 } })

await flow("R4 AT16: B11 direct detail retains buttons picker and check-in without seat", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await dismissHoldAlerts(page)
  const data = await page.evaluate(async () => {
    const { api, clock } = await import("/src/services/index.ts")
    const { businessDateOf } = await import("/src/lib/time.ts")
    const { useUi } = await import("/src/state/ui.ts")
    const r = (await api.listReservations({ businessDate: businessDateOf(clock.now()) })).find((r) => r.status === "BOOKED" && r.tableIds.includes(15))
    window.holdWrites = []
    for (const key of ["seatWaitlist", "checkIn", "assignTables"]) { const f = api[key].bind(api); api[key] = (...args) => { window.holdWrites.push({ key, args }); return f(...args) } }
    useUi.getState().openReservation(r.id, r.businessDate)
    return r
  })
  let detail = page.getByRole("dialog").last()
  for (const label of ["Đổi bàn", "Sửa", "Hủy booking", "Check-in B4"]) await expect(detail.getByRole("button", { name: label, exact: true })).toBeVisible()
  await expect(detail.getByRole("button", { name: "Không tới", exact: true })).toHaveCount(0)
  await detail.getByRole("button", { name: "Đổi bàn", exact: true }).click()
  assert.deepEqual(await page.evaluate(async () => { const p = (await import("/src/state/ui.ts")).useUi.getState().pick; return { intent: p.intent, own: p.preselected, date: p.targetDate, expected: p.targetExpectedAt } }), { intent: "assign", own: data.tableIds, date: data.businessDate, expected: data.expectedAt })
  await page.getByRole("button", { name: "Hủy chọn bàn" }).click()
  await page.evaluate(async (r) => (await import("/src/state/ui.ts")).useUi.getState().openReservation(r.id, r.businessDate), data)
  detail = page.getByRole("dialog").last()
  await detail.getByRole("button", { name: "Check-in B4", exact: true }).click()
  const confirm = page.getByRole("dialog", { name: /Check-in/ }).last()
  await confirm.getByRole("button", { name: "Check-in", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.holdWrites.length)).toBe(1)
  const calls = await page.evaluate(() => window.holdWrites)
  assert.equal(calls[0].key, "checkIn")
  assert.equal(calls[0].args[0].reservationId, data.id)
}, { viewport: { width: 768, height: 1024 } })

for (const width of [360, 390, 768]) for (const theme of ["light", "dark"]) for (const kind of ["pure", "reservation"]) {
  await flow(`R4 AT17: ${kind} screenshots ${width} ${theme}`, 3, async (page) => {
    fs.mkdirSync("e2e/.artifacts/waitlist-hold/after", { recursive: true })
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    await page.evaluate(async (theme) => (await import("/src/state/session.ts")).useSession.getState().setTheme(theme), theme)
    await dismissHoldAlerts(page)
    const { e, code } = await mockHeldFixture(page, kind)
    await table(page, code).click()
    await expect(page.getByRole("button", { name: "Quản lý đơn", exact: true })).toBeVisible()
    const prefix = kind === "pure" ? "" : "linked-"
    await page.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/${prefix}table-sheet-${width}-${theme}.png` })
    await page.getByRole("button", { name: "Khách đã đến", exact: true }).click()
    const confirm = page.getByRole(width < 768 ? "alertdialog" : "dialog", { name: /Xác nhận khách đã đến/ })
    await expect(confirm).toContainText(code)
    await page.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/${prefix}arrival-confirm-${width}-${theme}.png` })
    await confirm.getByRole("button", { name: "Quay lại", exact: true }).click()
    if (width < 768) {
      await page.getByRole("dialog", { name: `Chi tiết ${code}` }).getByRole("button", { name: "Đóng", exact: true }).click()
      await page.locator('nav[aria-label="Điều hướng chính"]').getByRole("button", { name: /Đơn chờ/ }).click()
    } else {
      await page.getByRole("button", { name: "Ca tối nay", exact: true }).click()
      await page.getByRole("button", { name: /^Bàn chờ/ }).first().click()
    }
    await dismissHoldAlerts(page)
    const card = width < 768 ? page.locator("div.rounded-\\[18px\\]").filter({ hasText: e.displayName }) : page.locator(`#entry-${e.id}`)
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByRole("button", { name: "Quản lý đơn", exact: true })).toBeInViewport()
    assert.equal(await page.getByRole("dialog", { name: /Cảnh báo/ }).count(), 0)
    await page.screenshot({ path: `e2e/.artifacts/waitlist-hold/after/${prefix}wait-card-${width}-${theme}.png` })
    assert.deepEqual(await page.evaluate(() => window.holdWrites), [])
  }, { viewport: { width, height: width === 768 ? 1024 : 844 } })
}

for (const width of [360, 390, 430]) {
  await flow(`RR04 mobile honorific detail ${width}`, 3, async (page) => {
    fs.mkdirSync("e2e/.artifacts/rereview4-fixes", { recursive: true })
    await page.goto(`${base}/reservations`, { waitUntil: "networkidle" })
    for (const honorific of ["MR", "MS", null]) {
      const name = `RR04 ${honorific ?? "unset"}`
      await page.evaluate(async ({ name, honorific }) => {
        const { api, clock } = await import("/src/services/index.ts")
        const { businessDateOf, atBusinessTime } = await import("/src/lib/time.ts")
        await api.createReservation({ contactName: name, partySize: 4,
          expectedAt: atBusinessTime(businessDateOf(clock.now()), "22:00"),
          sourceCode: "HOTLINE", honorific, note: "Ghi chú nguyên bản" })
      }, { name, honorific })
      await page.getByText(name, { exact: true }).last().click()
      const detail = page.getByRole("dialog", { name: "Chi tiết booking", exact: true })
      const display = honorific ? `${honorific === "MR" ? "Mr" : "Ms"} ${name}` : name
      await expect(detail.getByText(display, { exact: true })).toHaveCount(2)
      await expect(detail.getByText("Ghi chú nguyên bản", { exact: true })).toBeVisible()
      if (honorific === "MR") await page.screenshot({ path: `e2e/.artifacts/rereview4-fixes/detail-${width}.png` })
      const stored = await page.evaluate(async (name) => {
        const { api, clock } = await import("/src/services/index.ts")
        const { businessDateOf } = await import("/src/lib/time.ts")
        return (await api.listReservations({ businessDate: businessDateOf(clock.now()) })).find((r) => r.displayName === name)
      }, name)
      assert.equal(stored.displayName, name)
      assert.equal(stored.honorific, honorific)
      assert.equal(stored.note, "Ghi chú nguyên bản")
      await detail.getByRole("button", { name: "Quay lại", exact: true }).click()
    }
  }, { viewport: { width, height: 844 } })
}

console.log(results.join("\n"))
await browser.close()
await import("./milestone-a.mjs")
await import("./p1-merge.mjs")
console.log(failures || process.exitCode ? "\nFAILED" : "\nALL PASSED")
process.exit(failures ? 1 : (process.exitCode ?? 0))
