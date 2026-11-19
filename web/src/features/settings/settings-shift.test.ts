/**
 * TU-38 — the operating shift row on the Cấu hình screen.
 *
 * Renders the real form rather than reimplementing its logic, so the two fields, the inline
 * reason and the disabled Save button are asserted as the screen actually produces them. The
 * form sits behind an OWNER login, which is why this is a render test and not a browser check.
 */
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { VenueSettingsView } from "@/domain/models"

const mockState = {
  settings: {
    quickTimes: ["21:00", "21:30"],
    upcomingMinutes: 10,
    noShowMinutes: 30,
    businessDayStartLocal: "17:00:00",
    businessDayCutoffLocal: "05:00:00",
  } as VenueSettingsView,
}

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
})

vi.mock("@/hooks/use-data", () => ({
  useVenueSettings: () => ({ data: mockState.settings }),
  useCatalog: () => ({ data: undefined }),
  qk: { settings: ["settings"], catalog: ["catalog"] },
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}))

vi.mock("@/services", () => ({
  api: { mode: "http", updateVenueSettings: vi.fn() },
  REST_ENDPOINTS: [],
}))

vi.mock("@/state/session", () => ({
  useCan: () => true,
  useSession: () => undefined,
}))

vi.mock("@/hooks/use-action", () => ({
  reportError: vi.fn(),
  useAction: () => ({ run: vi.fn(), pending: false }),
}))

vi.mock("@/components/common", () => ({
  GroupSymbolIcon: () => null,
  GuardedButton: ({ disabled, children }: { disabled?: boolean; children?: unknown }) =>
    createElement("button", { type: "button", disabled, "data-testid": "settings-save" }, children as never),
  PendingTag: () => null,
  SectionTitle: () => null,
}))

const { DynamicVenueSettings } = await import("./settings-page")

function render() {
  return renderToString(createElement(DynamicVenueSettings, { readOnly: false }))
}

/** React emits the attributes in its own order, so match the button rather than a literal. */
function savedDisabled(html: string): boolean {
  const button = /<button[^>]*data-testid="settings-save"[^>]*>/.exec(html)?.[0] ?? ''
  return button.includes('disabled=""')
}

describe("TU-38 operating shift row", () => {
  beforeEach(() => {
    mockState.settings = {
      quickTimes: ["21:00", "21:30"],
      upcomingMinutes: 10,
      noShowMinutes: 30,
      businessDayStartLocal: "17:00:00",
      businessDayCutoffLocal: "05:00:00",
    }
  })

  it("shows the stored shift as two HH:mm fields with no error and Save idle", () => {
    const html = render()
    expect(html).toContain("Ca vận hành")
    expect(html).toContain('aria-label="Giờ mở ca"')
    expect(html).toContain('aria-label="Mốc cắt ca"')
    expect(html).toContain('value="17:00"')
    expect(html).toContain('value="05:00"')
    // The hint quotes the venue's own cutoff rather than a fixed 05:00.
    expect(html).toContain("DATE(giờ địa phương - 05:00)")
    expect(html).not.toContain('data-testid="settings-shift-error"')
    // Nothing is dirty yet, so Save is disabled.
    expect(savedDisabled(html)).toBe(true)
  })

  it("reflects a venue configured for another shift", () => {
    mockState.settings = { ...mockState.settings, businessDayStartLocal: "18:30:00", businessDayCutoffLocal: "03:00:00" }
    const html = render()
    expect(html).toContain('value="18:30"')
    expect(html).toContain('value="03:00"')
    expect(html).toContain("DATE(giờ địa phương - 03:00)")
    expect(html).not.toContain('data-testid="settings-shift-error"')
  })

  it("names the reason inline and disables Save when the shift cannot serve the booking window", () => {
    // A venue opening at 20:00 could never seat a 19:00 booking.
    mockState.settings = { ...mockState.settings, businessDayStartLocal: "20:00:00", businessDayCutoffLocal: "02:00:00" }
    const html = render()
    expect(html).toContain('data-testid="settings-shift-error"')
    expect(html).toContain("19:00–01:00")
    expect(savedDisabled(html)).toBe(true)
  })

  it("names the reason inline when a boundary is not a time", () => {
    mockState.settings = { ...mockState.settings, businessDayStartLocal: "nope", businessDayCutoffLocal: "05:00:00" }
    const html = render()
    expect(html).toContain('data-testid="settings-shift-error"')
    expect(html).toContain("HH:mm")
    expect(savedDisabled(html)).toBe(true)
  })
})
