// Reproducible Playwright verification & screenshot capture for Sprint 4 Reception UI Refinement (mock mode).
// Usage (from repo root): node web/e2e/reception-ui-refinement.mjs
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const outDir =
  process.env.RECEPTION_EVIDENCE_DIR || path.join(__dirname, ".artifacts", `reception-ui-refinement-${randomUUID()}`)
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

const decorationTestIds = {
  guestBadge: "guest-count-badge",
  turnBadge: "turn-badge",
  leftIcons: "table-icons-bottom-left",
  rightIcons: "table-icons-bottom-right",
}

async function countPaintedOverlap(table, kind, textIndex, evidence) {
  const intersection = await table.evaluate(
    (node, { testId, textIndex }) => {
      const decoration = node.querySelector(`[data-testid="${testId}"]`)
      const text = node.querySelectorAll("text")[textIndex]
      if (!decoration || !text) throw new Error("Missing decoration or text for paint comparison")

      // SVG client rectangles omit strokes. Include each transformed stroke in the decoration box.
      const box = decoration.getBoundingClientRect().toJSON()
      for (const shape of decoration.querySelectorAll("rect, circle, ellipse, path, line, polygon, polyline, text")) {
        const style = getComputedStyle(shape)
        if (style.stroke === "none") continue
        const matrix = shape.getScreenCTM()
        const radius = Number.parseFloat(style.strokeWidth) / 2
        const extent = radius * (style.strokeLinejoin === "miter" ? Number(style.strokeMiterlimit) : Math.SQRT2)
        const scaleX = style.vectorEffect === "non-scaling-stroke" ? 1 : Math.hypot(matrix.a, matrix.c)
        const scaleY = style.vectorEffect === "non-scaling-stroke" ? 1 : Math.hypot(matrix.b, matrix.d)
        const shapeBox = shape.getBoundingClientRect()
        box.left = Math.min(box.left, shapeBox.left - extent * scaleX)
        box.right = Math.max(box.right, shapeBox.right + extent * scaleX)
        box.top = Math.min(box.top, shapeBox.top - extent * scaleY)
        box.bottom = Math.max(box.bottom, shapeBox.bottom + extent * scaleY)
      }
      const textBox = text.getBoundingClientRect()
      const left = Math.max(box.left, textBox.left)
      const right = Math.min(box.right, textBox.right)
      const top = Math.max(box.top, textBox.top)
      const bottom = Math.min(box.bottom, textBox.bottom)
      if (right <= left || bottom <= top) return null

      decoration.setAttribute("data-reception-paint", "decoration")
      text.setAttribute("data-reception-paint", "text")
      const tableBox = node.getBoundingClientRect()
      return {
        left: left - tableBox.left,
        right: right - tableBox.left,
        top: top - tableBox.top,
        bottom: bottom - tableBox.top,
      }
    },
    { testId: decorationTestIds[kind], textIndex },
  )
  if (!intersection) return 0

  const decoration = '[data-reception-paint="decoration"]'
  const text = '[data-reception-paint="text"]'
  const page = table.page()
  const layers = []
  try {
    // One crop keeps all captures aligned and excludes paint outside the badge/text intersection.
    await table.scrollIntoViewIfNeeded()
    const bounds = await table.boundingBox()
    assert(bounds, "Missing table bounds for paint comparison")
    const x = Math.floor(bounds.x + intersection.left)
    const y = Math.floor(bounds.y + intersection.top)
    const clip = {
      x,
      y,
      width: Math.ceil(bounds.x + intersection.right) - x,
      height: Math.ceil(bounds.y + intersection.bottom) - y,
    }
    for (const [name, hidden] of [
      ["neither", `${decoration}, ${text}`],
      ["text-only", decoration],
      ["both", null],
    ]) {
      const image = await page.screenshot({
        clip,
        animations: "disabled",
        style: hidden ? `${hidden} { opacity: 0 !important; }` : undefined,
        path: evidence && path.join(outDir, `${evidence}-${name}.png`),
      })
      layers.push(image.toString("base64"))
    }
  } finally {
    await table
      .locator("[data-reception-paint]")
      .evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute("data-reception-paint")))
  }

  return page.evaluate(async (layers) => {
    const images = await Promise.all(
      layers.map(async (layer) => {
        const image = new Image()
        image.src = `data:image/png;base64,${layer}`
        await image.decode()
        return image
      }),
    )
    const canvas = document.createElement("canvas")
    canvas.width = images[0].width
    canvas.height = images[0].height
    const ctx = canvas.getContext("2d")
    const [background, text, combined] = images.map((image) => {
      if (image.width !== canvas.width || image.height !== canvas.height) {
        throw new Error("Paint comparison screenshots have different dimensions")
      }
      ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data
    })
    const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]
    let overlap = 0
    for (let i = 0; i < background.length; i += 4) {
      if (differs(text, background, i) && differs(combined, text, i)) overlap++
    }
    return overlap
  }, layers)
}

// Allow antialiasing noise at painted edges; the overlap controls change at least 46 pixels.
const MAX_CHANGED_TEXT_PIXELS = 8

function assertTextUncovered(pixels, description) {
  assert(
    pixels <= MAX_CHANGED_TEXT_PIXELS,
    `${description}: ${pixels} changed text pixels (limit ${MAX_CHANGED_TEXT_PIXELS})`,
  )
}

async function verifyPaintControl(table, evidence) {
  const pixels = await countPaintedOverlap(table, "guestBadge", 0, evidence)
  assert.throws(
    () => assertTextUncovered(pixels, evidence),
    assert.AssertionError,
    `${evidence} must exceed the changed text pixel limit of ${MAX_CHANGED_TEXT_PIXELS}`,
  )
  return pixels
}

/** Browser-evaluated check: maps every painted badge/icon perimeter point into each cluster outline's SVG frame. */
function measureOutlineStrokeIntersections(svgRoot) {
  const outlines = Array.from(svgRoot?.querySelectorAll('[data-cluster-outline="1"] > rect') ?? [])
  const decorationShapes = Array.from(
    svgRoot?.querySelectorAll(
      '[data-testid="guest-count-badge"] rect, [data-testid="turn-badge"] rect, [data-testid="turn-badge"] circle, [data-testid="table-icons-bottom-left"] circle, [data-testid="table-icons-bottom-right"] circle',
    ) ?? [],
  )
  const hits = []
  if (!svgRoot || outlines.length === 0 || decorationShapes.length === 0) return hits
  const pt = svgRoot.createSVGPoint()
  for (const decShape of decorationShapes) {
    const decCtm = decShape.getScreenCTM()
    if (!decCtm) continue
    const decGroup = decShape.closest("[data-testid]")
    const tableGroup = decShape.closest('[role="button"][aria-label], [role="img"][aria-label]')
    const decLabel = `${tableGroup?.getAttribute("aria-label")?.split(",")[0] ?? "?"} ${decGroup?.getAttribute("data-testid") ?? ""}`
    const sw = Number(decShape.getAttribute("stroke-width") || 0) / 2
    const samplePoints = []
    if (decShape.tagName.toLowerCase() === "circle") {
      const cx = Number(decShape.getAttribute("cx") || 0)
      const cy = Number(decShape.getAttribute("cy") || 0)
      const r = Number(decShape.getAttribute("r") || 0) + sw
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        samplePoints.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
    } else {
      const x = Number(decShape.getAttribute("x") || 0) - sw
      const y = Number(decShape.getAttribute("y") || 0) - sw
      const w = Number(decShape.getAttribute("width") || 0) + sw * 2
      const h = Number(decShape.getAttribute("height") || 0) + sw * 2
      const rxRaw = Number(decShape.getAttribute("rx") || 0)
      const rr = rxRaw > 0 ? Math.min(w / 2, h / 2, rxRaw + sw) : 0
      if (rr > 0) {
        for (let i = 0; i <= 8; i++) {
          const tx = x + rr + ((w - 2 * rr) * i) / 8
          samplePoints.push([tx, y], [tx, y + h])
        }
        for (let i = 0; i <= 8; i++) {
          const aTopLeft = Math.PI + (i / 8) * (Math.PI / 2)
          const aTopRight = -Math.PI / 2 + (i / 8) * (Math.PI / 2)
          const aBotRight = (i / 8) * (Math.PI / 2)
          const aBotLeft = Math.PI / 2 + (i / 8) * (Math.PI / 2)
          samplePoints.push(
            [x + rr + Math.cos(aTopLeft) * rr, y + rr + Math.sin(aTopLeft) * rr],
            [x + w - rr + Math.cos(aTopRight) * rr, y + rr + Math.sin(aTopRight) * rr],
            [x + w - rr + Math.cos(aBotRight) * rr, y + h - rr + Math.sin(aBotRight) * rr],
            [x + rr + Math.cos(aBotLeft) * rr, y + h - rr + Math.sin(aBotLeft) * rr],
          )
        }
      } else {
        for (let i = 0; i <= 10; i++) {
          const t = i / 10
          samplePoints.push([x + w * t, y], [x + w * t, y + h], [x, y + h * t], [x + w, y + h * t])
        }
      }
    }
    for (const outlineRect of outlines) {
      const outCtm = outlineRect.getScreenCTM()
      if (!outCtm) continue
      const outInv = outCtm.inverse()
      const mask = outlineRect.getAttribute("mask")
      // Stroke geometry still includes parts hidden by the SVG mask.
      const cuts = mask
        ? Array.from(document.getElementById(mask.slice(5, -1))?.querySelectorAll('rect[fill="black"]') ?? [])
        : []
      const outlineCode = outlineRect.closest("[data-cluster-outline]")?.getAttribute("data-cluster-code-value") ?? "?"
      for (const [sx, sy] of samplePoints) {
        pt.x = sx
        pt.y = sy
        const mapped = pt.matrixTransform(decCtm).matrixTransform(outInv)
        if (outlineRect.isPointInStroke(mapped) && !cuts.some((cut) => cut.isPointInFill(mapped))) {
          hits.push(`${decLabel} intersects ${outlineCode} stroke`)
          break
        }
      }
    }
  }
  return hits
}

const { server, baseUrl } = process.env.E2E_BASE_URL
  ? { baseUrl: process.env.E2E_BASE_URL }
  : await startMockViteServer()
const browser = await launchBrowser()
const summary = { mode: "mock", viewports: {}, flows: {}, ownerCheck: {}, bdg02Matrix: [] }

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

    const metrics = await page.evaluate((fnSrc) => {
      const measureFn = new Function(`return (${fnSrc})`)()
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

      const frameCornerCollisions = []
      for (const frame of svg?.querySelectorAll('[data-cluster-outline="1"] > rect') ?? []) {
        const { left, top, right, bottom } = frame.getBoundingClientRect()
        const inverse = frame.getScreenCTM().inverse()
        const mask = frame.getAttribute("mask")
        const cuts = mask
          ? Array.from(document.getElementById(mask.slice(5, -1))?.querySelectorAll('rect[fill="black"]') ?? [])
          : []
        for (const { box, label } of [...countBadges, ...turnBadges, ...cornerIcons]) {
          const minY = Math.max(box.top, top - outlineHalfStroke)
          const maxY = Math.min(box.bottom, bottom + outlineHalfStroke)
          const minX = Math.max(box.left, left - outlineHalfStroke)
          const maxX = Math.min(box.right, right + outlineHalfStroke)
          let clear = true
          for (let y = minY; y <= maxY && clear; y += 0.25) {
            for (let x = minX; x <= maxX; x += 0.25) {
              const point = new DOMPoint(x, y).matrixTransform(inverse)
              if (frame.isPointInStroke(point) && !cuts.some((cut) => cut.isPointInFill(point))) {
                clear = false
                break
              }
            }
          }
          if (!clear) frameCornerCollisions.push({ code: frame.parentElement.dataset.clusterCodeValue, label })
        }
      }

      const svgRect = toBox(svg?.getBoundingClientRect() ?? null)

      const tableShapes = Array.from(svg?.querySelectorAll('[role="button"][aria-label]') ?? []).map((g) => {
        const shape = g.querySelector('rect[rx="4.5"], circle:not([fill="transparent"]):not(.focus-ring)')
        const texts = Array.from(g.querySelectorAll("text")).flatMap((t, index) =>
          t.closest(
            '[data-testid="guest-count-badge"], [data-testid="turn-badge"], [data-testid="table-icons-bottom-left"], [data-testid="table-icons-bottom-right"]',
          )
            ? []
            : [{ text: t.textContent ?? "", box: toBox(t.getBoundingClientRect()), index }],
        )
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

      const strokeIntersections = measureFn(svg)

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
        frameCornerCollisions,
        tableShapes,
        strokeIntersections,
        fontFamily: shell ? getComputedStyle(shell).fontFamily : "",
      }
    }, measureOutlineStrokeIntersections.toString())

    assert.deepEqual(
      metrics.strokeIntersections,
      [],
      `${vp.label} (light): decoration intersected cluster outline stroke: ${metrics.strokeIntersections.join("; ")}`,
    )

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
    assert.deepEqual(metrics.frameCornerCollisions, [], `${vp.label}: a cluster frame crosses a corner badge/icon`)

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
    let maxChangedTextPixels = 0
    const guestBadgeTitlePixels = {}
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
      const table = page.getByRole("button", { name: ts.aria, exact: true })
      for (const dec of tableDecorations) {
        for (const txt of ts.texts) {
          const trackedTable =
            dec.kind === "guestBadge" && txt === ts.texts[0] ? /^Bàn (A6|B3|B21),/.exec(ts.aria)?.[1] : undefined
          const isA6Title = vp.label === "390x844" && trackedTable === "A6"
          const pixels = await countPaintedOverlap(table, dec.kind, txt.index, isA6Title ? "a6-390x844" : undefined)
          assertTextUncovered(
            pixels,
            `${vp.label}: ${dec.kind} (${dec.label}) covers text "${txt.text}" inside ${ts.aria}`,
          )
          maxChangedTextPixels = Math.max(maxChangedTextPixels, pixels)
          if (trackedTable) guestBadgeTitlePixels[trackedTable] = pixels
          if (isA6Title) {
            const badge = table.getByTestId(decorationTestIds.guestBadge)
            const translate = await badge.evaluate((node) => {
              const previous = node.style.translate
              node.style.translate = "0 8px"
              return previous
            })
            try {
              const shiftedPixels = await verifyPaintControl(table, "a6-390x844-shifted")
              summary.a6Paint = { pixels, shiftedPixels }
            } finally {
              await badge.evaluate((node, previous) => {
                node.style.translate = previous
              }, translate)
            }
          }
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

    await page.getByText("Đã lưu bộ đếm khách", { exact: true }).waitFor({ state: "hidden", timeout: 10_000 })

    const shotPath = path.join(outDir, `reception-${vp.label}.png`)
    await page.screenshot({ path: shotPath })

    // Verify representative 4-digit counts on phone & tablet layouts without overwriting the 3-digit screenshots
    let fourDigitStats = null
    if (["375x812", "390x844", "768x1024", "1024x768"].includes(vp.label)) {
      await setAndVerifyGuestCounts(page, FOUR_DIGIT_COUNTS)
      fourDigitStats = await assertGuestCounterLayout(page, `${vp.label} (4-digit)`, FOUR_DIGIT_COUNTS)
    }

    summary.viewports[vp.label] = {
      dpr: await page.evaluate(() => window.devicePixelRatio),
      maxChangedTextPixels,
      guestBadgeTitlePixels,
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

  assert(summary.a6Paint, "A6 paint control did not run at 390x844")

  const fixturePage = await browser.newPage({ deviceScaleFactor: 3 })
  try {
    for (const [name, text, badge] of [
      [
        "accent-edge",
        '<text x="18" y="46" font-family="Arial" font-size="32" font-weight="bold">A6 - ẤỄỨ</text>',
        '<rect x="5" y="1" width="100" height="20.92" fill="red" stroke="red"/>',
      ],
      [
        "same-color-occlusion",
        '<text x="18" y="36" font-family="Arial" font-size="24">ABCD</text>',
        '<rect x="17" y="21" width="32" height="13" fill="white"/>',
      ],
    ]) {
      await fixturePage.setContent(`
        <svg width="190" height="70">
          <g role="button" aria-label="Paint control">
            <rect width="190" height="70" fill="white"/>
            ${text}
            <g data-testid="guest-count-badge">${badge}</g>
          </g>
        </svg>
      `)
      summary.a6Paint[name] = await verifyPaintControl(fixturePage.getByRole("button", { name: "Paint control" }), name)
    }
  } finally {
    await fixturePage.close()
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
    assert.equal(await notifications.evaluate((el) => el.parentElement.open), false)
    assert.equal(await readSeen(), previousSeen, "Opening Menu alone marked reception notifications as seen")
    assert.equal(await dot.count(), 1, "Menu alone cleared the unread dot")
    await page.waitForFunction(() => {
      const sheet = document.querySelector('[data-slot="sheet-content"][data-motion-state="open"]')
      return sheet && Math.abs(window.innerHeight - sheet.getBoundingClientRect().bottom) < 1
    })
    await page.screenshot({ path: path.join(outDir, "reception-390x844-menu-unread.png") })
    await page.keyboard.press("Escape")
    await accountSheet.waitFor({ state: "detached" })
    assert(await menuTrigger.evaluate((el) => document.activeElement === el), "Closing Menu did not restore focus")
    await menuTrigger.press("Enter")
    await notifications.waitFor({ state: "visible" })
    const disclosureHeight = await notifications.evaluate((el) => el.offsetHeight)
    assert(disclosureHeight >= 44, "Thông báo disclosure target is smaller than 44px")
    await notifications.press("Space")
    const firstAlert = accountSheet.locator("details button").first()
    await firstAlert.waitFor({ state: "visible" })
    await dot.waitFor({ state: "detached" })
    assert.notEqual(await readSeen(), previousSeen, "Opening Thông báo did not persist the seen notifications")
    assert(await notifications.evaluate((el) => document.activeElement === el), "Disclosure lost keyboard focus")
    await page.screenshot({ path: path.join(outDir, "reception-390x844-menu-notifications.png") })
    await firstAlert.press("Enter")
    await accountSheet.waitFor({ state: "detached" })
    const alertDetail = page.getByRole("dialog", { name: "Chi tiết Bàn G01", exact: true })
    await alertDetail.waitFor({ state: "visible" })
    await expect(alertDetail.getByRole("button", { name: "Đóng", exact: true })).toBeFocused()
    assert(
      await alertDetail.evaluate((el) => el.contains(document.activeElement)),
      "Alert detail did not receive focus",
    )
    await page.keyboard.press("Escape")
    await alertDetail.waitFor({ state: "detached" })
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor({ state: "visible" })
    summary.flows.receptionNotifications = { menuPreservedUnread: true, sectionMarkedSeen: true, detailFocus: true }

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

  // 4. Dark-theme 8-viewport BDG-01 stroke-intersection & A3 stress matrix check
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "dark" }))
    })
    const page = await context.newPage()
    const errors = attachErrorCollector(page)

    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn A7/ }).waitFor({ state: "visible" })
    await page.waitForTimeout(250)

    const darkAudit = await page.evaluate((fnSrc) => {
      const measureFn = new Function(`return (${fnSrc})`)()
      const svg = document.querySelector('[data-gm] svg[role="group"]')
      if (!svg) return { ok: false, reason: "missing svg" }
      const outlines = Array.from(svg.querySelectorAll('[data-cluster-outline="1"] > rect'))
      const hits = measureFn(svg)
      const turnBadges = Array.from(svg.querySelectorAll('[data-testid="turn-badge"]'))
      const a3Turn = svg.querySelector('[role="button"][aria-label^="Bàn A3"] [data-testid="turn-badge"]')
      return {
        ok: true,
        hits,
        turnCount: turnBadges.length,
        hasA3Turn2: a3Turn?.getAttribute("aria-label") === "Lượt 2",
        outlineCount: outlines.length,
      }
    }, measureOutlineStrokeIntersections.toString())

    assert(darkAudit.ok, `${vp.label} (dark): ${darkAudit.reason}`)
    assert.deepEqual(
      darkAudit.hits,
      [],
      `${vp.label} (dark): decoration intersected cluster outline stroke: ${darkAudit.hits.join("; ")}`,
    )
    assert(darkAudit.turnCount >= 3, `${vp.label} (dark): missing turn badges`)
    assert(darkAudit.hasA3Turn2, `${vp.label} (dark): missing A3 Lượt 2 fixture`)
    assert(darkAudit.outlineCount >= 4, `${vp.label} (dark): missing cluster outlines`)
    assert.deepEqual(errors, [], `${vp.label} (dark): errors: ${errors.join(" | ")}`)
    await context.close()
  }

  // 5. BDG-02 + ADM-05 matrix: G08 (C4+C5) + occupied C1 (14 guests, turn 12, 4 icons) + Reception Bar names across light/dark phone/iPad/laptop
  const bdg02Matrix = [
    { width: 390, height: 844, label: "390x844", theme: "light" },
    { width: 390, height: 844, label: "390x844", theme: "dark" },
    { width: 768, height: 1024, label: "768x1024", theme: "light" },
    { width: 768, height: 1024, label: "768x1024", theme: "dark" },
    { width: 1440, height: 900, label: "1440x900", theme: "light" },
    { width: 1440, height: 900, label: "1440x900", theme: "dark" },
  ]
  for (const vp of bdg02Matrix) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript((theme) => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme }))
    }, vp.theme)
    const page = await context.newPage()
    const errors = attachErrorCollector(page)

    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /^Bàn C4/ }).waitFor({ state: "visible" })
    const toastClose = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if ((await toastClose.count()) > 0) {
      await toastClose.click()
      await page.waitForTimeout(150)
    }

    await page.evaluate(async () => {
      const { api } = await import("/src/services/index.ts")
      const origGetFloorState = api.getFloorState.bind(api)
      const catalog = await api.getCatalog()
      const c4 = catalog.tables.find((t) => t.code === "C4")
      const c5 = catalog.tables.find((t) => t.code === "C5")
      const c1 = catalog.tables.find((t) => t.code === "C1")
      const bar1 = catalog.tables.find((t) => t.code === "BAR01")
      const bar2 = catalog.tables.find((t) => t.code === "BAR02")
      if (!c4 || !c5 || !c1 || !bar1 || !bar2) throw new Error("Missing C4/C5/C1/BAR01/BAR02")

      api.getFloorState = async (at) => {
        const res = await origGetFloorState(at)
        const now = new Date()
        const g08Claim = {
          kind: "visit",
          visitId: 9081,
          reservationId: null,
          waitlistEntryId: null,
          holdId: null,
          displayName: "Nhóm C4-C5",
          phoneLast3: "456",
          partySize: 8,
          startsAt: now,
          deadlineAt: null,
          paid: false,
          origin: "WALK_IN",
          tableIds: [c4.id, c5.id],
          groupId: 808,
          symbolNo: 8,
          groupDisplayCode: "G08",
          flags: ["RETURNING", "VIP"],
          warning: null,
          minutesLate: 0,
          sourceCode: null,
          note: null,
          version: 1,
        }
        const c1Claim = {
          kind: "visit",
          visitId: 9082,
          reservationId: null,
          waitlistEntryId: null,
          holdId: null,
          displayName: "Khách C1",
          phoneLast3: "123",
          partySize: 14,
          startsAt: now,
          deadlineAt: null,
          paid: false,
          origin: "WALK_IN",
          tableIds: [c1.id],
          groupId: null,
          symbolNo: null,
          groupDisplayCode: null,
          flags: ["RETURNING", "VIP", "DESIGNATED", "BIRTHDAY"],
          warning: null,
          minutesLate: 0,
          sourceCode: null,
          note: null,
          version: 1,
        }
        const bar1Claim = {
          kind: "reservation",
          visitId: null,
          reservationId: 9083,
          waitlistEntryId: null,
          holdId: null,
          displayName: "Nguyễn (090 123 4567)",
          phoneLast3: "567",
          partySize: 2,
          startsAt: now,
          deadlineAt: null,
          paid: false,
          origin: "RESERVATION",
          tableIds: [bar1.id],
          groupId: null,
          symbolNo: null,
          groupDisplayCode: null,
          flags: [],
          warning: null,
          minutesLate: 0,
          sourceCode: null,
          note: null,
          version: 1,
        }
        const bar2Claim = {
          ...bar1Claim,
          reservationId: 9084,
          displayName: "Nguyễn 18-11-2026",
          tableIds: [bar2.id],
        }
        const tables = res.tables.map((t) => {
          if (t.tableId === c4.id || t.tableId === c5.id) {
            return { ...t, state: "seated", seatedTurnCount: 2, claim: g08Claim }
          }
          if (t.tableId === c1.id) {
            return { ...t, state: "seated", seatedTurnCount: 12, claim: c1Claim }
          }
          if (t.tableId === bar1.id) {
            return { ...t, state: "reserved", claim: bar1Claim }
          }
          if (t.tableId === bar2.id) {
            return { ...t, state: "reserved", claim: bar2Claim }
          }
          return t
        })
        const groups = [
          ...res.groups.filter((g) => g.displayCode !== "G08"),
          { id: 808, symbolNo: 8, displayCode: "G08", tableIds: [c4.id, c5.id], seatedTurnCount: 2 },
        ]
        return { ...res, tables, groups }
      }

      await api.createTableGroup({ tableIds: [c4.id, c5.id] })
    })

    await page.waitForSelector('[data-cluster-outline="1"][data-cluster-code-value="G08"]', { timeout: 5000 })
    await page.waitForSelector('[role="button"][aria-label^="Bàn C1"] [data-testid="guest-count-badge"]', {
      timeout: 5000,
    })
    await page.waitForTimeout(200)

    const bdgAudit = await page.evaluate((fnSrc) => {
      const measureFn = new Function(`return (${fnSrc})`)()
      const svg = document.querySelector('[data-gm] svg[role="group"]')
      if (!svg) return { ok: false, reason: "missing svg" }
      const hits = measureFn(svg)
      const toBox = (r) =>
        r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null
      const expandBox = (r, pad) =>
        r
          ? {
              left: r.left - pad,
              top: r.top - pad,
              right: r.right + pad,
              bottom: r.bottom + pad,
            }
          : null
      const wallRect = svg.querySelector('rect[data-bg="1"]')?.getBoundingClientRect()
      const wallScale = wallRect ? wallRect.width / 370 : 1
      const outlineHalfStroke = 0.8 * wallScale
      const pillHalfStroke = 0.7 * wallScale

      const g08Outline = expandBox(
        svg.querySelector('[data-cluster-outline="1"][data-cluster-code-value="G08"] > rect')?.getBoundingClientRect(),
        outlineHalfStroke,
      )
      const g08Pill = expandBox(
        svg.querySelector('[data-cluster-code="1"][data-cluster-code-value="G08"] rect')?.getBoundingClientRect(),
        pillHalfStroke,
      )
      const g03Outline = expandBox(
        svg.querySelector('[data-cluster-outline="1"][data-cluster-code-value="G03"] > rect')?.getBoundingClientRect(),
        outlineHalfStroke,
      )
      const g02Outline = expandBox(
        svg.querySelector('[data-cluster-outline="1"][data-cluster-code-value="G02"] > rect')?.getBoundingClientRect(),
        outlineHalfStroke,
      )
      const c1 = svg.querySelector('[role="button"][aria-label^="Bàn C1"]')
      const c1GuestBadge = toBox(
        c1?.querySelector('[data-testid="guest-count-badge"]')?.getBoundingClientRect() ?? null,
      )
      const c1LeftIcons = toBox(
        c1?.querySelector('[data-testid="table-icons-bottom-left"]')?.getBoundingClientRect() ?? null,
      )
      const a3Turn = svg.querySelector('[role="button"][aria-label^="Bàn A3"] [data-testid="turn-badge"]')
      const barText = document.querySelector('[data-testid="bar-guest-list"]')?.textContent ?? ""

      const c1Box = toBox(c1?.getBoundingClientRect() ?? null)
      const cropClip =
        g08Outline && c1Box
          ? {
              x: Math.max(0, Math.floor(Math.min(g08Outline.left, c1Box.left) - 42)),
              y: Math.max(0, Math.floor(Math.min(g08Outline.top, c1Box.top) - 24)),
              width:
                Math.ceil(Math.max(g08Outline.right, c1Box.right) + 28) -
                Math.max(0, Math.floor(Math.min(g08Outline.left, c1Box.left) - 42)),
              height:
                Math.ceil(Math.max(g08Outline.bottom, c1Box.bottom) + 24) -
                Math.max(0, Math.floor(Math.min(g08Outline.top, c1Box.top) - 24)),
            }
          : null

      return {
        ok: true,
        hits,
        g08Outline,
        g08Pill,
        g02G03GapPx: g02Outline && g03Outline ? g02Outline.top - g03Outline.bottom : -1,
        c1GuestBadge,
        c1LeftIcons,
        hasA3Turn2: a3Turn?.getAttribute("aria-label") === "Lượt 2",
        barPreservesPhoneName: barText.includes("Nguyễn (090 123 4567)"),
        barPreservesDateName: barText.includes("Nguyễn 18-11-2026"),
        cropClip,
      }
    }, measureOutlineStrokeIntersections.toString())

    assert(bdgAudit.ok, `${vp.label} (${vp.theme}) BDG-02: ${bdgAudit.reason}`)
    assert.deepEqual(
      bdgAudit.hits,
      [],
      `${vp.label} (${vp.theme}) BDG-02: stroke intersections: ${bdgAudit.hits.join("; ")}`,
    )
    assert(bdgAudit.g08Outline && bdgAudit.c1GuestBadge && bdgAudit.c1LeftIcons, "Missing G08 or C1 decorations")
    assert(
      !rectsOverlap(bdgAudit.c1GuestBadge, bdgAudit.g08Outline, 0.2),
      `${vp.label} (${vp.theme}) BDG-02: C1 guest badge overlaps G08 outline`,
    )
    assert(
      !rectsOverlap(bdgAudit.c1LeftIcons, bdgAudit.g08Outline, 0.2),
      `${vp.label} (${vp.theme}) BDG-02: C1 bottom-left icon overlaps G08 outline`,
    )
    if (bdgAudit.g08Pill) {
      assert(
        !rectsOverlap(bdgAudit.g08Pill, bdgAudit.c1GuestBadge, 0),
        `${vp.label} (${vp.theme}) BDG-02: G08 pill overlaps C1 guest badge`,
      )
    }
    assert(bdgAudit.g02G03GapPx > 0.2, `${vp.label} (${vp.theme}): G02/G03 gap collapsed (${bdgAudit.g02G03GapPx})`)
    assert(bdgAudit.hasA3Turn2, `${vp.label} (${vp.theme}): missing A3 Lượt 2`)
    assert(
      bdgAudit.barPreservesPhoneName,
      `${vp.label} (${vp.theme}) ADM-05: Reception Bar lost "Nguyễn (090 123 4567)"`,
    )
    assert(bdgAudit.barPreservesDateName, `${vp.label} (${vp.theme}) ADM-05: Reception Bar lost "Nguyễn 18-11-2026"`)
    assert.deepEqual(errors, [], `${vp.label} (${vp.theme}) BDG-02 errors: ${errors.join(" | ")}`)

    if (vp.label === "1440x900" && vp.theme === "light" && bdgAudit.cropClip) {
      const cropDir = process.env.C1_CROP_DIR || outDir
      if (fs.existsSync(cropDir)) {
        await page.screenshot({ path: path.join(cropDir, "c1-c4-c5-crop-after.png"), clip: bdgAudit.cropClip })
      }
      await page.screenshot({ path: path.join(outDir, "reception-bdg02-1440x900.png") })
    }

    summary.bdg02Matrix.push({
      viewport: vp.label,
      theme: vp.theme,
      hits: bdgAudit.hits.length,
      g08ToC1BadgeGapPx: Number((bdgAudit.c1GuestBadge.left - bdgAudit.g08Outline.right).toFixed(2)),
      g02G03GapPx: Number(bdgAudit.g02G03GapPx.toFixed(2)),
    })
    await context.close()
  }
} finally {
  await browser.close()
  await server?.close()
}

console.log(JSON.stringify(summary, null, 2))
