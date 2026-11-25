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
const FIXED_CLOCK_ISO = "2026-11-25T04:00:00Z"

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
  // Wait for FloorCanvas 320ms transform transition to finish if running
  await page.waitForTimeout(360)
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
        if (el.closest("[inert]")) continue
        if (el.closest("svg") && !el.hasAttribute("data-bar-guest-row")) continue
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
  await page.clock.install({ time: new Date(FIXED_CLOCK_ISO) })
  await page.clock.resume()
  const errors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(err.message))
  return { context, page, errors }
}

async function checkFocusIndicator(page, label) {
  const focusRing = await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const s = getComputedStyle(el)
    return {
      tag: el.tagName,
      aria: el.getAttribute("aria-label") || el.textContent?.trim() || "",
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
  return focusRing
}

async function closeToastAndAssertExitFrame(page, width, label, method = "enter") {
  const openRect = await page.locator(".gm-toast-banner").boundingBox()
  assert(openRect, `${label}: missing open toast rect before close`)

  const closeBtn = page.getByRole("button", { name: "Đóng thông báo", exact: true })
  if (method === "enter") {
    await closeBtn.focus()
    await page.keyboard.press("Enter")
  } else {
    await closeBtn.click()
  }

  // Sample immediately during exit animation (data-state="closed")
  const exitSample = await page.evaluate(() => {
    const el = document.querySelector(".gm-toast-banner")
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      state: el.getAttribute("data-state"),
      left: r.left,
      right: r.right,
      width: r.width,
      pointerEvents: getComputedStyle(el).pointerEvents,
    }
  })
  if (exitSample) {
    assert(
      exitSample.left >= 11 && exitSample.right <= width - 11,
      `${label}: Toast15 exit frame clipped/overflowed (${JSON.stringify(exitSample)}, viewport=${width})`,
    )
    assert(
      exitSample.width <= openRect.width + 1,
      `${label}: Toast15 exit frame grew wider (${exitSample.width} > ${openRect.width})`,
    )
    assert.equal(exitSample.pointerEvents, "none", `${label}: exiting toast must pass through pointers`)
  }
  await page.locator(".gm-toast-banner").waitFor({ state: "detached" })
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

      // PA-R01: FloorCanvas <g> keeps 320ms transition duration in normal motion
      const gTransition = await page.evaluate(() => {
        const g = document.querySelector('svg[role="group"] > g')
        return g ? getComputedStyle(g).transitionDuration : null
      })
      assert.equal(gTransition, "0.32s", `${label}: FloorCanvas transitionDuration must remain 0.32s`)

      // UX-01 + DS-01 + PA-R08: Toast15 sits below header, never covers controls or C4/C1/C2; strict elementFromPoint
      const toastInfo = await page.evaluate(() => {
        const header = document.querySelector("header")
        const toast = document.querySelector(".gm-toast-banner")
        const menuBtn = document.querySelector('header button[aria-label^="Menu"]')
        const searchInput = document.querySelector('header input[aria-label^="Tìm "]')
        const searchModeBtn = document.querySelector('header button[aria-label^="Chuyển sang tìm "]')
        const exportBtn = document.querySelector('header button[aria-label="Xuất text Zalo"]')
        const legendBtn = document.querySelector('button[aria-label^="Ký hiệu:"]')
        const guestCard = document.querySelector('[data-testid="guest-count-card"]')
        const dateBtn = document.querySelector('button[aria-label="Chọn ngày kinh doanh"]')
        const waitBtn = document.querySelector('button[aria-label^="Bàn chờ,"]')
        const c4 = document.querySelector('g[role="button"][aria-label^="Bàn C4,"]')
        const c1 = document.querySelector('g[role="button"][aria-label^="Bàn C1,"]')
        const c2 = document.querySelector('g[role="button"][aria-label^="Bàn C2,"]')
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
            contains: Boolean(hit && el.contains(hit)),
            inToast: Boolean(hit && hit.closest(".gm-toast-banner")),
            hitTag: hit?.tagName ?? null,
          }
        }
        return {
          headerRect: rect(header),
          toastRect: rect(toast),
          toastBgPointer: toast ? getComputedStyle(toast).pointerEvents : null,
          viewRect: rect(viewBtn),
          viewPointer: viewBtn ? getComputedStyle(viewBtn).pointerEvents : null,
          closeRect: rect(closeBtn),
          closePointer: closeBtn ? getComputedStyle(closeBtn).pointerEvents : null,
          legendRect: rect(legendBtn),
          guestCardRect: rect(guestCard),
          c4Rect: rect(c4),
          c1Rect: rect(c1),
          c2Rect: rect(c2),
          hits: {
            menu: centerHit(menuBtn),
            search: centerHit(searchInput),
            searchMode: centerHit(searchModeBtn),
            export: centerHit(exportBtn),
            legend: centerHit(legendBtn),
            guestCard: centerHit(guestCard),
            date: centerHit(dateBtn),
            wait: centerHit(waitBtn),
            c4: centerHit(c4),
            c1: centerHit(c1),
            c2: centerHit(c2),
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
      for (const [tName, tRect] of [
        ["C4", toastInfo.c4Rect],
        ["C1", toastInfo.c1Rect],
        ["C2", toastInfo.c2Rect],
      ]) {
        assert(tRect, `${label}: missing Bàn ${tName}`)
        assert(
          toastInfo.toastRect.bottom <= tRect.top + 1,
          `${label}: Toast15 bottom (${toastInfo.toastRect.bottom}) overlaps Bàn ${tName} top (${tRect.top})`,
        )
      }
      for (const [key, hit] of Object.entries(toastInfo.hits)) {
        assert(
          hit?.contains && !hit.inToast,
          `${label}: strict elementFromPoint on ${key} failed: ${JSON.stringify(hit)}`,
        )
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

      // UX-09 + PA-R03 + PA-R04: BarGuestList scroll to every row, full name/code without clipping, >= 44px button, non-overlapping hits
      const rowCount = await page.locator('[data-testid="bar-guest-list"] [data-bar-guest-row]').count()
      assert(rowCount >= 5, `${label}: expected >= 5 BarGuestList rows, got ${rowCount}`)
      const barRowsInfo = []
      for (let idx = 0; idx < rowCount; idx++) {
        const rowLoc = page.locator('[data-testid="bar-guest-list"] [data-bar-guest-row]').nth(idx)
        await rowLoc.evaluate((el) => el.scrollIntoView({ block: "nearest" }))
        const info = await rowLoc.evaluate((row) => {
          const r = row.getBoundingClientRect()
          const smallTexts = []
          for (const el of row.querySelectorAll("*")) {
            if (!(el instanceof HTMLElement) || el.closest(".sr-only")) continue
            const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            if (!hasText) continue
            const fs = parseFloat(getComputedStyle(el).fontSize)
            if (fs < 12) smallTexts.push({ text: el.innerText, fs })
          }
          const spans = [...row.querySelectorAll("span:not(.sr-only)")].filter((s) =>
            [...s.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()),
          )
          const codeEl = spans[0]
          const nameEl = row.querySelector("span[title]")
          const nameStyle = nameEl ? getComputedStyle(nameEl) : null
          const cx = (r.left + r.right) / 2
          const midHit = document.elementFromPoint(cx, (r.top + r.bottom) / 2)
          const topHit = document.elementFromPoint(cx, r.top + 4)
          const botHit = document.elementFromPoint(cx, r.bottom - 4)
          return {
            tag: row.tagName,
            w: r.width,
            h: r.height,
            top: r.top,
            bottom: r.bottom,
            smallTexts,
            code: codeEl?.textContent?.trim() ?? "",
            codeOverflow: codeEl ? codeEl.scrollWidth > codeEl.clientWidth + 1 : false,
            name: nameEl?.textContent?.trim() ?? "",
            nameOverflow: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 1 : false,
            nameTextOverflow: nameStyle?.textOverflow ?? "",
            hitsOk:
              Boolean(midHit && row.contains(midHit)) &&
              Boolean(topHit && row.contains(topHit)) &&
              Boolean(botHit && row.contains(botHit)),
          }
        })
        assert.deepEqual(info.smallTexts, [], `${label} row[${idx}]: <12px text`)
        assert(/^(Bar|G)\d/.test(info.code), `${label} row[${idx}]: invalid code "${info.code}"`)
        assert(!info.codeOverflow, `${label} row[${idx}]: code "${info.code}" clipped`)
        assert(info.name.length > 0, `${label} row[${idx}]: missing guest name`)
        assert(!info.nameOverflow, `${label} row[${idx}]: guest name clipped horizontally: ${JSON.stringify(info)}`)
        assert.notEqual(info.nameTextOverflow, "ellipsis", `${label} row[${idx}]: guest name uses ellipsis`)
        if (w <= 1024) {
          assert(info.w >= 44 && info.h >= 44, `${label} row[${idx}]: ${info.w.toFixed(1)}x${info.h.toFixed(1)} < 44`)
          assert(info.hitsOk, `${label} row[${idx}]: center/edge hit failed: ${JSON.stringify(info)}`)
        }
        barRowsInfo.push(info)
      }
      // Verify consecutive bar rows do not overlap vertically at the same scroll position
      const verticalOverlap = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="bar-guest-list"] [data-bar-guest-row]')]
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1].getBoundingClientRect()
          const cur = rows[i].getBoundingClientRect()
          if (prev.bottom > cur.top + 0.5) {
            return { i, prevBottom: prev.bottom, curTop: cur.top }
          }
        }
        return null
      })
      assert.equal(verticalOverlap, null, `${label}: bar rows overlap vertically: ${JSON.stringify(verticalOverlap)}`)

      // Landmarks, overflow, touch targets, small fonts (now includes [data-bar-guest-row]!)
      const stats = await measureScreen(page)
      assert(!stats.overflowX, `${label}: horizontal overflow`)
      assert.equal(stats.mainCount, 1, `${label}: expected 1 <main>`)
      assert.notEqual(stats.mainStats[0].display, "contents", `${label}: <main> must not be display:contents`)
      assert(stats.mainStats[0].w > 0 && stats.mainStats[0].h > 0, `${label}: <main> has 0 box`)
      assert.deepEqual(stats.smallHtmlFonts, [], `${label}: HTML fonts < 12px: ${JSON.stringify(stats.smallHtmlFonts)}`)
      assert.deepEqual(stats.smallTargets, [], `${label}: touch targets < 44px: ${JSON.stringify(stats.smallTargets)}`)

      // Run axe on key viewports (including GuestCountCard UX-07)
      let axeStatus = "not-run"
      if ([320, 390, 820, 1024, 1440].includes(w)) {
        await runAxeSeriousCritical(page, label)
        axeStatus = "0-serious-critical"
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

      // Toast15 exit frame check at 320 / 1440 via Enter
      if (w === 320 || w === 1440) {
        await closeToastAndAssertExitFrame(page, w, label, "enter")
      }

      // At 390x844: Toast15 does NOT auto-hide after 1.5s, Tab/Shift+Tab between Xem & Đóng, Space on Xem opens target, tap Bar row opens sheet
      if (w === 390) {
        await page.waitForTimeout(1500)
        assert.equal(await page.locator(".gm-toast-banner").count(), 1, `${label}: Toast15 unexpectedly auto-hid`)

        const viewBtn = page.locator(".gm-toast-banner").getByRole("button", { name: "Xem", exact: true })
        await viewBtn.focus()
        const f1 = await checkFocusIndicator(page, `${label} Xem`)
        assert.equal(f1.aria, "Xem")

        await page.keyboard.press("Tab")
        const f2 = await checkFocusIndicator(page, `${label} Đóng`)
        assert.equal(f2.aria, "Đóng thông báo")

        await page.keyboard.press("Shift+Tab")
        const f3 = await checkFocusIndicator(page, `${label} Shift+Tab back to Xem`)
        assert.equal(f3.aria, "Xem")

        // Space on Xem opens TableSheet for B3 and marks toast handled
        await page.keyboard.press("Space")
        const sheet = page.locator('[data-mobile-table-sheet="true"]')
        await sheet.waitFor({ state: "visible" })
        await page.locator(".gm-toast-banner").waitFor({ state: "detached" })
        await sheet.getByRole("button", { name: "Đóng", exact: true }).click()
        await sheet.waitFor({ state: "detached" })

        // Tap a BarGuestList row opens its TableSheet
        const firstBarRow = page.locator('[data-testid="bar-guest-list"] [data-bar-guest-row]').first()
        await firstBarRow.scrollIntoViewIfNeeded()
        await firstBarRow.click()
        await sheet.waitFor({ state: "visible" })
        const sheetHeading = await sheet.locator("h2").textContent()
        assert(
          sheetHeading && /Bar|Ghế Bar/.test(sheetHeading),
          `${label}: BarGuestList click opened wrong sheet: ${sheetHeading}`,
        )
        await sheet.getByRole("button", { name: "Đóng", exact: true }).click()
        await sheet.waitFor({ state: "detached" })
      }

      assert.deepEqual(errors, [], `${label}: console/page errors: ${errors.join("; ")}`)
      summary.push({
        screen: label,
        overflowX: stats.overflowX,
        smallTargets: stats.smallTargets.length,
        smallFonts: stats.smallHtmlFonts.length,
        barRows: barRowsInfo.length,
        minBarRowH: Math.round(Math.min(...barRowsInfo.map((r) => r.h)) * 10) / 10,
        axe: axeStatus,
      })
    } finally {
      await context.close()
    }
  }

  // DS-01 + DS-02 explicit 320x640 shots + reduced-motion FloorCanvas & Toast15 exit frame check
  {
    const { context, page, errors } = await openContext(browser, 1, 320, 640, { reducedMotion: true })
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.locator(".gm-toast-banner").waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, "A-reception-toast-overlap-320x640.png")

      // PA-R01 reduced-motion check
      const gTransition = await page.evaluate(() => {
        const g = document.querySelector('svg[role="group"] > g')
        return g ? getComputedStyle(g).transitionProperty : null
      })
      assert.equal(gTransition, "none", "320x640 reduced-motion: FloorCanvas transitionProperty must be none")

      await page.getByRole("button", { name: /^Ký hiệu:/ }).click()
      await page.getByRole("dialog", { name: "Chú giải ký hiệu" }).waitFor({ state: "visible" })
      await waitSettle(page)
      await maybeShot(page, "A-reception-legend-320x640.png")
      await page.keyboard.press("Escape")

      await closeToastAndAssertExitFrame(page, 320, "320x640 reduced-motion", "enter")
      assert.deepEqual(errors, [], `320x640 reduced-motion errors: ${errors.join("; ")}`)
      summary.push({ screen: "receptionist 320x640 reduced-motion", axe: "not-run" })
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
      await waitSettle(page)
      await closeToastAndAssertExitFrame(page, w, label, w === 390 ? "enter" : "click")

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
      summary.push({
        screen: label,
        contrast: Number(contrast.toFixed(2)),
        overflowX: false,
        axe: "0-serious-critical",
      })
    } finally {
      await context.close()
    }
  }
}

async function verifyToastTabSwitchPersistence(browser, baseUrl, summary) {
  // PA-R02: Toast15 must NOT remount or replay gm-toast-in across tab switches (Owner & Cashier at 390x844)
  for (const [roleName, userId] of [
    ["owner", 3],
    ["cashier", 5],
  ]) {
    const label = `${roleName} tab-switch Toast15 390x844`
    const { context, page, errors } = await openContext(browser, userId, 390, 844)
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.locator(".gm-toast-banner").waitFor({ state: "visible" })
      await waitSettle(page)

      const initialAnims = await page.evaluate(() => {
        const el = document.querySelector(".gm-toast-banner")
        window.__paToastRef = el
        return el ? el.getAnimations().map((a) => [a.animationName, a.playState]) : []
      })
      assert(initialAnims.some(([name, state]) => name === "gm-toast-in" && state === "finished"))

      // Switch Sơ đồ -> Danh sách
      await page
        .getByRole("navigation", { name: "Điều hướng chính" })
        .getByRole("button", { name: "Danh sách" })
        .click()
      await page.waitForURL("**/reservations")
      await page.getByRole("heading", { name: "Danh sách", level: 1 }).waitFor({ state: "visible" })
      await page.waitForTimeout(80)
      const listCheck = await page.evaluate(() => {
        const el = document.querySelector(".gm-toast-banner")
        const header = document.querySelector("header")
        const seg = document.querySelector('[role="tablist"][aria-label="Kiểu xem"]')
        return {
          same: el === window.__paToastRef,
          anims: el ? el.getAnimations().map((a) => [a.animationName, a.playState]) : [],
          tTop: el?.getBoundingClientRect().top ?? 0,
          hBottom: header?.getBoundingClientRect().bottom ?? 0,
          sBottom: seg?.getBoundingClientRect().bottom ?? 0,
        }
      })
      assert(listCheck.same, `${label} -> Danh sách: Toast15 remounted (${JSON.stringify(listCheck)})`)
      assert(
        !listCheck.anims.some(([name, state]) => name === "gm-toast-in" && state === "running"),
        `${label} -> Danh sách: gm-toast-in replayed (${JSON.stringify(listCheck.anims)})`,
      )
      assert(listCheck.tTop >= listCheck.hBottom - 1 && listCheck.tTop >= listCheck.sBottom - 1)

      // Switch Danh sách -> Đơn chờ
      await page
        .getByRole("navigation", { name: "Điều hướng chính" })
        .getByRole("button", { name: /^Đơn chờ/ })
        .click()
      await page.waitForURL("**/waitlist")
      await page.getByRole("heading", { name: "Đơn chờ", level: 1 }).waitFor({ state: "visible" })
      await page.waitForTimeout(80)
      const waitCheck = await page.evaluate(() => {
        const el = document.querySelector(".gm-toast-banner")
        const header = document.querySelector("header")
        return {
          same: el === window.__paToastRef,
          anims: el ? el.getAnimations().map((a) => [a.animationName, a.playState]) : [],
          tTop: el?.getBoundingClientRect().top ?? 0,
          hBottom: header?.getBoundingClientRect().bottom ?? 0,
        }
      })
      assert(waitCheck.same, `${label} -> Đơn chờ: Toast15 remounted (${JSON.stringify(waitCheck)})`)
      assert(
        !waitCheck.anims.some(([name, state]) => name === "gm-toast-in" && state === "running"),
        `${label} -> Đơn chờ: gm-toast-in replayed (${JSON.stringify(waitCheck.anims)})`,
      )
      assert(waitCheck.tTop >= waitCheck.hBottom - 1)

      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, toastSameInstance: true, axe: "not-run" })
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
      summary.push({ screen: label, overflowX: false, mainCount: stats.mainCount, axe: "not-run" })
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
      let axeStatus = "not-run"
      if (route === "/overview") {
        await page.evaluate(axe.source)
        const bannerViolations = await page.evaluate(async () => {
          const res = await window.axe.run(document, { resultTypes: ["violations"] })
          return res.violations.filter((v) => v.id === "landmark-no-duplicate-banner" || v.id === "landmark-unique")
        })
        assert.equal(bannerViolations.length, 0, `${label}: duplicate banner violation`)
        axeStatus = "landmark-rules-0"
      }
      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, overflowX: false, mainCount: stats.mainCount, axe: axeStatus })
    } finally {
      await context.close()
    }
  }

  // UX-19 tablet <= 1024: Owner /floor at 820x1180 and 1024x768 (reservations-page.tsx reverted to PC per PA-R05)
  for (const [w, h] of [
    [820, 1180],
    [1024, 768],
  ]) {
    const label = `owner /floor ${w}x${h}`
    const { context, page, errors } = await openContext(browser, 3, w, h)
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await waitSettle(page)
      const tabHeights = await page.evaluate(() =>
        [...document.querySelectorAll('[role="tablist"][aria-label="Lọc khu"] [role="tab"]')].map((b) =>
          Math.round(b.getBoundingClientRect().height),
        ),
      )
      assert(tabHeights.length >= 4 && tabHeights.every((ht) => ht >= 44), `${label} zone tabs: ${tabHeights}`)
      const availBtn = page.getByRole("button", { name: "Xem khả dụng", exact: true })
      const availBox = await availBtn.boundingBox()
      assert(availBox && availBox.height >= 44, `${label} Xem khả dụng height ${availBox?.height} < 44`)
      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, zoneTabs: tabHeights.length, axe: "not-run" })
    } finally {
      await context.close()
    }

    // Also capture owner /reservations tablet shots without asserting PC's legacy filter chip heights
    if (captureDir) {
      const { context: c2, page: p2, errors: e2 } = await openContext(browser, 3, w, h)
      try {
        await p2.goto(`${baseUrl}/reservations`, { waitUntil: "networkidle" })
        await waitSettle(p2)
        await maybeShot(p2, `owner-reservations-busy-${w}x${h}.png`)
        assert.deepEqual(e2, [], `owner /reservations ${w}x${h}: errors: ${e2.join("; ")}`)
      } finally {
        await c2.close()
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
      summary.push({ screen: label, barSeatsChecked: barCheck.length, axe: "not-run" })
    } finally {
      await context.close()
    }
  }
}

async function verifyHomeScrollToast(browser, baseUrl, summary) {
  // INT-R01: Owner (3) & Cashier (5) at 320x568, 390x844 (plus 390x844 reduced-motion):
  // Toast15 stays inside viewport when /home scrolls, single instance preserved across tab switches,
  // Hero header controls and scrolled content remain unobstructed and interactive.
  const cases = [
    ["owner", 3, 320, 568, false],
    ["owner", 3, 390, 844, false],
    ["cashier", 5, 320, 568, false],
    ["cashier", 5, 390, 844, false],
    ["owner", 3, 390, 844, true],
  ]
  for (const [roleName, userId, w, h, reducedMotion] of cases) {
    const label = `${roleName} /home scroll Toast15 ${w}x${h}${reducedMotion ? " reduced-motion" : ""}`
    const homeLabel = roleName === "owner" ? "Tổng quan" : "Tiếp đón"
    const { context, page, errors } = await openContext(browser, userId, w, h, { reducedMotion })
    try {
      await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
      await page.locator(".gm-toast-banner").waitFor({ state: "visible" })
      await waitSettle(page)
      await page.evaluate(() => {
        window.__paHomeToastRef = document.querySelector(".gm-toast-banner")
      })

      // Switch /floor -> /home while Toast15 is open
      await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: homeLabel }).click()
      await page.waitForURL("**/home")
      await page.getByRole("heading", { name: homeLabel, level: 1 }).waitFor({ state: "visible" })
      await waitSettle(page)

      const measureHomeToast = () =>
        page.evaluate(() => {
          const scroller = document.querySelector("[data-scroll]")
          const banner = document.querySelector(".gm-toast-banner")
          const viewBtn = [...document.querySelectorAll(".gm-toast-banner button")].find(
            (b) => b.textContent?.trim() === "Xem",
          )
          const closeBtn = document.querySelector('button[aria-label="Đóng thông báo"]')
          const accountBtn = document.querySelector('button[aria-label^="Tài khoản và giao diện"]')
          const bellBtn = document.querySelector('button[aria-label^="Thông báo,"]')
          const hit = (el) => {
            if (!el) return false
            const r = el.getBoundingClientRect()
            if (r.width <= 0 || r.height <= 0) return false
            const pt = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
            return Boolean(pt && el.contains(pt))
          }
          const br = banner?.getBoundingClientRect()
          const ar = accountBtn?.getBoundingClientRect()
          return {
            sameInstance: banner === window.__paHomeToastRef,
            scrollTop: scroller ? Math.round(scroller.scrollTop) : -1,
            scrollHeight: scroller ? scroller.scrollHeight : 0,
            clientHeight: scroller ? scroller.clientHeight : 0,
            bannerTop: br?.top ?? -999,
            bannerBottom: br?.bottom ?? 9999,
            accountTop: ar?.top ?? -999,
            viewHit: hit(viewBtn),
            closeHit: hit(closeBtn),
            accountHit: hit(accountBtn),
            bellHit: hit(bellBtn),
            anims: banner ? banner.getAnimations().map((a) => [a.animationName, a.playState]) : [],
          }
        })

      const atTop = await measureHomeToast()
      assert(atTop.sameInstance, `${label}: Toast15 remounted entering /home`)
      assert(
        atTop.bannerTop >= 0 && atTop.bannerBottom <= h,
        `${label} scrollTop=0: banner out of viewport (${JSON.stringify(atTop)})`,
      )
      assert(atTop.accountTop >= atTop.bannerBottom - 1, `${label}: banner overlaps Hero account button`)
      assert(atTop.viewHit && atTop.closeHit, `${label} scrollTop=0: toast button hit-test failed`)
      assert(atTop.accountHit && atTop.bellHit, `${label} scrollTop=0: Hero header button hit-test failed`)

      // Scroll down 310px (Boss probe)
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-scroll]")
        if (scroller) scroller.scrollTop = 310
      })
      await page.waitForTimeout(80)
      if (roleName === "owner" && w === 390 && !reducedMotion) {
        await maybeShot(page, "owner-home-scrolled-390x844.png")
      }

      const scrolled = await measureHomeToast()
      assert(scrolled.scrollTop >= 200, `${label}: failed to scroll /home (${scrolled.scrollTop})`)
      assert(
        scrolled.bannerTop >= 0 && scrolled.bannerBottom <= h,
        `${label} scrollTop=${scrolled.scrollTop}: Toast15 left viewport (${JSON.stringify(scrolled)})`,
      )
      assert(
        scrolled.viewHit && scrolled.closeHit,
        `${label} scrollTop=${scrolled.scrollTop}: Xem/Đóng hit-test failed (${JSON.stringify(scrolled)})`,
      )

      // Tab / Shift+Tab / Space / Enter while scrolled
      const viewBtn = page.locator(".gm-toast-banner").getByRole("button", { name: "Xem", exact: true })
      await viewBtn.focus()
      await page.keyboard.press("Tab")
      const fClose = await checkFocusIndicator(page, `${label} scrolled Đóng`)
      assert.equal(fClose.aria, "Đóng thông báo")
      await page.keyboard.press("Shift+Tab")
      const fBack = await checkFocusIndicator(page, `${label} scrolled Shift+Tab Xem`)
      assert.equal(fBack.aria, "Xem")

      // Scroll back up to 0 and verify Hero header controls work again
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-scroll]")
        if (scroller) scroller.scrollTop = 0
      })
      await page.waitForTimeout(80)
      const backTop = await measureHomeToast()
      assert(backTop.accountHit && backTop.bellHit, `${label}: Hero header failed after scrolling back up`)

      // Switch tab while Toast15 is still open -> same instance preserved
      await page
        .getByRole("navigation", { name: "Điều hướng chính" })
        .getByRole("button", { name: "Danh sách" })
        .click()
      await page.waitForURL("**/reservations")
      await waitSettle(page)
      const afterSwitchSame = await page.evaluate(
        () => document.querySelector(".gm-toast-banner") === window.__paHomeToastRef,
      )
      assert(afterSwitchSame, `${label}: Toast15 remounted switching /home -> /reservations`)

      // Return to /home, scroll again, activate Space on Xem (owner 390) or Enter on Đóng (others)
      await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: homeLabel }).click()
      await page.waitForURL("**/home")
      await waitSettle(page)
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-scroll]")
        if (scroller) scroller.scrollTop = 310
      })
      await page.waitForTimeout(80)
      if (roleName === "owner" && w === 390 && !reducedMotion) {
        await viewBtn.focus()
        await page.keyboard.press("Space")
        await page.waitForURL("**/floor")
        await page.locator('[data-mobile-table-sheet="true"]').waitFor({ state: "visible" })
        await page.locator(".gm-toast-banner").waitFor({ state: "detached" })
      } else {
        await closeToastAndAssertExitFrame(page, w, label, "enter")
      }

      assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
      summary.push({ screen: label, toastStayInView: true, axe: "not-run" })
    } finally {
      await context.close()
    }
  }
}

async function verifyCashierAndOwnerMobileFloor(browser, baseUrl, summary) {
  // INT-R05: Cashier (5) and Owner (3) /floor at 320x568 and 390x844 with Toast15 open and closed
  for (const [roleName, userId] of [
    ["cashier", 5],
    ["owner", 3],
  ]) {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
    ]) {
      const label = `${roleName} /floor ${w}x${h}`
      const { context, page, errors } = await openContext(browser, userId, w, h)
      try {
        await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
        await page.getByRole("button", { name: /^Bàn C1,/ }).waitFor({ state: "visible" })
        await waitSettle(page)
        await maybeShot(page, `${roleName}-floor-busy-${w}x${h}.png`)

        const openStats = await page.evaluate(() => {
          const svg = document.querySelector('svg[role="group"]')
          const barBox = document.querySelector('[data-testid="bar-guest-list"]')
          const legendBtn = document.querySelector('button[aria-label^="Ký hiệu:"]')
          const c1 = document.querySelector('g[role="button"][aria-label^="Bàn C1,"]')
          const c2 = document.querySelector('g[role="button"][aria-label^="Bàn C2,"]')
          const hit = (el) => {
            if (!el) return false
            const r = el.getBoundingClientRect()
            const pt = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
            return Boolean(pt && el.contains(pt))
          }
          return {
            svgH: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
            barBoxW: barBox ? Math.round(barBox.getBoundingClientRect().width) : 0,
            legendHit: hit(legendBtn),
            c1Hit: hit(c1),
            c2Hit: hit(c2),
          }
        })
        const minSvgH = w === 320 ? 240 : 480
        assert(openStats.svgH >= minSvgH, `${label} (toast open): SVG height ${openStats.svgH}px < ${minSvgH}px`)
        assert(
          openStats.barBoxW >= (w === 320 ? (roleName === "cashier" ? 60 : 50) : 100),
          `${label} (toast open): Bar box width ${openStats.barBoxW}px too narrow`,
        )
        assert(
          openStats.legendHit && openStats.c1Hit && openStats.c2Hit,
          `${label}: hit-test failed: ${JSON.stringify(openStats)}`,
        )

        const mOpen = await measureScreen(page)
        assert(!mOpen.overflowX, `${label}: horizontal overflow`)
        assert.deepEqual(mOpen.smallTargets, [], `${label}: smallTargets ${JSON.stringify(mOpen.smallTargets)}`)
        const barSmallFonts = await page.evaluate(() => {
          const bad = []
          for (const el of document.querySelectorAll('[data-testid="bar-guest-list"] *')) {
            if (!(el instanceof HTMLElement) || el.closest(".sr-only")) continue
            const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            if (!hasText) continue
            const fs = parseFloat(getComputedStyle(el).fontSize)
            if (fs < 12) bad.push({ text: el.innerText.slice(0, 30), fs })
          }
          return bad
        })
        assert.deepEqual(barSmallFonts, [], `${label}: BarGuestList fonts < 12px: ${JSON.stringify(barSmallFonts)}`)

        // Open compact StatusLegend badge and verify all 6 status chips & labels >= 12px
        await page.getByRole("button", { name: /^Ký hiệu:/ }).click()
        const dialog = page.getByRole("dialog", { name: "Chú giải ký hiệu" })
        await dialog.waitFor({ state: "visible" })
        const legendLabels = await dialog.evaluate((el) =>
          ["Trống", "Đã đặt", "Sắp tới", "Tới muộn", "Đã tới", "Sơ cua"].every((txt) =>
            [...el.querySelectorAll("span")].some((s) => s.textContent?.trim() === txt),
          ),
        )
        assert(legendLabels, `${label}: StatusLegend dialog missing status labels`)
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "detached" })

        // Close Toast15 and verify floor expands + BarGuestList row tap works
        await closeToastAndAssertExitFrame(page, w, label, "click")
        await waitSettle(page)
        const closedSvgH = await page.evaluate(() =>
          Math.round(document.querySelector('svg[role="group"]')?.getBoundingClientRect().height ?? 0),
        )
        assert(
          closedSvgH > openStats.svgH,
          `${label}: closing toast did not expand SVG (${closedSvgH} <= ${openStats.svgH})`,
        )

        const firstBarRow = page.locator('[data-testid="bar-guest-list"] [data-bar-guest-row]').first()
        await firstBarRow.scrollIntoViewIfNeeded()
        const barRowBox = await firstBarRow.boundingBox()
        assert(barRowBox && barRowBox.height >= 44, `${label}: bar guest row < 44px`)
        await firstBarRow.click()
        const sheet = page.locator('[data-mobile-table-sheet="true"]')
        await sheet.waitFor({ state: "visible" })
        await sheet.getByRole("button", { name: "Đóng", exact: true }).click()
        await sheet.waitFor({ state: "detached" })

        assert.deepEqual(errors, [], `${label}: errors: ${errors.join("; ")}`)
        summary.push({
          screen: label,
          svgOpenH: openStats.svgH,
          svgClosedH: closedSvgH,
          barBoxW: openStats.barBoxW,
          axe: "not-run",
        })
      } finally {
        await context.close()
      }
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
    await verifyToastTabSwitchPersistence(browser, vite.baseUrl, summary)
    await verifyHomeScrollToast(browser, vite.baseUrl, summary)
    await verifyCashierAndOwnerMobileFloor(browser, vite.baseUrl, summary)
    await verifyOwnerAndWaiter(browser, vite.baseUrl, summary)
    console.log("PA E2E PASS:", JSON.stringify({ checked: summary.length, captureDir: captureDir || null, summary }))
  } finally {
    await browser.close()
    await vite.close()
  }
}

await main()
