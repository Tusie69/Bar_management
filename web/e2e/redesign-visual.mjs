// Mock-mode Chromium evidence. Run from web/: node e2e/redesign-visual.mjs --base http://localhost:5190 --out e2e/.artifacts/redesign-before
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

export const viewports = [
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
]
export const fixedTime = "2026-11-17T14:30:00.000Z"
export const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}

export function args(defaultOut) {
  const result = { base: "http://localhost:5190", out: defaultOut }
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, "")
    assert(
      ["base", "out", "only", "before", "after"].includes(key) && process.argv[i + 1],
      `Invalid argument: ${process.argv[i]}`,
    )
    result[key] = process.argv[i + 1]
  }
  return result
}

export async function contextFor(browser, job, options = {}) {
  const context = await browser.newContext({
    viewport: { width: job.w, height: job.h },
    deviceScaleFactor: 1,
    isMobile: job.w < 768,
    hasTouch: job.w <= 1024,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    colorScheme: job.dark ? "dark" : "light",
    reducedMotion: "no-preference",
    ...options,
  })
  await context.addInitScript(
    ({ userId, dark }) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId, theme: dark ? "dark" : "light" }))
      let seed = 21
      Math.random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296
    },
    { userId: job.userId ?? (job.screen.startsWith("admin") ? 3 : 1), dark: job.dark },
  )
  return context
}

export async function settle(page) {
  await page.waitForLoadState("networkidle")
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  for (let i = 0; i < 4; i++) {
    const close = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if (!(await close.count())) break
    await close.first().click()
  }
}

export async function openTable(page, code = "C4") {
  await page
    .getByRole("button", { name: new RegExp(`^(Bàn )?${code}(?:,|\\s|$)`) })
    .first()
    .click()
  await expect(page.getByRole("dialog", { name: new RegExp(`Chi tiết.*${code}`) })).toBeVisible()
}

export async function openCreateAccount(page) {
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Tạo tài khoản", exact: true })).toBeVisible()
}

export async function prepare(page, job, base) {
  await page.clock.setFixedTime(new Date(fixedTime))
  await page.goto(new URL(job.url, base).href, { waitUntil: "networkidle" })
  await settle(page)
  assert.equal(
    await page.evaluate(async () => (await import("/src/services/index.ts")).api.mode),
    "mock",
    "Start the target Vite server with VITE_API_MODE=mock",
  )
  if (job.screen === "admin-login") {
    // Mock AuthBoundary bypasses login. Exercise its real anonymous branch without an HTTP backend.
    await page.evaluate(async () => {
      const { api } = await import("/src/services/index.ts")
      const { useSession } = await import("/src/state/session.ts")
      api.mode = "http"
      useSession.setState({ authStatus: "anonymous", portal: "admin", authError: null })
    })
    await expect(page.getByRole("heading", { name: "Đăng nhập Quản trị", exact: true })).toBeVisible()
  } else if (job.state === "drawer-open") {
    await page.getByTestId("admin-menu-trigger").click()
    await expect(page.getByTestId("admin-drawer-panel")).toBeVisible()
  } else if (job.state === "table-sheet") await openTable(page)
  else if (job.state === "create-sheet") {
    await page.getByRole("button", { name: "Tạo mới", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Tạo mới", exact: true })).toBeVisible()
  } else if (job.state === "waitlist") {
    await page.getByRole("button", { name: /^Bàn chờ,/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
  } else if (job.state === "booking-form") {
    await openTable(page)
    await page.getByRole("button", { name: "Đặt bàn", exact: true }).click()
    await expect(page.getByRole("button", { name: "Đóng form", exact: true })).toBeVisible()
  } else if (job.state === "guest-detail") {
    await openTable(page, "B4")
    await page.getByRole("button", { name: "Xem booking", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
  } else if (job.state === "guest-counter-edit") {
    await page.getByRole("button", { name: "Sửa bộ đếm khách", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
  } else if (job.state === "account-sheet") {
    await page.getByRole("button", { name: "Menu", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Tài khoản", exact: true })).toBeVisible()
  } else if (job.state === "create") await openCreateAccount(page)
  else if (job.state === "password") {
    await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).first().click()
    await expect(page.getByTestId("admin-password-dialog")).toBeVisible()
  } else if (job.state === "detail") {
    await page.getByRole("button", { name: "Xem", exact: true }).first().click()
    await expect(page.getByTestId("admin-account-detail-dialog")).toBeVisible()
  } else if (job.state === "merge-confirm") {
    await page.getByTestId("turns-dup-merge-btn").click()
    await expect(page.getByTestId("turns-dup-merge-dialog")).toBeVisible()
  } else if (job.state === "anonymous-assign") {
    await page.getByTestId("turns-anon-phone-input").fill("0987654321")
    await page.getByTestId("turns-anon-submit-btn").click()
    await expect(page.getByTestId("turns-anon-name-input")).toBeVisible()
    await page.getByTestId("turns-anon-name-input").fill("Khách kiểm tra giao diện")
    await page.getByTestId("turns-anon-card").scrollIntoViewIfNeeded()
  }
  await settle(page)
}

export function jobs() {
  const result = []
  for (const [w, h] of viewports) {
    for (const page of ["overview", "visits", "accounts", "audit", "reports", "login"])
      result.push({ screen: `admin-${page}`, state: "default", url: `/admin/${page}`, w, h })
    for (const dark of [false, true])
      result.push({ screen: "reception-floor", state: "default", url: "/floor", w, h, dark })
    if (w <= 820) result.push({ screen: "admin-overview", state: "drawer-open", url: "/admin/overview", w, h })
    if ([375, 390].includes(w))
      for (const state of [
        "table-sheet",
        "create-sheet",
        "waitlist",
        "booking-form",
        "guest-detail",
        "guest-counter-edit",
        "account-sheet",
      ]) {
        // CreateSheet has no receptionist trigger in BEFORE; the existing owner phone navigation exposes it.
        result.push({ screen: "reception-floor", state, url: "/floor", w, h, userId: state === "create-sheet" ? 3 : 1 })
      }
    if ([390, 1440].includes(w)) {
      for (const state of ["create", "password", "detail"])
        result.push({ screen: "admin-accounts", state, url: "/admin/accounts", w, h })
      for (const state of ["merge-confirm", "anonymous-assign"])
        result.push({ screen: "admin-visits", state, url: "/admin/visits", w, h })
    }
  }
  assert.equal(result.length, 101)
  assert.equal(new Set(result.map(shotName)).size, result.length)
  return result
}

export function shotName(job, full = false) {
  return `${job.screen}__${job.state}${full ? "-full" : ""}__${job.w}x${job.h}${job.dark ? "__dark" : ""}`
}

export async function layoutMetrics(page, touch) {
  return page.evaluate((touch) => {
    const root = document.documentElement
    const visible = (el) => {
      if (el.closest(".sr-only")) return false
      const r = el.getBoundingClientRect(),
        s = getComputedStyle(el)
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth &&
        s.visibility !== "hidden" &&
        s.display !== "none" &&
        s.clip !== "rect(0px, 0px, 0px, 0px)" &&
        s.clipPath !== "inset(50%)" &&
        Number(s.opacity) > 0
      )
    }
    const identify = (el) => ({
      tag: el.tagName.toLowerCase(),
      testId: el.getAttribute("data-testid"),
      label: el.getAttribute("aria-label"),
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
    })
    const rect = (r) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
    })
    const clipping = (el) => {
      let right = innerWidth,
        left = 0,
        top = 0,
        bottom = innerHeight,
        ancestor = "viewport"
      for (let p = el; p; p = p.parentElement) {
        // Fixed shells leave body/html at zero height; the root scrollport clips to the viewport, not that box.
        if (p === document.body || p === document.documentElement) continue
        const s = getComputedStyle(p),
          r = p.getBoundingClientRect()
        if (/(hidden|clip|scroll|auto)/.test(s.overflowX)) {
          if (r.right < right) {
            right = r.right
            ancestor = p.getAttribute("data-testid") ?? p.tagName.toLowerCase()
          }
          left = Math.max(left, r.left)
        }
        if (/(hidden|clip|scroll|auto)/.test(s.overflowY)) {
          top = Math.max(top, r.top)
          bottom = Math.min(bottom, r.bottom)
        }
      }
      return { right, left, top, bottom, ancestor }
    }
    const texts = [],
      clippedText = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode,
        el = node.parentElement
      if (!node.textContent.trim() || !el || !visible(el) || el.closest('script,style,[aria-hidden="true"]')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const clip = clipping(el)
      for (const r of range.getClientRects()) {
        if (r.bottom <= clip.top || r.top >= clip.bottom || r.right <= clip.left || r.left >= clip.right) continue
        const item = { ...identify(el), text: node.textContent.trim().slice(0, 120), rect: rect(r) }
        if (r.right > clip.right + 1)
          clippedText.push({
            ...item,
            clippingAncestor: clip.ancestor,
            clippingRight: clip.right,
            intentionalEllipsis: getComputedStyle(el).textOverflow === "ellipsis",
          })
        texts.push({ el, r, item })
      }
    }
    const textOverlaps = []
    // Best effort: intersect independently rendered text rectangles, ignoring ancestor pairs and subpixel contact.
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i],
          b = texts[j]
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
        const width = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
        const height = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
        if (width > 2 && height > 2 && width * height > 16) textOverlaps.push({ a: a.item, b: b.item })
      }
    const smallTargets = touch
      ? [
          ...document.querySelectorAll(
            'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="checkbox"],[role="radio"],[role="tab"]',
          ),
        ]
          .filter((el) => visible(el) && !el.closest('[inert],[aria-hidden="true"]'))
          .filter((el) => {
            const r = el.getBoundingClientRect(),
              c = clipping(el)
            return (
              r.right > c.left &&
              r.left < c.right &&
              r.top < c.bottom &&
              r.bottom > c.top &&
              (r.width < 43.9 || r.height < 43.9)
            )
          })
          .map((el) => ({
            ...identify(el),
            rect: rect(el.getBoundingClientRect()),
            disabled: el.matches(':disabled,[aria-disabled="true"]'),
          }))
      : []
    const innerScroll = [...document.querySelectorAll("*")]
      .filter(
        (el) =>
          visible(el) && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1,
      )
      .map((el) => ({
        ...identify(el),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        top: el.getBoundingClientRect().top,
      }))
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: root.scrollWidth > root.clientWidth,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      clippedText,
      smallTargets,
      textOverlaps,
      innerScroll,
    }
  }, touch)
}

async function capture(page, job, out, errors, full) {
  const name = shotName(job, full)
  const metrics = {
    job,
    capture: full ? "expanded-full-height" : "viewport",
    ...(await layoutMetrics(page, job.w <= 1024)),
    consoleErrors: [...errors],
  }
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full })
  await fs.writeFile(path.join(out, `${name}.json`), JSON.stringify(metrics, null, 2))
  return { name, ...metrics }
}

export async function visualMain() {
  const options = args("e2e/.artifacts/redesign-before/visual")
  const selected = jobs().filter(
    (job) => !options.only || job.screen === options.only || `${job.screen}:${job.state}` === options.only,
  )
  assert(selected.length, `Unknown screen: ${options.only}`)
  await fs.mkdir(options.out, { recursive: true })
  const browser = await chromium.launch(launchOptions)
  const results = [],
    failures = []
  try {
    const check = await browser.newPage({ viewport: { width: 200, height: 200 } })
    await check.setContent(
      "<style>body{margin:0;overflow:hidden}button{position:fixed;top:10px;left:10px;width:20px;height:20px}p{position:fixed;left:180px;top:50px;white-space:nowrap}</style><button>x</button><p>overflowing text</p>",
    )
    const metrics = await layoutMetrics(check, true)
    assert.equal(metrics.smallTargets.length, 1, "Detect fixed controls when body is zero height")
    assert(metrics.clippedText.length > 0, "Detect text exceeding the viewport")
    await check.close()
    for (const job of selected) {
      const context = await contextFor(browser, job)
      const page = await context.newPage(),
        errors = []
      page.on("pageerror", (error) => errors.push(String(error)))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      page.setDefaultTimeout(10000)
      try {
        await prepare(page, job, options.base)
        results.push(await capture(page, job, options.out, errors, false))
        for (let i = 0; i < 3; i++) {
          const current = page.viewportSize()
          const target = await page.evaluate(() => {
            let height = Math.max(innerHeight, document.documentElement.scrollHeight)
            for (const el of document.querySelectorAll("*")) {
              const s = getComputedStyle(el),
                r = el.getBoundingClientRect()
              if (r.width && r.height && /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1)
                height = Math.max(height, r.top + el.scrollHeight + Math.max(0, innerHeight - r.bottom))
            }
            return Math.min(6000, Math.ceil(height))
          })
          if (target <= current.height) break
          await page.setViewportSize({ width: job.w, height: target })
          await page.waitForTimeout(200)
        }
        results.push(await capture(page, job, options.out, errors, true))
        console.log(`PASS ${shotName(job)}`)
      } catch (error) {
        failures.push({ job, error: String(error), consoleErrors: errors })
        await page.screenshot({ path: path.join(options.out, `${shotName(job)}__FAILED.png`) }).catch(() => {})
        console.error(`FAIL ${shotName(job)} ${error}`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  await fs.writeFile(
    path.join(options.out, "manifest.json"),
    JSON.stringify({ fixedTime, browser: "Chromium emulation", options, results, failures }, null, 2),
  )
  console.log(JSON.stringify({ shots: results.length, failures: failures.length }))
  if (failures.length) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await visualMain()
