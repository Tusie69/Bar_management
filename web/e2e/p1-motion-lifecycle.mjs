/**
 * Committed browser lifecycle regression suite for Redesign P1 motion primitives:
 * - P1-10: Real React + Radix Portal + GSAP lifecycle (normal/reduced motion
 *   interpolation, portal readiness, mounted exit, interruptible drawer, and
 *   automatic React-owner matchMedia/target cleanup without manual mm.revert()).
 * - P1-11: Cold delayed motion-controller chunk settles at visible endpoint once
 *   fallback has revealed, without resetting opacity or jumping offscreen.
 * - P1-12: External ref swaps (object & callback refs) clear previous ref and
 *   assign the same connected node without portal remount or timeline restart.
 * - P1-13: Newly mounted default-open and initially-closed programmatic Dialog
 *   and AlertDialog retain initial focus inside content, trap Tab/Shift+Tab,
 *   and return/clear focus cleanly on Escape across normal and reduced motion.
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { chromium } from "@playwright/test"

const webRoot = path.resolve(import.meta.dirname, "..")
const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const evidenceDir = process.env.P1_EVIDENCE_DIR ?? ""

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr ? addr.port : 5197
      srv.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, timeoutMs = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Server not listening yet.
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Timed out waiting for Vite server at ${url}`)
}

async function ensureDevServer() {
  if (process.env.E2E_BASE_URL) {
    return { baseUrl: process.env.E2E_BASE_URL, stop: async () => {} }
  }
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const viteBin = path.join(webRoot, "node_modules", "vite", "bin", "vite.js")
  const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: webRoot,
    env: { ...process.env, VITE_API_MODE: "mock" },
    stdio: "ignore",
  })
  await waitForServer(baseUrl)
  return {
    baseUrl,
    stop: async () => {
      if (!child.killed) {
        child.kill()
      }
    },
  }
}

const MATCHMEDIA_SPY_INIT = () => {
  const origAdd = MediaQueryList.prototype.addListener
  const origRem = MediaQueryList.prototype.removeListener
  const origAddEv = MediaQueryList.prototype.addEventListener
  const origRemEv = MediaQueryList.prototype.removeEventListener
  window.__mqStats = { adds: 0, removes: 0 }
  MediaQueryList.prototype.addListener = function (...args) {
    window.__mqStats.adds++
    return origAdd.apply(this, args)
  }
  MediaQueryList.prototype.removeListener = function (...args) {
    window.__mqStats.removes++
    return origRem.apply(this, args)
  }
  MediaQueryList.prototype.addEventListener = function (...args) {
    window.__mqStats.adds++
    return origAddEv.apply(this, args)
  }
  MediaQueryList.prototype.removeEventListener = function (...args) {
    window.__mqStats.removes++
    return origRemEv.apply(this, args)
  }
}

async function countDetachedTargets(page) {
  return page.evaluate(async () => {
    const gsap = (await import("/node_modules/.vite/deps/gsap.js")).default
    return gsap.globalTimeline
      .getChildren(true, true, true)
      .flatMap((t) => t.targets?.() ?? [])
      .filter((e) => e instanceof HTMLElement && !e.isConnected).length
  })
}

async function mqActiveDelta(page) {
  return page.evaluate(() => window.__mqStats.adds - window.__mqStats.removes)
}

async function installOverlayHarness(page) {
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom.js")).default
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default
    const mods = {
      dialog: await import("/src/components/ui/dialog.tsx"),
      sheet: await import("/src/components/ui/sheet.tsx"),
      alert: await import("/src/components/ui/alert-dialog.tsx"),
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    const outside = document.createElement("button")
    outside.id = "p1-outside-btn"
    outside.textContent = "Outside"
    outside.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:999"
    window.__outsideClicks = 0
    outside.onclick = () => window.__outsideClicks++
    document.body.appendChild(outside)

    window.__harness = {
      React,
      flushSync: ReactDOM.flushSync,
      root,
      mods,
      mountPrimitive({ kind, side = "right", initialOpen = false }) {
        const mod = mods[kind]
        const prefix = kind === "dialog" ? "Dialog" : kind === "sheet" ? "Sheet" : "AlertDialog"
        const Root = mod[prefix]
        const Trigger = mod[`${prefix}Trigger`]
        const Content = mod[`${prefix}Content`]
        const Title = mod[`${prefix}Title`]
        const Description = mod[`${prefix}Description`]
        const Close = mod[`${prefix}${kind === "alert" ? "Cancel" : "Close"}`]

        function Harness() {
          const [open, setOpen] = React.useState(initialOpen)
          const [contentRef, setContentRef] = React.useState(undefined)
          React.useEffect(() => {
            window.__setOpen = setOpen
            window.__setContentRef = setContentRef
          }, [])
          return React.createElement(
            Root,
            { open, onOpenChange: setOpen },
            React.createElement(Trigger, { "data-p1": "trigger" }, "Open"),
            React.createElement(
              Content,
              { "data-p1": "content", ref: contentRef, ...(kind === "sheet" ? { side } : {}) },
              React.createElement(Title, {}, `Lifecycle ${kind}`),
              React.createElement(Description, {}, "Portal lifecycle probe"),
              React.createElement(Close, { "data-p1": "close" }, "Close"),
            ),
          )
        }

        ReactDOM.flushSync(() => {
          root.render(React.createElement(Harness, { key: `${kind}-${Math.random()}` }))
        })
      },
      unmount() {
        ReactDOM.flushSync(() => {
          root.render(null)
        })
      },
    }
  })
}

async function settleFrames(page, count = 2) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let remaining = n
        const step = () => {
          remaining -= 1
          if (remaining <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count,
  )
}

/**
 * Samples rAF frames synchronized with the animation start signal (active GSAP
 * tween, `will-change` transition marker, or first non-initial frame) instead of
 * counting a fixed window before React/CDP/motion-controller start.
 */
async function sampleFrames(page, selector, durationMs, options = {}) {
  const { phase = "any", triggerAction = null, waitStartMs = 1500 } = options
  return page.evaluate(
    async ({ selector, durationMs, phase, triggerAction, waitStartMs }) => {
      const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
      const gsap = (await import("/node_modules/.vite/deps/gsap.js")).default

      // Align with a fresh frame cadence before triggering so GSAP ticker's
      // delta from any prior Playwright CDP/emulateMedia call is flushed.
      await nextFrame()
      await nextFrame()
      if (typeof gsap.ticker?.tick === "function") {
        gsap.ticker.tick()
      }

      const initialEl = document.querySelector(selector)
      const initialRect = initialEl ? initialEl.getBoundingClientRect() : null
      const initialOpacity = initialEl ? Number(getComputedStyle(initialEl).opacity) : null

      if (triggerAction === "open") window.__setOpen(true)
      else if (triggerAction === "close") window.__setOpen(false)
      else if (triggerAction === "closeCold") window.__closeColdDialog()
      else if (triggerAction === "reopenCold") window.__reopenColdDialog()

      const hasStarted = (el) => {
        if (!el) return false
        if (phase === "any") return true
        const style = getComputedStyle(el)
        const wc = el.style.willChange || style.willChange
        const hasWillChange = wc === "transform, opacity" || wc.includes("opacity") || wc.includes("transform")
        const hasActiveTween = gsap.globalTimeline
          .getChildren(true, true, false)
          .some((t) => t.isActive?.() && t.targets?.().includes(el))
        if (phase === "enter") {
          const op = Number(style.opacity)
          const rect = el.getBoundingClientRect()
          const moved = initialRect
            ? Math.abs(rect.x - initialRect.x) > 0.5 || Math.abs(rect.y - initialRect.y) > 0.5
            : false
          return hasWillChange || hasActiveTween || (op > 0.01 && op < 0.99) || moved || !initialEl
        }
        if (phase === "exit") {
          const op = Number(style.opacity)
          const rect = el.getBoundingClientRect()
          const moved = initialRect
            ? Math.abs(rect.x - initialRect.x) > 0.5 || Math.abs(rect.y - initialRect.y) > 0.5
            : false
          const opChanged = initialOpacity !== null ? op < initialOpacity - 0.01 : op < 0.99
          return el.dataset.motionState === "closing" || hasWillChange || hasActiveTween || opChanged || moved
        }
        return true
      }

      const samples = []
      const waitDeadline = performance.now() + waitStartMs
      let animStart = null

      while (performance.now() < waitDeadline) {
        const el = document.querySelector(selector)
        if (hasStarted(el)) {
          animStart = performance.now()
          break
        }
        await nextFrame()
      }

      if (animStart === null) {
        animStart = performance.now()
      }

      while (performance.now() - animStart < durationMs) {
        const el = document.querySelector(selector)
        if (el) {
          const style = getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          samples.push({
            t: performance.now() - animStart,
            opacity: Number(style.opacity),
            transform: style.transform,
            x: rect.x,
            y: rect.y,
          })
        } else {
          samples.push({ t: performance.now() - animStart, absent: true })
          if (phase === "exit" && samples.some((s) => !s.absent)) {
            break
          }
        }
        await nextFrame()
      }
      return samples
    },
    { selector, durationMs, phase, triggerAction, waitStartMs },
  )
}

async function runP110Tests(browser, baseUrl) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
  })
  await ctx.addInitScript(MATCHMEDIA_SPY_INIT)
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
  await installOverlayHarness(page)

  // Warm lazy controller once before measuring per-primitive lifecycle deltas.
  await page.evaluate(async () => {
    const motion = await import("/src/lib/motion.ts")
    await motion.prewarmMotionController()
  })

  for (const motion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion: motion })
    for (const kind of ["dialog", "sheet", "alert"]) {
      const baselineListeners = await mqActiveDelta(page)
      await page.evaluate((k) => window.__harness.mountPrimitive({ kind: k, initialOpen: false }), kind)
      assert.equal(await page.locator('[data-p1="content"]').count(), 0, `${kind} (${motion}) must start closed`)

      // Trigger open via React state synchronized with frame cadence and motion start.
      const openSamples = await sampleFrames(page, '[data-p1="content"]', 380, {
        phase: "enter",
        triggerAction: "open",
      })

      const presentOpen = openSamples.filter((s) => !s.absent)
      assert.ok(presentOpen.length > 0, `${kind} (${motion}) did not mount portal content`)

      if (motion === "no-preference") {
        if (kind === "sheet") {
          const xs = presentOpen.map((s) => s.x)
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          assert.ok(maxX - minX > 30, `${kind} normal-motion expected x interpolation, got [${minX}..${maxX}]`)
        } else {
          const midOpacity = presentOpen.filter((s) => s.opacity > 0.02 && s.opacity < 0.98)
          assert.ok(
            midOpacity.length >= 2,
            `${kind} normal-motion expected >=2 intermediate opacity frames, got ${midOpacity.length} (${JSON.stringify(presentOpen.map((s) => s.opacity))})`,
          )
          const hasTransformAnim = presentOpen.some((s) => s.transform !== "none")
          assert.ok(hasTransformAnim, `${kind} normal-motion expected transform interpolation`)
        }
      } else {
        const midOpacity = presentOpen.filter((s) => s.opacity > 0.02 && s.opacity < 0.98)
        assert.ok(midOpacity.length >= 1, `${kind} reduced-motion expected intermediate opacity frame`)
        assert.ok(
          presentOpen.every((s) => s.transform === "none"),
          `${kind} reduced-motion must keep transform fixed`,
        )
      }

      // Verify focus moved inside the open portal content and stays trapped.
      const focusInside = await page.evaluate(() => {
        const el = document.querySelector('[data-p1="content"]')
        return Boolean(el && el.contains(document.activeElement))
      })
      assert.ok(focusInside, `${kind} (${motion}) programmatic open did not focus inside content`)
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab")
        const stillInside = await page.evaluate(() => {
          const el = document.querySelector('[data-p1="content"]')
          return Boolean(el && el.contains(document.activeElement))
        })
        assert.ok(stillInside, `${kind} (${motion}) Tab #${i + 1} escaped content`)
      }

      // Close via React state and verify mounted exit frames before unmount.
      const exitSamples = await sampleFrames(page, '[data-p1="content"]', 360, {
        phase: "exit",
        triggerAction: "close",
      })

      const retainedExit = exitSamples.filter((s) => !s.absent)
      assert.ok(retainedExit.length >= 2, `${kind} (${motion}) exited immediately instead of staying mounted`)
      if (kind === "sheet" && motion === "no-preference") {
        const exitXs = retainedExit.map((s) => s.x)
        assert.ok(Math.max(...exitXs) - Math.min(...exitXs) > 20, `${kind} expected exit x movement`)
      } else {
        const exitMid = retainedExit.filter((s) => s.opacity > 0.02 && s.opacity < 0.98)
        assert.ok(exitMid.length >= 1, `${kind} (${motion}) expected intermediate exit opacity frame`)
      }

      assert.equal(await page.locator('[data-p1="content"]').count(), 0, `${kind} (${motion}) must unmount after exit`)
      assert.equal(
        await page.evaluate(() => document.body.style.pointerEvents),
        "",
        `${kind} (${motion}) left body pointerEvents locked`,
      )
      const clicksBefore = await page.evaluate(() => window.__outsideClicks)
      await page.locator("#p1-outside-btn").click()
      assert.equal(
        await page.evaluate(() => window.__outsideClicks),
        clicksBefore + 1,
        `${kind} (${motion}) blocked outside clicks after close`,
      )

      // Repeat 8 close/reopen cycles via React state and check automatic cleanup.
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.__setOpen(true))
        await page.waitForTimeout(90)
        await page.evaluate(() => window.__setOpen(false))
        await page.waitForTimeout(260)
      }

      // Also test unmounting the React owner while open.
      await page.evaluate(() => window.__setOpen(true))
      await page.waitForTimeout(60)
      await page.evaluate(() => window.__harness.unmount())
      await page.waitForTimeout(50)

      assert.equal(
        await mqActiveDelta(page),
        baselineListeners,
        `${kind} (${motion}) leaked matchMedia listeners after React owner close/unmount`,
      )
      assert.equal(await countDetachedTargets(page), 0, `${kind} (${motion}) left detached GSAP targets`)
    }
  }

  // AdminShell mobile drawer lifecycle: open, exit, interruptible reversal, and repeated cycle cleanup.
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const drawerBaseline = await mqActiveDelta(page)

  await settleFrames(page, 2)
  const drawerEnterPromise = sampleFrames(page, '[data-testid="admin-drawer-panel"]', 380, { phase: "enter" })
  await page.getByTestId("admin-menu-trigger").click()
  const drawerEnter = (await drawerEnterPromise).filter((s) => !s.absent)
  assert.ok(
    drawerEnter.some((s) => s.x < -5 && s.x > -230),
    `Admin drawer expected intermediate x frames, got ${JSON.stringify(drawerEnter.map((s) => s.x))}`,
  )

  await settleFrames(page, 2)
  const drawerExitPromise = sampleFrames(page, '[data-testid="admin-drawer-panel"]', 360, { phase: "exit" })
  await page.keyboard.press("Escape")
  const drawerExit = await drawerExitPromise
  assert.ok(drawerExit.filter((s) => !s.absent).length >= 2, "Admin drawer did not remain mounted during exit")
  assert.equal(await page.locator('[data-testid="admin-drawer-panel"]').count(), 0, "Admin drawer remained mounted")

  // Interruptible mid-exit reversal.
  await page.getByTestId("admin-menu-trigger").click()
  const reversal = await page.evaluate(async () => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
    const panelSelector = '[data-testid="admin-drawer-panel"]'
    const trigger = document.querySelector('[data-testid="admin-menu-trigger"]')
    const el = document.querySelector(panelSelector)
    if (!el || !trigger) {
      throw new Error("Admin drawer panel or menu trigger missing before reversal")
    }
    const readX = () => el.getBoundingClientRect().x

    // Wait until the drawer finishes opening and settles near x = 0 before triggering Escape.
    const openStart = performance.now()
    let settledFrames = 0
    while (performance.now() - openStart < 750) {
      await nextFrame()
      const elapsed = performance.now() - openStart
      const x = readX()
      if (elapsed >= 280 && Math.abs(x) < 0.5) {
        settledFrames++
        if (settledFrames >= 2) break
      } else {
        settledFrames = 0
      }
    }
    const settledOpenX = readX()

    // Trigger exit via Escape and sample frames until the closing drawer moves past -40 px while still mounted.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    const exitSamples = []
    const exitStart = performance.now()
    while (performance.now() - exitStart < 600) {
      await nextFrame()
      const current = document.querySelector(panelSelector)
      const x = current ? current.getBoundingClientRect().x : null
      exitSamples.push({
        t: Math.round(performance.now() - exitStart),
        x,
        connected: Boolean(current === el && el.isConnected),
      })
      if (current === el && el.isConnected && x !== null && x <= -40) {
        break
      }
    }
    const before = readX()

    // Re-open mid-exit and sample frames through spring overshoot until settled back at x = 0.
    trigger.click()
    const after = readX()
    const sameNodeOnClick = document.querySelector(panelSelector) === el && el.isConnected
    const reopenSamples = []
    const reopenStart = performance.now()
    while (performance.now() - reopenStart < 500) {
      await nextFrame()
      const current = document.querySelector(panelSelector)
      reopenSamples.push({
        t: Math.round(performance.now() - reopenStart),
        x: current ? current.getBoundingClientRect().x : null,
        connected: el.isConnected,
        sameNode: current === el,
        expanded: trigger.getAttribute("aria-expanded"),
      })
    }

    return { settledOpenX, exitSamples, before, after, sameNodeOnClick, reopenSamples }
  })
  assert.ok(
    Math.abs(reversal.settledOpenX) < 0.5,
    `Admin drawer did not settle open before reversal: settledOpenX=${reversal.settledOpenX}`,
  )
  assert.ok(
    reversal.before <= -40 && reversal.before > -210,
    `Admin drawer was not sampled mid-exit past -40px: before=${reversal.before}, exitSamples=${JSON.stringify(reversal.exitSamples)}`,
  )
  assert.ok(reversal.sameNodeOnClick, "Admin drawer unmounted/remounted immediately on mid-exit reopen")
  assert.ok(
    Math.abs(reversal.after - reversal.before) < 25,
    `Drawer snapped on reversal: ${JSON.stringify({ before: reversal.before, after: reversal.after })}`,
  )
  assert.ok(reversal.reopenSamples.length >= 2, "Insufficient rAF samples during drawer reversal")
  assert.ok(
    reversal.reopenSamples.every((s) => s.connected && s.sameNode),
    `Admin drawer unmounted or remounted during reversal: ${JSON.stringify(reversal.reopenSamples)}`,
  )
  const reopenXs = reversal.reopenSamples.map((s) => s.x)
  assert.ok(
    Math.min(...reopenXs) >= reversal.before - 10,
    `Drawer continued closing instead of reversing: before=${reversal.before}, minX=${Math.min(...reopenXs)}`,
  )
  assert.ok(
    Math.max(...reopenXs) > reversal.before + 25 && reopenXs.some((x) => x > reversal.before + 2 && x < -5),
    `Drawer did not reverse smoothly toward open: before=${reversal.before}, xs=${JSON.stringify(reopenXs.slice(0, 15))}`,
  )
  const settledReopen = reversal.reopenSamples[reversal.reopenSamples.length - 1]
  assert.ok(
    Math.abs(settledReopen.x) < 1 && settledReopen.expanded === "true",
    `Drawer did not settle at open state after reversal: ${JSON.stringify(settledReopen)}`,
  )
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)

  for (let i = 0; i < 8; i++) {
    await page.getByTestId("admin-menu-trigger").click()
    await page.waitForTimeout(80)
    await page.keyboard.press("Escape")
    await page.waitForTimeout(260)
  }

  assert.equal(await mqActiveDelta(page), drawerBaseline, "Admin drawer leaked matchMedia listeners")
  assert.equal(await countDetachedTargets(page), 0, "Admin drawer left detached GSAP targets")
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("[inert]").length),
    0,
    "Admin drawer left inert attributes",
  )
  assert.deepEqual(errors, [], `Unexpected page errors in P1-10: ${errors.join("; ")}`)

  await ctx.close()
  console.log("PASS P1-10: lifecycle regression (normal/reduced, portals, mounted exit, cleanup)")
}

async function runP111DelayedChunkTest(browser, baseUrl, viewport, label) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
  })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  let controllerArrived = false
  await page.route("**/src/lib/motion-controller.tsx*", async (route) => {
    await new Promise((r) => setTimeout(r, 900))
    await route.continue()
    controllerArrived = true
  })

  await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
  for (let i = 0; i < 6; i++) {
    const close = page.getByRole("button", { name: "Đóng thông báo", exact: true })
    if (!(await close.count())) break
    await close.first().click()
  }

  // 1) Programmatic defaultOpen Dialog with delayed controller chunk.
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default
    const { Dialog, DialogContent, DialogTitle, DialogDescription } = await import("/src/components/ui/dialog.tsx")

    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    const samples = []
    const start = performance.now()
    let stopSampling = false
    const tick = () => {
      const el = document.querySelector('[data-p1-cold="dialog"]')
      if (el) {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        samples.push({
          t: Math.round(performance.now() - start),
          opacity: Number(s.opacity),
          transform: s.transform,
          y: Math.round(r.y),
        })
      }
      if (!stopSampling && performance.now() - start < 1600) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)

    function ColdDialog() {
      const [open, setOpen] = React.useState(true)
      React.useEffect(() => {
        window.__closeColdDialog = () => setOpen(false)
        window.__reopenColdDialog = () => setOpen(true)
      }, [])
      return React.createElement(
        Dialog,
        { open, onOpenChange: setOpen },
        React.createElement(
          DialogContent,
          { "data-p1-cold": "dialog" },
          React.createElement(DialogTitle, {}, "Cold Dialog"),
          React.createElement(DialogDescription, {}, "Delayed GSAP controller test"),
        ),
      )
    }

    root.render(React.createElement(ColdDialog))
    window.__coldDialogRoot = root
    window.__coldDialogDone = new Promise((r) => setTimeout(r, 1550)).then(() => {
      stopSampling = true
      return samples
    })
  })

  if (evidenceDir) {
    const dialogStripDir = path.join(evidenceDir, `p1-11-dialog-${label}`)
    fs.mkdirSync(dialogStripDir, { recursive: true })
    let prevMs = 0
    for (const ms of [100, 320, 750, 950, 1150, 1400]) {
      await page.waitForTimeout(ms - prevMs)
      prevMs = ms
      await page.screenshot({ path: path.join(dialogStripDir, `frame-${String(ms).padStart(4, "0")}ms.png`) })
    }
  }

  const dialogFrames = await page.evaluate(() => window.__coldDialogDone)
  assert.ok(controllerArrived, `${label} motion-controller chunk should have arrived`)

  const firstVisibleIdx = dialogFrames.findIndex((f) => f.opacity >= 0.99)
  assert.ok(firstVisibleIdx !== -1, `${label} Dialog never became visible via fallback`)
  const afterVisible = dialogFrames.slice(firstVisibleIdx)
  const opacityReset = afterVisible.find((f) => f.opacity < 0.99)
  assert.equal(
    opacityReset,
    undefined,
    `${label} Dialog reset opacity after becoming visible: ${JSON.stringify(afterVisible.slice(0, 20))}`,
  )

  // Verify exit still animates and close completes cleanly, then second open animates normally.
  const exitSamples = await sampleFrames(page, '[data-p1-cold="dialog"]', 360, {
    phase: "exit",
    triggerAction: "closeCold",
  })
  assert.ok(
    exitSamples.filter((s) => !s.absent && s.opacity > 0.02 && s.opacity < 0.98).length >= 1,
    `${label} Dialog did not animate exit after late controller settled`,
  )
  assert.equal(await page.locator('[data-p1-cold="dialog"]').count(), 0)

  const reopenSamples = await sampleFrames(page, '[data-p1-cold="dialog"]', 360, {
    phase: "enter",
    triggerAction: "reopenCold",
  })
  assert.ok(
    reopenSamples.filter((s) => !s.absent && s.opacity > 0.02 && s.opacity < 0.98).length >= 2,
    `${label} Dialog second open did not animate entrance normally`,
  )
  await page.evaluate(() => window.__coldDialogRoot.render(null))

  // 2) Real consumer GuestCountSheet with delayed controller chunk in a fresh page context.
  const ctx2 = await browser.newContext({ viewport })
  await ctx2.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
  })
  const page2 = await ctx2.newPage()
  page2.on("pageerror", (e) => errors.push(e.message))
  let sheetControllerArrived = false
  await page2.route("**/src/lib/motion-controller.tsx*", async (route) => {
    await new Promise((r) => setTimeout(r, 900))
    await route.continue()
    sheetControllerArrived = true
  })
  await page2.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
  for (let i = 0; i < 6; i++) {
    const close = page2.getByRole("button", { name: "Đóng thông báo", exact: true })
    if (!(await close.count())) break
    await close.first().click()
  }

  const sheetSamplingPromise = sampleFrames(page2, '[data-slot="sheet-content"]', 1600)
  await page2.getByRole("button", { name: "Sửa bộ đếm khách", exact: true }).click()

  // Capture a visual frame strip if P1_EVIDENCE_DIR is provided.
  const stripDir = evidenceDir ? path.join(evidenceDir, `p1-11-sheet-${label}`) : ""
  if (stripDir) {
    fs.mkdirSync(stripDir, { recursive: true })
    let prevMs = 0
    for (const ms of [100, 320, 750, 950, 1150, 1400]) {
      await page2.waitForTimeout(ms - prevMs)
      prevMs = ms
      await page2.screenshot({ path: path.join(stripDir, `frame-${String(ms).padStart(4, "0")}ms.png`) })
    }
  }

  const sheetFrames = await sheetSamplingPromise
  assert.ok(sheetControllerArrived, `${label} sheet motion-controller chunk should have arrived`)
  const visibleSheetFrames = sheetFrames.filter((f) => !f.absent && f.opacity >= 0.99)
  assert.ok(visibleSheetFrames.length > 0, `${label} GuestCountSheet never became visible`)
  const firstSheetVisibleIdx = sheetFrames.findIndex((f) => !f.absent && f.opacity >= 0.99)
  const postRevealSheet = sheetFrames.slice(firstSheetVisibleIdx).filter((f) => !f.absent)
  const settledY = postRevealSheet[0].y
  const jumpedFrame = postRevealSheet.find((f) => f.opacity < 0.99 || Math.abs(f.y - settledY) > 4)
  assert.equal(
    jumpedFrame,
    undefined,
    `${label} GuestCountSheet jumped or reset after fallback reveal: settledY=${settledY}, jumped=${JSON.stringify(jumpedFrame)}`,
  )

  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(
      path.join(evidenceDir, `p1-11-${label}.json`),
      JSON.stringify({ viewport, dialogFrames, sheetFrames }, null, 2),
    )
  }

  assert.deepEqual(errors, [], `Unexpected page errors in P1-11 (${label}): ${errors.join("; ")}`)
  await ctx2.close()
  await ctx.close()
  console.log(`PASS P1-11 (${label}): delayed lazy GSAP controller has zero reset/replay`)
}

async function runP112RefSwapTests(browser, baseUrl) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
  })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })

  const results = await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom.js")).default
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default
    const mods = {
      dialog: await import("/src/components/ui/dialog.tsx"),
      sheet: await import("/src/components/ui/sheet.tsx"),
      alert: await import("/src/components/ui/alert-dialog.tsx"),
    }
    const gsap = (await import("/node_modules/.vite/deps/gsap.js")).default
    await (await import("/src/lib/motion.ts")).prewarmMotionController()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const out = {}

    for (const kind of ["dialog", "sheet", "alert"]) {
      const mod = mods[kind]
      const prefix = kind === "dialog" ? "Dialog" : kind === "sheet" ? "Sheet" : "AlertDialog"
      const Root = mod[prefix]
      const Content = mod[`${prefix}Content`]
      const Title = mod[`${prefix}Title`]
      const Description = mod[`${prefix}Description`]

      const refA = React.createRef()
      const refB = React.createRef()
      const cbALog = []
      const cbBLog = []
      const cbA = (el) => cbALog.push(el ? el.tagName : null)
      const cbB = (el) => cbBLog.push(el ? el.tagName : null)

      function Probe() {
        const [mode, setMode] = React.useState("objA")
        const [open, setOpen] = React.useState(true)
        React.useEffect(() => {
          window.__swapRefMode = setMode
          window.__closeRefProbe = () => setOpen(false)
        }, [])
        const currentRef = mode === "objA" ? refA : mode === "objB" ? refB : mode === "cbA" ? cbA : cbB
        return React.createElement(
          Root,
          { open, onOpenChange: setOpen },
          React.createElement(
            Content,
            { ref: currentRef, "data-ref-kind": kind },
            React.createElement(Title, {}, `Ref ${kind}`),
            React.createElement(Description, {}, "Ref swap probe"),
          ),
        )
      }

      ReactDOM.flushSync(() => root.render(React.createElement(Probe, { key: kind })))
      const settleDeadline = performance.now() + 3000
      while (performance.now() < settleDeadline) {
        const node = refA.current
        if (node) {
          const style = getComputedStyle(node)
          const wc = node.style.willChange || style.willChange
          const anyActive = gsap.globalTimeline
            .getChildren(true, true, false)
            .some((t) => t.isActive?.() && t.targets?.().includes(node))
          if (Number(style.opacity) === 1 && wc !== "transform, opacity" && !anyActive) {
            break
          }
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
      const initialNode = refA.current
      const beforeObjSwap = {
        aConnected: Boolean(refA.current?.isConnected),
        bNull: refB.current === null,
      }

      ReactDOM.flushSync(() => window.__swapRefMode("objB"))
      const afterObjSwap = {
        aCleared: refA.current === null,
        sameNode: refB.current === initialNode,
        bConnected: Boolean(refB.current?.isConnected),
        opacity: Number(getComputedStyle(refB.current).opacity),
      }

      ReactDOM.flushSync(() => window.__swapRefMode("cbA"))
      const afterCbA = {
        bCleared: refB.current === null,
        cbALog: [...cbALog],
      }

      ReactDOM.flushSync(() => window.__swapRefMode("cbB"))
      const afterCbB = {
        cbALog: [...cbALog],
        cbBLog: [...cbBLog],
      }

      ReactDOM.flushSync(() => window.__closeRefProbe())
      const closeDeadline = performance.now() + 1500
      while (performance.now() < closeDeadline) {
        if (document.querySelectorAll(`[data-ref-kind="${kind}"]`).length === 0) break
        await new Promise((r) => requestAnimationFrame(r))
      }
      const afterClose = {
        cbBLog: [...cbBLog],
        remaining: document.querySelectorAll(`[data-ref-kind="${kind}"]`).length,
      }

      ReactDOM.flushSync(() => root.render(null))
      out[kind] = { beforeObjSwap, afterObjSwap, afterCbA, afterCbB, afterClose }
    }

    return out
  })

  for (const kind of ["dialog", "sheet", "alert"]) {
    const r = results[kind]
    assert.deepEqual(r.beforeObjSwap, { aConnected: true, bNull: true }, `${kind} beforeObjSwap`)
    assert.deepEqual(
      r.afterObjSwap,
      { aCleared: true, sameNode: true, bConnected: true, opacity: 1 },
      `${kind} afterObjSwap`,
    )
    assert.deepEqual(r.afterCbA, { bCleared: true, cbALog: ["DIV"] }, `${kind} afterCbA`)
    assert.deepEqual(r.afterCbB, { cbALog: ["DIV", null], cbBLog: ["DIV"] }, `${kind} afterCbB`)
    assert.deepEqual(r.afterClose, { cbBLog: ["DIV", null], remaining: 0 }, `${kind} afterClose`)
  }

  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(path.join(evidenceDir, "p1-12-ref-swaps.json"), JSON.stringify(results, null, 2))
  }

  assert.deepEqual(errors, [], `Unexpected page errors in P1-12: ${errors.join("; ")}`)
  await ctx.close()
  console.log("PASS P1-12: object and callback ref swaps preserve node/timeline on Dialog, Sheet, AlertDialog")
}

async function runP113FocusContinuityTests(browser, baseUrl) {
  for (const mode of ["no-preference", "reduce"]) {
    for (const kind of ["dialog", "alert"]) {
      for (const variant of ["defaultOpen", "programmatic"]) {
        for (let trial = 0; trial < 5; trial++) {
          const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: mode })
          await ctx.addInitScript(() => {
            localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
          })
          const page = await ctx.newPage()
          const errors = []
          page.on("pageerror", (e) => errors.push(e.message))

          await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
          await page.evaluate(
            async ({ kind, variant }) => {
              const React = (await import("/node_modules/.vite/deps/react.js")).default
              const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default
              const mods = {
                dialog: await import("/src/components/ui/dialog.tsx"),
                alert: await import("/src/components/ui/alert-dialog.tsx"),
              }
              await (await import("/src/lib/motion.ts")).prewarmMotionController()

              const mod = mods[kind]
              const prefix = kind === "dialog" ? "Dialog" : "AlertDialog"
              const Root = mod[prefix]
              const Trigger = mod[`${prefix}Trigger`]
              const Content = mod[`${prefix}Content`]
              const Title = mod[`${prefix}Title`]
              const Description = mod[`${prefix}Description`]
              const Close = mod[`${prefix}${kind === "alert" ? "Cancel" : "Close"}`]

              const host = document.createElement("div")
              document.body.appendChild(host)
              const root = createRoot(host)

              if (variant === "defaultOpen") {
                root.render(
                  React.createElement(
                    Root,
                    { defaultOpen: true },
                    React.createElement(Trigger, { id: "p113-trigger" }, "Open"),
                    React.createElement(
                      Content,
                      { "data-p113-content": "" },
                      React.createElement(Title, {}, `Focus ${kind}`),
                      React.createElement(Description, {}, "P1-13 focus probe"),
                      React.createElement("input", { id: "p113-input" }),
                      React.createElement(Close, { id: "p113-close" }, "Close"),
                    ),
                  ),
                )
              } else {
                function ProgrammaticOwner() {
                  const [open, setOpen] = React.useState(false)
                  React.useEffect(() => {
                    window.__openP113 = () => setOpen(true)
                  }, [])
                  return React.createElement(
                    Root,
                    { open, onOpenChange: setOpen },
                    React.createElement(Trigger, { id: "p113-trigger" }, "Open"),
                    React.createElement(
                      Content,
                      { "data-p113-content": "" },
                      React.createElement(Title, {}, `Focus ${kind}`),
                      React.createElement(Description, {}, "P1-13 programmatic probe"),
                      React.createElement("input", { id: "p113-input" }),
                      React.createElement(Close, { id: "p113-close" }, "Close"),
                    ),
                  )
                }
                root.render(React.createElement(ProgrammaticOwner))
              }
            },
            { kind, variant },
          )

          if (variant === "programmatic") {
            await page.locator("#p113-trigger").focus()
            await page.evaluate(() => window.__openP113())
          }

          await page.waitForFunction(
            () => {
              const el = document.querySelector("[data-p113-content]")
              if (!el) return false
              const style = getComputedStyle(el)
              const wc = el.style.willChange || style.willChange
              return Number(style.opacity) >= 0.99 && wc !== "transform, opacity"
            },
            null,
            { timeout: 1500 },
          )

          const initialInside = await page.evaluate(() => {
            const el = document.querySelector("[data-p113-content]")
            return {
              mounted: Boolean(el),
              inside: Boolean(el && el.contains(document.activeElement)),
              activeTag: document.activeElement?.tagName ?? null,
              visibility: el ? getComputedStyle(el).visibility : null,
            }
          })
          assert.ok(
            initialInside.mounted && initialInside.inside,
            `P1-13 ${kind} (${mode}, ${variant}, trial ${trial}) lost initial focus: ${JSON.stringify(initialInside)}`,
          )

          for (let step = 0; step < 4; step++) {
            await page.keyboard.press("Tab")
            const tabState = await page.evaluate(() => {
              const el = document.querySelector("[data-p113-content]")
              return Boolean(el && el.contains(document.activeElement))
            })
            assert.ok(tabState, `P1-13 ${kind} (${mode}, ${variant}, trial ${trial}) Tab #${step + 1} escaped modal`)
          }

          await page.keyboard.press("Shift+Tab")
          const shiftTabInside = await page.evaluate(() => {
            const el = document.querySelector("[data-p113-content]")
            return Boolean(el && el.contains(document.activeElement))
          })
          assert.ok(shiftTabInside, `P1-13 ${kind} (${mode}, ${variant}, trial ${trial}) Shift+Tab escaped modal`)

          await page.keyboard.press("Escape")
          await page
            .waitForFunction(() => document.querySelectorAll("[data-p113-content]").length === 0, null, {
              timeout: 1500,
            })
            .catch(() => {})
          const closedState = await page.evaluate(() => ({
            remaining: document.querySelectorAll("[data-p113-content]").length,
            activeId: document.activeElement?.id ?? null,
          }))
          assert.equal(closedState.remaining, 0, `P1-13 ${kind} (${mode}, ${variant}) failed to unmount on Escape`)
          if (variant === "programmatic") {
            assert.equal(
              closedState.activeId,
              "p113-trigger",
              `P1-13 ${kind} (${mode}, programmatic) did not return focus to trigger`,
            )
          }

          assert.deepEqual(errors, [], `Unexpected page errors in P1-13: ${errors.join("; ")}`)
          await ctx.close()
        }
      }
    }
  }
  console.log("PASS P1-13: defaultOpen and programmatic Dialog/AlertDialog preserve initial focus & Tab trap")
}

const server = await ensureDevServer()
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : fs.existsSync(defaultChrome)
      ? { executablePath: defaultChrome }
      : {},
)

try {
  await runP110Tests(browser, server.baseUrl)
  await runP111DelayedChunkTest(browser, server.baseUrl, { width: 1440, height: 900 }, "1440x900")
  await runP111DelayedChunkTest(browser, server.baseUrl, { width: 390, height: 844 }, "390x844")
  await runP112RefSwapTests(browser, server.baseUrl)
  await runP113FocusContinuityTests(browser, server.baseUrl)
} finally {
  await browser.close()
  await server.stop()
}
