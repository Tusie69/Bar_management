// Chromium emulation only. Run from web/: node e2e/redesign-motion.mjs --base http://localhost:5190 --out e2e/.artifacts/redesign-before/motion
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { chromium, expect } from "@playwright/test"
import { args, contextFor, fixedTime, launchOptions, openCreateAccount, openTable, settle } from "./redesign-visual.mjs"

const scenarios = [
  { screen: "admin-drawer", w: 390, h: 844, url: "/admin/overview" },
  { screen: "reception-sheet", w: 390, h: 844, url: "/floor" },
  { screen: "admin-dialog", w: 1440, h: 900, url: "/admin/accounts" },
]

async function load(page, job, base) {
  await page.clock.setFixedTime(new Date(fixedTime))
  await page.goto(new URL(job.url, base).href)
  await settle(page)
  assert.equal(
    await page.evaluate(async () => (await import("/src/services/index.ts")).api.mode),
    "mock",
    "Start the target Vite server with VITE_API_MODE=mock",
  )
  if (job.screen.startsWith("admin")) await expect(page.getByTestId("admin-shell")).toBeVisible()
  else await expect(page.getByRole("button", { name: /^(Bàn )?C4(?:,|\s|$)/ }).first()).toBeVisible()
}

async function open(page, job) {
  if (job.screen === "admin-drawer") await page.getByTestId("admin-menu-trigger").click()
  else if (job.screen === "admin-dialog") await openCreateAccount(page)
  else await openTable(page)
}

async function close(page, job) {
  if (job.screen === "admin-drawer") {
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("admin-drawer-panel")).toBeHidden()
  } else if (job.screen === "admin-dialog") {
    // BEFORE uses an inline create section; AFTER may use a dialog with the same heading and close action.
    await page
      .getByRole("button", { name: /^(Đóng|Close|Hủy)$/ })
      .last()
      .click()
    await expect(page.getByRole("heading", { name: "Tạo tài khoản", exact: true })).toBeHidden()
  } else {
    const dialog = page.getByRole("dialog").last()
    await dialog
      .getByRole("button", { name: /^(Đóng|Close|Hủy)$/ })
      .last()
      .click()
    await expect(dialog).toBeHidden()
  }
}

async function frames(page, dir, transition, action) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 80, captureBeyondViewport: false })
  const start = performance.now(),
    samples = []
  // Start the user interaction and screenshot sampling together; record actual timing when encoding exceeds 40ms.
  const pending = action().then(
    () => null,
    (error) => error,
  )
  for (let i = 0; i <= 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start + i * 40 - performance.now())))
    const filename = `${transition}-${String(i).padStart(2, "0")}.jpg`
    const elapsedMs = performance.now() - start
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
      captureBeyondViewport: false,
    })
    await fs.writeFile(path.join(dir, filename), Buffer.from(data, "base64"))
    samples.push({ filename, targetMs: i * 40, elapsedMs })
  }
  const error = await pending
  await cdp.detach()
  if (error) throw error
  return samples
}

async function video(browser, job, motion, out, base) {
  const name = `${job.screen}__${job.w}x${job.h}__${motion}`
  const dir = path.join(out, name)
  await fs.mkdir(dir, { recursive: true })
  const context = await contextFor(browser, job, {
    reducedMotion: motion,
    recordVideo: { dir, size: { width: job.w, height: job.h } },
  })
  const page = await context.newPage()
  try {
    await load(page, job, base)
    const opening = await frames(page, dir, "open", () => open(page, job))
    await page.waitForTimeout(400)
    const closing = await frames(page, dir, "close", () => close(page, job))
    await page.waitForTimeout(300)
    await context.close()
    const videoPath = await page.video().path()
    await fs.rename(videoPath, path.join(dir, `${name}.webm`))
    const data = { name, job, reducedMotion: motion, targetIntervalMs: 40, opening, closing }
    await fs.writeFile(path.join(dir, "frames.json"), JSON.stringify(data, null, 2))
    await fs.writeFile(
      path.join(dir, "strip.html"),
      `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{font:14px system-ui;background:#eee}section{display:flex;gap:8px;overflow:auto}figure{margin:0}img{width:${job.w < 768 ? 195 : 360}px}figcaption{white-space:nowrap}</style><h1>${name}</h1><p>40ms targets; captions show actual screenshot start times. Video and screenshots are unthrottled.</p>${[
        ["Open", opening],
        ["Close", closing],
      ]
        .map(
          ([title, list]) =>
            `<h2>${title}</h2><section>${list.map((f) => `<figure><img src="${f.filename}"><figcaption>${f.targetMs}ms target / ${f.elapsedMs.toFixed(1)}ms actual</figcaption></figure>`).join("")}</section>`,
        )
        .join("")}`,
    )
    return { name, video: `${name}/${name}.webm`, strip: `${name}/strip.html`, ...data }
  } finally {
    await context.close()
  }
}

async function traced(page, cdp, filename, action) {
  await cdp.send("Performance.enable")
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  await page.evaluate(() => {
    window.__redesignPerf = { longTasks: [], intervals: [] }
    window.__redesignObserver = new PerformanceObserver((list) => {
      window.__redesignPerf.longTasks.push(
        ...list.getEntries().map((e) => ({ startTime: e.startTime, duration: e.duration })),
      )
    })
    window.__redesignObserver.observe({ type: "longtask", buffered: false })
    let last
    const sample = (time) => {
      if (last !== undefined) window.__redesignPerf.intervals.push(time - last)
      last = time
      window.__redesignRaf = requestAnimationFrame(sample)
    }
    window.__redesignRaf = requestAnimationFrame(sample)
  })
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,toplevel,blink.user_timing,benchmark",
    transferMode: "ReturnAsStream",
  })
  const start = performance.now()
  let stream
  try {
    await action()
  } finally {
    const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve))
    await cdp.send("Tracing.end")
    stream = (await complete).stream
  }
  const elapsedMs = performance.now() - start
  let trace = ""
  try {
    for (;;) {
      const chunk = await cdp.send("IO.read", { handle: stream })
      trace += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data
      if (chunk.eof) break
    }
  } finally {
    await cdp.send("IO.close", { handle: stream })
  }
  await fs.writeFile(filename, trace)
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  const observation = await page.evaluate(() => {
    cancelAnimationFrame(window.__redesignRaf)
    window.__redesignObserver?.disconnect()
    return window.__redesignPerf
  })
  const events = JSON.parse(trace).traceEvents
  const count = (name) => events.filter((e) => e.name === name && e.ph === "X").length
  const metrics = Object.fromEntries(
    ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "ScriptDuration"].map(
      (key) => [key, after[key] - before[key]],
    ),
  )
  return {
    elapsedMs,
    cpuThrottle: 4,
    metrics,
    traceCounts: { layout: count("Layout"), recalcStyle: count("UpdateLayoutTree") + count("RecalculateStyles") },
    ...observation,
    longTaskCount: observation.longTasks.length,
    maxLongTaskMs: Math.max(0, ...observation.longTasks.map((t) => t.duration)),
    rafGapsOver50ms: observation.intervals.filter((t) => t > 50).length,
    droppedFrames: null,
    droppedFramesNote: "Not reliably exposed by headless CDP; rAF gaps are a proxy, not measured compositor drops.",
  }
}

async function perfRun(browser, job, motion, out, base, firstLoad = false) {
  const name = `${job.screen}__${job.w}x${job.h}__${motion}${firstLoad ? "__first-load" : ""}`
  const context = await contextFor(browser, job, { reducedMotion: motion })
  // Observers survive navigation for first-load measurements.
  if (firstLoad)
    await context.addInitScript(() => {
      window.__redesignPerf = { longTasks: [], intervals: [] }
      window.__redesignObserver = new PerformanceObserver((list) =>
        window.__redesignPerf.longTasks.push(
          ...list.getEntries().map((e) => ({ startTime: e.startTime, duration: e.duration })),
        ),
      )
      window.__redesignObserver.observe({ type: "longtask", buffered: true })
      let last
      const sample = (time) => {
        if (last !== undefined) window.__redesignPerf.intervals.push(time - last)
        last = time
        window.__redesignRaf = requestAnimationFrame(sample)
      }
      window.__redesignRaf = requestAnimationFrame(sample)
    })
  const page = await context.newPage(),
    errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const cdp = await context.newCDPSession(page)
  try {
    if (!firstLoad) await load(page, job, base)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    const traceFile = `${name}.trace.json`
    const results = await traced(page, cdp, path.join(out, traceFile), async () => {
      if (firstLoad) await load(page, job, base)
      else {
        await open(page, job)
        await page.waitForTimeout(650)
        await close(page, job)
        await page.waitForTimeout(650)
      }
    })
    return { name, job, reducedMotion: motion, firstLoad, traceFile, consoleErrors: errors, ...results }
  } finally {
    await context.close()
  }
}

const options = args("e2e/.artifacts/redesign-before/motion")
await fs.mkdir(options.out, { recursive: true })
const browser = await chromium.launch(launchOptions),
  videos = [],
  performanceResults = [],
  failures = []
try {
  const selected = scenarios.filter((job) => !options.only || job.screen === options.only)
  assert(selected.length, `Unknown screen: ${options.only}`)
  for (const motion of ["no-preference", "reduce"]) {
    for (const job of selected) {
      try {
        videos.push(await video(browser, job, motion, options.out, options.base))
        performanceResults.push(await perfRun(browser, job, motion, options.out, options.base))
        console.log(`PASS ${job.screen} ${motion}`)
      } catch (error) {
        failures.push({ job, motion, error: String(error) })
        console.error(error)
      }
    }
    if (!options.only)
      for (const [screen, url] of [
        ["reception-floor", "/floor"],
        ["admin-overview", "/admin/overview"],
      ]) {
        const job = { screen, url, w: 390, h: 844 }
        try {
          performanceResults.push(await perfRun(browser, job, motion, options.out, options.base, true))
        } catch (error) {
          failures.push({ job, motion, firstLoad: true, error: String(error) })
          console.error(error)
        }
      }
  }
} finally {
  await browser.close()
}
await fs.writeFile(
  path.join(options.out, "manifest.json"),
  JSON.stringify(
    { options, fixedTime, browser: "Chromium emulation", videos, performance: performanceResults, failures },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({ videos: videos.length, performanceRuns: performanceResults.length, failures: failures.length }),
)
if (failures.length) process.exitCode = 1
