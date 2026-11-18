import { beforeEach, describe, expect, it, vi } from "vitest"

type HookEffect = {
  deps?: readonly unknown[]
  create: () => void | (() => void)
  cleanup?: void | (() => void)
}

interface HookInstance {
  cursor: number
  idCounter: number
  states: unknown[]
  refs: Array<{ current: unknown }>
  callbacks: Array<{ deps?: readonly unknown[]; fn: unknown }>
  effects: HookEffect[]
  pendingEffects: number[]
}

const runtime = vi.hoisted(() => {
  const instances = new Map<string, HookInstance>()
  let activeKey = "default"
  let idSeq = 0
  const docListeners = new Map<string, Set<(event: unknown) => void>>()
  let activeEl: unknown = null
  let openOverlays: Array<{ attrs: Record<string, string>; dataset: Record<string, string>; focusables: unknown[] }> =
    []
  let svgButtons: MockElement[] = []

  const getInst = (key = activeKey): HookInstance => {
    let inst = instances.get(key)
    if (!inst) {
      inst = { cursor: 0, idCounter: 0, states: [], refs: [], callbacks: [], effects: [], pendingEffects: [] }
      instances.set(key, inst)
    }
    return inst
  }

  const depsChanged = (prev?: readonly unknown[], next?: readonly unknown[]) => {
    if (!prev || !next || prev.length !== next.length) return true
    return next.some((v, i) => !Object.is(v, prev[i]))
  }

  function findClosest(start: MockElement, selector: string): MockElement | null {
    const parts = selector.split(",").map((s) => s.trim())
    let cur: MockElement | null = start
    while (cur) {
      for (const p of parts) {
        if (p === "[inert]" && "inert" in cur.attrs) return cur
        if (p === "[aria-hidden='true']" && cur.attrs["aria-hidden"] === "true") return cur
        if (p === "[data-gm-overlay-id]" && "data-gm-overlay-id" in cur.attrs) return cur
        if (p === "[data-mobile-table-sheet]" && "data-mobile-table-sheet" in cur.attrs) return cur
        const slotMatch = p.match(/^\[data-slot='([^']+)'\]$/)
        if (slotMatch && cur.attrs["data-slot"] === slotMatch[1]) return cur
        if (p === "button" && cur.attrs.tag === "button") return cur
        if (p === "[role='button']" && cur.attrs.role === "button") return cur
      }
      cur = cur.parent
    }
    return null
  }

  class MockElement {
    isConnected = true
    dataset: Record<string, string> = {}
    attrs: Record<string, string> = {}
    parent: MockElement | null = null
    focusedCount = 0
    disabled = false

    constructor(attrs: Record<string, string> = {}, dataset: Record<string, string> = {}) {
      this.attrs = attrs
      this.dataset = dataset
    }

    hasAttribute(name: string) {
      if (name === "disabled" && this.disabled) return true
      return name in this.attrs
    }

    getAttribute(name: string) {
      return this.attrs[name] ?? null
    }

    closest(selector: string): MockElement | null {
      return findClosest(this, selector)
    }

    querySelector() {
      return null
    }

    focus() {
      this.focusedCount++
      activeEl = findClosest(this, "button, [role='button']") ?? activeEl
    }
  }

  class MockHTMLElement extends MockElement {}
  class MockSVGElement extends MockElement {}

  const mockDocument = {
    body: new MockHTMLElement({ tag: "body" }),
    get activeElement() {
      return activeEl ?? this.body
    },
    set activeElement(v: unknown) {
      activeEl = v
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      let set = docListeners.get(type)
      if (!set) {
        set = new Set()
        docListeners.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener(type: string, fn: (event: unknown) => void) {
      docListeners.get(type)?.delete(fn)
    },
    dispatchEvent(type: string, target: unknown) {
      for (const fn of docListeners.get(type) ?? []) {
        fn({ target })
      }
    },
    querySelector(selector: string) {
      if (selector.includes("Đặt bàn trên sơ đồ")) {
        return (
          openOverlays.find(
            (o) => o.attrs["aria-label"] === "Đặt bàn trên sơ đồ" && o.dataset.motionState === "open",
          ) ?? null
        )
      }
      const idMatch = selector.match(/data-gm-overlay-id="([^"]+)"/)
      if (idMatch) {
        return openOverlays.find((o) => o.attrs["data-gm-overlay-id"] === idMatch[1]) ?? null
      }
      return null
    },
    querySelectorAll(selector: string) {
      if (selector.includes('svg[role="group"] [role="button"]')) {
        return svgButtons
      }
      return []
    },
  }

  vi.stubGlobal("HTMLElement", MockHTMLElement)
  vi.stubGlobal("SVGElement", MockSVGElement)
  vi.stubGlobal("document", mockDocument)
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } })

  return {
    MockHTMLElement,
    MockSVGElement,
    mockDocument,
    setOpenOverlays(list: typeof openOverlays) {
      openOverlays = list
    },
    setSvgButtons(list: MockElement[]) {
      svgButtons = list
    },
    reset() {
      for (const inst of instances.values()) {
        for (const eff of inst.effects) {
          if (eff && typeof eff.cleanup === "function") eff.cleanup()
        }
      }
      instances.clear()
      docListeners.clear()
      openOverlays = []
      svgButtons = []
      idSeq = 0
      activeKey = "default"
      activeEl = mockDocument.body
    },
    render<T>(key: string, fn: () => T): T {
      activeKey = key
      const inst = getInst(key)
      let result: T
      let passes = 0
      do {
        inst.cursor = 0
        ;(inst as HookInstance & { dirty?: boolean }).dirty = false
        result = fn()
        passes++
      } while ((inst as HookInstance & { dirty?: boolean }).dirty && passes < 5)
      return result
    },
    flushEffects(key = "default") {
      const inst = getInst(key)
      const indices = inst.pendingEffects.splice(0, inst.pendingEffects.length)
      for (const idx of indices) {
        const eff = inst.effects[idx]
        if (!eff) continue
        if (typeof eff.cleanup === "function") eff.cleanup()
        eff.cleanup = eff.create()
      }
    },
    unmount(key = "default") {
      const inst = instances.get(key)
      if (!inst) return
      for (const eff of inst.effects) {
        if (eff && typeof eff.cleanup === "function") {
          eff.cleanup()
          eff.cleanup = undefined
        }
      }
      instances.delete(key)
    },
    useId(): string {
      const inst = getInst()
      const idx = inst.cursor++
      if (!(idx in inst.states)) {
        inst.states[idx] = `oid-${++idSeq}`
      }
      return inst.states[idx] as string
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((p: T) => T)) => void] {
      const inst = getInst()
      const idx = inst.cursor++
      if (!(idx in inst.states)) {
        inst.states[idx] = typeof initial === "function" ? (initial as () => T)() : initial
      }
      const setState = (next: T | ((p: T) => T)) => {
        const prev = inst.states[idx] as T
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next
        if (!Object.is(prev, resolved)) {
          inst.states[idx] = resolved
          ;(inst as HookInstance & { dirty?: boolean }).dirty = true
        }
      }
      return [inst.states[idx] as T, setState]
    },
    useRef<T>(initial: T): { current: T } {
      const inst = getInst()
      const idx = inst.cursor++
      if (!(idx in inst.refs)) {
        inst.refs[idx] = { current: initial }
      }
      return inst.refs[idx] as { current: T }
    },
    useCallback<T>(fn: T, deps?: readonly unknown[]): T {
      const inst = getInst()
      const idx = inst.cursor++
      const prev = inst.callbacks[idx]
      if (!prev || depsChanged(prev.deps, deps)) {
        inst.callbacks[idx] = { deps, fn }
      }
      return inst.callbacks[idx].fn as T
    },
    useEffect(create: () => void | (() => void), deps?: readonly unknown[]) {
      const inst = getInst()
      const idx = inst.cursor++
      const prev = inst.effects[idx]
      if (!prev || depsChanged(prev.deps, deps)) {
        inst.effects[idx] = { deps, create, cleanup: prev?.cleanup }
        inst.pendingEffects.push(idx)
      }
    },
    useSyncExternalStore<T>(_subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T {
      return getSnapshot()
    },
  }
})

vi.mock("zustand", async () => {
  const { createStore } = await import("zustand/vanilla")
  const create = (initializer: unknown) => {
    const store = createStore(initializer as never)
    return Object.assign((selector: (s: unknown) => unknown = (s) => s) => selector(store.getState()), store)
  }
  return { create }
})

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  const patched = {
    ...actual,
    useId: runtime.useId,
    useState: runtime.useState,
    useRef: runtime.useRef,
    useCallback: runtime.useCallback,
    useEffect: runtime.useEffect,
    useLayoutEffect: runtime.useEffect,
    useSyncExternalStore: runtime.useSyncExternalStore,
  }
  return {
    ...patched,
    default: patched,
  }
})

import { useUi } from "@/state/ui"
import { clearOverlayFocusRegistryForTest, useRestoreTriggerFocus } from "./overlay-focus"
import { useQuickFormPresence } from "./quick-form-presence"

describe("P3-01 useQuickFormPresence", () => {
  beforeEach(() => {
    runtime.reset()
    clearOverlayFocusRegistryForTest()
    useUi.setState({ bookingOpen: false, walkInOpen: false, draft: null, selectedTableId: null })
  })

  it("keeps ui.draft valid throughout GSAP exit animation and clears it onExitComplete", () => {
    let state = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(state.present).toBe(false)
    expect(state.storeDraft).toBeNull()

    // Open booking (e.g. from C4)
    useUi.getState().openBooking({ tableIds: [4] })
    state = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(state.isOpen).toBe(true)
    expect(state.present).toBe(true)
    expect(state.activeDraft?.kind).toBe("booking")
    expect(state.storeDraft?.kind).toBe("booking")

    // Close booking (clean close, dirty discard, Escape, or submit):
    // storeDraft MUST stay valid while present=true so QuickForm never sees null draft during exit.
    useUi.getState().closeBooking()
    state = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(state.isOpen).toBe(false)
    expect(state.activeDraft).toBeNull()
    expect(state.present).toBe(true)
    expect(state.storeDraft?.kind).toBe("booking")
    expect(useUi.getState().draft?.kind).toBe("booking")

    // Exit completes -> unmounts QuickForm and clears storeDraft
    state.onExitComplete()
    state = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(state.present).toBe(false)
    expect(state.storeDraft).toBeNull()
    expect(useUi.getState().draft).toBeNull()
  })

  it("handles walk-in submit followed by selectTable and exit completion", () => {
    runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")

    useUi.getState().openWalkIn([7])
    let state = runtime.render("map", () => useQuickFormPresence())
    expect(state.isOpen).toBe(true)
    expect(state.storeDraft?.kind).toBe("walkin")

    // Mirrors QuickForm walk-in submit: close() then ui.selectTable(ids[0])
    useUi.getState().closeWalkIn()
    useUi.getState().selectTable(7)
    state = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(state.present).toBe(true)
    expect(state.storeDraft?.kind).toBe("walkin")
    expect(useUi.getState().selectedTableId).toBe(7)

    state.onExitComplete()
    state = runtime.render("map", () => useQuickFormPresence())
    expect(state.present).toBe(false)
    expect(useUi.getState().draft).toBeNull()
    expect(useUi.getState().selectedTableId).toBe(7)
  })

  it("reopens cleanly mid-exit with a fresh sessionKey without clearing the new draft", () => {
    runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")

    useUi.getState().openBooking({ tableIds: [1] })
    const first = runtime.render("map", () => useQuickFormPresence())
    useUi.getState().closeBooking()
    const closing = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(closing.present).toBe(true)
    expect(closing.isOpen).toBe(false)

    // User opens a new booking mid-exit before onExitComplete fires
    useUi.getState().openBooking({ tableIds: [2] })
    const reopened = runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")
    expect(reopened.isOpen).toBe(true)
    expect(reopened.present).toBe(true)
    expect(reopened.sessionKey).toBeGreaterThan(first.sessionKey)
    expect(reopened.storeDraft?.tableIds).toEqual([2])

    // Calling stale onExitComplete from earlier exit must NOT clear the active reopened draft
    closing.onExitComplete()
    expect(useUi.getState().draft?.tableIds).toEqual([2])
  })

  it("restores original store actions and clears pending exiting draft on unmount", () => {
    const origCloseBooking = useUi.getState().closeBooking
    runtime.render("map", () => useQuickFormPresence())
    runtime.flushEffects("map")

    useUi.getState().openBooking({ tableIds: [3] })
    useUi.getState().closeBooking()
    expect(useUi.getState().draft?.tableIds).toEqual([3])

    runtime.unmount("map")
    expect(useUi.getState().closeBooking).toBe(origCloseBooking)
    expect(useUi.getState().draft).toBeNull()
  })
})

describe("P3-02 overlay focus handoff", () => {
  beforeEach(() => {
    runtime.reset()
    clearOverlayFocusRegistryForTest()
  })

  it("hands off CreateSheet -> FormScreen without stealing focus and restores trigger on FormScreen close", () => {
    const { MockHTMLElement, mockDocument } = runtime
    const createBtn = new MockHTMLElement({ tag: "button", "aria-label": "Tạo mới" })

    // Mount closed CreateSheet and FormScreen
    let createFocus = runtime.render("create", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("create")
    let formFocus = runtime.render("form", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("form")

    const createSheetEl = new MockHTMLElement(
      { "data-slot": "sheet-content", "data-gm-overlay-id": createFocus.overlayId },
      { motionState: "open" },
    )
    const bookMenuBtn = new MockHTMLElement({ tag: "button" })
    bookMenuBtn.parent = createSheetEl

    // User presses Tạo mới -> opens CreateSheet
    mockDocument.dispatchEvent("pointerdown", createBtn)
    mockDocument.activeElement = createBtn
    createFocus = runtime.render("create", () => useRestoreTriggerFocus(true))
    runtime.flushEffects("create")

    // User presses Đặt bàn inside CreateSheet -> CreateSheet closes while FormScreen opens
    mockDocument.dispatchEvent("pointerdown", bookMenuBtn)
    mockDocument.activeElement = bookMenuBtn
    createSheetEl.dataset.motionState = "closing"

    formFocus = runtime.render("form", () => useRestoreTriggerFocus(true))
    createFocus = runtime.render("create", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("form")
    runtime.flushEffects("create")

    // CreateSheet finishes exiting while FormScreen is open: must preventDefault and NOT focus createBtn
    let defaultPrevented = false
    createFocus.onCloseAutoFocus({
      preventDefault: () => {
        defaultPrevented = true
      },
    } as unknown as Event)
    expect(defaultPrevented).toBe(true)
    expect(createBtn.focusedCount).toBe(0)

    // FormScreen closes later: restores focus to surviving Tạo mới trigger
    formFocus = runtime.render("form", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("form")
    defaultPrevented = false
    formFocus.onCloseAutoFocus({
      preventDefault: () => {
        defaultPrevented = true
      },
    } as unknown as Event)
    expect(defaultPrevented).toBe(true)
    expect(createBtn.focusedCount).toBe(1)
  })

  it("hands off StatusDialog -> ConfirmDialog inside DetailScreen and returns focus to Status trigger", () => {
    const { MockHTMLElement, mockDocument } = runtime
    const listBtn = new MockHTMLElement({ tag: "button" })

    let detailFocus = runtime.render("detail", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("detail")
    let statusFocus = runtime.render("status", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("status")
    let confirmFocus = runtime.render("confirm", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("confirm")

    const detailEl = new MockHTMLElement(
      { "data-slot": "sheet-content", "data-gm-overlay-id": detailFocus.overlayId },
      { motionState: "open" },
    )
    const statusTrigger = new MockHTMLElement({ tag: "button" })
    statusTrigger.parent = detailEl

    const statusEl = new MockHTMLElement(
      { "data-slot": "dialog-content", "data-gm-overlay-id": statusFocus.overlayId },
      { motionState: "open" },
    )
    const releaseOption = new MockHTMLElement({ tag: "button" })
    releaseOption.parent = statusEl

    // Open DetailScreen from listBtn
    mockDocument.dispatchEvent("pointerdown", listBtn)
    mockDocument.activeElement = listBtn
    detailFocus = runtime.render("detail", () => useRestoreTriggerFocus(true))
    runtime.flushEffects("detail")

    // Open StatusDialog from statusTrigger inside DetailScreen
    mockDocument.dispatchEvent("pointerdown", statusTrigger)
    mockDocument.activeElement = statusTrigger
    statusFocus = runtime.render("status", () => useRestoreTriggerFocus(true))
    runtime.flushEffects("status")

    // Click releaseOption -> StatusDialog closes, ConfirmDialog opens
    mockDocument.dispatchEvent("pointerdown", releaseOption)
    mockDocument.activeElement = releaseOption
    statusEl.dataset.motionState = "closing"
    statusFocus = runtime.render("status", () => useRestoreTriggerFocus(false))
    confirmFocus = runtime.render("confirm", () => useRestoreTriggerFocus(true))
    runtime.flushEffects("status")
    runtime.flushEffects("confirm")

    // StatusDialog finishes exiting: must NOT restore focus to statusTrigger while ConfirmDialog is open
    statusFocus.onCloseAutoFocus({ preventDefault: () => undefined } as unknown as Event)
    expect(statusTrigger.focusedCount).toBe(0)

    // ConfirmDialog closes (Cancel / Escape): restores focus to statusTrigger inside still-open DetailScreen
    confirmFocus = runtime.render("confirm", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("confirm")
    confirmFocus.onCloseAutoFocus({ preventDefault: () => undefined } as unknown as Event)
    expect(statusTrigger.focusedCount).toBe(1)
  })

  it("prevents non-modal TableSheet from stealing focus when superseded by an open modal", () => {
    const { MockHTMLElement, mockDocument } = runtime
    const tableBtn = new MockHTMLElement({ role: "button" })

    let tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false }))
    runtime.flushEffects("table")
    runtime.render("detail", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("detail")

    mockDocument.dispatchEvent("pointerdown", tableBtn)
    mockDocument.activeElement = tableBtn
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(true, { modal: false }))
    runtime.flushEffects("table")

    // DetailScreen opens and supersedes TableSheet
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false }))
    runtime.render("detail", () => useRestoreTriggerFocus(true))
    runtime.flushEffects("table")
    runtime.flushEffects("detail")

    tableFocus.restoreNonModal()
    expect(tableBtn.focusedCount).toBe(0)
  })

  it("carries SVG table opener B4 through TableSheet -> DetailScreen and restores B4 on close", () => {
    const { MockHTMLElement, MockSVGElement, mockDocument } = runtime
    const b4Group = new MockSVGElement({ role: "button", "aria-label": "Bàn B4, Đã đặt, Anh A, 4 khách" })

    let tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false, sourceKey: null }))
    runtime.flushEffects("table")
    let detailFocus = runtime.render("detail", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("detail")

    const tableSheetEl = new MockHTMLElement(
      { "data-mobile-table-sheet": "true", "data-gm-overlay-id": tableFocus.overlayId },
      { motionState: "open" },
    )
    const viewBookingBtn = new MockHTMLElement({ tag: "button" })
    viewBookingBtn.parent = tableSheetEl

    // Focus B4, press Enter -> TableSheet opens
    mockDocument.dispatchEvent("focusin", b4Group)
    mockDocument.activeElement = b4Group
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(true, { modal: false, sourceKey: 4 }))
    runtime.flushEffects("table")

    // Click Xem booking inside TableSheet -> TableSheet closes, DetailScreen opens
    mockDocument.dispatchEvent("pointerdown", viewBookingBtn)
    mockDocument.activeElement = viewBookingBtn
    tableSheetEl.dataset.motionState = "closing"

    detailFocus = runtime.render("detail", () => useRestoreTriggerFocus(true))
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false, sourceKey: null }))
    runtime.flushEffects("detail")
    runtime.flushEffects("table")

    // TableSheet exit must not steal focus while DetailScreen is open
    tableFocus.restoreNonModal()
    expect(b4Group.focusedCount).toBe(0)

    // DetailScreen closes -> focus returns directly to SVG table B4
    detailFocus = runtime.render("detail", () => useRestoreTriggerFocus(false))
    runtime.flushEffects("detail")
    let defaultPrevented = false
    detailFocus.onCloseAutoFocus({
      preventDefault: () => {
        defaultPrevented = true
      },
    } as unknown as Event)
    expect(defaultPrevented).toBe(true)
    expect(b4Group.focusedCount).toBe(1)
    expect(mockDocument.activeElement).toBe(b4Group)
  })

  it("restores surviving SVG table C4 when QuickForm closes even if FloorCanvas remounted LiveGlyph", () => {
    const { MockHTMLElement, MockSVGElement, mockDocument } = runtime
    const c4Old = new MockSVGElement({ role: "button", "aria-label": "Bàn C4, Trống" })
    const c4InnerRect = new MockSVGElement({})
    c4InnerRect.parent = c4Old

    let tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false, sourceKey: null }))
    runtime.flushEffects("table")
    let qfFocus = runtime.render("qf", () => useRestoreTriggerFocus(false, { modal: false }))
    runtime.flushEffects("qf")

    const tableSheetEl = new MockHTMLElement(
      { "data-mobile-table-sheet": "true", "data-gm-overlay-id": tableFocus.overlayId },
      { motionState: "open" },
    )
    const bookBtn = new MockHTMLElement({ tag: "button" })
    bookBtn.parent = tableSheetEl

    // Click C4 inner rect -> TableSheet opens
    mockDocument.dispatchEvent("pointerdown", c4InnerRect)
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(true, { modal: false, sourceKey: 14 }))
    runtime.flushEffects("table")

    // Click Đặt bàn -> TableSheet closes, QuickForm opens
    mockDocument.dispatchEvent("pointerdown", bookBtn)
    mockDocument.activeElement = bookBtn
    tableSheetEl.dataset.motionState = "closing"
    qfFocus = runtime.render("qf", () => useRestoreTriggerFocus(true, { modal: false }))
    tableFocus = runtime.render("table", () => useRestoreTriggerFocus(false, { modal: false, sourceKey: null }))
    runtime.flushEffects("qf")
    runtime.flushEffects("table")

    // FloorCanvas toggled mode="availability" -> mode="live", replacing c4Old with c4New
    c4Old.isConnected = false
    const c4New = new MockSVGElement({ role: "button", "aria-label": "Bàn C4, Trống" })
    runtime.setSvgButtons([c4New])

    qfFocus = runtime.render("qf", () => useRestoreTriggerFocus(false, { modal: false }))
    runtime.flushEffects("qf")
    qfFocus.restoreNonModal()
    expect(c4New.focusedCount).toBe(1)
    expect(mockDocument.activeElement).toBe(c4New)
  })
})
