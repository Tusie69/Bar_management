import { chromium, expect } from "@playwright/test"
import fs from "node:fs"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5178"
const apiBase = process.env.E2E_API_URL ?? "http://127.0.0.1:3100/api/v1"
const password = process.env.E2E_PASSWORD ?? "Browser-E2E-Pass-2026!"
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const browser = await chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome, headless: true } : { headless: true })
const results = []

async function login(username, portal = "admin", viewport = { width: 1280, height: 800 }, expectedStatus = 200) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`${base}/${portal}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Tên đăng nhập").fill(username)
  await page.locator('input[name="password"]').fill(password)
  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => response.url() === `${apiBase}/auth/login` && response.request().method() === "POST"),
    page.getByRole("button", { name: "Đăng nhập", exact: true }).click(),
  ])
  if (loginResponse.status() !== expectedStatus) {
    throw new Error(`${username} login failed ${loginResponse.status()}: ${await loginResponse.text()}`)
  }
  if (expectedStatus !== 200) return { context, page }
  await page.waitForURL((url) => !url.pathname.endsWith("/login"))
  await page.waitForLoadState("networkidle")
  return { context, page }
}

async function session(page) {
  const response = await page.context().request.get(`${apiBase}/auth/me`, { headers: { origin: base } })
  return { status: response.status(), body: await response.json() }
}

async function protectedPost(page, path, body) {
  const request = page.context().request
  const me = await request.get(`${apiBase}/auth/me`, { headers: { origin: base } })
  const auth = await me.json()
  const response = await request.post(`${apiBase}${path}`, {
    headers: { origin: base, "x-csrf-token": auth.csrfToken },
    data: body,
  })
  return { status: response.status(), body: response.status() === 204 ? null : await response.json() }
}

async function protectedGet(page, path) {
  const response = await page.context().request.get(`${apiBase}${path}`, { headers: { origin: base } })
  return { status: response.status(), body: await response.json() }
}

async function openSseFromBrowserSession(context) {
  const cookies = await context.cookies(apiBase)
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ")
  const controller = new AbortController()
  const response = await fetch(`${apiBase}/tables/stream`, {
    headers: { cookie, origin: base, accept: "text/event-stream" },
    signal: controller.signal,
  })
  if (!response.ok || !response.body) throw new Error(`SSE open failed ${response.status}`)

  let resolveHello
  let resolveFloor
  let rejectStream
  const hello = new Promise((resolve, reject) => { resolveHello = resolve; rejectStream = reject })
  const floor = new Promise((resolve, reject) => { resolveFloor = resolve; rejectStream = reject })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  void (async () => {
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n")
        let boundary
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = /^event: (.+)$/m.exec(frame)?.[1]
          if (event === "hello") resolveHello(true)
          if (event === "floor-changed") resolveFloor(frame)
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) rejectStream(error)
    }
  })()
  const timeout = (label) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), 8000))
  await Promise.race([hello, timeout("SSE open")])
  return { floor: Promise.race([floor, timeout("SSE event")]), close: () => controller.abort() }
}

try {
  const owner = await login("integration_owner")
  await expect(owner.page.getByLabel(/Tài khoản:/)).toBeVisible()
  const ownerSession = await session(owner.page)
  if (ownerSession.body.user.roles[0] !== "OWNER") throw new Error("OWNER role missing")
  results.push("PASS OWNER /admin login")

  const write = await login("browser_admin_write")
  const writeSession = await session(write.page)
  if (writeSession.body.user.accessLevel !== "WRITE") throw new Error("ADMIN WRITE access level missing")
  results.push("PASS ADMIN WRITE /admin login")

  const read = await login("browser_admin_read")
  const readSession = await session(read.page)
  if (readSession.body.user.accessLevel !== "READ_ONLY") throw new Error("ADMIN READ_ONLY access level missing")
  results.push("PASS ADMIN READ_ONLY /admin login")

  const denied = await login("integration_reception", "admin", { width: 1280, height: 800 }, 403)
  await expect(denied.page.getByText("Tài khoản không được phép đăng nhập tại cổng này")).toBeVisible()
  results.push("PASS RECEPTIONIST denied at /admin")
  await denied.context.close()

  for (const [path, text] of [
    ["/reservations", "Đặt bàn"], ["/floor", "Điều phối"], ["/waitlist", "Danh sách chờ"],
  ]) {
    await read.page.goto(`${base}${path}`, { waitUntil: "networkidle" })
    await expect(read.page.getByRole("heading", { name: text, exact: false }).first()).toBeVisible()
  }
  await read.page.goto(`${base}/settings`, { waitUntil: "networkidle" })
  await read.page.getByRole("tab", { name: "Phân quyền" }).click()
  await expect(read.page.getByRole("row").filter({ hasText: "browser_admin_read" })).toBeVisible()
  results.push("PASS READ_ONLY booking/layout/waitlist/account-list screens")

  await read.page.goto(`${base}/reports`, { waitUntil: "networkidle" })
  await expect(read.page.getByText("Chưa hỗ trợ báo cáo")).toBeVisible()
  results.push("GAP READ_ONLY report screen unavailable in HTTP mode")

  const deniedBusiness = await protectedPost(read.page, "/bookings", {})
  const deniedAdmin = await protectedPost(read.page, "/accounts", {
    username: "forbidden", displayName: "Forbidden", password, roleCode: "RECEPTIONIST",
  })
  if (deniedBusiness.status !== 403 || deniedAdmin.status !== 403) throw new Error("READ_ONLY mutation was not denied")
  results.push("PASS READ_ONLY business/admin mutations return 403")

  const booking = await protectedPost(owner.page, "/bookings", {
    guestName: "Browser phone guest", phoneNumber: "0900000789", partySize: 2,
    expectedAt: "2030-10-24T20:00:00+07:00", businessDate: "2030-10-24", sourceCode: "HOTLINE",
  })
  if (booking.status !== 201) throw new Error(`Booking fixture failed ${booking.status}`)
  const bookingId = booking.body.booking.id
  const bookingDetail = await protectedGet(read.page, `/bookings/${bookingId}`)
  if (bookingDetail.status !== 200 || bookingDetail.body.booking.id !== bookingId) throw new Error("READ_ONLY booking detail failed")
  const reveal = await protectedPost(read.page, `/bookings/${bookingId}/phone:reveal`, {})
  if (reveal.status !== 200 || reveal.body.phoneNumber !== "+84900000789") throw new Error("READ_ONLY full phone reveal failed")
  results.push("PASS READ_ONLY booking detail and full-phone reveal")

  await owner.page.goto(`${base}/settings`, { waitUntil: "networkidle" })
  await owner.page.getByRole("tab", { name: "Phân quyền" }).click()
  await owner.page.getByRole("button", { name: "Tạo tài khoản" }).click()
  await owner.page.getByLabel("Tên đăng nhập").last().fill("browser_created_staff")
  await owner.page.getByLabel("Tên hiển thị").fill("Browser Created Staff")
  await owner.page.getByLabel(/Mật khẩu ban đầu/).fill(password)
  await owner.page.getByText("Lễ tân", { exact: true }).last().click()
  await owner.page.getByRole("button", { name: "Tạo tài khoản", exact: true }).last().click()
  const staffRow = owner.page.getByRole("row").filter({ hasText: "browser_created_staff" })
  await expect(staffRow).toBeVisible()
  await staffRow.getByRole("button", { name: "Khóa" }).click()
  await expect(staffRow.getByText("Đã khóa")).toBeVisible()
  await staffRow.getByRole("button", { name: "Mở khóa" }).click()
  await expect(staffRow.getByText("Đang hoạt động")).toBeVisible()
  results.push("PASS OWNER create and lock/unlock account via browser UI")

  const adminRow = owner.page.getByRole("row").filter({ hasText: "browser_admin_write" })
  const [accessResponse] = await Promise.all([
    owner.page.waitForResponse((response) => response.url().endsWith("/accounts/9810/access-level") && response.request().method() === "POST"),
    adminRow.getByRole("button", { name: /Đổi sang Chỉ xem/ }).click(),
  ])
  if (accessResponse.status() !== 200) throw new Error(`Access-level update failed ${accessResponse.status()}`)
  await expect(adminRow.getByText("Chỉ xem")).toBeVisible()
  const oldWrite = await session(write.page)
  if (oldWrite.status !== 401) throw new Error(`Access-level change did not revoke old ADMIN session: ${oldWrite.status} ${JSON.stringify(oldWrite.body)}`)
  results.push("PASS OWNER changes ADMIN access and old session is revoked")

  const ownerSecond = await login("integration_owner")
  const ownerOld = await session(owner.page)
  const ownerNew = await session(ownerSecond.page)
  if (ownerOld.status !== 401 || ownerNew.status !== 200) throw new Error("Single Active Session browser check failed")
  results.push("PASS Single Active Session across two browser contexts")

  // Open the real SSE transport with cookies issued by two independent browser contexts.
  const freshWrite = await login("browser_admin_write")
  const freshOwner = ownerSecond
  const [ownerStream, adminStream] = await Promise.all([
    openSseFromBrowserSession(freshOwner.context), openSseFromBrowserSession(freshWrite.context),
  ])
  const mutation = await protectedPost(freshOwner.page, "/tables/groups", { tableIds: [9801, 9810] })
  if (mutation.status !== 201) throw new Error(`SSE mutation failed ${mutation.status}: ${JSON.stringify(mutation.body)}`)
  await Promise.all([ownerStream.floor, adminStream.floor])
  ownerStream.close()
  adminStream.close()
  results.push("PASS SSE event reaches two valid browser accounts")

  for (const width of [360, 375, 430, 768]) {
    await read.page.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
    for (const path of ["/floor", "/reservations", "/waitlist", "/settings"]) {
      await read.page.goto(`${base}${path}`, { waitUntil: "networkidle" })
      const overflow = await read.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      if (overflow) throw new Error(`Horizontal overflow at ${width}px on ${path}`)
    }
  }
  results.push("PASS responsive floor/booking/waitlist/settings at 360/375/430/tablet without document overflow")

  await Promise.all([owner.context.close(), write.context.close(), read.context.close(), freshWrite.context.close(), ownerSecond.context.close()])
  console.log(results.join("\n"))
} finally {
  await browser.close()
}
