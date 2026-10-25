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

console.log(results.join("\n"))
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
await browser.close()
process.exit(failures ? 1 : 0)
