import { chromium } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const browser = await chromium.launch()
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
  },
  permissions: currentUser === "owner" ? ["report.read", "venue.configure"] : ["customer.view_masked"],
  csrfToken: "csrf-from-server",
  expiresAt: "2026-10-29T00:00:00.000Z",
})

await page.route("**/api/v1/**", async (route) => {
  if (networkDown) return route.abort("connectionrefused")
  const request = route.request()
  const path = new URL(request.url()).pathname
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
  return route.fulfill({ status: 404, headers, json: { error: { code: "NOT_FOUND", message: "Không tìm thấy." } } })
})

const expectText = async (text) => page.getByText(text, { exact: false }).first().waitFor()

await page.goto(base, { waitUntil: "networkidle" })
await expectText("Đăng nhập 21GAM")

await page.getByLabel("Tên đăng nhập").fill("operator")
await page.getByLabel("Mật khẩu").fill("wrong")
await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
await expectText("Tên đăng nhập hoặc mật khẩu không hợp lệ")

await page.getByLabel("Mật khẩu").fill("correct-password")
await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
await expectText("Xin chào, Lễ tân")
await expectText("customer.view_masked")

await page.reload({ waitUntil: "networkidle" })
await expectText("Xin chào, Lễ tân")

await page.getByRole("button", { name: "Đăng xuất", exact: true }).click()
await expectText("Đăng nhập 21GAM")
if (!csrfSeenOnLogout) throw new Error("Logout did not send x-csrf-token")

await page.getByLabel("Tên đăng nhập").fill("owner")
await page.getByLabel("Mật khẩu").fill("correct-password")
await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
await expectText("Xin chào, Chủ quán")
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
await browser.close()
