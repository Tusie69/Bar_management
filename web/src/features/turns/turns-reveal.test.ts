import { beforeEach, describe, expect, it, vi } from "vitest"

const mockState = vi.hoisted(() => ({
  revealedFlag: { current: false },
  gsapCalls: [] as Array<{
    callback: () => (() => void) | void
    config: { scope?: unknown; dependencies?: unknown[] }
  }>,
  toArrayTargets: [] as HTMLElement[],
  toArrayScopes: [] as unknown[],
  revertSpy: vi.fn(),
  setupRevealMock: vi.fn(),
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useRef: () => mockState.revealedFlag,
  }
})

vi.mock("@gsap/react", () => ({
  useGSAP: (callback: () => (() => void) | void, config: { scope?: unknown; dependencies?: unknown[] }) => {
    mockState.gsapCalls.push({ callback, config })
  },
}))

vi.mock("gsap", () => ({
  default: {
    utils: {
      toArray: (_selector: string, scope: unknown) => {
        mockState.toArrayScopes.push(scope)
        return mockState.toArrayTargets
      },
    },
  },
}))

vi.mock("@/features/admin/admin-motion", () => ({
  setupRevealMatchMedia: (targets: HTMLElement[]) => {
    mockState.setupRevealMock(targets)
    return { revert: mockState.revertSpy }
  },
}))

import { useTurnsFirstReveal } from "./turns-reveal"

describe("useTurnsFirstReveal (P2A-04)", () => {
  beforeEach(() => {
    mockState.revealedFlag.current = false
    mockState.gsapCalls = []
    mockState.toArrayTargets = []
    mockState.toArrayScopes = []
    mockState.revertSpy.mockReset()
    mockState.setupRevealMock.mockReset()
  })

  it("registers scoped useGSAP, waits for ready, runs setupRevealMatchMedia once, and returns revert cleanup", () => {
    const fakeRoot = { tagName: "DIV" } as unknown as HTMLDivElement
    const rootRef = { current: fakeRoot }
    const targetA = { tagName: "DIV" } as unknown as HTMLElement
    const targetB = { tagName: "SECTION" } as unknown as HTMLElement
    mockState.toArrayTargets = [targetA, targetB]

    // 1. Initial loading state (ready = false)
    useTurnsFirstReveal(rootRef, false)
    expect(mockState.gsapCalls).toHaveLength(1)
    expect(mockState.gsapCalls[0]!.config).toEqual({ scope: rootRef, dependencies: [false] })
    const earlyCleanup = mockState.gsapCalls[0]!.callback()
    expect(earlyCleanup).toBeUndefined()
    expect(mockState.setupRevealMock).not.toHaveBeenCalled()

    // 2. Data arrives (ready = true)
    useTurnsFirstReveal(rootRef, true)
    expect(mockState.gsapCalls).toHaveLength(2)
    expect(mockState.gsapCalls[1]!.config).toEqual({ scope: rootRef, dependencies: [true] })
    const cleanup = mockState.gsapCalls[1]!.callback()
    expect(mockState.toArrayScopes).toEqual([fakeRoot])
    expect(mockState.setupRevealMock).toHaveBeenCalledTimes(1)
    expect(mockState.setupRevealMock).toHaveBeenCalledWith([targetA, targetB])
    expect(typeof cleanup).toBe("function")

    // 3. Filter switch or refetch does not re-trigger reveal
    useTurnsFirstReveal(rootRef, true)
    const noopCleanup = mockState.gsapCalls[2]!.callback()
    expect(noopCleanup).toBeUndefined()
    expect(mockState.setupRevealMock).toHaveBeenCalledTimes(1)

    // 4. Unmount cleanup reverts matchMedia context
    cleanup?.()
    expect(mockState.revertSpy).toHaveBeenCalledTimes(1)
  })
})
