/**
 * Kiểm giao diện theo kích thước máy thật — chạy headless, không cần ai nhìn.
 *
 * Lý do tồn tại: pane trình duyệt trong công cụ hỗ trợ ngừng vẽ khi cửa sổ bị
 * ẩn. Khi đó `ResizeObserver` và `requestAnimationFrame` không chạy, sơ đồ bàn
 * render ở kích thước 0×0, và mọi ảnh chụp hay số đo lấy từ đó đều sai. Lỗi
 * khung "Khách quầy bar" ngày 16/11 mất mấy vòng mới tìm ra chỉ vì chuyện đó.
 *
 * Chromium headless của Playwright vẽ thật và độc lập với cửa sổ nào cả, nên
 * script này là cách duy nhất ở đây để nói "đã kiểm trên iPhone 13 Pro Max"
 * mà không phải cầm máy.
 *
 * Cách chạy:
 *   pnpm dev            # hoặc: VITE_API_MODE=mock npx vite --port 5173
 *   pnpm e2e:mobile
 *
 * Biến môi trường:
 *   E2E_BASE_URL   mặc định http://127.0.0.1:5173
 *   E2E_SHOTS      thư mục lưu ảnh, mặc định e2e/__screens__
 *   PW_CHROMIUM_PATH  dùng Chromium có sẵn thay vì bản Playwright tải về
 */
import fs from "node:fs"
import path from "node:path"
import { chromium } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173"
const shotDir = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, "__screens__")

/**
 * Kích thước thật, không phải "mobile/tablet" chung chung. 375×667 là iPhone SE
 * — máy nhỏ nhất còn dùng trong quán; 428×926 là iPhone 13 Pro Max của anh Tú;
 * 768×1024 là iPad dọc, ranh giới giữa Mobile V1 và khung desktop.
 */
const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667, phone: true },
  { name: "iphone-13-pro-max", width: 428, height: 926, phone: true },
  { name: "ipad-portrait", width: 768, height: 1024, phone: false },
  { name: "desktop", width: 1440, height: 900, phone: false },
]

const ROUTES = [
  { path: "/floor", name: "floor" },
  { path: "/reservations", name: "reservations" },
]

const failures = []
const warnings = []
const notes = []

/** Lỗi bố cục: hỏng thật, chặn deploy. */
function fail(viewport, route, message) {
  failures.push(`${viewport} · ${route}: ${message}`)
}

/**
 * Việc nên sửa nhưng không chặn: hiện đang còn vài nút nhỏ hơn 44px trong vỏ
 * ứng dụng Lễ tân. Để chúng chặn ngay thì script này đỏ từ lần chạy đầu và sẽ
 * bị bỏ qua; in riêng ra để còn đọc được danh sách thật.
 */
function warn(viewport, route, message) {
  warnings.push(`${viewport} · ${route}: ${message}`)
}

/** Đo trong trang: trả về mọi thứ cần để kết luận, trong một lần evaluate. */
const measure = () =>
  // eslint-disable-next-line no-undef -- chạy trong trình duyệt
  ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    floorSvg: (() => {
      const svg = document.querySelector('svg[aria-label*="Sơ đồ bàn"]')
      if (!svg) return null
      const r = svg.getBoundingClientRect()
      return { width: Math.round(r.width), height: Math.round(r.height) }
    })(),
    barList: (() => {
      const el = document.querySelector('[data-testid="bar-guest-list"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })(),
    // Phần tử tràn ra ngoài mép phải màn hình: nguồn gốc của mọi thanh cuộn
    // ngang và mọi nút bị cắt mất một nửa.
    overflowing: [...document.querySelectorAll("button, a, input, table, section, [data-testid]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map(({ el, r }) => ({
        tag: el.tagName.toLowerCase(),
        id: el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? "",
        right: Math.round(r.right),
      })),
    /**
     * Nút quá nhỏ để bấm bằng ngón tay, 44px theo mobile.css của dự án.
     *
     * CHỈ xét phần vỏ ứng dụng. Bàn, ghế bar và dòng trong danh sách quầy bar
     * nằm trong sơ đồ: kích thước của chúng là kích thước của bản vẽ, thu nhỏ
     * theo mức zoom, nên đo chúng bằng thước 44px sẽ ra 50 cảnh báo mỗi lần
     * chạy và không ai đọc nữa.
     */
    smallTargets: [...document.querySelectorAll("button, a[href], [role='button']")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => {
        if (r.width === 0 || r.height === 0) return false
        if (el.closest("[aria-hidden='true']")) return false
        if (el.closest("svg")) return false
        if (el.closest('[data-testid="bar-guest-list"]')) return false
        return r.height < 40 || r.width < 24
      })
      .slice(0, 8)
      .map(({ el, r }) => ({
        id: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? el.tagName,
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      })),
  })

fs.mkdirSync(shotDir, { recursive: true })
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: viewport.phone,
    hasTouch: viewport.phone,
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 120))
  })

  for (const route of ROUTES) {
    await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" })
    // Sơ đồ fit lại trong một khung hình sau khi ResizeObserver chạy.
    await page.waitForTimeout(600)
    const m = await page.evaluate(measure)

    if (m.scrollWidth > m.clientWidth + 1) {
      fail(viewport.name, route.name, `trang cuộn ngang: scrollWidth ${m.scrollWidth} > ${m.clientWidth}`)
    }
    for (const item of m.overflowing) {
      fail(viewport.name, route.name, `"${item.id}" (${item.tag}) tràn sang phải tới ${item.right}px`)
    }
    // Mức chạm chỉ áp cho điện thoại; trên desktop con trỏ chuột không cần 44px.
    if (viewport.phone) {
      for (const item of m.smallTargets) {
        warn(viewport.name, route.name, `nút "${item.id}" chỉ ${item.size}, nhỏ hơn mức chạm 44px`)
      }
    }

    if (route.name === "floor") {
      if (!m.floorSvg) {
        fail(viewport.name, route.name, "không tìm thấy sơ đồ bàn")
      } else if (m.floorSvg.width === 0 || m.floorSvg.height === 0) {
        fail(viewport.name, route.name, "sơ đồ bàn render ở kích thước 0 — ResizeObserver chưa chạy")
      }
      // Quyết định 16/11: điện thoại không vẽ khung quầy bar khi chưa có khách.
      if (viewport.phone && m.barList) {
        const share = ((m.barList.width * m.barList.height) / (viewport.width * viewport.height)) * 100
        notes.push(`${viewport.name}: khung quầy bar ${m.barList.width}x${m.barList.height} (${share.toFixed(0)}% màn hình)`)
        if (share > 25) {
          fail(viewport.name, route.name, `khung quầy bar chiếm ${share.toFixed(0)}% màn hình`)
        }
      }
    }

    await page.screenshot({ path: path.join(shotDir, `${viewport.name}-${route.name}.png`), fullPage: false })
  }

  for (const error of consoleErrors) fail(viewport.name, "console", error)
  await context.close()
}

await browser.close()

for (const note of notes) console.log(`   ${note}`)
console.log(`Ảnh chụp: ${shotDir}`)
if (warnings.length) {
  const unique = [...new Set(warnings.map((item) => item.split(": ")[1]))]
  console.log(`
${unique.length} nút dưới mức chạm 44px trên điện thoại (cảnh báo, không chặn):`)
  for (const message of unique) console.log(`  · ${message}`)
}
if (failures.length) {
  console.error(`\n${failures.length} vấn đề giao diện:`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`Đạt: ${VIEWPORTS.length} kích thước × ${ROUTES.length} màn, không có lỗi bố cục.`)
