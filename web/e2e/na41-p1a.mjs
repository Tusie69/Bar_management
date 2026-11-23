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

async function verifyFloorAndMobile(browser) {
  const { server, baseUrl } = await startVite("mock")
  try {
    // 1. UI-13 & UI-12 & no overflow at 320x640
    {
      const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
      })
      const page = await context.newPage()
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
      const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
      if ((await toastClose.count()) > 0) {
        await toastClose.click()
        await page.waitForTimeout(150)
      }

      const check320 = await page.evaluate(() => {
        const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth
        const search = document.querySelector("input[placeholder]")
        const searchRect = search?.getBoundingClientRect()
        const placeholder = search?.getAttribute("placeholder") ?? ""
        const waitBtn = document.querySelector('button[aria-label^="Bàn chờ"]')
        const waitText = waitBtn?.innerText.replace(/\s+/g, " ").trim() ?? ""
        const b21 = document.querySelector('[role="button"][aria-label^="Bàn B21"]')?.getBoundingClientRect() ?? null
        const waitRect = waitBtn?.getBoundingClientRect() ?? null
        const toggle = document.querySelector('[data-testid="guest-count-toggle"]')
        const toggleRect = toggle?.getBoundingClientRect() ?? null
        const toggleFont = toggle ? parseFloat(getComputedStyle(toggle).fontSize) : 0
        return {
          overflowX,
          placeholder,
          searchWidth: searchRect?.width ?? 0,
          waitText,
          waitRect: waitRect
            ? { left: waitRect.left, right: waitRect.right, top: waitRect.top, bottom: waitRect.bottom }
            : null,
          b21: b21 ? { left: b21.left, right: b21.right, top: b21.top, bottom: b21.bottom } : null,
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

      // Expand on tap and verify >= 12px text on all stat cells, then collapse
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

    // 2. 640x400 DPR 2 (200% zoom) zero horizontal scroll
    {
      const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
      })
      const page = await context.newPage()
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
      const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
      if ((await toastClose.count()) > 0) {
        await toastClose.click()
        await page.waitForTimeout(150)
      }
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      assert.equal(overflowX, false, "640x400: horizontal overflow")
      await context.close()
    }

    // 3. UI-10: >= 768px uses full available width, overlays anchored to edges & bounded
    for (const [w, h] of [
      [768, 1024],
      [820, 1180],
      [1024, 768],
      [1280, 600],
      [1440, 900],
    ]) {
      const context = await browser.newContext({ viewport: { width: w, height: h } })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
      })
      const page = await context.newPage()
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
      const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
      if ((await toastClose.count()) > 0) {
        await toastClose.click()
        await page.waitForTimeout(150)
      }
      const m = await page.evaluate(() => {
        const shell = document.querySelector("[data-gm]")?.getBoundingClientRect()
        const card = document.querySelector('[data-testid="guest-count-card"]')
        const cardRect = card?.getBoundingClientRect()
        const minCardFont = card
          ? Math.min(
              ...[...card.querySelectorAll("span, button")].map((el) => parseFloat(getComputedStyle(el).fontSize)),
            )
          : 0
        const waitBtn = document.querySelector('button[aria-label^="Bàn chờ"]')?.getBoundingClientRect()
        const searchInput = document.querySelector("input[placeholder]")?.getBoundingClientRect()
        return {
          vw: window.innerWidth,
          shellW: shell?.width ?? 0,
          cardLeft: cardRect?.left ?? -1,
          cardW: cardRect?.width ?? 0,
          minCardFont,
          waitRight: waitBtn?.right ?? 0,
          searchW: searchInput?.width ?? 0,
        }
      })
      assert(Math.abs(m.shellW - m.vw) <= 2, `${w}x${h}: shell width ${m.shellW} != viewport ${m.vw}`)
      assert(m.cardLeft <= 12, `${w}x${h}: GuestCountCard not anchored to left edge (${m.cardLeft})`)
      assert(m.cardW <= 320, `${w}x${h}: GuestCountCard stretched too wide (${m.cardW})`)
      assert(m.minCardFont >= 12, `${w}x${h}: GuestCountCard min font ${m.minCardFont} < 12px`)
      assert(
        m.vw - m.waitRight <= 16,
        `${w}x${h}: right controls not anchored to right edge (${m.waitRight} vs ${m.vw})`,
      )
      assert(m.searchW <= 460, `${w}x${h}: search bar stretched (${m.searchW})`)
      await context.close()
    }

    // 4. UI-11: smallest table/bar seat hit area >= 44x44 at 390x844 on BOTH /floor and /phucvu, nearest-pick works
    for (const check of [
      { userId: 1, route: "/floor" },
      { userId: 6, route: "/phucvu" },
    ]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
      await context.addInitScript((uid) => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
      }, check.userId)
      const page = await context.newPage()
      await page.goto(`${baseUrl}${check.route}`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /^Ghế Bar 5,/ }).waitFor({ state: "visible" })
      const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
      if ((await toastClose.count()) > 0) {
        await toastClose.click()
        await page.waitForTimeout(150)
      }

      const hitStats = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('svg[role="group"] g[role="button"]')]
        let minW = Infinity
        let minH = Infinity
        let smallestLabel = ""
        for (const el of btns) {
          const r = el.getBoundingClientRect()
          if (r.width < minW || r.height < minH) {
            minW = Math.min(minW, r.width)
            minH = Math.min(minH, r.height)
            smallestLabel = el.getAttribute("aria-label") ?? ""
          }
        }
        const bar5 = document.querySelector('g[role="button"][aria-label^="Ghế Bar 5,"]')
        const bar5Visual = bar5
          ?.querySelector('circle:not([fill="transparent"]):not(.focus-ring)')
          ?.getBoundingClientRect()
        return {
          count: btns.length,
          minW,
          minH,
          smallestLabel,
          bar5Visual: bar5Visual
            ? { left: bar5Visual.left, top: bar5Visual.top, width: bar5Visual.width, height: bar5Visual.height }
            : null,
        }
      })

      assert(hitStats.count >= 30, `${check.route}: expected >= 30 table/bar targets, got ${hitStats.count}`)
      assert(
        hitStats.minW >= 44,
        `${check.route}: smallest hit width ${hitStats.minW.toFixed(1)}px < 44px (${hitStats.smallestLabel})`,
      )
      assert(
        hitStats.minH >= 44,
        `${check.route}: smallest hit height ${hitStats.minH.toFixed(1)}px < 44px (${hitStats.smallestLabel})`,
      )

      // Tap inside the invisible outer hit area to the left of BAR05 visual circle (must select BAR05, not miss)
      assert(hitStats.bar5Visual, `${check.route}: missing BAR05 visual circle`)
      await page.mouse.click(hitStats.bar5Visual.left - 8, hitStats.bar5Visual.top + hitStats.bar5Visual.height / 2)
      await page.waitForFunction(
        () =>
          document.querySelector('g[role="button"][aria-label^="Ghế Bar 5,"]')?.getAttribute("aria-pressed") === "true",
      )
      await page.getByRole("dialog").waitFor({ state: "visible" })

      console.log(
        `PASS ${check.route} 390x844: ${hitStats.count} targets, min hit=${hitStats.minW.toFixed(1)}x${hitStats.minH.toFixed(1)}px`,
      )
      await context.close()
    }
  } finally {
    await server.close()
  }
}

const browser = await launchBrowser()
try {
  await verifyLoginPortals(browser)
  await verifyFloorAndMobile(browser)
  console.log("PASS na41-p1a UI-10..UI-15 verification")
} finally {
  await browser.close()
}
