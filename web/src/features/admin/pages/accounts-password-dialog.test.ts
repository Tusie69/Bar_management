import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountSummary } from "@/services/contracts"

const mockEnv = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  reportError: vi.fn(),
  resetAccountPassword: vi.fn(),
}))

const hookRuntime = vi.hoisted(() => {
  type HookEffect = {
    deps?: readonly unknown[]
    create: () => void | (() => void)
    cleanup?: void | (() => void)
  }
  const state = {
    cursor: 0,
    states: [] as unknown[],
    refs: [] as Array<{ current: unknown }>,
    effects: [] as HookEffect[],
    pendingEffects: [] as number[],
    mounted: false,
    dirty: false,
  }
  const depsChanged = (prev?: readonly unknown[], next?: readonly unknown[]) => {
    if (!prev || !next || prev.length !== next.length) return true
    return next.some((value, index) => !Object.is(value, prev[index]))
  }
  return {
    state,
    reset() {
      for (const effect of state.effects) {
        if (effect && typeof effect.cleanup === "function") effect.cleanup()
      }
      state.cursor = 0
      state.states = []
      state.refs = []
      state.effects = []
      state.pendingEffects = []
      state.mounted = false
      state.dirty = false
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = state.cursor++
      if (!(idx in state.states)) {
        state.states[idx] = typeof initial === "function" ? (initial as () => T)() : initial
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = state.states[idx] as T
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next
        if (!Object.is(prev, resolved)) {
          state.states[idx] = resolved
          state.dirty = true
        }
      }
      return [state.states[idx] as T, setState]
    },
    useRef<T>(initial: T): { current: T } {
      const idx = state.cursor++
      if (!(idx in state.refs)) {
        state.refs[idx] = { current: initial }
      }
      return state.refs[idx] as { current: T }
    },
    useEffect(create: () => void | (() => void), deps?: readonly unknown[]) {
      const idx = state.cursor++
      const prev = state.effects[idx]
      if (!prev || depsChanged(prev.deps, deps)) {
        state.effects[idx] = { deps, create, cleanup: prev?.cleanup }
        state.pendingEffects.push(idx)
      }
    },
    flushEffects() {
      const indices = state.pendingEffects.splice(0, state.pendingEffects.length)
      for (const idx of indices) {
        const entry = state.effects[idx]
        if (!entry) continue
        if (typeof entry.cleanup === "function") entry.cleanup()
        entry.cleanup = entry.create()
      }
    },
    unmount() {
      for (const effect of state.effects) {
        if (effect && typeof effect.cleanup === "function") {
          effect.cleanup()
          effect.cleanup = undefined
        }
      }
      state.mounted = false
    },
  }
})

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useState: hookRuntime.useState,
    useRef: hookRuntime.useRef,
    useEffect: hookRuntime.useEffect,
  }
})

vi.mock("sonner", () => ({
  toast: {
    success: mockEnv.toastSuccess,
    error: mockEnv.toastError,
  },
}))

vi.mock("@/hooks/use-action", () => ({
  reportError: mockEnv.reportError,
}))

vi.mock("@/services", () => ({
  api: {
    resetAccountPassword: mockEnv.resetAccountPassword,
  },
}))

import { isValidElement, type ReactElement, type ReactNode } from "react"
import { Dialog } from "@/components/ui/dialog"
import { PasswordResetDialog } from "./accounts-password-dialog"

const ACCOUNT_A: AccountSummary = {
  id: 4,
  version: 1,
  username: "le_tan_1",
  displayName: "Lễ tân 1",
  roles: ["RECEPTIONIST"],
  accessLevel: null,
  status: "ACTIVE",
  membershipStatus: "ACTIVE",
  lastLoginAt: "2026-11-17T02:05:00.000Z",
}

const ACCOUNT_B: AccountSummary = {
  id: 5,
  version: 3,
  username: "cskh_1",
  displayName: "CSKH",
  roles: ["RECEPTIONIST"],
  accessLevel: null,
  status: "ACTIVE",
  membershipStatus: "ACTIVE",
  lastLoginAt: null,
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type ElementWithProps = ReactElement<Record<string, unknown>>

function walkElements(node: ReactNode, visitor: (el: ElementWithProps) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visitor)
    return
  }
  if (!isValidElement(node)) return
  const el = node as ElementWithProps
  visitor(el)
  if (typeof el.type === "function" && el.type.name === "IssuedPassword") {
    walkElements((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visitor)
  }
  if (el.props && "children" in el.props) {
    walkElements(el.props.children as ReactNode, visitor)
  }
}

function findByTestId(tree: ReactNode, testId: string): ElementWithProps | null {
  let found: ElementWithProps | null = null
  walkElements(tree, (el) => {
    if (!found && el.props["data-testid"] === testId) found = el
  })
  return found
}

function findDialog(tree: ReactNode): ElementWithProps | null {
  let found: ElementWithProps | null = null
  walkElements(tree, (el) => {
    if (!found && el.type === Dialog) found = el
  })
  return found
}

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join("")
  if (!isValidElement(node)) return ""
  const el = node as ElementWithProps
  if (typeof el.type === "function" && el.type.name === "IssuedPassword") {
    return collectText((el.type as (props: Record<string, unknown>) => ReactNode)(el.props))
  }
  return collectText(el.props.children as ReactNode)
}

function createHarness() {
  let currentProps: {
    open: boolean
    account: AccountSummary | null
    onClose: () => void
    onDone: () => void
  } = {
    open: false,
    account: null,
    onClose: vi.fn(),
    onDone: vi.fn(),
  }
  let tree: ReactNode = null

  const render = (nextProps?: Partial<typeof currentProps>) => {
    if (nextProps) currentProps = { ...currentProps, ...nextProps }
    for (let pass = 0; pass < 20; pass++) {
      hookRuntime.state.cursor = 0
      hookRuntime.state.dirty = false
      hookRuntime.state.pendingEffects = []
      tree = PasswordResetDialog(currentProps)
      if (!hookRuntime.state.dirty) break
    }
    hookRuntime.state.mounted = true
    hookRuntime.flushEffects()
    return tree
  }

  return {
    render,
    rerender: () => render(),
    getTree: () => tree,
    getProps: () => currentProps,
    clickRandom() {
      const btn = findByTestId(tree, "admin-password-random")
      if (!btn) throw new Error("admin-password-random not rendered")
      ;(btn.props.onClick as () => void)()
      render()
    },
    setPassword(value: string) {
      const input = findByTestId(tree, "admin-password-input")
      if (!input) throw new Error("admin-password-input not rendered")
      ;(input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } })
      render()
    },
    clickSubmit() {
      const btn = findByTestId(tree, "admin-password-submit")
      if (!btn) throw new Error("admin-password-submit not rendered")
      ;(btn.props.onClick as () => void)()
      render()
    },
    requestClose() {
      const dialog = findDialog(tree)
      if (!dialog) throw new Error("Dialog not rendered")
      ;(dialog.props.onOpenChange as (open: boolean) => void)(false)
      render()
    },
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("PasswordResetDialog async session isolation", () => {
  beforeEach(() => {
    hookRuntime.reset()
    mockEnv.toastSuccess.mockReset()
    mockEnv.toastError.mockReset()
    mockEnv.reportError.mockReset()
    mockEnv.resetAccountPassword.mockReset()
  })

  it("ignores stale random reset credential when dialog closes and opens for account B", async () => {
    const reqA = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqA.promise)

    const onDone = vi.fn()
    const onCloseB = vi.fn()
    const h = createHarness()

    h.render({ open: true, account: ACCOUNT_A, onClose: vi.fn(), onDone })
    h.clickRandom()
    expect(mockEnv.resetAccountPassword).toHaveBeenCalledWith(4, 1, undefined)

    // Close A (mimicking parent setting open=false while exit runs), then open B
    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_B, onClose: onCloseB, onDone })

    reqA.resolve({ temporaryPassword: "OLD-ACCOUNT-SECRET-1234" })
    await flushMicrotasks()
    h.rerender()

    expect(findByTestId(h.getTree(), "admin-password-issued")).toBeNull()
    expect(collectText(h.getTree())).not.toContain("OLD-ACCOUNT-SECRET-1234")
    expect(collectText(h.getTree())).toContain("CSKH")
    expect(onCloseB).not.toHaveBeenCalled()
    expect(mockEnv.toastSuccess).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("ignores stale manual reset completion and does not close account B's dialog", async () => {
    const reqA = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqA.promise)

    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    const onDone = vi.fn()
    const h = createHarness()

    h.render({ open: true, account: ACCOUNT_A, onClose: onCloseA, onDone })
    h.setPassword("ValidPassword1234")
    h.clickSubmit()
    expect(mockEnv.resetAccountPassword).toHaveBeenCalledWith(4, 1, "ValidPassword1234")

    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_B, onClose: onCloseB, onDone })

    reqA.resolve({ temporaryPassword: null })
    await flushMicrotasks()
    h.rerender()

    expect(onCloseB).not.toHaveBeenCalled()
    expect(onCloseA).not.toHaveBeenCalled()
    expect(mockEnv.toastSuccess).not.toHaveBeenCalled()
    expect(findByTestId(h.getTree(), "admin-password-input")).not.toBeNull()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("invalidates stale completion when closing and reopening the same account A", async () => {
    const reqA1 = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqA1.promise)

    const onClose = vi.fn()
    const h = createHarness()

    h.render({ open: true, account: ACCOUNT_A, onClose, onDone: vi.fn() })
    h.clickRandom()

    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_A, onClose, onDone: vi.fn() })

    reqA1.resolve({ temporaryPassword: "STALE-SAME-ACCOUNT-SECRET" })
    await flushMicrotasks()
    h.rerender()

    expect(findByTestId(h.getTree(), "admin-password-issued")).toBeNull()
    expect(collectText(h.getTree())).not.toContain("STALE-SAME-ACCOUNT-SECRET")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("does not let an older session clear pending state or leak errors into a newer pending session", async () => {
    const reqA = deferred<{ temporaryPassword: string | null }>()
    const reqB = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqA.promise).mockReturnValueOnce(reqB.promise)

    const onCloseB = vi.fn()
    const h = createHarness()

    h.render({ open: true, account: ACCOUNT_A, onClose: vi.fn(), onDone: vi.fn() })
    h.clickRandom()

    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_B, onClose: onCloseB, onDone: vi.fn() })

    h.setPassword("ValidPassword5678")
    h.clickSubmit()
    expect(findByTestId(h.getTree(), "admin-password-submit")?.props.disabled).toBe(true)
    expect(findByTestId(h.getTree(), "admin-password-random")?.props.disabled).toBe(true)

    // Old request A resolves while B is still pending -> must NOT clear B's pending or show A's secret
    reqA.resolve({ temporaryPassword: "OLD-SECRET-WHILE-B-PENDING" })
    await flushMicrotasks()
    h.rerender()

    expect(findByTestId(h.getTree(), "admin-password-issued")).toBeNull()
    expect(findByTestId(h.getTree(), "admin-password-submit")?.props.disabled).toBe(true)
    expect(findByTestId(h.getTree(), "admin-password-random")?.props.disabled).toBe(true)
    expect(onCloseB).not.toHaveBeenCalled()

    // Now B's own request resolves -> toast + close fire for B
    reqB.resolve({ temporaryPassword: null })
    await flushMicrotasks()
    h.rerender()

    expect(mockEnv.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mockEnv.toastSuccess.mock.calls[0]?.[0]).toContain("CSKH")
    expect(onCloseB).toHaveBeenCalledTimes(1)
  })

  it("ignores stale rejection error from an older session without clearing a newer pending request", async () => {
    const reqA = deferred<{ temporaryPassword: string | null }>()
    const reqB = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqA.promise).mockReturnValueOnce(reqB.promise)

    const h = createHarness()
    h.render({ open: true, account: ACCOUNT_A, onClose: vi.fn(), onDone: vi.fn() })
    h.clickRandom()

    h.requestClose()
    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_B, onClose: vi.fn(), onDone: vi.fn() })
    h.setPassword("ValidPassword1234")
    h.clickSubmit()

    reqA.reject(new Error("Stale failure"))
    await flushMicrotasks()
    h.rerender()

    expect(mockEnv.reportError).not.toHaveBeenCalled()
    expect(findByTestId(h.getTree(), "admin-password-submit")?.props.disabled).toBe(true)

    reqB.resolve({ temporaryPassword: null })
    await flushMicrotasks()
    h.rerender()

    expect(mockEnv.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mockEnv.toastSuccess.mock.calls[0]?.[0]).toContain("CSKH")
  })

  it("completes uninterrupted random, manual, and version-refreshed single sessions normally", async () => {
    const reqRandom = deferred<{ temporaryPassword: string | null }>()
    const reqManual = deferred<{ temporaryPassword: string | null }>()
    mockEnv.resetAccountPassword.mockReturnValueOnce(reqRandom.promise).mockReturnValueOnce(reqManual.promise)

    const onDone = vi.fn()
    const onClose = vi.fn()
    const h = createHarness()

    h.render({ open: true, account: ACCOUNT_A, onClose, onDone })
    h.clickRandom()
    // Background account list refetch produces a new object reference for the same account id
    h.render({ open: true, account: { ...ACCOUNT_A, version: 2 }, onClose, onDone })

    reqRandom.resolve({ temporaryPassword: "FRESH-TEMP-PASSWORD" })
    await flushMicrotasks()
    h.rerender()

    expect(findByTestId(h.getTree(), "admin-password-issued")).not.toBeNull()
    expect(collectText(h.getTree())).toContain("FRESH-TEMP-PASSWORD")
    expect(onDone).toHaveBeenCalledTimes(1)

    h.render({ open: false, account: null })
    h.render({ open: true, account: ACCOUNT_B, onClose, onDone })
    h.setPassword("ValidPassword9999")
    h.clickSubmit()

    reqManual.resolve({ temporaryPassword: null })
    await flushMicrotasks()
    h.rerender()

    expect(mockEnv.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mockEnv.toastSuccess.mock.calls[0]?.[0]).toContain("CSKH")
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
