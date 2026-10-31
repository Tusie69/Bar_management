import { chromium } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const launchOptions = {
  headless: true,
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}
const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

let signedIn = false
let currentUser = "operator"
let csrfSeenOnLogout = false
let networkDown = false

const session = () => ({
  user: {
    id: currentUser === "owner" ? 9 : 7,
    username: currentUser,
    displayName: currentUser === "owner" ? "Chủ quán" : "Lễ tân",
    organizationId: 1,
    venueId: 1,
    roles: [currentUser === "owner" ? "OWNER_ADMIN" : "RECEPTIONIST"],
  },
  roles: [currentUser === "owner" ? "OWNER_ADMIN" : "RECEPTIONIST"],
  permissions:
    currentUser === "owner"
      ? [
          "reservation.create",
          "reservation.update",
          "reservation.cancel",
          "reservation.mark_no_show",
          "table.assign",
          "table.assign_override",
          "visit.checkin",
          "visit.walkin",
          "visit.move",
          "visit.combine",
          "visit.split",
          "visit.end",
          "visit.mark_paid",
          "waitlist.create",
          "waitlist.cancel",
          "waitlist.claim",
          "waitlist.record_contact",
          "waitlist.accept_offer",
          "hold.set_deadline",
          "hold.release",
          "customer.view_masked",
          "customer.phone.reveal",
          "booking.phone.reveal",
          "customer.anonymize",
          "audit.read",
          "report.read",
          "venue.configure",
          "user.manage",
          "operation.undo",
        ]
      : [
          "reservation.create",
          "reservation.update",
          "reservation.cancel",
          "reservation.mark_no_show",
          "table.assign",
          "visit.checkin",
          "visit.walkin",
          "visit.move",
          "visit.combine",
          "visit.split",
          "visit.end",
          "waitlist.create",
          "waitlist.cancel",
          "waitlist.claim",
          "waitlist.record_contact",
          "waitlist.accept_offer",
          "hold.set_deadline",
          "hold.release",
          "customer.view_masked",
          "operation.undo",
        ],
  csrfToken: "csrf-from-server",
  expiresAt: "2026-10-29T00:00:00.000Z",
})

await page.route("**/api/v1/**", async (route) => {
  if (networkDown) return route.abort("connectionrefused")
  const request = route.request()
  const reqUrl = new URL(request.url())
  const path = reqUrl.pathname
  const reqDate = reqUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  const headers = { "access-control-allow-origin": base, "access-control-allow-credentials": "true" }

  if (path === "/api/v1/auth/me") {
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        headers,
        json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Vui lòng đăng nhập." } },
      })
    }
    return route.fulfill({ status: 200, headers, json: session() })
  }
  if (path === "/api/v1/auth/login") {
    const body = request.postDataJSON()
    if (body.password !== "correct-password") {
      return route.fulfill({
        status: 401,
        headers,
        json: { error: { code: "INVALID_CREDENTIALS", message: "Tên đăng nhập hoặc mật khẩu không hợp lệ." } },
      })
    }
    currentUser = body.username
    signedIn = true
    return route.fulfill({
      status: 200,
      headers: { ...headers, "set-cookie": "21gam_session=fake; HttpOnly; Path=/api/v1; SameSite=Lax" },
      json: session(),
    })
  }
  if (path === "/api/v1/auth/logout") {
    csrfSeenOnLogout = request.headers()["x-csrf-token"] === "csrf-from-server"
    if (!csrfSeenOnLogout) {
      return route.fulfill({
        status: 403,
        headers,
        json: { error: { code: "CSRF_TOKEN_INVALID", message: "Sai CSRF" } },
      })
    }
    signedIn = false
    return route.fulfill({ status: 204, headers })
  }
  if (path === "/api/v1/tables/catalog") {
    return route.fulfill({
      status: 200,
      headers,
      json: {
        venue: {
          id: 1,
          version: 1,
          name: "21GAM",
          timezone: "Asia/Ho_Chi_Minh",
          businessDayStartLocal: "17:00:00",
          businessDayCutoffLocal: "05:00:00",
          lateWarningMinutes: 15,
          noShowWarningMinutes: 30,
          waitlistHoldDefaultMinutes: 30,
          waitlistClaimLeaseSeconds: 300,
          reservationHoldPolicy: "SEQUENTIAL",
          reservationWindowMinutes: null,
          groupSymbolCount: 12,
          changeSeq: 1,
        },
        zones: [{ id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false }],
        tables: [
          {
            id: 1,
            version: 1,
            code: "A1",
            displayName: "Bàn A1",
            zoneId: 1,
            zoneCode: "A",
            kind: "TABLE",
            capacity: 4,
            seqNo: null,
            isSpare: false,
            status: "ACTIVE",
            x: 80,
            y: 654,
            width: 46,
            height: 32,
          },
          {
            id: 2,
            version: 1,
            code: "A10",
            displayName: "Bàn A10",
            zoneId: 1,
            zoneCode: "A",
            kind: "TABLE",
            capacity: 4,
            seqNo: null,
            isSpare: true,
            status: "ACTIVE",
            x: 231,
            y: 685,
            width: 38,
            height: 38,
          },
        ],
        combinations: [],
      },
    })
  }
  if (path === "/api/v1/bookings/sources") {
    return route.fulfill({ status: 200, headers, json: { sources: [{ code: "HOTLINE", name: "Hotline" }] } })
  }
  if (path === "/api/v1/tables") {
    return route.fulfill({
      status: 200,
      headers,
      json: {
        businessDate: reqDate,
        tables: [
          { id: 1, code: "A1", state: "AVAILABLE", isBackup: false, activeVisit: null },
          { id: 2, code: "A10", state: "AVAILABLE", isBackup: true, activeVisit: null },
        ],
        groups: [],
      },
    })
  }
  if (path === "/api/v1/bookings") {
    return route.fulfill({ status: 200, headers, json: { businessDate: reqDate, bookings: [] } })
  }
  if (path === "/api/v1/waitlist") {
    return route.fulfill({ status: 200, headers, json: { businessDate: reqDate, entries: [] } })
  }
  return route.fulfill({ status: 404, headers, json: { error: { code: "NOT_FOUND", message: "Không tìm thấy." } } })
})

const expectText = async (text) => page.getByText(text, { exact: false }).first().waitFor()

try {
  await page.goto(base, { waitUntil: "networkidle" })
  await expectText("Đăng nhập 21GAM")

  await page.getByLabel("Tên đăng nhập").fill("operator")
  await page.getByLabel("Mật khẩu").fill("wrong")
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expectText("Tên đăng nhập hoặc mật khẩu không hợp lệ")

  await page.getByLabel("Mật khẩu").fill("correct-password")
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await page.getByLabel(/Tài khoản: Lễ tân/).waitFor()
  await page.getByLabel("Sơ đồ bàn, trạng thái hiện tại").waitFor()
  await page.getByRole("button", { name: /Bàn A10, Bàn sơ cua/ }).waitFor()

  await page.reload({ waitUntil: "networkidle" })
  await page.getByLabel(/Tài khoản: Lễ tân/).waitFor()

  await page.getByLabel(/Tài khoản: Lễ tân/).click()
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click()
  await expectText("Đăng nhập 21GAM")
  if (!csrfSeenOnLogout) throw new Error("Logout did not send x-csrf-token")

  await page.getByLabel("Tên đăng nhập").fill("owner")
  await page.getByLabel("Mật khẩu").fill("correct-password")
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await page.getByLabel(/Tài khoản: Chủ quán/).waitFor()
  if (await page.getByText("Lễ tân", { exact: true }).count())
    throw new Error("Previous account state leaked after account change")

  signedIn = false
  await page.reload({ waitUntil: "networkidle" })
  await expectText("Đăng nhập 21GAM")

  networkDown = true
  await page.reload({ waitUntil: "domcontentloaded" })
  await expectText("Không thể khôi phục phiên")
  await expectText("Không thể kết nối tới máy chủ")

  console.log(
    "PASS auth bootstrap, invalid login, login, reload, CSRF logout, account change, revoked session, network error",
  )
} finally {
  await browser.close()
}
