// Playwright E2E verification & after-screenshot capture for PA UI/UX fixes (mock mode).
// Usage: node web/e2e/uiux-2026-11-25-pa.mjs [--capture-dir <path>]
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { chromium } from "@playwright/test"
import axe from "axe-core"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")

const { values: cliArgs } = parseArgs({
  options: { "capture-dir": { type: "string" } },
  strict: false,
})
const captureDir = cliArgs["capture-dir"] || process.env.PA_CAPTURE_DIR || ""
if (captureDir) fs.mkdirSync(captureDir, { recursive: true })

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

async function startVite(mode = "mock") {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = mode
  process.env.VITE_API_BASE_URL = ""
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
  })
  await server.listen()
  const addr = server.httpServer?.address()
  assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await server.close()
      if (prevMode === undefined) delete process.env.VITE_API_MODE
      else process.env.VITE_API_MODE = prevMode
      if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
      else process.env.VITE_API_BASE_URL = prevBase
    },
  }
}

async function waitSettle(page) {
  await page.evaluate(() =>
    Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(resolve, 2500))]),
  )
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    )
  })
  await page.waitForTimeout(120)
}

async function maybeShot(page, name) {
  if (!captureDir) return
  await page.screenshot({ path: path.join(captureDir, name), animations: "disabled", caret: "hide" })
}

async function runAxeSeriousCritical(page, label) {
  await page.evaluate(axe.source)
  const violations = await page.evaluate(async () => {
    const res = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "best-practice"],
    })
    return res.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      }))
  })
  assert.equal(violations.length, 0, `${label}: axe serious/critical violations: ${JSON.stringify(violations)}`)
}

async function measureScreen(page) {
  return page.evaluate(() => {
    const overflowX = document.documentElement.scrollWidth > window.innerWidth
    const mains = [...document.querySelectorAll("main")]
    const mainStats = mains.map((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { display: s.display, w: Math.round(r.width), h: Math.round(r.height) }
    })

    const smallHtmlFonts = []
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) continue
      if (el.closest(".sr-only, [aria-hidden='true'], svg")) continue
      const s = getComputedStyle(el)
      if (s.display === "none" || s.visibility !== "visible") continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      const hasDirectText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      if (!hasDirectText) continue
      const fs = parseFloat(s.fontSize)
      if (fs < 12) smallHtmlFonts.push({ tag: el.localName, text: el.innerText.slice(0, 40), fs })
    }

    const smallTargets = []
    if (window.innerWidth <= 1024) {
      for (const el of document.querySelectorAll(
        "button, a[href], input:not([type=hidden]), select, [role=button], [role=tab]",
      )) {
        if (el.hasAttribute("data-bar-guest-row")) continue
        if (el.closest("[inert]")) continue
        const s = getComputedStyle(el)
        if (s.display === "none" || s.visibility !== "visible") continue
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) continue
        if (r.width < 44 || r.height < 44) {
          smallTargets.push({
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          })
        }
      }
    }

    return { overflowX, mainCount: mains.length, mainStats, smallHtmlFonts, smallTargets }
  })
}

async function openContext(browser, userId, width, height, { reducedMotion = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width <= 1024,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  })
  await context.addInitScript((uid) => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
  }, userId)
  const page = await context.newPage()
  const errors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(err.message))
  return { context, page, errors }
}

const RECEPTION_VIEWPORTS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
]

async function verifyReceptionFloor(browser, baseUrl, summary) {
  for (const [w, h] of RECEPTION_VIEWPORTS) {
    const label = `receptionist /floor ${w}x${h}`
    const { context, page, errors } = await openContext(browser, 1, w, h)
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.getByTestId("guest-count-card").waitFor({ state: "visible" })
      await page.getByRole("button", { name: /^Bàn C1,/ }).waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, `receptionist-floor-busy-${w}x${h}.png`)

      // UX-01 + DS-01: Toast15 sits below header, never covers header, legend, GuestCountCard, or row C1/C2/C4
      const toastInfo = await page.evaluate(() => {
        const header = document.querySelector("header")
        const toast = document.querySelector(".gm-toast-banner")
        const menuBtn = document.querySelector('header button[aria-label^="Menu"]')
        const exportBtn = document.querySelector('header button[aria-label="Xuất text Zalo"]')
        const legendBtn = document.querySelector('button[aria-label^="Ký hiệu:"]')
        const guestCard = document.querySelector('[data-testid="guest-count-card"]')
        const c1 = document.querySelector('g[role="button"][aria-label^="Bàn C1,"]')
        const viewBtn = [...document.querySelectorAll(".gm-toast-banner button")].find(
          (b) => b.textContent?.trim() === "Xem",
        )
        const closeBtn = document.querySelector('button[aria-label="Đóng thông báo"]')

        const rect = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
        }
        const centerHit = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
          return {
            contains: Boolean(hit && (el.contains(hit) || hit.contains(el))),
            inToast: Boolean(hit && hit.closest(".gm-toast-banner")),
            hitTag: hit?.tagName ?? null,
          }
        }
        return {
          headerRect: rect(header),
          toastRect: rect(toast),
          toastBgPointer: toast ? getComputedStyle(toast).pointerEvents : null,
          toastBackdrop: toast ? getComputedStyle(toast).backdropFilter : null,
          viewRect: rect(viewBtn),
          viewPointer: viewBtn ? getComputedStyle(viewBtn).pointerEvents : null,
          closeRect: rect(closeBtn),
          closePointer: closeBtn ? getComputedStyle(closeBtn).pointerEvents : null,
          legendRect: rect(legendBtn),
          guestCardRect: rect(guestCard),
          c1Rect: rect(c1),
          hits: {
            menu: centerHit(menuBtn),
            export: centerHit(exportBtn),
            legend: centerHit(legendBtn),
            guestCard: centerHit(guestCard),
            c1: centerHit(c1),
          },
        }
      })

      assert(toastInfo.toastRect && toastInfo.headerRect, `${label}: missing toast or header`)
      assert(
        toastInfo.toastRect.top >= toastInfo.headerRect.bottom - 1,
        `${label}: Toast15 top (${toastInfo.toastRect.top}) overlaps header bottom (${toastInfo.headerRect.bottom})`,
      )
      assert(
        toastInfo.toastRect.bottom <= toastInfo.legendRect.top + 1,
        `${label}: Toast15 bottom (${toastInfo.toastRect.bottom}) overlaps legend top (${toastInfo.legendRect.top})`,
      )
      assert(
        toastInfo.toastRect.bottom <= toastInfo.guestCardRect.top + 1,
        `${label}: Toast15 bottom (${toastInfo.toastRect.bottom}) overlaps GuestCountCard top (${toastInfo.guestCardRect.top})`,
      )
      assert(
        toastInfo.toastRect.bottom <= toastInfo.c1Rect.top + 1,
        `${label}: Toast15 bottom (${toastInfo.toastRect.bottom}) overlaps Bàn C1 top (${toastInfo.c1Rect.top})`,
      )
      for (const [key, hit] of Object.entries(toastInfo.hits)) {
        assert(hit?.contains && !hit.inToast, `${label}: elementFromPoint on ${key} failed: ${JSON.stringify(hit)}`)
      }
      assert.equal(toastInfo.toastBgPointer, "none", `${label}: Toast15 background should pass through pointer events`)
      assert.equal(toastInfo.viewPointer, "auto", `${label}: Xem button must accept pointer events`)
      assert.equal(toastInfo.closePointer, "auto", `${label}: Đóng button must accept pointer events`)
      assert(toastInfo.viewRect.width >= 44 && toastInfo.viewRect.height >= 44, `${label}: Xem button < 44px`)
      assert(toastInfo.closeRect.width >= 44 && toastInfo.closeRect.height >= 44, `${label}: Đóng button < 44px`)

      // UX-24: No backdrop-blur on floating reception controls
      const blurs = await page.evaluate(() => {
        const els = [
          document.querySelector('[data-testid="guest-count-card"] > button, [data-testid="guest-count-card"]'),
          document.querySelector('button[aria-label^="Ký hiệu:"]'),
          document.querySelector('button[aria-label="Chọn ngày kinh doanh"]'),
          document.querySelector('button[aria-label^="Bàn chờ,"]'),
          document.querySelector(".gm-toast-banner"),
        ].filter(Boolean)
        return els.map((el) => ({
          label: (el.getAttribute("aria-label") || el.getAttribute("data-testid") || el.className).slice(0, 40),
          backdrop: getComputedStyle(el).backdropFilter,
        }))
      })
      for (const item of blurs) {
        assert.equal(item.backdrop, "none", `${label}: unexpected backdrop-filter on ${item.label}: ${item.backdrop}`)
      }

      // UX-09: BarGuestList >= 12px and no clipped seat code or missing guest name
      const barStats = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="bar-guest-list"]')
        if (!list) return null
        const smallTexts = []
        for (const el of list.querySelectorAll("*")) {
          if (!(el instanceof HTMLElement)) continue
          if (el.closest(".sr-only")) continue
          const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
          if (!hasText) continue
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs < 12) smallTexts.push({ text: el.innerText, fs })
        }
        const rows = [...list.querySelectorAll("[data-bar-guest-row]")].map((row) => {
          const spans = [...row.querySelectorAll("span:not(.sr-only)")].filter((s) =>
            [...s.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()),
          )
          const codeEl = spans[0]
          const nameEl = row.querySelector("span.truncate")
          return {
            code: codeEl?.textContent?.trim() ?? "",
            codeOverflow: codeEl ? codeEl.scrollWidth > codeEl.clientWidth + 1 : false,
            name: nameEl?.textContent?.trim() ?? "",
            nameWidth: nameEl ? Math.round(nameEl.getBoundingClientRect().width) : 0,
          }
        })
        return { smallTexts, rows }
      })
      assert(barStats && barStats.rows.length > 0, `${label}: missing BarGuestList rows`)
      assert.deepEqual(barStats.smallTexts, [], `${label}: BarGuestList has <12px text`)
      for (const row of barStats.rows) {
        assert(/^(Bar|G)\d/.test(row.code), `${label}: invalid BarGuestList seat/group code "${row.code}"`)
        assert(!row.codeOverflow, `${label}: BarGuestList code "${row.code}" clipped`)
        assert(
          row.name.length > 0 && row.nameWidth >= 40,
          `${label}: BarGuestList guest name lost/squeezed: ${JSON.stringify(row)}`,
        )
      }

      // Landmarks, overflow, touch targets, small fonts
      const stats = await measureScreen(page)
      assert(!stats.overflowX, `${label}: horizontal overflow`)
      assert.equal(stats.mainCount, 1, `${label}: expected 1 <main>`)
      assert.notEqual(stats.mainStats[0].display, "contents", `${label}: <main> must not be display:contents`)
      assert(stats.mainStats[0].w > 0 && stats.mainStats[0].h > 0, `${label}: <main> has 0 box`)
      assert.deepEqual(stats.smallHtmlFonts, [], `${label}: HTML fonts < 12px: ${JSON.stringify(stats.smallHtmlFonts)}`)
      assert.deepEqual(stats.smallTargets, [], `${label}: touch targets < 44px: ${JSON.stringify(stats.smallTargets)}`)

      // Run axe on key viewports (including GuestCountCard UX-07)
      if ([320, 390, 820, 1024, 1440].includes(w)) {
        await runAxeSeriousCritical(page, label)
      }

      // Open StatusLegend while Toast15 is STILL visible (DS-01 + DS-02)
      if ([320, 390, 768, 1440].includes(w)) {
        await page.getByRole("button", { name: /^Ký hiệu:/ }).click()
        const dialog = page.getByRole("dialog", { name: "Chú giải ký hiệu" })
        await dialog.waitFor({ state: "visible" })
        await waitSettle(page)
        const legendStats = await dialog.evaluate((el) => {
          const labels = ["Trống", "Đã đặt", "Sắp tới", "Tới muộn", "Đã tới", "Sơ cua"]
          const items = labels.map((name) => {
            const span = [...el.querySelectorAll("span")].find((s) => s.textContent?.trim() === name)
            const fs = span ? parseFloat(getComputedStyle(span).fontSize) : 0
            return {
              name,
              fs,
              scrollW: span ? span.scrollWidth : 0,
              clientW: span ? span.clientWidth : 0,
            }
          })
          return { items }
        })
        for (const item of legendStats.items) {
          assert(item.fs >= 12, `${label} legend "${item.name}": font ${item.fs} < 12`)
          assert(
            item.clientW >= item.scrollW - 1,
            `${label} legend "${item.name}" truncated: ${item.clientW}/${item.scrollW}`,
          )
        }
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "detached" })
      }

      // Verify Toast15 does NOT auto-hide after 1.5s, and closes on click
      if (w === 390) {
        await page.waitForTimeout(1500)
        assert.equal(await page.locator(".gm-toast-banner").count(), 1, `${label}: Toast15 unexpectedly auto-hid`)
        await page.getByRole("button", { name: "Đóng thông báo", exact: true }).click()
        await page.locator(".gm-toast-banner").waitFor({ state: "detached" })

        // Focus-visible ring check on Tab
        await page.keyboard.press("Tab")
        const focusRing = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return null
          const s = getComputedStyle(el)
          return {
            tag: el.tagName,
            focusVisible: el.matches(":focus-visible"),
            outlineStyle: s.outlineStyle,
            outlineWidth: s.outlineWidth,
            boxShadow: s.boxShadow,
          }
        })
        assert(
          focusRing &&
            focusRing.focusVisible &&
            ((focusRing.outlineStyle !== "none" && parseFloat(focusRing.outlineWidth) > 0) ||
              (focusRing.boxShadow !== "none" && focusRing.boxShadow !== "")),
          `${label}: missing focus-visible indicator (${JSON.stringify(focusRing)})`,
        )
      }

      assert.deepEqual(errors, [], `${label}: console/page errors: ${errors.join("; ")}`)
      summary.push({ screen: label, overflowX: stats.overflowX, smallTargets: 0, smallFonts: 0, axe: 0 })
    } finally {
      await context.close()
    }
  }

  // DS-01 + DS-02 explicit 320x640 shots + reduced-motion toast close check
  {
    const { context, page, errors } = await openContext(browser, 1, 320, 640, { reducedMotion: true })
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.locator(".gm-toast-banner").waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, "A-reception-toast-overlap-320x640.png")

      await page.getByRole("button", { name: /^Ký hiệu:/ }).click()
      await page.getByRole("dialog", { name: "Chú giải ký hiệu" }).waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, "A-reception-legend-320x640.png")
      await page.keyboard.press("Escape")

      await page.getByRole("button", { name: "Đóng thông báo", exact: true }).click()
      await page.locator(".gm-toast-banner").waitFor({ state: "detached" })
      assert.deepEqual(errors, [], `320x640 reduced-motion errors: ${errors.join("; ")}`)
    } finally {
      await context.close()
    }
  }
}

async function verifyTableSheetAndQuickForm(browser, baseUrl, summary) {
  for (const [w, h] of [
    [320, 568],
    [390, 844],
    [820, 1180],
    [1440, 900],
  ]) {
    const label = `receptionist TableSheet+QuickForm ${w}x${h}`
    const { context, page, errors } = await openContext(browser, 1, w, h)
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: "Đóng thông báo", exact: true }).click()
      await page.locator(".gm-toast-banner").waitFor({ state: "detached" })

      // UX-04 + UX-19 (CallHistory): open B3 booked table sheet
      await page.getByRole("button", { name: /^Bàn B3,/ }).click()
      const sheet = page.locator('[data-mobile-table-sheet="true"]')
      await sheet.waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, `receptionist-floor-table-sheet-${w}x${h}.png`)

      const cancelBtn = sheet.getByRole("button", { name: "Hủy booking", exact: true })
      const callHistBtn = sheet.getByRole("button", { name: /^Lịch sử gọi/ })
      const chBox = await callHistBtn.boundingBox()
      assert(chBox && chBox.height >= 44, `${label}: Lịch sử gọi height ${chBox?.height} < 44`)

      const contrast = await cancelBtn.evaluate((el) => {
        const parse = (c) => c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]
        const s = getComputedStyle(el)
        const [fr, fg, fb] = parse(s.color)
        const [br, bg, bb, ba = 1] = parse(s.backgroundColor)
        // Composite over white #ffffff surface-1
        const cr = br * ba + 255 * (1 - ba)
        const cg = bg * ba + 255 * (1 - ba)
        const cb = bb * ba + 255 * (1 - ba)
        const lum = (r, g, b) => {
          const [lr, lg, lb] = [r, g, b].map((v) => {
            const x = v / 255
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
        }
        const l1 = lum(fr, fg, fb)
        const l2 = lum(cr, cg, cb)
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      })
      assert(contrast >= 4.5, `${label}: Hủy booking contrast ${contrast.toFixed(2)} < 4.5`)
      await runAxeSeriousCritical(page, `${label} TableSheet`)

      await sheet.getByRole("button", { name: "Đóng", exact: true }).click()
      await sheet.waitFor({ state: "detached" })

      // UX-19 QuickForm: open B5 booking form
      await page.getByRole("button", { name: /^Bàn B5,/ }).click()
      await sheet.waitFor({ state: "visible" })
      await sheet.getByRole("button", { name: "Đặt bàn", exact: true }).click()
      const form = page.getByRole("form", { name: "Tạo đặt bàn B5", exact: true })
      await form.waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, `receptionist-floor-booking-create-${w}x${h}.png`)

      const qfStats = await form.evaluate(() => {
        const guestBtns = [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].filter((b) =>
          /^\d khách$/.test(b.getAttribute("aria-label") || ""),
        )
        const dateBtn = [...document.querySelectorAll("button")].find((b) => /Hôm nay ·/.test(b.textContent || ""))
        return {
          guestDims: guestBtns.map((b) => {
            const r = b.getBoundingClientRect()
            return { label: b.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height) }
          }),
          dateH: dateBtn ? Math.round(dateBtn.getBoundingClientRect().height) : null,
        }
      })
      for (const g of qfStats.guestDims) {
        assert(g.w >= 44 && g.h >= 44, `${label} guest chip ${g.label}: ${g.w}x${g.h} < 44`)
      }
      if (qfStats.dateH !== null) {
        assert(qfStats.dateH >= 44, `${label} date toggle height ${qfStats.dateH} < 44`)
      }
      const mStats = await measureScreen(page)
      assert(!mStats.overflowX, `${label}: QuickForm horizontal overflow`)
      assert.deepEqual(errors, [], `${label}: console/page errors: ${errors.join("; ")}`)
      summary.push({ screen: label, contrast: Number(contrast.toFixed(2)), overflowX: false })
    } finally {
      await context.close()
    }
  }
}

async function verifyOwnerAndWaiter(browser, baseUrl, summary) {
  // Owner mobile /reservations (390x844): Toast15 below PlainHeader + single <main>
  {
    const label = "owner /reservations 390x844"
    const { context, page, errors } = await openContext(browser, 3, 390, 844)
    try {
      await page.goto(`${baseUrl}/reservations`, { waitUntil: "networkidle" })
      await waitSettle(page)
      await maybeShot(page, "owner-reservations-busy-390x844.png")

      const check = await page.evaluate(() => {
        const header = document.querySelector("header")
        const toast = document.querySelector(".gm-toast-banner")
        const seg = document.querySelector('[role="tablist"][aria-label="Kiểu xem"]')
        return {
          hBottom: header?.getBoundingClientRect().bottom ?? 0,
          tTop: toast?.getBoundingClientRect().top ?? 0,
          sBottom: seg?.getBoundingClientRect().bottom ?? 0,
        }
      })
      assert(check.tTop >= check.hBottom - 1, `${label}: Toast15 overlaps PlainHeader`)
      assert(check.tTop >= check.sBottom - 1, `${label}: Toast15 overlaps Danh sách/Thời gian toggle`)

      const stats = await measureScreen(page)
      assert.equal(stats.mainCount, 1, `${label}: expected 1 <main>`)
      assert.notEqual(stats.mainStats[0].display, "contents", `${label}: <main> must not be display:contents`)
      assert(!stats.overflowX, `${label}: horizontal overflow`)
      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, overflowX: false, mainCount: stats.mainCount })
    } finally {
      await context.close()
    }
  }

  // Owner /home & /overview mobile (390x844): single <main>, no duplicate banner on /overview
  for (const route of ["/home", "/overview"]) {
    const label = `owner ${route} 390x844`
    const { context, page, errors } = await openContext(browser, 3, 390, 844)
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" })
      await waitSettle(page)
      await maybeShot(page, `owner-${route.slice(1)}-busy-390x844.png`)
      const stats = await measureScreen(page)
      assert.equal(stats.mainCount, 1, `${label}: expected 1 <main>`)
      assert.notEqual(stats.mainStats[0].display, "contents", `${label}: <main> must not be display:contents`)
      assert(!stats.overflowX, `${label}: horizontal overflow`)
      if (route === "/overview") {
        // Verify axe does not report landmark-no-duplicate-banner
        await page.evaluate(axe.source)
        const bannerViolations = await page.evaluate(async () => {
          const res = await window.axe.run(document, { resultTypes: ["violations"] })
          return res.violations.filter((v) => v.id === "landmark-no-duplicate-banner" || v.id === "landmark-unique")
        })
        assert.equal(bannerViolations.length, 0, `${label}: duplicate banner violation`)
      }
      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, overflowX: false, mainCount: stats.mainCount })
    } finally {
      await context.close()
    }
  }

  // UX-19 tablet <= 1024: Owner /floor and /reservations at 820x1180 and 1024x768
  for (const [w, h] of [
    [820, 1180],
    [1024, 768],
  ]) {
    for (const route of ["/floor", "/reservations"]) {
      const label = `owner ${route} ${w}x${h}`
      const { context, page, errors } = await openContext(browser, 3, w, h)
      try {
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" })
        await waitSettle(page)
        if (route === "/reservations") await maybeShot(page, `owner-reservations-busy-${w}x${h}.png`)
        if (route === "/floor") {
          const tabHeights = await page.evaluate(() =>
            [...document.querySelectorAll('[role="tablist"][aria-label="Lọc khu"] [role="tab"]')].map((b) =>
              Math.round(b.getBoundingClientRect().height),
            ),
          )
          assert(tabHeights.length >= 4 && tabHeights.every((ht) => ht >= 44), `${label} zone tabs: ${tabHeights}`)
          const availBtn = page.getByRole("button", { name: "Xem khả dụng", exact: true })
          const availBox = await availBtn.boundingBox()
          assert(availBox && availBox.height >= 44, `${label} Xem khả dụng height ${availBox?.height} < 44`)
        } else {
          const chipHeights = await page.evaluate(() =>
            [...document.querySelectorAll('[role="tablist"][aria-label="Lọc trạng thái"] [role="tab"]')].map((b) =>
              Math.round(b.getBoundingClientRect().height),
            ),
          )
          assert(
            chipHeights.length >= 4 && chipHeights.every((ht) => ht >= 44),
            `${label} filter chips: ${chipHeights}`,
          )
        }
        assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      } finally {
        await context.close()
      }
    }
  }

  // UX-23: Waiter /phucvu Bar seat label does not overflow circle
  for (const [w, h] of [
    [390, 844],
    [1440, 900],
  ]) {
    const label = `waiter /phucvu ${w}x${h}`
    const { context, page, errors } = await openContext(browser, 6, w, h)
    try {
      await page.goto(`${baseUrl}/phucvu`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: /^Ghế Bar 1,/ }).waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, `waiter-phucvu-busy-${w}x${h}.png`)

      const barCheck = await page.evaluate(() => {
        const seats = [...document.querySelectorAll('svg[role="group"] g[role="button"][aria-label^="Ghế Bar "]')]
        return seats
          .filter((g) => g.querySelectorAll("text").length >= 2)
          .map((g) => {
            const circle = g.querySelector('circle:not([fill="transparent"]):not(.focus-ring)')
            const texts = [...g.querySelectorAll("text")]
            const sub = texts[1]
            return {
              aria: g.getAttribute("aria-label") ?? "",
              subText: sub.textContent?.trim() ?? "",
              subW: sub.getBoundingClientRect().width,
              circleW: circle ? circle.getBoundingClientRect().width : 0,
            }
          })
      })
      for (const s of barCheck) {
        assert(!s.subText.includes("đang gọi"), `${label}: bar seat still renders "đang gọi": ${JSON.stringify(s)}`)
        assert(s.subW <= s.circleW + 1, `${label}: bar seat text overflows circle: ${JSON.stringify(s)}`)
      }
      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, barSeatsChecked: barCheck.length })
    } finally {
      await context.close()
    }
  }
}

async function main() {
  const summary = []
  const vite = await startVite("mock")
  const browser = await launchBrowser()
  try {
    await verifyReceptionFloor(browser, vite.baseUrl, summary)
    await verifyTableSheetAndQuickForm(browser, vite.baseUrl, summary)
    await verifyOwnerAndWaiter(browser, vite.baseUrl, summary)
    console.log("PA E2E PASS:", JSON.stringify({ checked: summary.length, captureDir: captureDir || null }))
  } finally {
    await browser.close()
    await vite.close()
  }
}

await main()
