import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { normalizeIconKey } from "./floor-visual-rules"
import { TableIcons } from "./table-icons"

describe("TableIcons", () => {
  it("renders nothing for empty, null, or undefined input", () => {
    expect(renderToString(createElement(TableIcons, {}))).toBe("")
    expect(renderToString(createElement(TableIcons, { iconKeys: null }))).toBe("")
    expect(renderToString(createElement(TableIcons, { iconKeys: [] }))).toBe("")
    expect(renderToString(createElement(TableIcons, { icons: null }))).toBe("")
    expect(renderToString(createElement(TableIcons, { icons: [] }))).toBe("")
    expect(renderToString(createElement(TableIcons, { iconKeys: ["unknown", "invalid"] }))).toBe("")
  })

  it("normalizes icon keys correctly", () => {
    expect(normalizeIconKey("star")).toBe("star")
    expect(normalizeIconKey("VIP")).toBe("star")
    expect(normalizeIconKey("boss")).toBe("star")
    expect(normalizeIconKey("fire")).toBe("fire")
    expect(normalizeIconKey("RETURNING")).toBe("fire")
    expect(normalizeIconKey("pin")).toBe("pin")
    expect(normalizeIconKey("DESIGNATED")).toBe("pin")
    expect(normalizeIconKey("cake")).toBe("cake")
    expect(normalizeIconKey("BIRTHDAY")).toBe("cake")
    expect(normalizeIconKey("is_birthday")).toBe("cake")
    expect(normalizeIconKey("other")).toBeNull()
  })

  it("renders single star icon (Bàn sếp)", () => {
    const html = renderToString(createElement(TableIcons, { iconKeys: ["star"] }))
    expect(html).toContain("⭐")
    expect(html).toContain('data-icon="star"')
    expect(html).toContain("Bàn sếp")
  })

  it("renders single fire icon (Đã từng đặt bàn)", () => {
    const html = renderToString(createElement(TableIcons, { iconKeys: ["fire"] }))
    expect(html).toContain("🔥")
    expect(html).toContain('data-icon="fire"')
    expect(html).toContain("Đã từng đặt bàn")
  })

  it("renders single pin icon (Chỉ định)", () => {
    const html = renderToString(createElement(TableIcons, { iconKeys: ["pin"] }))
    expect(html).toContain("📌")
    expect(html).toContain('data-icon="pin"')
    expect(html).toContain("Chỉ định")
  })

  it("renders single cake icon (Sinh nhật)", () => {
    const html = renderToString(createElement(TableIcons, { iconKeys: ["cake"] }))
    expect(html).toContain("🎂")
    expect(html).toContain('data-icon="cake"')
    expect(html).toContain("Sinh nhật")
  })

  it("renders several icons together in one small row without covering table code", () => {
    // 3 icons together
    const html = renderToString(
      createElement(TableIcons, {
        iconKeys: ["star", "fire", "cake"],
        x: 20,
        y: -15,
      }),
    )
    expect(html).toContain("⭐")
    expect(html).toContain("🔥")
    expect(html).toContain("🎂")
    expect(html).toContain('transform="translate(20 -15)"')
    // Icons expand leftward (-12, -24) along top edge
    expect(html).toContain('transform="translate(0 0)"')
    expect(html).toContain('transform="translate(-12 0)"')
    expect(html).toContain('transform="translate(-24 0)"')
    expect(html).toContain("Bàn sếp, Đã từng đặt bàn, Sinh nhật")
  })

  it("deduplicates identical icon keys", () => {
    const html = renderToString(
      createElement(TableIcons, {
        iconKeys: ["star", "VIP", "boss", "star"],
      }),
    )
    // Only one star rendered
    const starMatches = html.match(/data-icon="star"/g)
    expect(starMatches?.length).toBe(1)
  })

  it("renders all four icons when all four are specified", () => {
    const html = renderToString(
      createElement(TableIcons, {
        iconKeys: ["star", "fire", "pin", "cake"],
      }),
    )
    expect(html).toContain("⭐")
    expect(html).toContain("🔥")
    expect(html).toContain("📌")
    expect(html).toContain("🎂")
    expect(html).toContain("Bàn sếp, Đã từng đặt bàn, Chỉ định, Sinh nhật")
  })

  it("supports HTML rendering mode", () => {
    const html = renderToString(
      createElement(TableIcons, {
        icons: ["star", "cake"],
        as: "html",
      }),
    )
    expect(html).toContain("table-icons-container")
    expect(html).toContain("⭐")
    expect(html).toContain("🎂")
    expect(html).toContain("Bàn sếp, Sinh nhật")
  })
})
