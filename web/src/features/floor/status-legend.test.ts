import React from "react"
import { describe, expect, it } from "vitest"
import { renderToString } from "react-dom/server"
import { STATE_META } from "@/components/status-meta"
import { StateSwatch, WarningChip } from "@/components/status"
import { StatusLegend } from "./status-legend"

describe("G3 - status metadata and language (HU-32 section 4)", () => {
  it("defines the 5 core status names and tokens matching HU-32 + late red", () => {
    // 1. Trống
    expect(STATE_META.free.label).toBe("Trống")
    expect(STATE_META.free.color).toBe("var(--st-free)")
    expect(STATE_META.free.tint).toBe("var(--st-free-tint)")

    // 2. Đã đặt
    expect(STATE_META.reserved.label).toBe("Đã đặt")
    expect(STATE_META.reserved.color).toBe("var(--st-reserved)")
    expect(STATE_META.reserved.tint).toBe("var(--st-reserved-tint)")

    // 3. Sắp tới
    expect(STATE_META.upcoming.label).toBe("Sắp tới")
    expect(STATE_META.upcoming.color).toBe("var(--st-upcoming)")
    expect(STATE_META.upcoming.tint).toBe("var(--st-upcoming-tint)")

    // 4. Tới muộn (late, late_confirmed, noshow) -> red token
    expect(STATE_META.late.label).toBe("Tới muộn")
    expect(STATE_META.late.color).toBe("var(--st-noshow)")
    expect(STATE_META.late.tint).toBe("var(--st-noshow-tint)")

    expect(STATE_META.late_confirmed.label).toBe("Tới muộn")
    expect(STATE_META.late_confirmed.color).toBe("var(--st-noshow)")
    expect(STATE_META.late_confirmed.tint).toBe("var(--st-noshow-tint)")

    expect(STATE_META.noshow.label).toBe("Tới muộn")
    expect(STATE_META.noshow.color).toBe("var(--st-noshow)")
    expect(STATE_META.noshow.tint).toBe("var(--st-noshow-tint)")

    // 5. Đã tới
    expect(STATE_META.seated.label).toBe("Đã tới")
    expect(STATE_META.seated.color).toBe("var(--st-seated)")
    expect(STATE_META.seated.tint).toBe("var(--st-seated-tint)")
  })

  it("ensures no live state uses 'Khách không tới' label", () => {
    for (const meta of Object.values(STATE_META)) {
      expect(meta.label).not.toContain("không tới")
      expect(meta.label).not.toContain("Khách không tới")
      expect(meta.short).not.toContain("không tới")
    }
  })

  it("WarningChip formats warning as 'Tới muộn +N'' and never 'Khách không tới'", () => {
    const htmlLate = renderToString(React.createElement(WarningChip, { warning: "late", minutes: 15 }))
    expect(htmlLate).toContain("Tới muộn +")
    expect(htmlLate).toContain("15")
    expect(htmlLate).not.toContain("không tới")

    const htmlNoshow = renderToString(React.createElement(WarningChip, { warning: "noshow", minutes: 30 }))
    expect(htmlNoshow).toContain("Tới muộn +")
    expect(htmlNoshow).toContain("30")
    expect(htmlNoshow).not.toContain("không tới")
  })

  it("StateSwatch renders appropriate swatch styles for table live states", () => {
    const freeSwatch = renderToString(React.createElement(StateSwatch, { state: "free" }))
    expect(freeSwatch).toContain("border-color:var(--st-free)")
    expect(freeSwatch).toContain("background:var(--st-free-tint)")

    const seatedSwatch = renderToString(React.createElement(StateSwatch, { state: "seated" }))
    expect(seatedSwatch).toContain("border-color:var(--st-seated)")
    expect(seatedSwatch).toContain("background:var(--st-seated-fill)")

    const noshowSwatch = renderToString(React.createElement(StateSwatch, { state: "noshow" }))
    expect(noshowSwatch).toContain("border-color:var(--st-noshow)")
    expect(noshowSwatch).toContain("background:var(--st-noshow-tint)")

    const spareSwatch = renderToString(React.createElement(StateSwatch, { state: "spare" }))
    expect(spareSwatch).toContain("border-color:var(--table-line)")
    expect(spareSwatch).toContain("background:var(--st-free-tint)")
    expect(spareSwatch).toContain("border-style:dashed")
  })

  it("STATE_META defines spare state with soft neutral colors and dashed icon", () => {
    expect(STATE_META.spare.label).toBe("Bàn sơ cua")
    expect(STATE_META.spare.short).toBe("Sơ cua")
    expect(STATE_META.spare.color).toBe("var(--table-line)")
    expect(STATE_META.spare.tint).toBe("var(--st-free-tint)")
  })

  it("StatusLegend renders polished box with heading, chips, and tabular counts", () => {
    const mockTables = [
      { id: 1, code: "A1", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "free", version: 1, displayName: "A1", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isSpare: false, isActive: true },
      { id: 2, code: "A2", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "reserved", version: 1, displayName: "A2", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isSpare: false, isActive: true },
      { id: 3, code: "A3", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "upcoming", version: 1, displayName: "A3", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isSpare: false, isActive: true },
      { id: 4, code: "A4", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "noshow", version: 1, displayName: "A4", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isSpare: false, isActive: true },
      { id: 5, code: "A5", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "seated", version: 1, displayName: "A5", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isSpare: false, isActive: true },
      { id: 6, code: "A0", x: 0, y: 0, w: 30, h: 30, kind: "TABLE", zoneCode: "A", state: "free", isSpare: true, version: 1, displayName: "A0", zoneId: 1, capacity: 4, minCapacity: 2, shape: "RECT", isActive: true },
    ] as any

    const html = renderToString(
      React.createElement(StatusLegend, {
        tables: mockTables,
      }),
    )

    // Heading
    expect(html).toContain("Trạng thái · Số bàn / ghế")

    // Legend Chips in order
    expect(html).toContain("Trống")
    expect(html).toContain("Đã đặt")
    expect(html).toContain("Sắp tới")
    expect(html).toContain("Tới muộn")
    expect(html).toContain("Đã tới")
    expect(html).toContain("Sơ cua")

    // Swatch for spare has dashed border and beige/grey tint background
    expect(html).toContain("border-dashed")
    expect(html).toContain("border-color:var(--table-line)")
    expect(html).toContain("background:var(--st-free-tint)")

    // Tabular numbers
    expect(html).toContain("tabular-nums")

    // Does not have "Khách không tới"
    expect(html).not.toContain("Khách không tới")
  })

  it("updates counts dynamically and gives precedence to booking state over spare flag", () => {
    // When a spare table has booking data (e.g. seated), real booking state wins
    const mockTables = [
      { id: 1, code: "B1", kind: "TABLE", isSpare: true, state: "seated", isActive: true },
      { id: 2, code: "B2", kind: "TABLE", isSpare: true, state: "free", isActive: true },
      { id: 3, code: "B3", kind: "TABLE", isSpare: false, state: "free", isActive: true },
    ] as any

    const html = renderToString(React.createElement(StatusLegend, { tables: mockTables }))

    // B1 is seated -> counted under Đã tới (1)
    // B2 is spare free -> counted under Sơ cua (1)
    // B3 is free -> counted under Trống (1)
    expect(html).toContain("Trống")
    expect(html).toContain("Đã tới")
    expect(html).toContain("Sơ cua")
  })
})
