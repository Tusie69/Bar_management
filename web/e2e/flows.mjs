// End-to-end flows as a receptionist / owner would run them on a tablet (1280x800).
// Run against a dev server:  npm run dev  ->  npm run e2e
// Env: E2E_BASE_URL (default http://127.0.0.1:5173), PW_CHROMIUM_PATH (optional custom Chromium binary).
import { chromium } from "@playwright/test"
import assert from "node:assert/strict"
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
import fs from "node:fs"
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
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"], [aria-label^="Bàn ${code}:"]`).first()
const barSeat = (page, number) => page.locator(`[aria-label^="Ghế Bar ${number},"], [aria-label^="Ghế Bar ${number}:"]`).first()
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
  await expectLabel(loc, new RegExp(`Có khách,.*\\b${guests} khách(?:,|$)`))
  if (/\d+\s*(?:phút|giờ|['’′])/.test(await loc.textContent())) throw new Error("Occupied glyph still shows elapsed time")
  if ((await loc.getAttribute("aria-label")).startsWith("Bàn ") && !(await loc.locator("text").allTextContents()).includes(`${guests} khách`)) {
    throw new Error(`Occupied table must display ${guests} khách`)
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
        for (const phase of ["load", "Tất cả"]) {
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
  await page.getByRole("tab", { name: "Walk-in" }).click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(table(page, "B5"), 4)
  await page.getByText("Bản mô phỏng").first().waitFor()
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).first().click()
  await expectLabel(table(page, "B5"), /Chưa đặt/)
})

await flow("inline walk-in suggests a table (3 taps)", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("tab", { name: "Walk-in" }).click()
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
    const form = page.getByRole("dialog", { name: "Tạo đơn đặt bàn" })
    await form.getByRole("tab", { name: "Walk-in" }).click()
    await form.getByRole("radio", { name: "2 khách" }).click()
    await form.getByRole("button", { name: "Xem bàn trống lúc này" }).click()
    if (await form.getByRole("radiogroup", { name: "Bàn trống" }).count()) {
      throw new Error("Walk-in still renders the legacy table-chip list")
    }
    const map = form.getByRole("group", { name: "Sơ đồ bàn để chọn trực tiếp cho khách Walk-in" })
    await map.waitFor()
    const second = map.locator('[aria-label^="Ghế Bar"][aria-disabled="false"][aria-pressed="false"]').first()
    await second.click()
    await form.getByText("Sức chứa: 2/2 chỗ · Đã đủ chỗ", { exact: true }).waitFor()
    const open = form.getByRole("button", { name: /^Mở bàn Bar/ })
    if (await open.isDisabled()) throw new Error("Walk-in action stayed disabled after enough Bar seats were selected")
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
  await page.getByRole("button", { name: "Ghép bàn" }).click()
  await table(page, "B7").click()
  await page
    .getByRole("dialog", { name: /Ghép thêm/ })
    .getByRole("button", { name: "Ghép bàn" })
    .click()
  await expectOccupied(table(page, "B7"), 2)
  await page.getByRole("button", { name: "Tách bàn" }).click()
  await page.getByRole("dialog").getByRole("checkbox").nth(1).click()
  await page.getByRole("button", { name: /Tách và nhả B7/ }).click()
  await expectLabel(table(page, "B7"), /Chưa đặt/)
  await expectOccupied(table(page, "B5"), 2)
})

await flow("booking flow end-to-end for tomorrow with table", 3, async (page) => {
  await page.goto(base + "/reservations", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Đặt bàn mới/ }).click()
  await page.getByRole("button", { name: "Ngày mai" }).click()
  await page.getByRole("radio", { name: "20:30" }).click()
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByRole("button", { name: /^A0/ }).first().click()
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByLabel("Tên khách").fill("Khách E2E")
  await page.getByLabel("Số điện thoại").fill("0912345678")
  await page.getByRole("button", { name: /Tiếp/ }).click()
  await page.getByRole("button", { name: /Xác nhận đặt bàn/ }).click()
  await page
    .getByText(/Booking 20:30 · 2 khách · giữ A0/)
    .first()
    .waitFor()
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.getByText("Khách E2E").first().waitFor()
  const html = await page.content()
  if (html.includes("0912345678") || html.includes("912345678")) throw new Error("full phone leaked to DOM")
})

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
  await expectLabel(table(page, "A5"), /Không tới/)
  assert.equal(await state(), "late")
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.keyboard.press("Escape")
  await expectLabel(table(page, "A5"), /Không tới/)
  assert.equal(await state(), "noshow", "warning must keep the booking and table held")
})

await flow("call customer: mobile opens tel flow and keeps a manual outcome action", 3, async (page) => {
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
}, {
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
})

await flow("call customer: tablet explains that direct calling is unavailable", 3, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.evaluate(async () => {
    const { demo } = await import("/src/services/index.ts")
    demo?.reset()
  })
  await page.reload({ waitUntil: "networkidle" })
  await table(page, "A5").click()
  await page.getByRole("button", { name: "Gọi khách", exact: true }).click()
  await page.getByText("Thiết bị này không hỗ trợ gọi trực tiếp", { exact: true }).waitFor()
  await page.screenshot({ path: "e2e/.artifacts/call-customer-tablet-768.png" })
}, { viewport: { width: 768, height: 1024 } })

await flow("waitlist: claim, accept offer -> hold, then seat when guest arrives", 3, async (page) => {
  await page.goto(base + "/waitlist", { waitUntil: "networkidle" })
  const card = page.locator("li", { hasText: "Chị mặc váy đỏ" }).first()
  await card.getByRole("button", { name: "Nhận liên hệ" }).click()
  const dlg = page.getByRole("dialog", { name: /Kết quả liên hệ/ })
  await dlg.getByRole("button", { name: /^B5/ }).click()
  await dlg.getByRole("button", { name: "Ghi kết quả" }).click()
  await card.getByText("Đang giữ bàn").waitFor()
  await card.getByRole("button", { name: "Khách đã tới, xếp chỗ" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Xếp chỗ" }).click()
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
  if (await page.getByRole("link", { name: "Báo cáo" }).count()) throw new Error("reports navigation visible for receptionist")
})

await flow("availability tomorrow: B3 reserved, A3 free", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await selectTomorrow(page)
  await page.waitForTimeout(600)
  const b3 = await table(page, "B3").getAttribute("aria-label")
  const a3 = await table(page, "A3").getAttribute("aria-label")
  if (!/Đang đặt/.test(b3)) throw new Error("B3 should be reserved tomorrow: " + b3)
  if (!/Chưa đặt/.test(a3)) throw new Error("A3 should be free tomorrow: " + a3)
})

await flow("inline form: occupied table is refused, free table is picked on the map", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("tab", { name: "Walk-in" }).click()
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
  await expectLabel(table(page, "B4"), /Chưa đặt/)
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

  await card.getByRole("button", { name: "Khách đã tới, xếp chỗ" }).click()
  const checkInDialog = page.getByRole("dialog").filter({ hasText: "Xếp chỗ cho" }).last()
  await checkInDialog.waitFor()
  await checkInDialog.getByRole("button", { name: "Xếp chỗ", exact: true }).click()
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

    // 3. Trigger arrival check-in on target card only
    await card.getByRole("button", { name: "Khách nhận bàn (check-in)" }).click()
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
    if (
      !visit.tableIds.includes(13) ||
      !visit.tableIds.includes(10) ||
      visit.tableIds.length !== 2
    ) {
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
  await page.locator("#bk-classification").click()
  await page.getByRole("option", { name: "Khách quen (O)" }).click()
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
  await page.getByRole("tab", { name: "Walk-in" }).click()
  await page.getByRole("radio", { name: "1 khách" }).click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectOccupied(barSeat(page, 13), 1)
})

await flow("bar seat: multi-seat booking capacity check & group reservation", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await barSeat(page, 8).click()
  // QuickForm opens with Bar 8 selected (capacity 1). Pick 2 guests to trigger capacity shortage.
  await page.getByRole("radio", { name: "2 khách" }).click()
  await page.getByText(/thiếu 1 chỗ cho 2 khách/).waitFor()

  // Select adjacent bar seat 7 on the canvas to meet capacity
  await barSeat(page, 7).click()
  await page.getByText(/Sức chứa 2 chỗ · đủ cho 2 khách/).waitFor()

  // Draft inputs
  await page.locator("#qf-name").fill("Khách Bar Ghép")
  await page.locator("#qf-phone").fill("0912345678")
  await page.getByRole("button", { name: "Lưu đặt bàn" }).click()

  // Both bar seats become reserved and grouped
  await expectLabel(barSeat(page, 8), /Đang đặt/)
  await expectLabel(barSeat(page, 7), /Đang đặt/)
  await expectLabel(barSeat(page, 8), /nhóm G\d{2,}, 2 bàn/)
  const groupCode = (await barSeat(page, 8).getAttribute("aria-label")).match(/nhóm (G\d{2,})/)[1]
  await expectLabel(barSeat(page, 7), new RegExp(`nhóm ${groupCode}, 2 bàn`))
  if (await page.locator("path[data-group-id]").count()) throw new Error("Group connector must be hidden by default")
  await barSeat(page, 8).click()
  if ((await barSeat(page, 7).getAttribute("data-group-highlighted")) !== "true") {
    throw new Error("Selecting one group member must highlight the other member")
  }
  if ((await page.locator("path[data-group-id]").count()) !== 1) {
    throw new Error("Only the selected group connector should be visible")
  }
  await barSeat(page, 8).click()
  if (await page.locator("path[data-group-id]").count()) throw new Error("Deselecting must hide the group connector")
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

  // On floor picker: wait for availability query to settle: table A0 becomes available
  const a0 = page.locator('[aria-label^="Bàn A0:"][aria-disabled="false"]').first()
  await a0.waitFor()

  // Direction 1: Table B7 held tomorrow must be disabled/unavailable
  const b7 = page.locator('[aria-label^="Bàn B7:"]').first()
  await b7.waitFor()
  const b7Disabled = await b7.getAttribute("aria-disabled")
  if (b7Disabled !== "true") throw new Error("Table B7 held tomorrow should be disabled during tomorrow assignment")

  // Direction 2: Table A0 free tomorrow must be available
  const a0Disabled = await a0.getAttribute("aria-disabled")
  if (a0Disabled === "true") throw new Error("Table A0 free tomorrow should be available during tomorrow assignment")

  // Select A0 and confirm initial assignment
  await a0.click()
  if ((await a0.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Table A0 was not selected after click")
  }
  await page.getByRole("button", { name: "Phân bàn" }).click()

  // Verify assignment in details
  await page.getByRole("link", { name: "Đặt bàn" }).click()
  await page.waitForURL("**/reservations")
  await selectTomorrow(page)
  await page.getByRole("cell").filter({ hasText: "Khách phân bàn mai" }).click()
  detail = page.getByRole("dialog").filter({ hasText: "Khách phân bàn mai" })
  await detail.getByText("A0", { exact: true }).waitFor()

  // Reassignment retaining source table A0 and adding A2
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
  await detail.getByText("A0 + A2", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
})

await flow("direct booking: validate same zone and kind in floor quick-form and booking sheet (MD-05)", 3, async (page) => {
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
})

await flow("booking pickers: keyboard navigation across expired selected slot (MD-04)", 3, async (page) => {
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

  // Verify roving tab stop: exactly one enabled slot has tabIndex=0
  const enabledWithTabstop = await editDialog.getByRole("radio").evaluateAll((nodes) =>
    nodes.filter((n) => !n.disabled && n.getAttribute("tabindex") === "0").map((n) => n.textContent?.trim())
  )
  if (enabledWithTabstop.length !== 1) {
    throw new Error(`Expected exactly 1 enabled radio with tabIndex=0, found ${enabledWithTabstop.length}`)
  }

  // Keyboard navigation: focus stepper and press Tab into the time picker
  await editDialog.getByRole("button", { name: "Tăng số khách" }).focus()
  await page.keyboard.press("Tab")

  const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute("role"))
  if (focusedRole !== "radio") {
    throw new Error(`Tab from stepper did not land on time radio (focused ${focusedRole})`)
  }

  // Keyboard ArrowRight / Home / End navigation
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Home")
  await page.keyboard.press("End")

  const lastChecked = await editDialog.getByRole("radio", { name: /^01:00/ }).getAttribute("aria-checked")
  if (lastChecked !== "true") {
    throw new Error("End key did not select the 01:00 slot")
  }

  await page.keyboard.press("Escape")
})

console.log(results.join("\n"))
await browser.close()
await import("./milestone-a.mjs")
console.log(failures || process.exitCode ? "\nFAILED" : "\nALL PASSED")
process.exit(failures ? 1 : (process.exitCode ?? 0))
