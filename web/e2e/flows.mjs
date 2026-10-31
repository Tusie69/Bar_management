// End-to-end flows as a receptionist / owner would run them on a tablet (1280x800).
// Run against a dev server:  npm run dev  ->  npm run e2e
// Env: E2E_BASE_URL (default http://127.0.0.1:5173), PW_CHROMIUM_PATH (optional custom Chromium binary).
import { chromium } from "@playwright/test"
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
import fs from "node:fs"
fs.mkdirSync("e2e/.artifacts", { recursive: true })
let failures = 0
const results = []
async function flow(name, userId, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
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
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"]`).first()
const expectLabel = async (loc, re) => {
  for (let i = 0; i < 25; i++) {
    if (re.test(await loc.getAttribute("aria-label"))) return
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error(`label ${await loc.getAttribute("aria-label")} !~ ${re}`)
}

await flow("walk-in from table panel, then undo", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: /Mở Bàn B5 cho 2 khách/ }).click()
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
  await page.getByText("Bản mô phỏng").first().waitFor()
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).first().click()
  await expectLabel(table(page, "B5"), /Chưa đặt/)
})

await flow("inline walk-in suggests a table (3 taps)", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Walk-in" }).first().click()
  await page
    .getByRole("button", { name: /^Gợi ý / })
    .first()
    .click()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
})

await flow("check-in reserved booking A5", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "A5").click()
  await page.getByRole("button", { name: /Check-in A5/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Check-in", exact: true }).click()
  await expectLabel(table(page, "A5"), /Đang sử dụng/)
})

await flow("move seated party B7? -> combine B5 + B7 then split", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: /Mở Bàn B5/ }).click()
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
  await page.getByRole("button", { name: "Ghép bàn" }).click()
  await table(page, "B7").click()
  await page
    .getByRole("dialog", { name: /Ghép thêm/ })
    .getByRole("button", { name: "Ghép bàn" })
    .click()
  await expectLabel(table(page, "B7"), /Đang sử dụng/)
  await page.getByRole("button", { name: "Tách bàn" }).click()
  await page.getByRole("dialog").getByRole("checkbox").nth(1).click()
  await page.getByRole("button", { name: /Tách và nhả B7/ }).click()
  await expectLabel(table(page, "B7"), /Chưa đặt/)
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
})

await flow("booking flow end-to-end for tomorrow with table", 1, async (page) => {
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

await flow("validation: booking needs name or phone, note without phone", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Tạo đặt bàn" }).click()
  await page.getByLabel("Ghi chú").fill("goi 0901234567")
  await page.getByRole("button", { name: "Lưu đặt bàn" }).click()
  await page.getByRole("alert").filter({ hasText: "Cần ít nhất tên hoặc số điện thoại" }).waitFor()
  await page.getByRole("alert").filter({ hasText: "Không ghi số điện thoại vào ghi chú" }).waitFor()
})

await flow("conflict: another device takes the table at confirm", 1, async (page) => {
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

await flow("undo blocked after remote edit (conflict UX)", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B5").click()
  await page.getByRole("button", { name: /Mở Bàn B5/ }).click()
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "iPad cửa thao tác ngay" }).click()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).first().click()
  await page.getByText("Không thể hoàn tác").first().waitFor()
})

await flow("time warp: A5 becomes late after +15', no auto cancel after +60'", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "15'" }).click()
  await page.keyboard.press("Escape")
  await expectLabel(table(page, "A5"), /Đến muộn/)
  await page.getByRole("button", { name: /Giờ mô phỏng/ }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.getByRole("button", { name: "30'" }).click()
  await page.keyboard.press("Escape")
  await expectLabel(table(page, "A5"), /Khách không đến/)
})

await flow("waitlist: claim, accept offer -> hold, then seat when guest arrives", 1, async (page) => {
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
  if (await page.getByRole("button", { name: "Xem số" }).count()) throw new Error("reveal visible for receptionist")
  await page.goto(base + "/reports", { waitUntil: "networkidle" })
  await page.getByText("Báo cáo chỉ dành cho Chủ quán").waitFor()
})

await flow("availability tomorrow: B3 reserved, A3 free", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  // The date/time taskbar: stepping the day from Live switches to Khả dụng for that day.
  await page.getByRole("button", { name: "Ngày sau" }).click()
  await page.waitForTimeout(600)
  await page.getByRole("status").filter({ hasText: "Xem trước" }).waitFor()
  const b3 = await page.locator('[aria-label^="Bàn B3:"]').first().getAttribute("aria-label")
  const a3 = await page.locator('[aria-label^="Bàn A3:"]').first().getAttribute("aria-label")
  if (!/giữ cho booking/.test(b3)) throw new Error("B3 should be reserved tomorrow: " + b3)
  if (!/Trống/.test(a3)) throw new Error("A3 should be free tomorrow: " + a3)
})

await flow("inline form: occupied table is refused, free table is picked on the map", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Walk-in" }).first().click()
  await table(page, "A3").click()
  await page
    .getByText(/A3: không trống/)
    .first()
    .waitFor()
  await table(page, "B5").click()
  await page.getByRole("button", { name: "Bỏ B5" }).waitFor()
  await page.getByRole("button", { name: "Mở bàn ngay" }).click()
  await expectLabel(table(page, "B5"), /Đang sử dụng/)
})

await flow("cancel booking requires confirmation with reason", 1, async (page) => {
  await page.goto(base + "/floor", { waitUntil: "networkidle" })
  await table(page, "B4").click()
  await page.getByRole("button", { name: "Hủy booking" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Hủy booking" }).click()
  await expectLabel(table(page, "B4"), /Chưa đặt/)
})

await flow("direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)", 1, async (page) => {
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

  await card.getByText("Đang giữ bàn").waitFor()
  await card.getByText("B7").first().waitFor()

  await card.getByRole("button", { name: "Khách đã tới, xếp chỗ" }).click()
  const checkInDialog = page.getByRole("dialog").filter({ hasText: "Xếp chỗ cho" }).last()
  await checkInDialog.waitFor()
  await checkInDialog.getByRole("button", { name: "Xếp chỗ", exact: true }).click()
  await checkInDialog.waitFor({ state: "hidden" })
  await page.getByText("Đã đóng trong ca").waitFor()
})

await flow("direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)", 1, async (page) => {
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
      const { api } = await import("/src/services/index.ts")
      const bd = "2026-10-31"
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
      async ({ targetId, reservationId }) => {
        const { api } = await import("/src/services/index.ts")
        const bd = "2026-10-31"
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
      { targetId: assignment.targetId, reservationId: assignment.reservationId },
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

await flow("mobile booking creation with classification and Zalo export (phone 390px)", 1, async (page) => {
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

console.log(results.join("\n"))
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
await browser.close()
process.exit(failures ? 1 : 0)
