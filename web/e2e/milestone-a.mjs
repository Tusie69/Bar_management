// Mock browser regressions. Run with pnpm exec node e2e/milestone-a.mjs against Vite.
import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
import fs from "node:fs"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const only = process.env.MILESTONE_A_CASE
const output = process.env.MILESTONE_A_OUTPUT ?? "e2e/.artifacts/milestone-a"
const results = []
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const table = (page, code) => page.locator(`[aria-label^="Bàn ${code},"]`).first()
const freeTables = (form) => form.getByRole("radiogroup", { name: "Bàn trống", exact: true })
const presetCard = (form) => form.getByRole("status", { name: "Bàn B5 không khả dụng", exact: true })

async function dismiss(page) {
  for (let i = 0; i < 10; i++) {
    const button = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đóng thông báo/ }).first()
    if (!(await button.isVisible())) break
    await button.click()
  }
}

async function run(name, width, theme, fn) {
  if (only && !name.startsWith(only)) return
  const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, reducedMotion: "reduce" })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  try {
    await page.clock.install({ time: new Date("2026-11-04T14:30:00Z") })
    await page.addInitScript((theme) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme }))
    }, theme)
    await page.goto(base + "/floor", { waitUntil: "networkidle" })
    assert.equal(await page.evaluate(async () => (await import("/src/services/index.ts")).api.mode), "mock")
    await expect(table(page, "B5")).toHaveAttribute("aria-label", /Chưa đặt/)
    await dismiss(page)
    const data = await fn(page)
    assert.deepEqual(errors, [], "browser errors")
    results.push({ name, pass: true, ...data })
    console.log(`PASS ${name}${data ? ` ${JSON.stringify(data)}` : ""}`)
  } catch (error) {
    results.push({ name, pass: false, error: error.stack })
    console.error(`FAIL ${name}: ${error.stack}`)
    await page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true })
  } finally {
    await page.close()
  }
}

async function openBooking(page) {
  await table(page, "B5").click()
  const form = page.getByRole("dialog", { name: "Tạo đơn đặt bàn", exact: true })
  await expect(form).toBeVisible()
  await form.getByLabel("Tên khách").fill("Milestone A browser")
  await expect(freeTables(form).getByRole("radio", { name: /^B5\b/ })).toHaveAttribute("aria-checked", "true")
  return form
}

async function remoteClaim(page, days = 0, walkIn = false) {
  return page.evaluate(
    async ({ days, walkIn }) => {
      const { api, clock } = await import("/src/services/index.ts")
      const { atBusinessTime, businessDateOf, addDays } = await import("/src/lib/time.ts")
      const { DEMO_USERS, REMOTE_USER_ID } = await import("/src/services/mock/seed.ts")
      const id = (await api.getCatalog()).tables.find((item) => item.code === "B5").id
      // Mock state is per tab; use its second-device actor on the same real service/change feed.
      api.setSession(DEMO_USERS.find((user) => user.id === REMOTE_USER_ID))
      try {
        if (walkIn) await api.seatWalkIn({ tableIds: [id], guestCount: 2, idempotencyKey: crypto.randomUUID() })
        else
          await api.createReservation({
            contactName: "Other client",
            partySize: 2,
            expectedAt: atBusinessTime(addDays(businessDateOf(clock.now()), days), "23:00"),
            sourceCode: "HOTLINE",
            classification: "UNCLASSIFIED",
            tableIds: [id],
            idempotencyKey: crypto.randomUUID(),
          })
      } finally {
        api.setSession(DEMO_USERS.find((user) => user.id === 1))
      }
      return id
    },
    { days, walkIn },
  )
}

async function observeCreates(page) {
  await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    const create = api.createReservation.bind(api)
    window.bookingCreates = []
    api.createReservation = async (input) => {
      const call = { tableIds: input.tableIds, expectedAt: input.expectedAt.toISOString() }
      window.bookingCreates.push(call)
      const result = await create(input)
      call.reservationId = result.reservationId
      return result
    }
  })
}

async function assertBlocked(form, page) {
  await expect(freeTables(form).getByRole("radio", { name: /^B5\b/ }), "taken preset must leave Bàn trống").toHaveCount(
    0,
  )
  await expect(presetCard(form)).toContainText(/B5.*(?:đã được giữ|đang được giữ|đang có khách|Đã giữ cho booking)/s)
  await form.getByRole("button", { name: "Đặt bàn", exact: true }).click()
  await expect(form.getByRole("alert").last()).toContainText(/Vui lòng chọn bàn trống khác hoặc bỏ chọn bàn/)
  assert.deepEqual(
    await page.evaluate(() => window.bookingCreates),
    [],
    "blocked submit must not call createReservation",
  )
  await expect(form).toBeVisible()
}

async function assertCreated(page, tableId, expectedDate) {
  const calls = await page.evaluate(() => window.bookingCreates)
  assert.equal(calls.length, 1, "exactly one create request")
  assert.deepEqual(calls[0].tableIds, [tableId])
  assert(calls[0].reservationId > 0, "real mock service must return a created reservation")
  const reservation = await page.evaluate(
    async ({ id, businessDate }) => {
      const { api } = await import("/src/services/index.ts")
      return (await api.listReservations({ businessDate })).find((row) => row.id === id)
    },
    { id: calls[0].reservationId, businessDate: expectedDate },
  )
  assert.equal(reservation.status, "BOOKED")
  assert.deepEqual(reservation.tableIds, [tableId])
  assert.equal(reservation.businessDate, expectedDate)
  return { createCalls: calls.length, reservationId: reservation.id, businessDate: reservation.businessDate }
}

async function tomorrow(form) {
  await form.getByRole("button", { name: /05\/11/ }).click()
  await form.getByRole("button", { name: "Kiểm tra bàn trống", exact: true }).click()
}

async function contrast(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    const ancestors = []
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, 1, 1)
    for (const node of ancestors) {
      const style = getComputedStyle(node)
      if (style.backgroundImage !== "none" || style.opacity !== "1")
        throw new Error("Contrast probe requires solid backgrounds and opacity 1")
      ctx.fillStyle = style.backgroundColor
      ctx.fillRect(0, 0, 1, 1)
    }
    const bg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    ctx.fillStyle = getComputedStyle(element).color
    ctx.fillRect(0, 0, 1, 1)
    const fg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    const luminance = (rgb) =>
      rgb
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
    const a = luminance(bg),
      b = luminance(fg)
    return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  })
}

try {
  for (const theme of ["light", "dark"])
    for (const width of [360, 390]) {
      await run(`race-${width}-${theme}`, width, theme, async (page) => {
        const form = await openBooking(page)
        await remoteClaim(page)
        await observeCreates(page)
        await assertBlocked(form, page)
        await page.screenshot({ path: `${output}/race-${width}-${theme}.png`, fullPage: true })
        const free = freeTables(form).getByRole("radio").first()
        const code = (await free.innerText()).split("\n")[0]
        const id = await page.evaluate(async (code) => {
          const { api } = await import("/src/services/index.ts")
          return (await api.getCatalog()).tables.find((item) => item.code === code).id
        }, code)
        await free.click()
        await form.getByRole("button", { name: "Đặt bàn", exact: true }).click()
        await expect(form).toBeHidden()
        return { freeTable: code, ...(await assertCreated(page, id, "2026-11-04")) }
      })
      await run(`tomorrow-occupied-today-${width}-${theme}`, width, theme, async (page) => {
        const form = await openBooking(page)
        const id = await remoteClaim(page, 0, true)
        await expect(presetCard(form)).toContainText("đang có khách")
        await tomorrow(form)
        await expect(presetCard(form)).toHaveCount(0)
        await expect(freeTables(form).getByRole("radio", { name: /^B5\b/ })).toHaveAttribute("aria-checked", "true")
        await observeCreates(page)
        await form.getByRole("button", { name: "Đặt bàn", exact: true }).click()
        await expect(form).toBeHidden()
        return assertCreated(page, id, "2026-11-05")
      })
      await run(`tomorrow-held-${width}-${theme}`, width, theme, async (page) => {
        const form = await openBooking(page)
        await remoteClaim(page, 1)
        await expect(table(page, "B5")).toHaveAttribute("aria-label", /Chưa đặt/)
        await tomorrow(form)
        await observeCreates(page)
        await assertBlocked(form, page)
      })
      await run(`contrast-${width}-${theme}`, width, theme, async (page) => {
        const form = await openBooking(page)
        await remoteClaim(page)
        const button = presetCard(form).getByRole("button", { name: "Bỏ chọn bàn này", exact: true })
        await expect(button).toBeVisible()
        await button.scrollIntoViewIfNeeded()
        await page.evaluate(() => document.fonts.ready)
        const measurement = await contrast(button)
        await page.screenshot({ path: `${output}/contrast-${width}-${theme}.png`, fullPage: true })
        assert(
          measurement.ratio >= 4.5,
          `Bỏ chọn bàn này ${width} ${theme}: ${JSON.stringify(measurement)} must be >=4.5`,
        )
        await button.click()
        await observeCreates(page)
        await form.getByRole("button", { name: "Đặt bàn", exact: true }).click()
        await expect(form).toBeHidden()
        assert.deepEqual((await page.evaluate(() => window.bookingCreates))[0].tableIds, [])
        return measurement
      })
      await run(`chips-${width}-${theme}`, width, theme, async (page) => {
        await table(page, "B3").click()
        const sheet = page.getByRole("dialog", { name: "Chi tiết B3", exact: true })
        const chip = sheet.locator("span.rounded-full").first()
        const states = []
        for (const state of ["late", "late_confirmed", "noshow"]) {
          await expect
            .poll(() =>
              page.evaluate(async () => {
                const { api, clock } = await import("/src/services/index.ts")
                const id = (await api.getCatalog()).tables.find((item) => item.code === "B3").id
                return (await api.getFloorState(clock.now())).tables.find((item) => item.tableId === id).state
              }),
            )
            .toBe(state)
          const sheetText =
            state === "late_confirmed"
              ? "Không tới · đã báo muộn · 15 phút"
              : `Không tới · ${state === "noshow" ? 30 : 15} phút`
          await expect(chip).toHaveText(sheetText)
          await sheet.getByRole("button", { name: "Xem booking", exact: true }).click()
          const detail = page.getByRole("dialog", { name: "Chi tiết booking", exact: true })
          const detailChip = detail.getByRole("button", {
            name: /^Trạng thái Không tới · (?:đã báo muộn · )?\d+ phút\. Đổi trạng thái$/,
          })
          await expect(detailChip).toBeVisible()
          const detailText = await detailChip.innerText()
          await detail.getByRole("button", { name: "Quay lại", exact: true }).click()
          if (!(await sheet.isVisible())) await table(page, "B3").click()
          states.push({ state, sheet: sheetText, detail: detailText })
          if (state === "late") {
            await sheet.getByRole("button", { name: "Tới muộn", exact: true }).click()
            const dialog = page.getByRole("alertdialog")
            if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Tới muộn", exact: true }).click()
            await expect(chip).toHaveText("Không tới · đã báo muộn · 15 phút")
          } else if (state === "late_confirmed") {
            await page.evaluate(async () => (await import("/src/services/index.ts")).clock.advance(5))
            await expect(page.getByRole("button", { name: "Đã xem, xử lý sau", exact: true })).toBeVisible()
            await dismiss(page)
          }
        }
        await page.screenshot({ path: `${output}/chips-${width}-${theme}.png`, fullPage: true })
        return { states }
      })
    }
  await run("export-label", 390, "light", async (page) => {
    await page.evaluate(async () => {
      const { api, clock } = await import("/src/services/index.ts")
      const id = (await api.getCatalog()).tables.find((item) => item.code === "A6").id
      const claim = (await api.getFloorState(clock.now())).tables.find((item) => item.tableId === id).claim
      await api.markNoShow(claim.reservationId, claim.version)
    })
    await dismiss(page)
    await page.getByRole("button", { name: "Đếm khách", exact: true }).click()
    const text = await page.getByRole("textbox", { name: "Nội dung text booking", exact: true }).inputValue()
    assert(text.includes("\nKHÔNG TỚI\n"), "export must contain KHÔNG TỚI heading")
    assert(!text.includes("KHÔNG ĐẾN"), "export must not contain old heading")
  })
  assert(results.length > 0, "MILESTONE_A_CASE must select an existing case")
} finally {
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
if (results.some((result) => !result.pass)) process.exitCode = 1
