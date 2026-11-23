import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")

function launchBrowser() {
  const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  return chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : fs.existsSync(defaultChrome)
        ? { executablePath: defaultChrome }
        : {},
  )
}

async function startVite(mode) {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = mode
  process.env.VITE_API_BASE_URL = mode === "http" ? "http://127.0.0.1:59999/api/v1" : ""
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
  })
  await server.listen()
  const addr = server.httpServer?.address()
  assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
  return {
    server: {
      close: async () => {
        await server.close()
        if (prevMode === undefined) delete process.env.VITE_API_MODE
        else process.env.VITE_API_MODE = prevMode
        if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
        else process.env.VITE_API_BASE_URL = prevBase
      },
    },
    baseUrl: `http://127.0.0.1:${addr.port}`,
  }
}

const PORTALS = ["/letan/login", "/thungan/login", "/phucvu/login", "/chebien/login", "/admin/login"]

async function dismissToastIfPresent(page) {
  const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
  if ((await toastClose.count()) > 0) {
    await toastClose.click()
    await page.waitForTimeout(150)
  }
}

async function verifyLoginPortals(browser) {
  const { server, baseUrl } = await startVite("http")
  try {
    for (const portalPath of PORTALS) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      let loginRequests = 0
      await page.route("**/api/v1/**", async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === "/api/v1/auth/login") {
          loginRequests++
          return route.fulfill({ status: 400, json: { error: { code: "BAD", message: "bad" } } })
        }
        return route.fulfill({
          status: 401,
          json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Vui lòng đăng nhập." } },
        })
      })

      await page.goto(`${baseUrl}${portalPath}`, { waitUntil: "domcontentloaded" })
      await page.getByLabel("Tên đăng nhập", { exact: true }).waitFor()

      // UI-14: Vietnamese staff footer copy, no HttpOnly/CSRF jargon
      const bodyText = await page.locator("main").innerText()
      assert(bodyText.includes("Phiên đăng nhập được bảo vệ."), `${portalPath}: missing Vietnamese login footer`)
      assert(!/HttpOnly|CSRF/i.test(bodyText), `${portalPath}: technical jargon still present in footer`)

      // UI-15: Disabled button stays disabled; tapping disabled area reveals empty-field hints without API call
      const submitBtn = page.getByRole("button", { name: "Đăng nhập", exact: true })
      assert(await submitBtn.isDisabled(), `${portalPath}: submit button should stay disabled when empty`)
      const btnBox = await submitBtn.boundingBox()
      assert(btnBox, `${portalPath}: missing submit button box`)
      await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2)
      await page.getByText("Vui lòng nhập tên đăng nhập.", { exact: true }).waitFor({ state: "visible" })
      await page.getByText("Vui lòng nhập mật khẩu.", { exact: true }).waitFor({ state: "visible" })
      assert.equal(loginRequests, 0, `${portalPath}: empty tap triggered auth request`)
      assert(await submitBtn.isDisabled(), `${portalPath}: submit button unexpectedly enabled`)

      await context.close()
    }

    // UI-15 blur empty field -> shows hint, typing hides hint
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Vui lòng đăng nhập." } },
      }),
    )
    await page.goto(`${baseUrl}/letan/login`, { waitUntil: "domcontentloaded" })
    const userInput = page.getByLabel("Tên đăng nhập", { exact: true })
    const passInput = page.getByLabel("Mật khẩu", { exact: true })
    await userInput.focus()
    await passInput.focus()
    await page.getByText("Vui lòng nhập tên đăng nhập.", { exact: true }).waitFor({ state: "visible" })
    await userInput.fill("letan1")
    assert.equal(await page.getByText("Vui lòng nhập tên đăng nhập.", { exact: true }).count(), 0)
    await userInput.blur()
    await page.getByText("Vui lòng nhập mật khẩu.", { exact: true }).waitFor({ state: "visible" })
    await context.close()
  } finally {
    await server.close()
  }
}

async function getBarBisectorGeometry(page) {
  return page.evaluate(() => {
    const bar5 = document.querySelector('g[role="button"][aria-label^="Ghế Bar 5,"]')
    const bar6 = document.querySelector('g[role="button"][aria-label^="Ghế Bar 6,"]')
    const c5 = bar5?.querySelector('circle:not([fill="transparent"]):not(.focus-ring)')?.getBoundingClientRect()
    const c6 = bar6?.querySelector('circle:not([fill="transparent"]):not(.focus-ring)')?.getBoundingClientRect()
    if (!c5 || !c6) return null
    const p5 = { x: c5.left + c5.width / 2, y: c5.top + c5.height / 2, r: c5.width / 2 }
    const p6 = { x: c6.left + c6.width / 2, y: c6.top + c6.height / 2, r: c6.width / 2 }
    const midX = (p5.x + p6.x) / 2
    const midY = (p5.y + p6.y) / 2
    const delta = Math.max(1.2, Math.abs(p5.y - p6.y) * 0.07)
    // BAR05 sits below BAR06 (p5.y > p6.y)
    return {
      p5,
      p6,
      bar5Side: { x: midX, y: midY + delta },
      bar6Side: { x: midX, y: midY - delta },
      bar5OuterLeft: { x: c5.left - 8, y: p5.y },
    }
  })
}

async function assertSeatSelectedAndDetailMatches(page, seatNum, detailSelector) {
  const expectedPrefix = `Ghế Bar ${seatNum}`
  const pressedInfo = await page.waitForFunction((prefix) => {
    const pressed = [...document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]')]
    if (pressed.length !== 1) return null
    const aria = pressed[0].getAttribute("aria-label") ?? ""
    if (!aria.startsWith(`${prefix},`)) return null
    const groupMatch = aria.match(/nhóm\s+(G\d+)/i)
    return { aria, groupCode: groupMatch?.[1] ?? null }
  }, expectedPrefix)
  const info = await pressedInfo.jsonValue()
  const pressedCount = await page.locator('svg[role="group"] g[role="button"][aria-pressed="true"]').count()
  assert.equal(pressedCount, 1, `${expectedPrefix}: expected exactly 1 aria-pressed=true table`)

  const detail = page.locator(detailSelector).first()
  await detail.waitFor({ state: "visible" })
  const detailText = (await detail.innerText()).trim()
  const seatCode = `BAR${String(seatNum).padStart(2, "0")}`
  const matchesSeat =
    detailText.includes(`Bar ${seatNum}`) ||
    detailText.includes(seatCode) ||
    (info.groupCode ? detailText.includes(info.groupCode) : false)
  assert(
    matchesSeat,
    `Expected detail panel (${detailSelector}) for ${expectedPrefix} (group=${info.groupCode}) to match seat/group, got "${detailText}"`,
  )
}

async function verifyBarBisectorAndHitResolution(browser, baseUrl) {
  const roles = [
    {
      label: "OWNER 1440x900",
      userId: 3,
      route: "/floor",
      vw: 1440,
      vh: 900,
      detailSelector: "aside h2",
      isDesktop: true,
      modalDetail: false,
    },
    {
      label: "CASHIER 1440x900",
      userId: 5,
      route: "/floor",
      vw: 1440,
      vh: 900,
      detailSelector: "aside h2",
      isDesktop: true,
      modalDetail: false,
    },
    {
      label: "RECEPTION 390x844",
      userId: 1,
      route: "/floor",
      vw: 390,
      vh: 844,
      detailSelector: '[data-mobile-table-sheet="true"] h2',
      isDesktop: false,
      modalDetail: false,
    },
    {
      label: "WAITER 390x844",
      userId: 6,
      route: "/phucvu",
      vw: 390,
      vh: 844,
      detailSelector: '[role="dialog"] h2',
      isDesktop: false,
      modalDetail: true,
    },
  ]

  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: role.vw, height: role.vh }, hasTouch: true })
    await context.addInitScript((uid) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
    }, role.userId)
    const page = await context.newPage()
    await page.goto(`${baseUrl}${role.route}`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Ghế Bar 5,/ }).waitFor({ state: "visible" })
    await dismissToastIfPresent(page)

    if (role.isDesktop) {
      assert.equal(await page.locator("[data-gm]").count(), 0, `${role.label}: must remain on desktop AppShell`)
    }

    const hitStats = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('svg[role="group"] g[role="button"]')]
      let minW = Infinity
      let minH = Infinity
      for (const el of btns) {
        const r = el.getBoundingClientRect()
        minW = Math.min(minW, r.width)
        minH = Math.min(minH, r.height)
      }
      return { count: btns.length, minW, minH }
    })
    assert(hitStats.count >= 30, `${role.label}: expected >= 30 table/bar targets, got ${hitStats.count}`)
    assert(
      hitStats.minW >= 44 && hitStats.minH >= 44,
      `${role.label}: min hit ${hitStats.minW.toFixed(1)}x${hitStats.minH.toFixed(1)} < 44`,
    )

    const geo = await getBarBisectorGeometry(page)
    assert(geo, `${role.label}: missing BAR05/BAR06 geometry`)

    const closeBottomSheetIfMobile = async () => {
      if (role.modalDetail) {
        await page.keyboard.press("Escape")
        await page.locator('[role="dialog"]').waitFor({ state: "detached" })
      } else if (!role.isDesktop) {
        await page.locator('[data-mobile-table-sheet="true"] button[aria-label="Đóng"]').click()
        await page.locator('[data-mobile-table-sheet="true"]').waitFor({ state: "detached" })
      }
    }

    const cdp = await context.newCDPSession(page)

    // 0. Locked-camera drag suppression + NA41-06 (<250ms post-drag click/tap) + NA41-07 (leave <6px before capture)
    if (!role.isDesktop) {
      const transformBefore = await page.locator('svg[role="group"] > g').first().getAttribute("transform")
      await page.mouse.move(geo.p6.x, geo.p6.y)
      await page.mouse.down()
      await page.mouse.move(geo.p5.x, geo.p5.y, { steps: 10 })
      await page.mouse.up()
      const transformAfter = await page.locator('svg[role="group"] > g').first().getAttribute("transform")
      assert.equal(transformAfter, transformBefore, `${role.label}: locked camera transform changed on drag`)
      assert.equal(
        await page.locator('svg[role="group"] g[role="button"][aria-pressed="true"]').count(),
        0,
        `${role.label}: drag from BAR06 to BAR05 selected a table`,
      )
      assert.equal(
        await page.locator(role.detailSelector).count(),
        0,
        `${role.label}: drag from BAR06 to BAR05 opened detail panel`,
      )

      // NA41-06: immediate mouse click (<250ms after drag) must select BAR05
      const mouseDragEndedAt = Date.now()
      await page.mouse.click(geo.p5.x, geo.p5.y)
      const mouseElapsed = Date.now() - mouseDragEndedAt
      assert(mouseElapsed < 250, `${role.label}: immediate post-drag click took ${mouseElapsed}ms (>= 250ms)`)
      await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
      await closeBottomSheetIfMobile()

      // NA41-06 touch: touch drag BAR06 -> BAR05 selects nothing, immediate tap (<250ms) selects BAR05
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: geo.p6.x, y: geo.p6.y, id: 0 }],
      })
      for (let i = 1; i <= 6; i += 1) {
        const t = i / 6
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: geo.p6.x + (geo.p5.x - geo.p6.x) * t,
              y: geo.p6.y + (geo.p5.y - geo.p6.y) * t,
              id: 0,
            },
          ],
        })
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      assert.equal(
        await page.locator('svg[role="group"] g[role="button"][aria-pressed="true"]').count(),
        0,
        `${role.label}: touch drag BAR06->BAR05 selected a table`,
      )
      assert.equal(
        await page.locator(role.detailSelector).count(),
        0,
        `${role.label}: touch drag BAR06->BAR05 opened detail panel`,
      )
      const touchDragEndedAt = Date.now()
      await page.waitForTimeout(50)
      await page.touchscreen.tap(geo.p5.x, geo.p5.y)
      const touchElapsed = Date.now() - touchDragEndedAt
      assert(touchElapsed < 250, `${role.label}: immediate post-drag tap took ${touchElapsed}ms (>= 250ms)`)
      await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
      await closeBottomSheetIfMobile()

      // NA41-07: press inside canvas wrapper, move 3px (<6px) outside wrapper and release; first tap selects BAR05
      const boundary = await page.evaluate(() => {
        const svg = document.querySelector('svg[role="group"]')
        const wrap = svg?.parentElement
        if (!wrap) return null
        const r = wrap.getBoundingClientRect()
        const start = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) }
        const end = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top - 1) }
        const startEl = document.elementFromPoint(start.x, start.y)
        const endEl = document.elementFromPoint(end.x, end.y)
        return {
          start,
          end,
          startInside: Boolean(startEl && wrap.contains(startEl)),
          endOutside: Boolean(!endEl || !wrap.contains(endEl)),
        }
      })
      assert(boundary && boundary.startInside && boundary.endOutside, `${role.label}: invalid NA41-07 boundary points`)
      await page.mouse.move(boundary.start.x, boundary.start.y)
      await page.mouse.down()
      await page.mouse.move(boundary.end.x, boundary.end.y, { steps: 3 })
      await page.mouse.up()
      await page.waitForTimeout(300)
      await page.touchscreen.tap(geo.p5.x, geo.p5.y)
      await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
      await closeBottomSheetIfMobile()
    }

    // 1. Click both sides of BAR05/BAR06 perpendicular bisector
    await page.mouse.click(geo.bar6Side.x, geo.bar6Side.y)
    await assertSeatSelectedAndDetailMatches(page, 6, role.detailSelector)
    await closeBottomSheetIfMobile()

    await page.mouse.click(geo.bar5Side.x, geo.bar5Side.y)
    await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
    await closeBottomSheetIfMobile()

    // 2. Tap both sides of BAR05/BAR06 perpendicular bisector (BAR06 stays focused first to stress focus-ring hit)
    await page.touchscreen.tap(geo.bar6Side.x, geo.bar6Side.y)
    await assertSeatSelectedAndDetailMatches(page, 6, role.detailSelector)
    await closeBottomSheetIfMobile()

    await page.touchscreen.tap(geo.bar5Side.x, geo.bar5Side.y)
    await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
    await closeBottomSheetIfMobile()

    // 2b. Keyboard Enter on BAR06 and Space on BAR05
    await page.getByRole("button", { name: /^Ghế Bar 6,/ }).focus()
    await page.keyboard.press("Enter")
    await assertSeatSelectedAndDetailMatches(page, 6, role.detailSelector)
    await closeBottomSheetIfMobile()

    await page.getByRole("button", { name: /^Ghế Bar 5,/ }).focus()
    await page.keyboard.press("Space")
    await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
    await closeBottomSheetIfMobile()

    // 2c. Touch wobble < 6 px (4px x, 2px y -> 4.47px) still selects BAR05
    if (role.isDesktop) {
      await page.getByRole("button", { name: "Ca tối nay" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]').length === 0,
      )
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: geo.p5.x, y: geo.p5.y, id: 0 }],
    })
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: geo.p5.x + 4, y: geo.p5.y + 2, id: 0 }],
    })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
    await closeBottomSheetIfMobile()

    // 3. Tap inside outer padding to the left of BAR05 visual circle (clear selection first so desktop toggle selects BAR05)
    if (role.isDesktop) {
      await page.getByRole("button", { name: "Ca tối nay" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]').length === 0,
      )
    }
    await page.touchscreen.tap(geo.bar5OuterLeft.x, geo.bar5OuterLeft.y)
    await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)
    await closeBottomSheetIfMobile()

    // 4. Camera-drag smoke, NA41-06 immediate (<250ms) post-drag click, & merge-mode two-table selection on desktop roles
    if (role.isDesktop) {
      // Clear selection before drag smoke
      const svgBox = await page.locator('svg[role="group"]').boundingBox()
      assert(svgBox, `${role.label}: missing svg box`)
      await page.getByRole("button", { name: "Ca tối nay" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]').length === 0,
      )

      const transformBefore = await page.locator('svg[role="group"] > g').first().getAttribute("transform")
      const dragStartX = svgBox.x + svgBox.width * 0.25
      const dragStartY = svgBox.y + svgBox.height * 0.25
      await page.mouse.move(dragStartX, dragStartY)
      await page.mouse.down()
      await page.mouse.move(dragStartX + 42, dragStartY - 22, { steps: 6 })
      await page.mouse.up()
      const dragEndedAt = Date.now()
      const transformAfter = await page.locator('svg[role="group"] > g').first().getAttribute("transform")
      assert.notEqual(transformAfter, transformBefore, `${role.label}: camera drag did not move canvas transform`)
      assert.equal(
        await page.locator('svg[role="group"] g[role="button"][aria-pressed="true"]').count(),
        0,
        `${role.label}: post-drag click suppression failed`,
      )

      // Immediate (<250ms) post-drag click selects BAR05 cleanly
      const geoAfterDrag = await getBarBisectorGeometry(page)
      assert(geoAfterDrag, `${role.label}: missing BAR05/BAR06 geometry after drag`)
      await page.mouse.click(geoAfterDrag.p5.x, geoAfterDrag.p5.y)
      const desktopElapsed = Date.now() - dragEndedAt
      assert(desktopElapsed < 250, `${role.label}: immediate post-drag click took ${desktopElapsed}ms (>= 250ms)`)
      await assertSeatSelectedAndDetailMatches(page, 5, role.detailSelector)

      // Clear selection before merge mode
      await page.getByRole("button", { name: "Ca tối nay" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]').length === 0,
      )

      // Merge mode: select C4 and C1
      const mergeBtn = page.getByRole("button", { name: "Ghép bàn", exact: true })
      if ((await mergeBtn.count()) > 0 && (await mergeBtn.isEnabled())) {
        await mergeBtn.click()
        await page.getByRole("button", { name: /^Bàn C4,/ }).click()
        await page.getByRole("button", { name: /^Bàn C1,/ }).click()
        await page.waitForFunction(() => {
          const pressed = [...document.querySelectorAll('svg[role="group"] g[role="button"][aria-pressed="true"]')]
          return pressed.length === 2
        })
      }
    }

    console.log(
      `PASS ${role.label}: bisector click+tap, outer padding tap, ${hitStats.count} targets min=${hitStats.minW.toFixed(1)}x${hitStats.minH.toFixed(1)}px`,
    )
    await context.close()
  }
}

async function verifyShellAndPanelCaps(browser, baseUrl) {
  const breakpoints = [
    { w: 320, h: 640, expectCappedShell: true },
    { w: 640, h: 900, expectCappedShell: true },
    { w: 767, h: 900, expectCappedShell: true },
    { w: 768, h: 900, expectCappedShell: false },
    { w: 1024, h: 768, expectCappedShell: false },
  ]

  for (const vp of breakpoints) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await dismissToastIfPresent(page)

    const shellCheck = await page.evaluate(() => {
      const shell = document.querySelector("[data-gm]")?.getBoundingClientRect() ?? null
      return {
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        vw: window.innerWidth,
        shellW: shell?.width ?? 0,
        shellLeft: shell?.left ?? -1,
        shellRight: shell?.right ?? 0,
      }
    })
    assert.equal(shellCheck.overflowX, false, `${vp.w}x${vp.h}: horizontal overflow`)
    if (vp.expectCappedShell) {
      assert(shellCheck.shellW <= 628.5, `${vp.w}x${vp.h}: shell width ${shellCheck.shellW} > 628`)
      if (vp.w > 628) {
        const rightMargin = shellCheck.vw - shellCheck.shellRight
        assert(
          Math.abs(shellCheck.shellLeft - rightMargin) <= 2,
          `${vp.w}x${vp.h}: shell not centered (${shellCheck.shellLeft} vs ${rightMargin})`,
        )
      }
    } else {
      assert(Math.abs(shellCheck.shellW - vp.w) <= 2, `${vp.w}x${vp.h}: shell width ${shellCheck.shellW} != ${vp.w}`)
      assert(Math.abs(shellCheck.shellLeft) <= 1, `${vp.w}x${vp.h}: shell left ${shellCheck.shellLeft} != 0`)
    }

    // 1. TableSheet <= 628px (open C1 free table)
    await page.getByRole("button", { name: /^Bàn C1,/ }).click()
    const sheet = page.locator('[data-mobile-table-sheet="true"]')
    await sheet.waitFor({ state: "visible" })
    const sheetBox = await sheet.boundingBox()
    assert(sheetBox && sheetBox.width <= 628.5, `${vp.w}x${vp.h}: TableSheet width ${sheetBox?.width} > 628`)

    // 2. QuickForm <= 628px (click "Đặt bàn" from A0 TableSheet)
    await sheet.getByRole("button", { name: "Đặt bàn", exact: true }).click()
    const quickForm = page.locator('section[aria-label="Đặt bàn trên sơ đồ"]')
    await quickForm.waitFor({ state: "visible" })
    const qfBox = await quickForm.boundingBox()
    assert(qfBox && qfBox.width <= 628.5, `${vp.w}x${vp.h}: QuickForm width ${qfBox?.width} > 628`)
    await quickForm.getByRole("button", { name: "Đóng form" }).click()
    await quickForm.waitFor({ state: "hidden" })

    // 3. Pick panel <= 628px (open a booked table -> "Đổi bàn")
    await page.getByRole("button", { name: /^Bàn B21,/ }).click()
    await sheet.waitFor({ state: "visible" })
    await sheet.getByRole("button", { name: "Đổi bàn", exact: true }).click()
    const pickConfirmBtn = page.getByRole("button", { name: /Xác nhận|Chuyển|Đổi/ }).last()
    await pickConfirmBtn.waitFor({ state: "visible" })
    const pickPanelBox = await page.evaluate(() => {
      const cancelBtn = document.querySelector('button[aria-label="Hủy chọn bàn"]')
      const topBanner = cancelBtn?.closest("div")?.getBoundingClientRect() ?? null
      const bottomPanel = [...document.querySelectorAll("main > div")].at(-1)?.getBoundingClientRect() ?? null
      return { topW: topBanner?.width ?? 0, bottomW: bottomPanel?.width ?? 0 }
    })
    assert(pickPanelBox.topW <= 628.5, `${vp.w}x${vp.h}: pick top banner width ${pickPanelBox.topW} > 628`)
    assert(pickPanelBox.bottomW <= 628.5, `${vp.w}x${vp.h}: pick bottom panel width ${pickPanelBox.bottomW} > 628`)

    await context.close()
  }

  // Verify OWNER and CASHIER stay on desktop AppShell at 1024x768 as well
  for (const uid of [3, 5]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
    await context.addInitScript((id) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: id, theme: "light" }))
    }, uid)
    const page = await context.newPage()
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    assert.equal(await page.locator("[data-gm]").count(), 0, `userId ${uid} at 1024x768: expected desktop AppShell`)
    await context.close()
  }
}

async function verifyGuestCounterAndMobileTexts(browser, baseUrl) {
  // NA41-03: Guest counter "Sửa" button >= 44x44 at 1024x768 with coarse pointer, edge tap + save/reopen 6 values
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await dismissToastIfPresent(page)

    const editBtn = page.getByRole("button", { name: "Sửa bộ đếm khách" })
    const box = await editBtn.boundingBox()
    assert(box, "1024x768: missing Sửa bộ đếm khách button")
    assert(
      box.width >= 44 && box.height >= 44,
      `1024x768: Sửa button ${box.width.toFixed(1)}x${box.height.toFixed(1)} < 44x44`,
    )

    // Tap near the bottom edge of the 44x44 target (outside the old 32px height)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 2)
    const editor = page.getByTestId("guest-count-editor")
    await editor.waitFor({ state: "visible" })
    const expected = [
      ["Trước 21:30", "11"],
      ["Sau 21:30", "7"],
      ["Tổng đã tới", "18"],
      ["Tổng bàn đặt", "9"],
      ["Tổng khách đặt", "25"],
      ["Đã từng đặt bàn", "4"],
    ]
    for (const [label, val] of expected) {
      await editor.getByLabel(label, { exact: true }).fill(val)
    }
    await page.getByRole("button", { name: "Lưu", exact: true }).click()
    await editor.waitFor({ state: "detached" })

    await editBtn.click()
    await editor.waitFor({ state: "visible" })
    for (const [label, val] of expected) {
      assert.equal(
        await editor.getByLabel(label, { exact: true }).inputValue(),
        val,
        `1024x768: ${label} did not persist`,
      )
    }
    await context.close()
  }

  // UI-13 & UI-12 collapsed chip + expanded >=12px at 320x640, plus 640x400 DPR 2 zero overflow
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await dismissToastIfPresent(page)

    const check320 = await page.evaluate(() => {
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth
      const search = document.querySelector("input[placeholder]")
      const searchRect = search?.getBoundingClientRect()
      const placeholder = search?.getAttribute("placeholder") ?? ""
      const waitBtn = document.querySelector('button[aria-label^="Bàn chờ"]')
      const waitText = waitBtn?.innerText.replace(/\s+/g, " ").trim() ?? ""
      const toggle = document.querySelector('[data-testid="guest-count-toggle"]')
      const toggleRect = toggle?.getBoundingClientRect() ?? null
      const toggleFont = toggle ? parseFloat(getComputedStyle(toggle).fontSize) : 0
      return {
        overflowX,
        placeholder,
        searchWidth: searchRect?.width ?? 0,
        waitText,
        hasToggle: Boolean(toggle),
        toggleHeight: toggleRect?.height ?? 0,
        toggleFont,
      }
    })
    assert.equal(check320.overflowX, false, "320x640: horizontal overflow")
    assert.equal(check320.placeholder, "3 số cuối", `320x640: unexpected placeholder ${check320.placeholder}`)
    assert(check320.searchWidth >= 100, `320x640: search input too narrow (${check320.searchWidth})`)
    assert(check320.waitText.includes("Chờ"), `320x640: waitlist button missing "Chờ" (${check320.waitText})`)
    assert(check320.hasToggle, "320x640: GuestCountCard should be collapsed to toggle chip")
    assert(check320.toggleHeight >= 44, `320x640: toggle chip height ${check320.toggleHeight} < 44`)
    assert(check320.toggleFont >= 12, `320x640: toggle chip font ${check320.toggleFont} < 12`)

    await page.getByTestId("guest-count-toggle").click()
    await page.getByTestId("guest-count-collapse").waitFor({ state: "visible" })
    const minFont = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="guest-count-card"]')
      const spans = [...(card?.querySelectorAll("span, button") ?? [])]
      return Math.min(...spans.map((el) => parseFloat(getComputedStyle(el).fontSize)))
    })
    assert(minFont >= 12, `320x640: expanded GuestCountCard min font ${minFont} < 12px`)
    await page.getByTestId("guest-count-collapse").click()
    await page.getByTestId("guest-count-toggle").waitFor({ state: "visible" })
    await context.close()
  }

  {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await dismissToastIfPresent(page)
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    assert.equal(overflowX, false, "640x400: horizontal overflow")
    await context.close()
  }
}

const browser = await launchBrowser()
try {
  await verifyLoginPortals(browser)
  const { server, baseUrl } = await startVite("mock")
  try {
    await verifyBarBisectorAndHitResolution(browser, baseUrl)
    await verifyShellAndPanelCaps(browser, baseUrl)
    await verifyGuestCounterAndMobileTexts(browser, baseUrl)
  } finally {
    await server.close()
  }
  console.log("PASS na41-p1a UI-10..UI-15 + fix-round-1 verification")
} finally {
  await browser.close()
}
