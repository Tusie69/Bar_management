import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs, stripVTControlCharacters } from "node:util"
import { chromium } from "@playwright/test"
import axe from "axe-core"

const { values } = parseArgs({ options: { out: { type: "string" }, phase: { type: "string", default: "all" } } })
const out = path.resolve(values.out ?? path.join(import.meta.dirname, ".artifacts/ui-audit-2026-11-23"))
const base = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:35123")
const api = new URL(process.env.E2E_API_URL ?? "http://127.0.0.1:34123")
assert(["all", "quiet", "busy"].includes(values.phase), "Use --phase all, quiet or busy")
assert(
  [base, api].every((url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
  "Use local audit servers",
)

const sizes = [
  [320, 640],
  [360, 780],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [820, 1180],
  [1180, 820],
  [1024, 1366],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [640, 400, 2],
  [1280, 600],
  [390, 600],
]
const interactionSizes = [
  [390, 844],
  [820, 1180],
  [1440, 900],
]
const portals = {
  receptionist: "letan",
  cashier: "thungan",
  waiter: "phucvu",
  bar: "chebien",
  kitchen: "chebien",
  owner: "admin",
}
const screens = {
  receptionist: ["/floor"],
  cashier: ["/floor"],
  waiter: ["/phucvu", "/phucvu/hang-doi"],
  bar: ["/chebien"],
  kitchen: ["/chebien"],
  owner: ["/home", "/overview", "/floor", "/reservations", "/waitlist", "/guests", "/reports", "/settings"],
  admin: ["overview", "reports", "reconciliation", "customers", "visits", "accounts", "settings", "audit"].map(
    (s) => "/admin/" + s,
  ),
}
const logins = ["letan", "thungan", "phucvu", "chebien", "admin"]
const aliases = ["receptionist", "cashier", "waiter", "preparation"]
const loginRoles = { letan: "receptionist", thungan: "cashier", phucvu: "waiter", chebien: "bar", admin: "owner" }
const loginStates = ["disabled-submit", "loading", "wrong-password"]
const slug = (value) =>
  value === "/"
    ? "landing"
    : value
        .replace(/^\//, "")
        .replace(/[^-a-z0-9]+/gi, "-")
        .toLowerCase()
const safeUrl = (input) => {
  const url = new URL(input)
  return url.origin + url.pathname
}
const block = (role, route, state, reason) => blocked.push({ role, route, state, reason })
const records = []
const blocked = []
const audited = new Set()
const evidenceName = (role, route, state, [width, height]) =>
  [role, slug(route), state, width + "x" + height].join("-") + ".png"
const hasShot = (role, route, state, size) =>
  records.some((record) => record.file === evidenceName(role, route, state, size))

// Runs inside Chromium. Scroll and clipping evidence are relative to the current viewport.
function measure() {
  const nodes = [...document.querySelectorAll("body *")].filter(
    (el) => el instanceof HTMLElement || el instanceof SVGElement,
  )
  const name = (el) => {
    const label = el.getAttribute("aria-label") ?? el.getAttribute("data-testid") ?? el.getAttribute("title")
    const content = el.matches("input,textarea,[contenteditable]") ? el.getAttribute("placeholder") : el.textContent
    return {
      selector: el.localName + (el.id ? "#" + el.id : ""),
      label: (label ?? content ?? "").trim().replace(/\s+/g, " ").slice(0, 90),
    }
  }
  const visible = []
  const collapsed = []
  for (const el of nodes) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility !== "visible" || el.closest("[hidden]")) continue
    const box = el.getBoundingClientRect()
    if (box.height <= 1 && el.scrollHeight > 8 && /auto|scroll|hidden/.test(style.overflowY)) collapsed.push(name(el))
    if (box.width > 0 && box.height > 0) visible.push({ el, box, style })
  }
  const interactives = visible.filter(({ el }) =>
    el.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=link]"),
  )
  const smallTargets = []
  const clipped = []
  const overlaps = []
  const layers = visible.filter(
    ({ style, box }) =>
      /^(fixed|sticky)$/.test(style.position) &&
      box.right > 0 &&
      box.bottom > 0 &&
      box.left < innerWidth &&
      box.top < innerHeight,
  )
  for (const { el, box } of interactives) {
    const target = { ...name(el), width: Math.round(box.width), height: Math.round(box.height) }
    if (innerWidth <= 1024 && (box.width < 44 || box.height < 44)) smallTargets.push(target)
    const x = (box.left + box.right) / 2
    const y = (box.top + box.bottom) / 2
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
      clipped.push({ ...target, reason: "outside-viewport" })
      continue
    }
    const hit = document.elementFromPoint(x, y)
    if (!el.contains(hit) && !hit?.contains(el) && !el.closest("[inert]")) {
      clipped.push({ ...target, reason: "covered", by: hit && name(hit) })
      const layer = layers.find(({ el: overlay }) => overlay.contains(hit) && !overlay.contains(el))
      if (layer) overlaps.push({ overlay: name(layer.el), target })
    } else if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) {
      clipped.push({ ...target, reason: "partly-outside-viewport" })
    }
  }
  for (const layer of layers) {
    const { el, box } = layer
    const x = Math.min(innerWidth - 1, Math.max(0, (box.left + box.right) / 2))
    const y = Math.min(innerHeight - 1, Math.max(0, (box.top + box.bottom) / 2))
    const hit = document.elementFromPoint(x, y)
    const cover = layers.find(
      ({ el: other }) => other !== el && other.contains(hit) && !other.contains(el) && !el.contains(other),
    )
    if (cover) overlaps.push({ overlay: name(cover.el), target: name(el) })
  }
  const truncated = visible
    .filter(
      ({ el, style }) =>
        el.clientWidth > 0 &&
        el.clientHeight > 0 &&
        ((el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(style.overflowX)) ||
          (el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(style.overflowY))) &&
        (el.matches(".truncate,[class*=line-clamp]") ||
          [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) &&
        !el.closest("[title],[data-state][aria-describedby],[data-slot=tooltip-trigger]"),
    )
    .map(({ el }) => name(el))
  const scrollWidth = document.documentElement.scrollWidth
  return {
    overflowX: scrollWidth > innerWidth,
    overflowElements:
      scrollWidth > innerWidth
        ? visible
            .filter(({ box }) => box.right > innerWidth + 1 || box.left < -1)
            .map(({ el, box }) => ({ ...name(el), left: Math.round(box.left), right: Math.round(box.right) }))
        : [],
    clipped,
    smallTargets,
    truncated,
    collapsed,
    overlaps,
  }
}

function scrollContainers() {
  return [...document.querySelectorAll("body *")].filter((el) => {
    const style = getComputedStyle(el)
    return (
      el.clientWidth > 0 &&
      el.clientHeight > 0 &&
      ((/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2) ||
        (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2))
    )
  })
}

function setup(page) {
  const errors = new Set()
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.add(msg.text())
  })
  page.on("pageerror", (err) => errors.add(err.message))
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText !== "net::ERR_ABORTED")
      errors.add(req.method() + " " + safeUrl(req.url()) + " " + req.failure()?.errorText)
  })
  page.on("response", (res) => {
    if (res.status() >= 400) errors.add(res.request().method() + " " + safeUrl(res.url()) + " HTTP " + res.status())
  })
  return errors
}

function sanitize(text) {
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(E2E_.*PASSWORD|DB_PASSWORD|MYSQL_ROOT_PASSWORD)$/.test(key) && value)
      text = text.replaceAll(value, "[redacted]")
  }
  return stripVTControlCharacters(text)
    .replace(/https?:\/\/[^\s"')]+/g, (url) => {
      try {
        return safeUrl(url)
      } catch {
        return url
      }
    })
    .slice(0, 700)
}

async function settle(page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.trim() &&
      !/^Đang (tải|kiểm tra)[^.]*\.{0,3}$/.test(document.body.innerText.trim()) &&
      !document.querySelector('[aria-busy=true][aria-label^="Đang tải"]'),
    undefined,
    { timeout: 6000 },
  )
  await page.evaluate(() =>
    Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(resolve, 3000))]),
  )
  await page.waitForTimeout(140)
}

async function shot(page, errors, role, route, state, { fullPage = false, checkAxe = false, scroll } = {}) {
  const viewport = { ...page.viewportSize(), deviceScaleFactor: await page.evaluate(() => devicePixelRatio) }
  const file = evidenceName(role, route, state, [viewport.width, viewport.height])
  if (records.some((record) => record.file === file)) return
  const finalUrl = page.url()
  let axeViolations = []
  const key = role + route + viewport.width
  if (checkAxe && [390, 1440].includes(viewport.width) && !audited.has(key)) {
    try {
      await page.evaluate(axe.source)
      axeViolations = await page.evaluate(async () =>
        (await window.axe.run({ resultTypes: ["violations"] })).violations
          .filter((issue) => ["serious", "critical"].includes(issue.impact))
          .map(({ id, impact, description, nodes }) => ({
            id,
            impact,
            description,
            targets: nodes.map((node) => node.target),
          })),
      )
      audited.add(key)
    } catch (error) {
      block(role, route, "axe-" + viewport.width, sanitize(error.message))
    }
  }
  const findings = await page.evaluate(measure)
  await page.screenshot({ path: path.join(out, file), fullPage, animations: "disabled", caret: "hide", timeout: 9000 })
  records.push({
    role,
    route,
    requestedUrl: new URL(route, base).href,
    finalUrl,
    state,
    viewport,
    file,
    ...(scroll && { scroll }),
    ...findings,
    consoleErrors: [...errors].map(sanitize),
    axe: axeViolations,
  })
}

async function capture(page, errors, role, route, state, checkAxe = false) {
  await shot(page, errors, role, route, state, { fullPage: true, checkAxe })
  const rootMax = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)
  if (rootMax > 2) {
    for (const [label, ratio] of [
      ["mid", 0.5],
      ["bottom", 1],
    ]) {
      await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), rootMax * ratio)
      await shot(page, errors, role, route, state + "-page-" + label, { scroll: { root: true, position: label } })
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }))
  }
  const handles = await (await page.evaluateHandle(scrollContainers)).getProperties()
  for (const [index, handle] of handles) {
    const el = handle.asElement()
    if (!el) continue
    const container = await el.evaluate(
      (node) => node.id || node.getAttribute("data-testid") || node.getAttribute("data-slot") || node.localName,
    )
    const starting = await el.evaluate((node) => [node.scrollLeft, node.scrollTop])
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 2500 })
      for (const [label, ratio] of [
        ["mid", 0.5],
        ["bottom", 1],
      ]) {
        const position = await el.evaluate((node, fraction) => {
          node.scrollTo({
            left: (node.scrollWidth - node.clientWidth) * fraction,
            top: (node.scrollHeight - node.clientHeight) * fraction,
            behavior: "instant",
          })
          return { x: node.scrollLeft, y: node.scrollTop }
        }, ratio)
        await shot(page, errors, role, route, state + "-scroll-" + index + "-" + label, {
          scroll: { container, index: Number(index), position: label, ...position },
        })
      }
    } catch (error) {
      block(role, route, state + "-scroll-" + index, sanitize(error.message))
    } finally {
      await el
        .evaluate((node, [left, top]) => node.scrollTo({ left, top, behavior: "instant" }), starting)
        .catch(() => {})
      await handle.dispose()
    }
  }
}

const load = async (page, route) => {
  const login = route.endsWith("/login")
  const navigation = page.goto(new URL(route, base).href, { waitUntil: "domcontentloaded" })
  if (login) {
    await navigation
    await page.getByLabel("Tên đăng nhập", { exact: true }).waitFor()
  } else {
    const [session] = await Promise.all([
      page.waitForResponse((res) => res.url() === new URL("/api/v1/auth/me", api).href, { timeout: 9000 }),
      navigation,
    ])
    assert(session.ok(), "Protected route " + route + " returned auth/me HTTP " + session.status())
    await page.waitForFunction(
      () =>
        !!document.querySelector("main, [role=main], #root button, #root h1") &&
        !document.querySelector("#root input[type=password]"),
      undefined,
      { timeout: 9000 },
    )
  }
  await settle(page)
  assert(
    login ||
      (!new URL(page.url()).pathname.endsWith("/login") &&
        !(await page.getByLabel("Tên đăng nhập", { exact: true }).isVisible())),
    "Login shown for protected route " + route,
  )
}
const submit = (page) => page.getByRole("button", { name: /^(Đăng nhập|Đang đăng nhập)/ })
const credentials = (role) => {
  const prefix = "E2E_" + role.toUpperCase()
  const username = process.env[prefix + "_USERNAME"]
  const password = process.env[prefix + "_PASSWORD"]
  assert(username && password, "Missing " + prefix + "_USERNAME or " + prefix + "_PASSWORD")
  return { username, password }
}
async function login(page, role) {
  const { username, password } = credentials(role)
  await page.goto(new URL("/" + portals[role] + "/login", base).href, { waitUntil: "domcontentloaded" })
  await page.getByLabel("Tên đăng nhập", { exact: true }).fill(username)
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password)
  const response = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/auth/login") && res.request().method() === "POST",
  )
  await submit(page).click()
  const res = await response
  assert(res.ok(), role + " login HTTP " + res.status())
  await page.waitForURL((url) => !url.pathname.endsWith("/login"))
  const session = await page.request.get(new URL("/api/v1/auth/me", api).href, {
    headers: { origin: base.origin },
    timeout: 9000,
  })
  assert(session.ok(), role + " session HTTP " + session.status())
  return (await session.json()).csrfToken
}
async function visitScreen(page, role, route) {
  await load(page, route)
  const actual = new URL(page.url()).pathname
  if (actual !== route) block(role, route, "route-redirect", "Router opened " + actual)
}
async function openPage(browser, state, [width, height, deviceScaleFactor = 1]) {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width, height },
    deviceScaleFactor,
    locale: "vi-VN",
  })
  const page = await context.newPage()
  if (process.env.E2E_FIXED_NOW) await page.clock.setFixedTime(new Date(process.env.E2E_FIXED_NOW))
  page.setDefaultTimeout(6500)
  return { page, errors: setup(page), context }
}
async function attempt(role, route, state, fn) {
  try {
    return await fn()
  } catch (error) {
    block(role, route, state, sanitize(error.message))
  }
}

async function loginShots(browser) {
  for (const portal of [...logins, ...aliases]) {
    const route = "/" + portal + "/login"
    for (const size of aliases.includes(portal) ? [[390, 844]] : sizes) {
      if (hasShot("login", route, "empty", size)) continue
      const { page, errors, context } = await openPage(browser, undefined, size)
      try {
        await attempt("login", route, "empty-" + size.join("x"), async () => {
          await load(page, route)
          assert(await submit(page).isDisabled(), "Empty login submit is enabled")
          await capture(page, errors, "login", route, "empty", true)
        })
      } finally {
        await context.close()
      }
    }
    if (aliases.includes(portal)) continue
    for (const size of [...interactionSizes, [390, 500]]) {
      const states = size[1] === 500 ? ["keyboard"] : loginStates
      if (states.every((state) => hasShot("login", route, state, size))) continue
      const { page, errors, context } = await openPage(browser, undefined, size)
      try {
        await attempt("login", route, "interactions-" + size.join("x"), async () => {
          await load(page, route)
          const username = page.getByLabel("Tên đăng nhập", { exact: true })
          const password = page.getByLabel("Mật khẩu", { exact: true })
          await username.fill(credentials(loginRoles[portal]).username)
          if (size[1] === 500) {
            await password.focus()
            await capture(page, errors, "login", route, "keyboard")
            return
          }
          assert(await submit(page).isDisabled(), "Submit must be disabled when password is empty")
          await capture(page, errors, "login", route, "disabled-submit")
          if (!blocked.some((entry) => entry.route === route && entry.state === "validation-error")) {
            block(
              "login",
              route,
              "validation-error",
              "Form disables submission with an empty username or password and has no separate client validation message.",
            )
          }
          await password.fill(randomUUID())
          let allowRequest
          const pending = new Promise((resolve) => {
            allowRequest = resolve
          })
          await page.route("**/api/v1/auth/login", async (request) => {
            if (request.request().method() === "POST") await pending
            await request.continue()
          })
          try {
            await submit(page).click()
            assert(await submit(page).isDisabled(), "Login submit did not enter pending state")
            await shot(page, errors, "login", route, "loading", { fullPage: true })
          } finally {
            allowRequest()
          }
          await page.getByRole("alert").first().waitFor()
          await capture(page, errors, "login", route, "wrong-password")
        })
      } finally {
        await context.close()
      }
    }
  }
}

async function routeShots(browser, sessions, phase, dynamic = {}) {
  for (const [role, routes] of Object.entries({
    ...screens,
    waiter: [
      ...screens.waiter,
      ...(dynamic.visitId
        ? ["/phucvu/phien/" + dynamic.visitId + "/goi-mon", "/phucvu/orders/" + dynamic.visitId]
        : []),
    ],
    admin: [
      ...screens.admin,
      ...(dynamic.customerId ? ["/admin/customers/" + dynamic.customerId] : []),
      "/duyet-huy-mon",
    ],
  })) {
    const session = sessions[role === "admin" ? "owner" : role]
    if (!session) continue
    const remaining = [...sizes]
    const captureSizes = async () => {
      for (let size; (size = remaining.shift());) {
        const missing = routes.filter((route) => !hasShot(role, route, phase, size))
        if (!missing.length) continue
        const { page, errors, context } = await openPage(browser, session.storage, size)
        try {
          for (const route of missing) {
            errors.clear()
            await attempt(role, route, phase + "-" + size.join("x"), async () => {
              await visitScreen(page, role, route)
              await capture(page, errors, role, route, phase, true)
            })
          }
        } finally {
          await context.close()
        }
      }
    }
    await Promise.all(Array.from({ length: 3 }, captureSizes))
    console.log(phase + " " + role + " " + records.length + " screenshots")
    await save()
  }
}

async function save() {
  records.sort((a, b) => a.file.localeCompare(b.file, "en", { numeric: true }))
  assert.equal(new Set(records.map((record) => record.file)).size, records.length, "Evidence filenames must be unique")
  await writeFile(path.join(out, "findings.json"), JSON.stringify(records, null, 2))
  const unresolved = blocked.filter(({ role, route, state }) => {
    const match = /^(.*)-(\d+)x(\d+)(?:x2)?$/.exec(state)
    if (!match) return true
    const [, label, width, height] = match
    const requested =
      label === "interactions"
        ? height === "500"
          ? ["keyboard"]
          : loginStates
        : [label + (height === "500" ? "-keyboard" : "")]
    return !requested.every((name) => hasShot(role, route, name, [width, height]))
  })
  const uniqueBlocks = [
    ...new Set(unresolved.map((entry) => JSON.stringify({ ...entry, reason: sanitize(entry.reason) }))),
  ].map((entry) => JSON.parse(entry))
  await writeFile(path.join(out, "blocked.json"), JSON.stringify(uniqueBlocks, null, 2))
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  const groups = Map.groupBy(records, ({ role }) => role)
  const html = [...groups]
    .map(
      ([role, routes]) =>
        "<section><h2>" +
        esc(role) +
        "</h2>" +
        [...Map.groupBy(routes, ({ route }) => route)]
          .map(
            ([route, states]) =>
              "<h3>" +
              esc(route) +
              "</h3>" +
              [...Map.groupBy(states, ({ state }) => state)]
                .map(
                  ([state, images]) =>
                    "<details><summary>" +
                    esc(state) +
                    " (" +
                    images.length +
                    ")</summary><div class=grid>" +
                    images
                      .map(
                        ({ file, viewport }) =>
                          '<figure><a href="' +
                          esc(file) +
                          '"><img loading="lazy" src="' +
                          esc(file) +
                          '" alt="' +
                          esc(file) +
                          '"></a><figcaption>' +
                          viewport.width +
                          " × " +
                          viewport.height +
                          "</figcaption></figure>",
                      )
                      .join("") +
                    "</div></details>",
                )
                .join(""),
          )
          .join("") +
        "</section>",
    )
    .join("")
  await writeFile(
    path.join(out, "index.html"),
    '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NA-40 | 21GAM</title><style>body{font:16px system-ui;margin:24px;background:#15181e;color:#fff}details{margin:8px 0}summary{cursor:pointer}.grid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(180px,1fr);overflow:auto;gap:12px}figure{margin:0}img{width:100%;height:220px;object-fit:contain}a{color:#a9d8ff}</style><h1>NA-40 | Kiểm kê giao diện 21GAM</h1><p>' +
      records.length +
      ' ảnh · <a href="findings.json">Số đo</a> · <a href="blocked.json">Các mục bị chặn</a></p>' +
      html +
      "</html>",
  )
  return uniqueBlocks.length
}

await mkdir(out, { recursive: true })
if (values.phase === "busy") {
  for (const [name, target] of [
    ["findings", records],
    ["blocked", blocked],
  ]) {
    try {
      target.push(...JSON.parse(await readFile(path.join(out, name + ".json"), "utf8")))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  const authenticated = records.filter(
    (record) =>
      record.role === "login" || !record.consoleErrors.some((error) => /\/api\/v1\/auth\/me HTTP 401$/.test(error)),
  )
  records.splice(0, records.length, ...authenticated)
  for (const record of records)
    if (record.state === "quiet" && [390, 1440].includes(record.viewport.width)) {
      audited.add(record.role + record.route + record.viewport.width)
    }
}
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : { channel: "chrome" },
)
let blockedCount
try {
  const sessions = {}
  for (const role of Object.keys(portals)) {
    console.log("Authenticating " + role)
    const { page, context } = await openPage(browser, undefined, [1440, 900])
    try {
      const csrf = await login(page, role)
      sessions[role] = { storage: await context.storageState(), csrf }
    } finally {
      await context.close()
    }
  }
  if (values.phase !== "busy") {
    await loginShots(browser)
    await save()
    await routeShots(browser, sessions, "quiet")
    await save()
  }
  if (values.phase !== "quiet") {
    if (values.phase === "busy" && records.some((record) => record.state === "quiet")) {
      await loginShots(browser)
      await routeShots(browser, sessions, "quiet")
    }
    const { seedBusy, interactions } = await import("./ui-audit-seed.mjs")
    const fixturePath = path.join(out, ".fixture.json")
    let dynamic
    if (values.phase === "busy") {
      try {
        dynamic = JSON.parse(await readFile(fixturePath, "utf8"))
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
    }
    if (!dynamic) {
      dynamic = await seedBusy({ browser, api, base, sessions, credentials, block })
      await writeFile(fixturePath, JSON.stringify(dynamic))
    }
    await routeShots(browser, sessions, "busy", dynamic)
    await interactions({
      browser,
      sessions,
      dynamic,
      interactionSizes,
      openPage,
      visitScreen,
      capture,
      attempt,
      hasShot,
      block,
    })
  }
  assert(records.length > 0, "No evidence generated")
} finally {
  await browser.close()
  blockedCount = await save()
}
console.log(records.length + " screenshots, " + blockedCount + " blocked observations")
