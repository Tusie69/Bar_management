import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnBadge } from "./turn-badge"

describe("TurnBadge", () => {
  it("renders nothing when count is absent, null, undefined, or NaN", () => {
    expect(renderToString(createElement(TurnBadge, {}))).toBe("")
    expect(renderToString(createElement(TurnBadge, { count: null }))).toBe("")
    expect(renderToString(createElement(TurnBadge, { count: undefined }))).toBe("")
    expect(renderToString(createElement(TurnBadge, { count: Number.NaN }))).toBe("")
  })

  it("renders nothing when count is 0 or negative", () => {
    expect(renderToString(createElement(TurnBadge, { count: 0 }))).toBe("")
    expect(renderToString(createElement(TurnBadge, { count: -1 }))).toBe("")
    expect(renderToString(createElement(TurnBadge, { count: -5 }))).toBe("")
  })

  it("renders nothing for the first turn and shows from the second", () => {
    expect(renderToString(createElement(TurnBadge, { count: 1 }))).toBe("")

    const html2 = renderToString(createElement(TurnBadge, { count: 2 }))
    expect(html2).toContain("turn-badge")
    expect(html2).toContain(">2<")
    expect(html2).toContain('aria-label="Lượt 2"')
    // Black circle with white text
    expect(html2).toContain('fill="#000000"')
    expect(html2).toContain('fill="#ffffff"')
  })

  it("renders count 2 correctly", () => {
    const html2 = renderToString(createElement(TurnBadge, { count: 2 }))
    expect(html2).toContain("turn-badge")
    expect(html2).toContain(">2<")
    expect(html2).toContain('aria-label="Lượt 2"')
    expect(html2).toContain('fill="#000000"')
    expect(html2).toContain('fill="#ffffff"')
  })

  it("renders higher turn counts (3, 5)", () => {
    const html3 = renderToString(createElement(TurnBadge, { count: 3 }))
    expect(html3).toContain(">3<")
    expect(html3).toContain('aria-label="Lượt 3"')

    const html5 = renderToString(createElement(TurnBadge, { count: 5 }))
    expect(html5).toContain(">5<")
    expect(html5).toContain('aria-label="Lượt 5"')
  })

  it("is readable at the smallest map scale with bold font and high contrast", () => {
    const html = renderToString(createElement(TurnBadge, { count: 2 }))
    expect(html).toContain('font-weight="800"')
    expect(html).toContain('fill="#000000"')
    expect(html).toContain('stroke="#ffffff"')
  })

  it("positions correctly in SVG coordinate space (bottom-left of cell)", () => {
    const html = renderToString(
      createElement(TurnBadge, {
        count: 2,
        x: -20,
        y: 15,
      }),
    )
    expect(html).toContain('transform="translate(-20 15)"')
  })

  it("supports HTML rendering mode", () => {
    const html = renderToString(
      createElement(TurnBadge, {
        count: 2,
        as: "html",
      }),
    )
    expect(html).toContain("turn-badge-html")
    expect(html).toContain("bg-black")
    expect(html).toContain("text-white")
    expect(html).toContain("2")
    expect(html).toContain('aria-label="Lượt 2"')
  })
})
