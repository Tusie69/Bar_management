import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { chromium } from "@playwright/test"

const root = new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")
const apiUrl = "http://127.0.0.1:3102"
const webUrl = "http://127.0.0.1:5175"
const databaseName = process.env.DB_NAME ?? "gam21_platform_test"
if (!/_test$/.test(databaseName)) throw new Error("Refusing layout E2E: DB_NAME must end in _test")
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable")

const username = `layout_${Date.now()}`
const password = randomBytes(24).toString("base64url")
const encryptionKey = randomBytes(32).toString("base64")
const hmacKey = randomBytes(32).toString("base64")
const common = {
  ...process.env,
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: databaseName,
  DB_USER: process.env.DB_USER ?? "gam21",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "gam21_dev",
  ORGANIZATION_ID: "1",
  VENUE_ID: "1",
  NO_SHOW_WORKER_ENABLED: "false",
  PHONE_ENCRYPTION_KEYS: `1:${encryptionKey}`,
  PHONE_ACTIVE_ENCRYPTION_KEY_ID: "1",
  PHONE_HMAC_KEYS: `1:${hmacKey}`,
  PHONE_ACTIVE_HMAC_KEY_ID: "1",
  // Test-only threshold. Production policy remains explicitly configured by operations.
  PHONE_REVEAL_RATE_LIMIT_MAX: "10",
  PHONE_REVEAL_RATE_LIMIT_WINDOW_MS: "60000",
}
const credentialEnv = { ...common, E2E_USERNAME: username, E2E_PASSWORD: password }
const children = []
let browser

function run(command, args, env = common) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  children.push(child)
  return child
}

const runPnpm = (args, env = common) => run(process.execPath, [pnpmCli, ...args], env)
const startPnpm = (args, env) => start(process.execPath, [pnpmCli, ...args], env)

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  }
}

async function login(page) {
  await page.goto(webUrl, { waitUntil: "networkidle" })
  await page.getByLabel("Tên đăng nhập").fill(username)
  await page.getByLabel("Mật khẩu").fill(password)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await page.getByLabel("Sơ đồ bàn từ backend").waitFor()
}

const table = (page, code, state) => page.getByRole("button", { name: new RegExp(`^Bàn ${code}, ${state}`) })

async function createFromTable(page, code, guestName, party = 2, phoneNumber) {
  await table(page, code, "Chưa đặt").click()
  const dialog = page.getByRole("dialog").last()
  await dialog.getByText("Tạo booking", { exact: true }).waitFor()
  await dialog.getByText(`Bàn đã chọn: Bàn ${code}`, { exact: false }).waitFor()
  await dialog.locator("input").first().fill(guestName)
  if ((await dialog.locator('input[type="time"]').count()) !== 0) throw new Error("Native time picker is still present")
  if (phoneNumber) await dialog.locator('input[type="tel"]').fill(phoneNumber)
  await dialog.locator('input[type="number"]').fill(String(party))
  // Keep the fixture inside the approved 19:00–01:00 booking window regardless of test run time.
  const availableTime = dialog.locator('button[role="radio"]:not([disabled])').first()
  if ((await availableTime.count()) !== 1) throw new Error("No valid booking time remains in the current shift")
  await availableTime.click()
  await dialog.getByRole("button", { name: "Lưu qua backend" }).click()
  await dialog.waitFor({ state: "hidden" })
  await table(page, code, "Đang đặt").waitFor()
}

async function openAction(page, code) {
  await table(page, code, "Đang đặt").click()
  const dialog = page.getByRole("dialog").last()
  await dialog.getByText(`Thao tác Bàn ${code}`, { exact: true }).waitFor()
  return dialog
}

async function verifyBookingTextExport(page, copy = false) {
  await page.goto(webUrl, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Booking", exact: true }).click()
  await page.getByRole("button", { name: "Xuất text Zalo", exact: true }).waitFor()
  await page.getByRole("button", { name: "Xuất text Zalo", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const preview = dialog.getByLabel("Nội dung text booking")
  await preview.waitFor()
  const text = await preview.inputValue()
  for (const expected of ["Danh sách bàn đặt 21Gam", "BC (Bàn Chờ +0)", "BÀN OUT", "A3", "BÀN HUỶ", "✅"]) {
    if (!text.includes(expected)) throw new Error(`Booking export preview is missing ${expected}`)
  }
  if (/0987|\+849876|•••\s*321/.test(text)) throw new Error("Booking export preview leaked booking phone data")
  if (copy) {
    await dialog.getByRole("button", { name: "Sao chép", exact: true }).click()
    await page.getByText("Đã sao chép nội dung. Bạn có thể dán thủ công vào Zalo.", { exact: true }).waitFor()
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    const normalizeNewlines = (value) => value.replace(/\r\n/g, "\n")
    if (normalizeNewlines(clipboardText) !== normalizeNewlines(text)) {
      throw new Error("Clipboard did not preserve the preview, emoji and line boundaries")
    }
  }
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })
}

try {
  runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "setup"], credentialEnv)
  startPnpm(["--filter", "@21gam/api", "exec", "tsx", "src/server.ts"], {
    ...common,
    PORT: "3102",
    WEB_ORIGIN: webUrl,
    SESSION_CSRF_SECRET: randomBytes(32).toString("hex"),
    SESSION_COOKIE_SECURE: "false",
    SESSION_COOKIE_SAME_SITE: "lax",
  })
  startPnpm(["--filter", "@21gam/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5175"], {
    ...process.env,
    VITE_API_MODE: "http",
    VITE_API_BASE_URL: apiUrl,
    VITE_VENUE_ID: "1",
  })
  await Promise.all([waitFor(`${apiUrl}/api/v1/health`), waitFor(webUrl)])

  browser = await chromium.launch()
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const contextTablet = await browser.newContext({ viewport: { width: 834, height: 1112 } })
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], { origin: webUrl })
  const deviceA = await contextA.newPage()
  const deviceB = await contextB.newPage()
  const tablet = await contextTablet.newPage()
  await Promise.all([login(deviceA), login(deviceB), login(tablet)])

  const waitlistDraft = `Draft ${Date.now()}`
  await deviceB.getByRole("button", { name: "Bàn chờ, 0 nhóm đang chờ" }).click()
  const mobileWaitlist = deviceB.getByRole("dialog")
  await mobileWaitlist.getByLabel("Tên khách").fill(waitlistDraft)

  const waitlistGuest = `Waitlist ${Date.now()}`
  await deviceA.getByRole("button", { name: "Bàn chờ, 0 nhóm đang chờ" }).click()
  const desktopWaitlist = deviceA.getByRole("dialog")
  await desktopWaitlist.getByLabel("Tên khách").fill(waitlistGuest)
  await desktopWaitlist.getByLabel("Số điện thoại (không bắt buộc)").fill("0901 234 567")
  await desktopWaitlist.getByRole("radio", { name: "5 khách" }).click()
  await desktopWaitlist.getByLabel("Ghi chú").fill("Khách đồng ý chờ")
  await desktopWaitlist.getByRole("button", { name: "Thêm vào bàn chờ" }).click()
  await desktopWaitlist.getByText("1 nhóm", { exact: true }).waitFor()
  const waitlistAddedAt = Date.now()
  await mobileWaitlist.getByText("1 nhóm", { exact: true }).waitFor({ timeout: 25_000 })
  if ((await mobileWaitlist.getByLabel("Tên khách").inputValue()) !== waitlistDraft) {
    throw new Error("Waitlist polling reset the in-progress form on device B")
  }
  const waitlistAddSyncMs = Date.now() - waitlistAddedAt
  await mobileWaitlist.getByRole("button", { name: "Đóng" }).click()

  let waitlistSeatRequests = 0
  deviceA.on("request", (request) => {
    if (/\/waitlist\/\d+\/seat$/.test(new URL(request.url()).pathname)) waitlistSeatRequests += 1
  })
  await desktopWaitlist.getByRole("button", { name: "Chọn bàn" }).click()
  await deviceA.getByText("Chọn một hoặc nhiều bàn cùng khu", { exact: true }).waitFor()
  await table(deviceA, "B3", "Chưa đặt").click()
  if (await deviceA.getByRole("button", { name: "Xác nhận 4/5 chỗ" }).isEnabled()) {
    throw new Error("Waitlist assignment allowed insufficient total capacity")
  }
  await table(deviceA, "B4", "Chưa đặt").click()
  await deviceA.getByRole("button", { name: "Xác nhận 8/5 chỗ" }).click()
  const cancelledWaitlistAssign = deviceA.getByRole("dialog")
  await cancelledWaitlistAssign
    .getByText("Bạn có chắc chắn muốn gán khách vào bàn này không?", { exact: true })
    .waitFor()
  await cancelledWaitlistAssign.getByRole("button", { name: "Hủy", exact: true }).click()
  if (waitlistSeatRequests !== 0) throw new Error("Cancelling waitlist confirmation called the mutation endpoint")
  await table(deviceA, "B3", "Chưa đặt").waitFor()
  await table(deviceA, "B4", "Chưa đặt").waitFor()
  await deviceA.getByRole("button", { name: "Bàn chờ, 1 nhóm đang chờ" }).click()
  const retryWaitlist = deviceA.getByRole("dialog")
  await retryWaitlist.getByRole("button", { name: "Chọn bàn" }).click()
  await table(deviceA, "B3", "Chưa đặt").click()
  await table(deviceA, "B4", "Chưa đặt").click()
  await deviceA.getByRole("button", { name: "Xác nhận 8/5 chỗ" }).click()
  const confirmedWaitlistAssign = deviceA.getByRole("dialog")
  const waitlistResponsePromise = deviceA.waitForResponse(
    (response) =>
      /\/waitlist\/\d+\/seat$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
  )
  await confirmedWaitlistAssign.getByRole("button", { name: "Xác nhận giữ bàn" }).click()
  const waitlistResponse = await waitlistResponsePromise
  if (waitlistResponse.status() !== 200) {
    throw new Error(`Waitlist assignment failed with ${waitlistResponse.status()} ${await waitlistResponse.text()}`)
  }
  await deviceA.getByRole("button", { name: "Hoàn tất" }).click()
  await deviceA.getByRole("button", { name: "Bàn chờ, 0 nhóm đang chờ" }).waitFor()
  await table(deviceA, "B3", "Đang đặt").waitFor()
  await table(deviceA, "B4", "Đang đặt").waitFor()
  const waitlistAssignedAt = Date.now()
  await deviceB.getByRole("button", { name: "Bàn chờ, 0 nhóm đang chờ" }).waitFor({ timeout: 25_000 })
  await table(deviceB, "B3", "Đang đặt").waitFor({ timeout: 25_000 })
  await table(deviceB, "B4", "Đang đặt").waitFor({ timeout: 25_000 })
  const waitlistAssignSyncMs = Date.now() - waitlistAssignedAt
  await deviceA.reload({ waitUntil: "networkidle" })
  await table(deviceA, "B3", "Đang đặt").waitFor()
  await tablet.getByRole("button", { name: "Bàn chờ, 0 nhóm đang chờ" }).click()
  await tablet.getByText("Chưa có khách đang chờ.", { exact: true }).waitFor()
  await tablet.getByRole("dialog").getByRole("button", { name: "Đóng" }).click()

  await table(deviceA, "A10", "Bàn sơ cua").click()
  await deviceA.getByRole("dialog").getByText("Backend chưa cho phép đặt trực tiếp bàn sơ cua.").waitFor()
  await deviceA.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click()
  await table(deviceA, "A3", "Ngưng phục vụ").click()
  await deviceA.getByRole("dialog").getByText("Bàn đang ngưng phục vụ.").waitFor()
  await deviceA.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click()

  const guestOne = `Layout One ${Date.now()}`
  const firstMutationAt = Date.now()
  await createFromTable(deviceA, "A1", guestOne, 2, "0987 654 321")
  await table(deviceB, "A1", "Đang đặt").waitFor({ timeout: 25_000 })
  await table(tablet, "A1", "Đang đặt").waitFor({ timeout: 25_000 })
  const firstSyncMs = Date.now() - firstMutationAt

  const tabletMenu = await openAction(tablet, "A1")
  await tabletMenu.getByRole("button", { name: "Chuyển bàn" }).click()
  await tablet.getByText("Đang chọn bàn đích", { exact: true }).waitFor()
  await tablet.getByRole("button", { name: "Hủy thao tác" }).click()

  const menuB = await openAction(deviceB, "A1")
  await menuB.getByText(guestOne, { exact: true }).waitFor()
  const menuA = await openAction(deviceA, "A1")
  for (const [page, menu] of [
    [deviceA, menuA],
    [deviceB, menuB],
  ]) {
    const revealButton = menu.getByRole("button", { name: "Gọi khách" })
    if (await revealButton.isEnabled()) throw new Error("Receptionist must not be able to reveal booking phone data")
    if ((await page.getByRole("link", { name: `Gọi ${guestOne}` }).count()) !== 0) {
      throw new Error("Receptionist unexpectedly received a tel: handoff")
    }
  }
  await menuA.getByRole("button", { name: "Sửa booking" }).click()
  const editor = deviceA.getByRole("dialog").last()
  await editor.locator('input[type="number"]').fill("3")
  await editor.getByRole("button", { name: "Lưu qua backend" }).click()
  await deviceA.getByText("Thao tác Bàn A1", { exact: true }).waitFor()

  await menuB.getByRole("button", { name: "Hủy booking" }).click()
  const staleCancel = deviceB.getByRole("dialog").last()
  const staleResponsePromise = deviceB.waitForResponse(
    (response) => response.url().endsWith("/cancel") && response.request().method() === "POST",
  )
  await staleCancel.getByRole("button", { name: "Xác nhận hủy" }).click()
  const staleResponse = await staleResponsePromise
  const staleBody = await staleResponse.json()
  if (staleResponse.status() !== 409 || staleBody.error?.code !== "VERSION_CONFLICT") {
    throw new Error(`Expected stale VERSION_CONFLICT, received ${staleResponse.status()} ${JSON.stringify(staleBody)}`)
  }
  await staleCancel.getByRole("button", { name: "Không hủy" }).click()
  await deviceB.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click()

  const refreshedMenuA = deviceA.getByRole("dialog").last()
  await refreshedMenuA.getByRole("button", { name: "Chuyển bàn" }).click()
  await deviceA.getByText("Đang chọn bàn đích", { exact: true }).waitFor()
  await table(deviceA, "A2", "Chưa đặt").click()
  const firstConfirmation = deviceA.getByRole("dialog").last()
  await firstConfirmation.getByText("Xác nhận chuyển sang A2?", { exact: true }).waitFor()
  await firstConfirmation.getByRole("button", { name: "Quay lại chọn bàn" }).click()
  await deviceA.getByRole("button", { name: "Hủy thao tác" }).click()
  await table(deviceA, "A1", "Đang đặt").waitFor()
  await table(deviceA, "A2", "Chưa đặt").waitFor()

  const actualMoveMenu = await openAction(deviceA, "A1")
  await actualMoveMenu.getByRole("button", { name: "Chuyển bàn" }).click()
  await table(deviceA, "A2", "Chưa đặt").click()
  const confirmation = deviceA.getByRole("dialog").last()
  await confirmation.getByText("Xác nhận chuyển sang A2?", { exact: true }).waitFor()
  await confirmation.getByRole("button", { name: "Xác nhận chuyển bàn" }).click()
  await deviceA.getByRole("button", { name: "Hoàn tất" }).click()
  const reassignAt = Date.now()
  await table(deviceB, "A2", "Đang đặt").waitFor({ timeout: 25_000 })
  await table(deviceB, "A1", "Chưa đặt").waitFor({ timeout: 25_000 })
  const reassignSyncMs = Date.now() - reassignAt

  const cancelMenu = await openAction(deviceB, "A2")
  await cancelMenu.getByRole("button", { name: "Hủy booking" }).click()
  const cancel = deviceB.getByRole("dialog").last()
  const cancelResponsePromise = deviceB.waitForResponse(
    (response) => response.url().endsWith("/cancel") && response.request().method() === "POST",
  )
  await cancel.getByRole("button", { name: "Xác nhận hủy" }).click()
  const cancelResponse = await cancelResponsePromise
  if (cancelResponse.status() !== 200) {
    throw new Error(`Expected cancel 200, received ${cancelResponse.status()} ${await cancelResponse.text()}`)
  }
  const postCancelCreate = deviceB.getByRole("dialog").filter({
    has: deviceB.getByRole("heading", { name: "Tạo booking" }),
  })
  await postCancelCreate
    .locator('button:not([data-slot="dialog-close"])')
    .filter({ hasText: /^Đóng$/ })
    .click()
  const cancelAt = Date.now()
  await table(deviceB, "A2", "Chưa đặt").waitFor({ timeout: 25_000 })
  const cancelSyncMs = Date.now() - cancelAt

  const guestTwo = `Layout Checkin ${Date.now()}`
  await createFromTable(deviceB, "A1", guestTwo, 2)
  const checkinMenu = await openAction(deviceB, "A1")
  await checkinMenu.getByRole("button", { name: "Đón khách" }).click()
  const checkin = deviceB.getByRole("dialog").last()
  await checkin.getByRole("button", { name: "Xác nhận khách đã tới" }).click()
  const checkinAt = Date.now()
  await table(deviceB, "A1", "Đang sử dụng").waitFor({ timeout: 25_000 })
  const checkinSyncMs = Date.now() - checkinAt

  await table(deviceB, "A1", "Đang sử dụng").click()
  const visitMenu = deviceB.getByRole("dialog").last()
  await visitMenu.getByRole("button", { name: "Ghép bàn" }).click()
  await deviceB.getByText("Chọn các bàn cùng khu", { exact: true }).waitFor()
  if ((await table(deviceB, "B3", "Đang đặt").getAttribute("aria-disabled")) !== "true") {
    throw new Error("Cross-zone table B3 was not disabled during merge selection")
  }
  await deviceB.getByRole("button", { name: "Hủy", exact: true }).click()
  await table(deviceB, "A2", "Chưa đặt").waitFor()

  await table(deviceB, "A1", "Đang sử dụng").click()
  const mergeCancelMenu = deviceB.getByRole("dialog").last()
  await mergeCancelMenu.getByRole("button", { name: "Ghép bàn" }).click()
  await table(deviceB, "A4", "Chưa đặt").click()
  await deviceB.getByRole("button", { name: "Tiếp tục", exact: true }).click()
  const cancelledMergeConfirmation = deviceB.getByRole("dialog").last()
  await cancelledMergeConfirmation.getByRole("button", { name: "Quay lại" }).click()
  await deviceB.getByRole("button", { name: "Hủy", exact: true }).click()
  await table(deviceB, "A4", "Chưa đặt").waitFor()

  await table(deviceB, "A1", "Đang sử dụng").click()
  const mergeMenu = deviceB.getByRole("dialog").last()
  await mergeMenu.getByRole("button", { name: "Ghép bàn" }).click()
  await table(deviceB, "A4", "Chưa đặt").click()
  await deviceB.getByRole("button", { name: "Tiếp tục", exact: true }).click()
  const mergeConfirmation = deviceB.getByRole("dialog").last()
  await mergeConfirmation.getByText("Xác nhận ghép A1 + A4?", { exact: true }).waitFor()
  await mergeConfirmation.getByRole("button", { name: "Xác nhận ghép bàn" }).click()
  await deviceB.getByRole("button", { name: "Hoàn tất" }).click()
  const mergeAt = Date.now()
  await table(deviceA, "A1", "Đang sử dụng").waitFor({ timeout: 25_000 })
  await table(deviceA, "A4", "Đang sử dụng").waitFor({ timeout: 25_000 })
  const mergeSyncMs = Date.now() - mergeAt
  if (!/nhóm \d+/.test(await table(deviceA, "A1", "Đang sử dụng").getAttribute("aria-label"))) {
    throw new Error("Persisted group symbol was not restored through Floor State")
  }
  const groupHighlight = deviceA.locator("[data-group-symbol]:visible").first()
  await groupHighlight.waitFor()
  if (!(await groupHighlight.getAttribute("stroke"))) throw new Error("Persisted group highlight has no color")

  await table(deviceB, "A1", "Đang sử dụng").click()
  const groupedVisitMenu = deviceB.getByRole("dialog").last()
  await groupedVisitMenu.getByRole("button", { name: "Chuyển bàn" }).click()
  await table(deviceB, "A2", "Chưa đặt").click()
  const visitConfirmation = deviceB.getByRole("dialog").last()
  await visitConfirmation.getByText("Xác nhận chuyển sang A2?", { exact: true }).waitFor()
  await visitConfirmation.getByRole("button", { name: "Xác nhận chuyển bàn" }).click()
  await deviceB.getByRole("button", { name: "Hoàn tất" }).click()
  const visitMoveAt = Date.now()
  await table(deviceA, "A2", "Đang sử dụng").waitFor({ timeout: 25_000 })
  await table(deviceA, "A1", "Chưa đặt").waitFor({ timeout: 25_000 })
  await table(deviceA, "A4", "Chưa đặt").waitFor({ timeout: 25_000 })
  const visitMoveSyncMs = Date.now() - visitMoveAt

  await verifyBookingTextExport(deviceA, true)
  await verifyBookingTextExport(deviceB)
  await verifyBookingTextExport(tablet)

  await deviceA.keyboard.press("Escape")
  await deviceB.keyboard.press("Escape")
  await deviceA.getByRole("button", { name: "Đăng xuất", exact: true }).click()
  await deviceB.getByRole("button", { name: "Đăng xuất", exact: true }).click()
  await tablet.getByRole("button", { name: "Đăng xuất", exact: true }).click()
  await Promise.all([
    deviceA.getByText("Đăng nhập 21GAM", { exact: true }).waitFor(),
    deviceB.getByText("Đăng nhập 21GAM", { exact: true }).waitFor(),
    tablet.getByText("Đăng nhập 21GAM", { exact: true }).waitFor(),
  ])

  const phoneAudit = runPnpm(
    ["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-phone-audit"],
    credentialEnv,
  )
  if (!phoneAudit.includes("plaintext=0")) throw new Error("Phone audit contains unexpected data")

  console.log(
    JSON.stringify({
      loginTwoDevices: "PASS",
      waitlistVirtualMarker: "PASS",
      waitlistCreateAndFifo: "PASS",
      waitlistFormPollingPreserved: "PASS",
      waitlistCancelNoMutation: "PASS",
      waitlistReservedNoVisit: "PASS",
      waitlistTwoDeviceSync: "PASS",
      emptyTableDirectForm: "PASS",
      createAssign: "PASS",
      spareAndOosBlocked: "PASS",
      bookingActionMenu: "PASS",
      receptionistPhoneRevealDeniedDesktop: "PASS",
      receptionistPhoneRevealDeniedMobile: "PASS",
      edit: "PASS",
      staleVersionConflict: "PASS",
      reassign: "PASS",
      cancelMoveSelection: "PASS",
      cancelMoveConfirmation: "PASS",
      visitMove: "PASS",
      visitMerge: "PASS",
      sameZoneNonAdjacentMerge: "PASS",
      crossZoneDisabled: "PASS",
      cancelMergeSelection: "PASS",
      cancelMergeConfirmation: "PASS",
      persistedGroupFloorState: "PASS",
      persistedGroupHighlight: "PASS",
      bookingTextPreview: "PASS",
      bookingTextClipboardExact: "PASS",
      bookingTextPrivacy: "PASS",
      cancel: "PASS",
      checkIn: "PASS",
      secondDeviceNoRefresh: "PASS",
      syncMs: {
        waitlistAdd: waitlistAddSyncMs,
        waitlistAssign: waitlistAssignSyncMs,
        first: firstSyncMs,
        reassign: reassignSyncMs,
        cancel: cancelSyncMs,
        checkin: checkinSyncMs,
        merge: mergeSyncMs,
        visitMove: visitMoveSyncMs,
      },
      desktop: "PASS",
      mobile: "PASS",
      tablet: "PASS",
      logout: "PASS",
    }),
  )
} finally {
  if (browser) await browser.close()
  stopChildren()
  try {
    runPnpm(["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "cleanup"], credentialEnv)
    console.log(
      runPnpm(
        ["--filter", "@21gam/api", "exec", "tsx", "test/support/phase2b-e2e-fixture.ts", "verify-clean"],
        credentialEnv,
      ),
    )
  } catch (cleanupError) {
    console.error(cleanupError)
    process.exitCode = 1
  }
}
