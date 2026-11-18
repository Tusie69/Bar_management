// Reproducible Playwright verification & screenshot capture for Sprint 4 Reception UI Refinement (mock mode).
// Usage (from repo root): node web/e2e/reception-ui-refinement.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const outDir = process.env.RECEPTION_EVIDENCE_DIR || path.join(webRoot, "e2e", ".artifacts", "reception-ui-refinement")
fs.mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { width: 375, height: 812, label: "375x812" },
  { width: 390, height: 844, label: "390x844" },
  { width: 768, height: 1024, label: "768x1024" },
  { width: 820, height: 1180, label: "820x1180" },
  { width: 1024, height: 768, label: "1024x768" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1920, height: 1080, label: "1920x1080" },
]

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

async function startMockViteServer() {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = "mock"
  process.env.VITE_API_BASE_URL = ""
  const port = Number(process.env.PW_PORT || 5181)
  try {
    const server = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      server: { port, host: "127.0.0.1", strictPort: true, open: false },
    })
    await server.listen()
    const addr = server.httpServer?.address()
    assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` }
  } finally {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevBase
  }
}

const POPULATED_COUNTS = [
  { key: "arrivedBefore", label: "Trước 21:30", value: "123" },
  { key: "arrivedAfter", label: "Sau 21:30", value: "345" },
  { key: "arrivedTotal", label: "Tổng đã tới", value: "468" },
  { key: "bookedTables", label: "Tổng bàn đặt", value: "42" },
  { key: "bookedGuests", label: "Tổng khách đặt", value: "129" },
  { key: "returningGuests", label: "Đã từng đặt bàn", value: "99" },
]

const FOUR_DIGIT_COUNTS = [
  { key: "arrivedBefore", label: "Trước 21:30", value: "1234" },
  { key: "arrivedAfter", label: "Sau 21:30", value: "2345" },
  { key: "arrivedTotal", label: "Tổng đã tới", value: "3579" },
  { key: "bookedTables", label: "Tổng bàn đặt", value: "1024" },
  { key: "bookedGuests", label: "Tổng khách đặt", value: "1468" },
  { key: "returningGuests", label: "Đã từng đặt bàn", value: "1299" },
]

async function setAndVerifyGuestCounts(page, fields) {
  await page.getByRole("button", { name: "Sửa bộ đếm khách" }).click()
  const editor = page.getByTestId("guest-count-editor")
  await editor.waitFor({ state: "visible" })
  for (const f of fields) {
    await editor.getByLabel(f.label, { exact: true }).fill(f.value)
  }
  await page.getByRole("button", { name: "Lưu", exact: true }).click()
  await editor.waitFor({ state: "detached" })

  // Reopen to confirm all 6 persisted values
  await page.getByRole("button", { name: "Sửa bộ đếm khách" }).click()
  await editor.waitFor({ state: "visible" })
  for (const f of fields) {
    const val = await editor.getByLabel(f.label, { exact: true }).inputValue()
    assert.equal(val, f.value, `Counter reopen mismatch for ${f.label}: expected ${f.value}, got ${val}`)
  }
  await page.getByRole("button", { name: "Hủy", exact: true }).click()
  await editor.waitFor({ state: "detached" })
  await page.waitForTimeout(150)
}

async function assertGuestCounterLayout(page, vpLabel, fields) {
  const layout = await page.evaluate(
    (keys) => {
      const card = document.querySelector('[data-testid="guest-count-card"]')
      if (!card) return null
      const cardRect = card.getBoundingClientRect()
      const toBox = (r) => ({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      })
      const items = keys.map((key) => {
        const labelEl = card.querySelector(`[data-testid="guest-count-label-${key}"]`)
        const valueEl = card.querySelector(`[data-testid="guest-count-value-${key}"]`)
        const lr = labelEl?.getBoundingClientRect() ?? null
        const vr = valueEl?.getBoundingClientRect() ?? null
        return {
          key,
          text: valueEl?.textContent ?? "",
          labelClipped: labelEl ? labelEl.scrollWidth > labelEl.clientWidth + 0.5 : true,
          valueClipped: valueEl ? valueEl.scrollWidth > valueEl.clientWidth + 0.5 : true,
          labelRect: lr ? toBox(lr) : null,
          valueRect: vr ? toBox(vr) : null,
        }
      })
      const c4 = document.querySelector('[role="button"][aria-label^="Bàn C4"]')?.getBoundingClientRect() ?? null
      const b7 = document.querySelector('[role="button"][aria-label^="Bàn B7"]')?.getBoundingClientRect() ?? null
      return {
        cardRect: toBox(cardRect),
        items,
        c4: c4 ? toBox(c4) : null,
        b7: b7 ? toBox(b7) : null,
      }
    },
    fields.map((f) => f.key),
  )

  assert(layout, `${vpLabel}: guest-count-card missing`)
  const overlaps = (a, b, tol = 0.2) =>
    !(a.right <= b.left + tol || b.right <= a.left + tol || a.bottom <= b.top + tol || b.bottom <= a.top + tol)

  for (let i = 0; i < layout.items.length; i++) {
    const item = layout.items[i]
    const expected = fields[i]
    assert.equal(
      item.text,
      expected.value,
      `${vpLabel}: counter ${item.key} expected ${expected.value}, got ${item.text}`,
    )
    assert(!item.labelClipped, `${vpLabel}: label ${item.key} clipped`)
    assert(!item.valueClipped, `${vpLabel}: value ${item.key} (${item.text}) clipped`)
    assert(item.labelRect && item.valueRect, `${vpLabel}: missing rect for ${item.key}`)

    for (const [kind, r] of [
      ["label", item.labelRect],
      ["value", item.valueRect],
    ]) {
      assert(r.left >= layout.cardRect.left - 0.5, `${vpLabel}: ${item.key} ${kind} overflows card left`)
      assert(r.right <= layout.cardRect.right + 0.5, `${vpLabel}: ${item.key} ${kind} overflows card right`)
      assert(r.top >= layout.cardRect.top - 0.5, `${vpLabel}: ${item.key} ${kind} overflows card top`)
      assert(r.bottom <= layout.cardRect.bottom + 0.5, `${vpLabel}: ${item.key} ${kind} overflows card bottom`)
    }
    assert(!overlaps(item.labelRect, item.valueRect, 0), `${vpLabel}: ${item.key} label overlaps own value`)
  }

  // Check cross-column clearance for each of the 3 rows: (0 vs 3), (1 vs 4), (2 vs 5)
  const leftKeys = ["arrivedBefore", "arrivedAfter", "arrivedTotal"]
  const rightKeys = ["bookedTables", "bookedGuests", "returningGuests"]
  let minCrossColGap = Infinity
  for (let r = 0; r < 3; r++) {
    const leftItem = layout.items.find((it) => it.key === leftKeys[r])
    const rightItem = layout.items.find((it) => it.key === rightKeys[r])
    const leftRightEdge = Math.max(leftItem.labelRect.right, leftItem.valueRect.right)
    const rightLeftEdge = Math.min(rightItem.labelRect.left, rightItem.valueRect.left)
    const gap = rightLeftEdge - leftRightEdge
    minCrossColGap = Math.min(minCrossColGap, gap)
    assert(
      gap >= 2,
      `${vpLabel}: column overlap/tight gap (${gap.toFixed(2)}px) between ${leftKeys[r]} (${leftRightEdge.toFixed(2)}) and ${rightKeys[r]} (${rightLeftEdge.toFixed(2)})`,
    )
  }

  assert(layout.c4 && layout.b7, `${vpLabel}: C4 or B7 missing`)
  assert(!overlaps(layout.cardRect, layout.c4, 0.5), `${vpLabel}: populated GuestCountCard overlaps C4`)
  assert(!overlaps(layout.cardRect, layout.b7, 0.5), `${vpLabel}: populated GuestCountCard overlaps B7`)

  return { minCrossColGap: Number(minCrossColGap.toFixed(2)), cardHeight: Number(layout.cardRect.height.toFixed(2)) }
}

function attachErrorCollector(page) {
  const errors = []
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })
  return errors
}

function rectsOverlap(a, b, tol = 0.5) {
  return !(a.right <= b.left + tol || b.right <= a.left + tol || a.bottom <= b.top + tol || b.bottom <= a.top + tol)
}

const { server, baseUrl } = await startMockViteServer()
const browser = await launchBrowser()
const summary = { mode: "mock", viewports: {}, flows: {}, ownerCheck: {} }

try {
  // 1. Verify all 8 viewports as RECEPTIONIST (userId: 1, light theme matching reference screenshots)
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    const errors = attachErrorCollector(page)

    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByTestId("guest-count-card").waitFor({ state: "visible" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await page.waitForTimeout(350)

    // Dismiss the 15' late arrival operational toast if visible so the floor header/map can be inspected cleanly
    const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if ((await toastClose.count()) > 0) {
      await toastClose.click()
      await page.waitForTimeout(150)
    }

    // Populate the 6 guest counter values so screenshots & layout assertions validate real populated data
    await setAndVerifyGuestCounts(page, POPULATED_COUNTS)
    const counterStats = await assertGuestCounterLayout(page, vp.label, POPULATED_COUNTS)

    // Real keyboard Tab traversal across interactive controls (never lands on any notification launcher)
    const visitedLabels = []
    for (let t = 0; t < 70; t++) {
      await page.keyboard.press("Tab")
      const focused = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        return {
          tag: el.tagName,
          aria: el.getAttribute("aria-label") ?? "",
          hasBell: Boolean(el.querySelector("svg.lucide-bell")),
        }
      })
      if (focused) {
        assert(!focused.hasBell, `${vp.label}: Tab traversal focused a bell icon`)
        if (focused.aria !== "Đóng thông báo") {
          assert(
            !/^(thông báo|cần xử lý)/i.test(focused.aria),
            `${vp.label}: Tab focused notification control: ${focused.aria}`,
          )
        }
        if (focused.aria && !visitedLabels.includes(focused.aria)) visitedLabels.push(focused.aria)
      }
    }
    assert(visitedLabels.length >= 10, `${vp.label}: Tab traversal visited too few controls (${visitedLabels.length})`)
    await page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined,
    )

    // Keyboard focus audit across all focusable controls (exclude Toast15's "Đóng thông báo" dismiss button)
    const focusAudit = await page.evaluate(() => {
      const focusable = Array.from(
        document.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      const notificationMatches = focusable
        .filter((el) => {
          const aria = el.getAttribute("aria-label") ?? ""
          if (aria === "Đóng thông báo") return false
          return /^(thông báo|cần xử lý)/i.test(aria) || Boolean(el.querySelector("svg.lucide-bell"))
        })
        .map((el) => el.outerHTML.slice(0, 120))
      return { focusableCount: focusable.length, notificationMatches }
    })
    assert.deepEqual(
      focusAudit.notificationMatches,
      [],
      `${vp.label}: found focusable notification control(s): ${focusAudit.notificationMatches.join("; ")}`,
    )

    const metrics = await page.evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const docOverflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const docOverflowY = Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight)

      const shell = document.querySelector("[data-gm]")
      const shellRect = shell?.getBoundingClientRect() ?? null
      const header = shell?.querySelector("header")
      const headerRect = header?.getBoundingClientRect() ?? null
      const menuBtn = shell?.querySelector('button:is([aria-label="Menu"], [aria-label^="Menu, "])')
      const searchInput = shell?.querySelector('input[placeholder*="3 số cuối"]')
      const exportBtn = shell?.querySelector('button[aria-label="Xuất text Zalo"]')
      const undoBtn = shell?.querySelector('button[aria-label="Hoàn tác"]')
      const redoBtn = shell?.querySelector('button[aria-label="Làm lại"]')

      const bellIcons = document.querySelectorAll("svg.lucide-bell").length
      const bellButtons = Array.from(document.querySelectorAll("button, [role='button']")).filter((el) => {
        const aria = el.getAttribute("aria-label") ?? ""
        return /^(thông báo|cần xử lý)/i.test(aria)
      }).length
      const menuUnreadDot = Boolean(menuBtn?.querySelector('[data-testid="reception-menu-unread"]'))

      const svg = shell?.querySelector('svg[role="group"]')
      const canvasWrap = svg?.parentElement
      const canvasRect = canvasWrap?.getBoundingClientRect() ?? null
      const wall = svg?.querySelector('rect[data-bg="1"]')
      const wallRect = wall?.getBoundingClientRect() ?? null
      const canvasScrollOverflowY = canvasWrap ? Math.max(0, canvasWrap.scrollHeight - canvasWrap.clientHeight) : -1

      const guestCard = document.querySelector('[data-testid="guest-count-card"]')?.getBoundingClientRect() ?? null
      const infoBtn = shell?.querySelector('button[aria-label^="Ký hiệu"]')?.getBoundingClientRect() ?? null
      const waitBtn = shell?.querySelector('button[aria-label^="Bàn chờ"]')?.getBoundingClientRect() ?? null
      const barGuestPanel = document.querySelector('[data-testid="bar-guest-list"]')?.getBoundingClientRect() ?? null

      // Check key table glyphs near floating controls (C4, B7, B21) and A7 label
      const c4Rect = shell?.querySelector('[role="button"][aria-label^="Bàn C4"]')?.getBoundingClientRect() ?? null
      const b7Rect = shell?.querySelector('[role="button"][aria-label^="Bàn B7"]')?.getBoundingClientRect() ?? null
      const b21Rect = shell?.querySelector('[role="button"][aria-label^="Bàn B21"]')?.getBoundingClientRect() ?? null
      const a7Text = shell?.querySelector('[role="button"][aria-label^="Bàn A7"] text')?.textContent ?? ""

      const toBox = (r) =>
        r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null
      const expandBox = (r, pad) =>
        r
          ? {
              left: r.left - pad,
              top: r.top - pad,
              right: r.right + pad,
              bottom: r.bottom + pad,
              width: r.width + pad * 2,
              height: r.height + pad * 2,
            }
          : null

      const wallScale = wallRect ? wallRect.width / 370 : 1
      const outlineHalfStroke = 0.8 * wallScale
      const pillHalfStroke = 0.7 * wallScale

      const clusterOutlines = Array.from(svg?.querySelectorAll('[data-cluster-outline="1"]') ?? []).map((g) => {
        const r = g.querySelector("rect")?.getBoundingClientRect()
        return {
          code: g.getAttribute("data-cluster-code-value") ?? "",
          kind: g.getAttribute("data-cluster-kind") ?? "",
          box: expandBox(r, outlineHalfStroke),
        }
      })

      const clusterPills = Array.from(svg?.querySelectorAll('[data-cluster-code="1"]') ?? []).map((g) => {
        const r = g.querySelector("rect")?.getBoundingClientRect()
        return {
          code: g.getAttribute("data-cluster-code-value") ?? g.textContent?.trim() ?? "",
          side: g.getAttribute("data-cluster-label-side") ?? "",
          box: expandBox(r, pillHalfStroke),
        }
      })

      const countBadges = Array.from(svg?.querySelectorAll('[data-testid="guest-count-badge"]') ?? []).map((g) => ({
        label: g.getAttribute("aria-label") ?? "",
        box: toBox(g.getBoundingClientRect()),
      }))

      const turnBadges = Array.from(svg?.querySelectorAll('[data-testid="turn-badge"]') ?? []).map((g) => ({
        label: g.getAttribute("aria-label") ?? "",
        box: toBox(g.getBoundingClientRect()),
      }))

      const cornerIcons = Array.from(
        svg?.querySelectorAll('[data-testid="table-icons-bottom-left"], [data-testid="table-icons-bottom-right"]') ??
          [],
      ).map((g) => ({
        side: g.getAttribute("data-testid"),
        label: g.getAttribute("aria-label") ?? "",
        box: toBox(g.getBoundingClientRect()),
        items: Array.from(g.querySelectorAll("[data-icon]")).map((item) => ({
          icon: item.getAttribute("data-icon") ?? "",
          box: toBox(item.getBoundingClientRect()),
        })),
      }))

      const svgRect = toBox(svg?.getBoundingClientRect() ?? null)

      const tableShapes = Array.from(svg?.querySelectorAll('[role="button"][aria-label]') ?? []).map((g) => {
        const shape = g.querySelector('rect[rx="4.5"], circle:not([fill="transparent"]):not(.focus-ring)')
        const texts = Array.from(g.querySelectorAll("text"))
          .filter(
            (t) =>
              !t.closest(
                '[data-testid="guest-count-badge"], [data-testid="turn-badge"], [data-testid="table-icons-bottom-left"], [data-testid="table-icons-bottom-right"]',
              ),
          )
          .map((t) => ({
            text: t.textContent ?? "",
            box: toBox(t.getBoundingClientRect()),
          }))
        const guestBadge = g.querySelector('[data-testid="guest-count-badge"]')
        const turnBadge = g.querySelector('[data-testid="turn-badge"]')
        const leftIcons = g.querySelector('[data-testid="table-icons-bottom-left"]')
        const rightIcons = g.querySelector('[data-testid="table-icons-bottom-right"]')
        const iconItems = Array.from(g.querySelectorAll("[data-icon]")).map((item) => ({
          icon: item.getAttribute("data-icon") ?? "",
          box: toBox(item.getBoundingClientRect()),
        }))
        return {
          aria: g.getAttribute("aria-label") ?? "",
          box: shape ? toBox(shape.getBoundingClientRect()) : null,
          texts,
          guestBadge: guestBadge
            ? { label: guestBadge.getAttribute("aria-label") ?? "", box: toBox(guestBadge.getBoundingClientRect()) }
            : null,
          turnBadge: turnBadge
            ? { label: turnBadge.getAttribute("aria-label") ?? "", box: toBox(turnBadge.getBoundingClientRect()) }
            : null,
          leftIcons: leftIcons
            ? { label: leftIcons.getAttribute("aria-label") ?? "", box: toBox(leftIcons.getBoundingClientRect()) }
            : null,
          rightIcons: rightIcons
            ? { label: rightIcons.getAttribute("aria-label") ?? "", box: toBox(rightIcons.getBoundingClientRect()) }
            : null,
          iconItems,
        }
      })

      return {
        vw,
        vh,
        docOverflowX,
        docOverflowY,
        canvasScrollOverflowY,
        bellIcons,
        bellButtons,
        menuUnreadDot,
        shell: toBox(shellRect),
        header: toBox(headerRect),
        menuBtn: toBox(menuBtn?.getBoundingClientRect() ?? null),
        searchInput: toBox(searchInput?.getBoundingClientRect() ?? null),
        exportBtn: toBox(exportBtn?.getBoundingClientRect() ?? null),
        undoBtn: toBox(undoBtn?.getBoundingClientRect() ?? null),
        redoBtn: toBox(redoBtn?.getBoundingClientRect() ?? null),
        canvas: toBox(canvasRect),
        svgRect,
        wall: toBox(wallRect),
        wallScale,
        guestCard: toBox(guestCard),
        infoBtn: toBox(infoBtn),
        waitBtn: toBox(waitBtn),
        barGuestPanel: toBox(barGuestPanel),
        c4: toBox(c4Rect),
        b7: toBox(b7Rect),
        b21: toBox(b21Rect),
        a7Text,
        clusterOutlines,
        clusterPills,
        countBadges,
        turnBadges,
        cornerIcons,
        tableShapes,
        fontFamily: shell ? getComputedStyle(shell).fontFamily : "",
      }
    })

    assert.equal(metrics.docOverflowX, 0, `${vp.label}: horizontal overflow ${metrics.docOverflowX}`)
    assert.equal(metrics.docOverflowY, 0, `${vp.label}: document vertical overflow ${metrics.docOverflowY}`)
    assert.equal(
      metrics.canvasScrollOverflowY,
      0,
      `${vp.label}: canvas vertical scroll overflow ${metrics.canvasScrollOverflowY}`,
    )
    assert.equal(metrics.bellIcons, 0, `${vp.label}: bell SVG icon still rendered`)
    assert.equal(metrics.bellButtons, 0, `${vp.label}: notification button still rendered`)
    assert(metrics.menuUnreadDot, `${vp.label}: the unread fixture should show a dot on Menu`)

    assert(metrics.shell, `${vp.label}: [data-gm] missing`)
    assert(
      metrics.header && metrics.menuBtn && metrics.searchInput && metrics.exportBtn,
      `${vp.label}: header controls missing`,
    )
    assert(metrics.exportBtn.right <= metrics.shell.right + 1, `${vp.label}: export button clipped`)
    assert(metrics.menuBtn.height >= 44 && metrics.menuBtn.width >= 44, `${vp.label}: menu button < 44px`)
    assert(metrics.undoBtn && metrics.redoBtn, `${vp.label}: undo/redo buttons missing`)
    assert(metrics.undoBtn.height >= 44 && metrics.redoBtn.height >= 44, `${vp.label}: undo/redo < 44px`)

    assert(metrics.wall && metrics.canvas, `${vp.label}: wall or canvas missing`)
    assert(metrics.wall.left >= metrics.canvas.left - 1, `${vp.label}: wall clipped left`)
    assert(metrics.wall.right <= metrics.canvas.right + 1, `${vp.label}: wall clipped right`)
    assert(metrics.wall.top >= metrics.canvas.top - 1, `${vp.label}: wall clipped top`)
    assert(metrics.wall.bottom <= metrics.canvas.bottom + 1, `${vp.label}: wall clipped bottom`)

    if (vp.width >= 768) {
      assert(metrics.shell.width <= 629, `${vp.label}: reception shell exceeded 628px (${metrics.shell.width})`)
      const leftMargin = metrics.shell.left
      const rightMargin = metrics.vw - metrics.shell.right
      assert(
        Math.abs(leftMargin - rightMargin) <= 2,
        `${vp.label}: reception shell not centered (${leftMargin} vs ${rightMargin})`,
      )
    }

    assert(
      metrics.guestCard && metrics.c4 && metrics.b7 && metrics.b21 && metrics.waitBtn,
      `${vp.label}: missing clearance targets`,
    )
    assert(!rectsOverlap(metrics.guestCard, metrics.c4), `${vp.label}: GuestCountCard overlaps C4`)
    assert(!rectsOverlap(metrics.guestCard, metrics.b7), `${vp.label}: GuestCountCard overlaps B7`)
    assert(!rectsOverlap(metrics.waitBtn, metrics.b21), `${vp.label}: Chờ button overlaps B21`)
    assert(metrics.a7Text.startsWith("A7 - "), `${vp.label}: R2 label unexpected: "${metrics.a7Text}"`)
    assert(metrics.barGuestPanel && metrics.barGuestPanel.width > 0, `${vp.label}: BarGuestList missing`)
    assert(
      metrics.fontFamily.includes("Be Vietnam Pro"),
      `${vp.label}: Be Vietnam Pro font not applied (${metrics.fontFamily})`,
    )

    // F-02: Verify G02/G03 cluster outline clearance (stroke-inclusive) & zero pill collisions with badges/tables/outlines
    const g03Outline = metrics.clusterOutlines.find((o) => o.code === "G03")
    const g02Outline = metrics.clusterOutlines.find((o) => o.code === "G02")
    assert(g03Outline?.box && g02Outline?.box, `${vp.label}: missing G02 or G03 cluster outline`)
    const g02G03GapPx = g02Outline.box.top - g03Outline.box.bottom
    assert(
      g02G03GapPx > 0.2,
      `${vp.label}: G03/G02 outlines overlap or touch (stroke-inclusive gap ${g02G03GapPx.toFixed(3)}px)`,
    )

    assert(
      metrics.clusterPills.length >= 7,
      `${vp.label}: expected >= 7 cluster pills, got ${metrics.clusterPills.length}`,
    )
    assert(
      metrics.countBadges.length >= 4,
      `${vp.label}: expected >= 4 guest count badges, got ${metrics.countBadges.length}`,
    )

    for (const pill of metrics.clusterPills) {
      assert(pill.box, `${vp.label}: missing box for pill ${pill.code}`)
      for (const badge of metrics.countBadges) {
        assert(
          !rectsOverlap(pill.box, badge.box, 0),
          `${vp.label}: pill ${pill.code} overlaps guest-count badge (${badge.label})`,
        )
      }
      for (const tbadge of metrics.turnBadges) {
        assert(
          !rectsOverlap(pill.box, tbadge.box, 0),
          `${vp.label}: pill ${pill.code} overlaps turn badge (${tbadge.label})`,
        )
      }
      for (const ci of metrics.cornerIcons) {
        assert(!rectsOverlap(pill.box, ci.box, 0), `${vp.label}: pill ${pill.code} overlaps corner icon (${ci.label})`)
      }
      for (const outline of metrics.clusterOutlines) {
        if (outline.code === pill.code) continue
        assert(
          !rectsOverlap(pill.box, outline.box, 0),
          `${vp.label}: pill ${pill.code} overlaps cluster outline ${outline.code}`,
        )
      }
      for (const otherPill of metrics.clusterPills) {
        if (otherPill.code === pill.code) continue
        assert(
          !rectsOverlap(pill.box, otherPill.box, 0),
          `${vp.label}: pill ${pill.code} overlaps pill ${otherPill.code}`,
        )
      }
      for (const ts of metrics.tableShapes) {
        if (ts.box) {
          assert(!rectsOverlap(pill.box, ts.box, 0), `${vp.label}: pill ${pill.code} overlaps table cell ${ts.aria}`)
        }
        for (const txt of ts.texts) {
          assert(
            !rectsOverlap(pill.box, txt.box, 0),
            `${vp.label}: pill ${pill.code} overlaps text "${txt.text}" in ${ts.aria}`,
          )
        }
      }
    }

    // Verify TurnBadge corner placement (top-right), icon sizes, and zero badge/icon overlaps across all tables
    assert(
      metrics.turnBadges.length >= 3,
      `${vp.label}: expected >= 3 turn badges in mock mode, got ${metrics.turnBadges.length}`,
    )
    const allDecorations = []
    for (const ts of metrics.tableShapes) {
      if (!ts.box) continue
      const tableDecorations = [
        ts.guestBadge ? { kind: "guestBadge", ...ts.guestBadge } : null,
        ts.turnBadge ? { kind: "turnBadge", ...ts.turnBadge } : null,
        ts.leftIcons ? { kind: "leftIcons", ...ts.leftIcons } : null,
        ts.rightIcons ? { kind: "rightIcons", ...ts.rightIcons } : null,
      ].filter(Boolean)

      if (ts.turnBadge) {
        const cx = (ts.turnBadge.box.left + ts.turnBadge.box.right) / 2
        const cy = (ts.turnBadge.box.top + ts.turnBadge.box.bottom) / 2
        assert(
          cx > ts.box.left + ts.box.width * 0.5,
          `${vp.label}: TurnBadge on ${ts.aria} is not on right half (cx=${cx}, tableRight=${ts.box.right})`,
        )
        assert(
          cy < ts.box.top + ts.box.height * 0.45,
          `${vp.label}: TurnBadge on ${ts.aria} is not at top-right corner (cy=${cy}, tableTop=${ts.box.top})`,
        )
      }

      if (ts.guestBadge) {
        const cx = (ts.guestBadge.box.left + ts.guestBadge.box.right) / 2
        const cy = (ts.guestBadge.box.top + ts.guestBadge.box.bottom) / 2
        assert(cx < ts.box.left + ts.box.width * 0.5, `${vp.label}: GuestBadge not on left half on ${ts.aria}`)
        assert(cy < ts.box.top + ts.box.height * 0.45, `${vp.label}: GuestBadge not at top-left on ${ts.aria}`)
      }

      // Within the same table: no badge/icon overlaps own text, or each other
      for (const dec of tableDecorations) {
        for (const txt of ts.texts) {
          // SVG <text> getBoundingClientRect() includes ~18% transparent ascent/descent leading;
          // tighten vertically by 18% to approximate painted glyph bounds while still catching real text collisions.
          const th = txt.box.bottom - txt.box.top
          const glyphBox = {
            left: txt.box.left,
            right: txt.box.right,
            top: txt.box.top + th * 0.16,
            bottom: txt.box.bottom - th * 0.16,
          }
          assert(
            !rectsOverlap(dec.box, glyphBox, 0.2),
            `${vp.label}: ${dec.kind} (${dec.label}) overlaps text "${txt.text}" inside ${ts.aria} (dec=${JSON.stringify(dec.box)}, glyph=${JSON.stringify(glyphBox)})`,
          )
        }
        // Inside SVG bounds
        if (metrics.svgRect) {
          assert(
            dec.box.left >= metrics.svgRect.left - 0.5 &&
              dec.box.right <= metrics.svgRect.right + 0.5 &&
              dec.box.top >= metrics.svgRect.top - 0.5 &&
              dec.box.bottom <= metrics.svgRect.bottom + 0.5,
            `${vp.label}: ${dec.kind} clipped outside SVG on ${ts.aria}`,
          )
        }
      }
      for (let i = 0; i < tableDecorations.length; i++) {
        for (let j = i + 1; j < tableDecorations.length; j++) {
          assert(
            !rectsOverlap(tableDecorations[i].box, tableDecorations[j].box, 0),
            `${vp.label}: ${tableDecorations[i].kind} overlaps ${tableDecorations[j].kind} on ${ts.aria}`,
          )
        }
      }
      for (let i = 0; i < ts.iconItems.length; i++) {
        for (let j = i + 1; j < ts.iconItems.length; j++) {
          assert(
            !rectsOverlap(ts.iconItems[i].box, ts.iconItems[j].box, 0.2),
            `${vp.label}: icon ${ts.iconItems[i].icon} overlaps ${ts.iconItems[j].icon} on ${ts.aria}`,
          )
        }
      }

      // Against every other table cell
      for (const otherTs of metrics.tableShapes) {
        if (otherTs === ts || !otherTs.box) continue
        for (const dec of tableDecorations) {
          assert(
            !rectsOverlap(dec.box, otherTs.box, 0.2),
            `${vp.label}: ${dec.kind} (${dec.label}) on ${ts.aria} overlaps neighbour ${otherTs.aria}`,
          )
        }
      }

      for (const dec of tableDecorations) {
        allDecorations.push({ aria: ts.aria, ...dec })
      }
    }

    for (let i = 0; i < allDecorations.length; i++) {
      for (let j = i + 1; j < allDecorations.length; j++) {
        if (allDecorations[i].aria === allDecorations[j].aria) continue
        assert(
          !rectsOverlap(allDecorations[i].box, allDecorations[j].box, 0.2),
          `${vp.label}: ${allDecorations[i].kind} on ${allDecorations[i].aria} overlaps ${allDecorations[j].kind} on ${allDecorations[j].aria}`,
        )
      }
    }

    assert.deepEqual(errors, [], `${vp.label}: console/page errors: ${errors.join(" | ")}`)

    // Dismiss the "Đã lưu bộ đếm khách" Sonner toast so the header and Đếm khách card are unobstructed in screenshots
    const sonnerClose = page.locator("[data-sonner-toast] button")
    if ((await sonnerClose.count()) > 0) {
      await sonnerClose.first().click()
      await page.waitForTimeout(300)
    }

    const shotPath = path.join(outDir, `reception-${vp.label}.png`)
    await page.screenshot({ path: shotPath })

    // Verify representative 4-digit counts on phone & tablet layouts without overwriting the 3-digit screenshots
    let fourDigitStats = null
    if (["375x812", "390x844", "768x1024", "1024x768"].includes(vp.label)) {
      await setAndVerifyGuestCounts(page, FOUR_DIGIT_COUNTS)
      fourDigitStats = await assertGuestCounterLayout(page, `${vp.label} (4-digit)`, FOUR_DIGIT_COUNTS)
    }

    summary.viewports[vp.label] = {
      overflowX: metrics.docOverflowX,
      overflowY: metrics.docOverflowY,
      canvasScrollOverflowY: metrics.canvasScrollOverflowY,
      bellIcons: metrics.bellIcons,
      bellButtons: metrics.bellButtons,
      menuUnreadDot: metrics.menuUnreadDot,
      shellWidth: Math.round(metrics.shell.width),
      wallSize: `${Math.round(metrics.wall.width)}x${Math.round(metrics.wall.height)}`,
      a7Text: metrics.a7Text,
      counter3Digit: counterStats,
      counter4Digit: fourDigitStats,
      g02G03GapPx: Number(g02G03GapPx.toFixed(2)),
      pillSides: Object.fromEntries(metrics.clusterPills.map((p) => [p.code, p.side])),
      screenshot: shotPath,
    }
    await context.close()
  }

  // 2. Verify R1-R5 workflows + sheets on 390x844 (phone) and 1366x768 (laptop)
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
      window.__copiedText = null
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (txt) => {
            window.__copiedText = txt
          },
        },
        configurable: true,
      })
    })
    const page = await context.newPage()
    const errors = attachErrorCollector(page)

    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByTestId("guest-count-card").waitFor({ state: "visible" })

    const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if ((await toastClose.count()) > 0) {
      await toastClose.click()
      await page.waitForTimeout(150)
    }

    const menuTrigger = page.getByRole("button", { name: /^Menu, \d+ thông báo chưa xem$/ })
    const dot = page.getByTestId("reception-menu-unread")
    const accountSheet = page.getByRole("dialog", { name: "Tài khoản" })
    const notifications = accountSheet.locator("summary").filter({ hasText: /^Thông báo · \d+/ })
    const readSeen = () => page.evaluate(() => localStorage.getItem("21gam.mobile.alerts.seen.v1"))
    const previousSeen = await readSeen()
    await menuTrigger.focus()
    await menuTrigger.press("Enter")
    await notifications.waitFor({ state: "visible" })
    await accountSheet.locator('[data-motion-state="open"]').count()
    assert.equal(await notifications.evaluate((el) => el.parentElement.open), false)
    assert.equal(await readSeen(), previousSeen, "Opening Menu alone marked reception notifications as seen")
    assert.equal(await dot.count(), 1, "Menu alone cleared the unread dot")
    await page.screenshot({ path: path.join(outDir, "reception-390x844-menu-unread.png") })
    await page.keyboard.press("Escape")
    await accountSheet.waitFor({ state: "detached" })
    assert(await menuTrigger.evaluate((el) => document.activeElement === el), "Closing Menu did not restore focus")
    await menuTrigger.tap()
    await notifications.waitFor({ state: "visible" })
    const disclosureBox = await notifications.boundingBox()
    assert(disclosureBox && disclosureBox.height >= 44, "Thông báo disclosure target is smaller than 44px")
    await notifications.press("Space")
    const firstAlert = accountSheet.locator("details button").first()
    await firstAlert.waitFor({ state: "visible" })
    await dot.waitFor({ state: "detached" })
    assert.notEqual(await readSeen(), previousSeen, "Opening Thông báo did not persist the seen notifications")
    assert(await notifications.evaluate((el) => document.activeElement === el), "Disclosure lost keyboard focus")
    await page.screenshot({ path: path.join(outDir, "reception-390x844-menu-notifications.png") })
    await firstAlert.press("Enter")
    await accountSheet.waitFor({ state: "detached" })
    const alertDetail = page.getByRole("dialog").first()
    await alertDetail.waitFor({ state: "visible" })
    assert(await alertDetail.evaluate((el) => el.contains(document.activeElement)), "Alert detail did not receive focus")
    await page.keyboard.press("Escape")
    await alertDetail.waitFor({ state: "detached" })
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor({ state: "visible" })

    // R1: Open guest count edit, set Tổng đã tới = 42, save and confirm persisted on card
    await page.getByRole("button", { name: "Sửa bộ đếm khách" }).click()
    await page.getByTestId("guest-count-editor").waitFor({ state: "visible" })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(outDir, "reception-390x844-counter-edit.png") })
    const totalInput = page.getByLabel("Tổng đã tới", { exact: true })
    await totalInput.fill("42")
    await page.getByRole("button", { name: "Lưu", exact: true }).click()
    await page.getByTestId("guest-count-editor").waitFor({ state: "detached" })
    const updatedCardText = await page.getByTestId("guest-count-card").innerText()
    assert(updatedCardText.includes("42"), `R1: Expected 42 in GuestCountCard, got: ${updatedCardText}`)

    // R3: One-tap Xuất Text without preview dialog
    await page.getByRole("button", { name: "Xuất text Zalo" }).click()
    await page.waitForTimeout(200)
    const copied = await page.evaluate(() => window.__copiedText)
    assert(copied && copied.length > 10, "R3: Expected clipboard text on one-tap Xuất Text")
    assert.equal(await page.getByRole("dialog").count(), 0, "R3: Preview dialog must NOT open on Xuất Text")

    // R5: Tap free table C1 -> TableSheet shows "Đặt bàn" (not "Tạo trước")
    await page.getByRole("button", { name: /^Bàn C1,/ }).click()
    const sheet = page.getByRole("dialog", { name: "Chi tiết C1" })
    await sheet.waitFor({ state: "visible" })
    await page.waitForTimeout(200)
    const bookBtn = sheet.getByRole("button", { name: "Đặt bàn", exact: true })
    await bookBtn.waitFor({ state: "visible" })
    assert.equal(await sheet.getByRole("button", { name: /Tạo trước/ }).count(), 0, "R5: Must not show Tạo trước")
    await page.screenshot({ path: path.join(outDir, "reception-390x844-table-sheet.png") })
    await sheet.getByRole("button", { name: "Đóng", exact: true }).click()
    await sheet.waitFor({ state: "detached" })

    // Waitlist sheet check + confirm zero bell inside
    await page.getByRole("button", { name: /^Bàn chờ/ }).click()
    const waitSheet = page.getByRole("dialog")
    await waitSheet.waitFor({ state: "visible" })
    await page.waitForTimeout(250)
    assert.equal(await page.locator("svg.lucide-bell").count(), 0, "Bell icon appeared when Waitlist opened")
    await page.screenshot({ path: path.join(outDir, "reception-390x844-waitlist.png") })

    assert.deepEqual(errors, [], `R1-R5 390x844 errors: ${errors.join(" | ")}`)
    summary.flows.phone390 = { r1SavedTotal: 42, r3CopiedChars: copied.length, r5BookLabel: "Đặt bàn" }
    await context.close()
  }

  // 3. Verify OWNER role still has AlertsBell in TopBar at 1440x900
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
    })
    const page = await context.newPage()
    const errors = attachErrorCollector(page)

    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    const bellBtn = page.getByRole("button", { name: /^Cần xử lý:/ })
    await bellBtn.waitFor({ state: "visible" })
    const bellIcons = await page.locator("svg.lucide-bell").count()
    assert(bellIcons >= 1, "OWNER must still see the AlertsBell icon")
    await bellBtn.click()
    await page.getByText("Hệ thống không tự hủy booking").waitFor({ state: "visible" })
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(outDir, "owner-1440x900-alerts.png") })

    assert.deepEqual(errors, [], `OWNER check errors: ${errors.join(" | ")}`)
    summary.ownerCheck = { hasAlertsBell: true, bellIcons }
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(JSON.stringify(summary, null, 2))
