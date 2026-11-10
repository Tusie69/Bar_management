import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { BarGuestList } from "./bar-guest-list"
import { DEFAULT_BAR_GUEST_LIST_BOUNDS, type BarGuestRow } from "./bar-guest-rows"

function makeSampleRow(overrides: Partial<BarGuestRow> = {}): BarGuestRow {
  return {
    bookingKey: "res:101",
    seatNumbers: [1],
    seatsLabel: "Bar1",
    time: "21:00",
    partySize: 2,
    guestName: "Nam",
    state: "seated" as TableLiveState,
    icons: {},
    ...overrides,
  }
}

describe("BarGuestList presentational component", () => {
  it("keeps the scroll region keyboard accessible with a contextual name", () => {
    const html = renderToString(createElement(BarGuestList, {
      rows: [], as: "html", ariaLabel: "Khách quầy bar - Sơ đồ chọn bàn đặt trước",
    }))
    expect(html).toContain('role="region" tabindex="0" aria-label="Khách quầy bar - Sơ đồ chọn bàn đặt trước"')
    expect(html).toContain("Khách quầy bar</div>")
  })

  it("renders in SVG mode inside a foreignObject with default bounds", () => {
    const rows = [makeSampleRow()]
    const html = renderToString(
      createElement("svg", null, createElement(BarGuestList, { rows, as: "svg" })),
    )

    expect(html).toContain("<foreignObject")
    expect(html).toContain(`x="${DEFAULT_BAR_GUEST_LIST_BOUNDS.x}"`)
    expect(html).toContain(`y="${DEFAULT_BAR_GUEST_LIST_BOUNDS.y}"`)
    expect(html).toContain(`width="${DEFAULT_BAR_GUEST_LIST_BOUNDS.width}"`)
    expect(html).toContain(`height="${DEFAULT_BAR_GUEST_LIST_BOUNDS.height}"`)

    expect(html).toContain("Khách quầy bar")
    expect(html).toContain("Bar1")
    expect(html).toContain("Nam")
    expect(html).toContain("21:00")
  })

  it("renders in HTML mode as standalone container without foreignObject", () => {
    const rows = [makeSampleRow()]
    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))

    expect(html).not.toContain("<foreignObject")
    expect(html).toContain('data-testid="bar-guest-list"')
    expect(html).toContain("width:112px")
    expect(html).toContain("height:284px")
  })

  it("applies counter-scaling transform when mapScale is provided", () => {
    const rows = [makeSampleRow()]
    const html = renderToString(
      createElement("svg", null, createElement(BarGuestList, { rows, as: "svg", mapScale: 0.62 })),
    )

    // innerPixelWidth = Math.round(112 * 0.62) = 69px
    // innerPixelHeight = Math.round(284 * 0.62) = 176px
    // transform = scale(1 / 0.62) = scale(1.6129...)
    expect(html).toContain("width:69px")
    expect(html).toContain("height:176px")
    expect(html).toContain("transform:scale(")
    expect(html).toContain("transform-origin:top left")
  })

  it("renders consecutive ranges and non-adjacent seat labels", () => {
    const rows = [
      makeSampleRow({ bookingKey: "res:1", seatNumbers: [7, 8], seatsLabel: "Bar7-8", guestName: "Hưng" }),
      makeSampleRow({ bookingKey: "res:2", seatNumbers: [5, 17], seatsLabel: "Bar5, 17", guestName: "Đức" }),
    ]

    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))
    expect(html).toContain("Bar7-8")
    expect(html).toContain("Bar5, 17")
  })

  it("handles long Vietnamese names with ellipsis and full title tooltip", () => {
    const longName = "Nguyễn Thị Hoàng Oanh"
    const rows = [makeSampleRow({ guestName: longName })]

    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))
    expect(html).toContain(`title="${longName}"`)
    expect(html).toContain(longName)
    expect(html).toContain("truncate")
  })

  it("renders walk-in without a name and contains no phone number", () => {
    const rows = [makeSampleRow({ guestName: "Khách Walk-in" })]

    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))
    expect(html).toContain("Khách Walk-in")
    expect(html).not.toMatch(/090\d+/)
  })

  it("renders metadata icons when present", () => {
    const rows = [
      makeSampleRow({
        icons: { cake: true, vip: true, returning: true, pin: true },
      }),
    ]

    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))
    expect(html).toContain('aria-label="Sinh nhật"')
    expect(html).toContain("🎂")
    expect(html).toContain('aria-label="VIP"')
    expect(html).toContain("⭐")
    expect(html).toContain('aria-label="Khách quen"')
    expect(html).toContain("🔥")
    expect(html).toContain('aria-label="Chỉ định"')
    expect(html).toContain("📌")
  })

  it("supports empty state 'title-only' and 'hidden'", () => {
    // title-only renders frame with title and empty message
    const htmlTitleOnly = renderToString(createElement(BarGuestList, { rows: [], as: "html", emptyState: "title-only" }))
    expect(htmlTitleOnly).toContain("Khách quầy bar")
    expect(htmlTitleOnly).toContain("Chưa có khách")

    // hidden returns empty string
    const htmlHidden = renderToString(createElement(BarGuestList, { rows: [], as: "html", emptyState: "hidden" }))
    expect(htmlHidden).toBe("")
  })

  it("provides accessible list semantics and full details in aria-label", () => {
    const rows = [
      makeSampleRow({
        seatsLabel: "Bar1",
        time: "21:00",
        partySize: 2,
        guestName: "Nam",
        state: "seated",
      }),
    ]

    const html = renderToString(createElement(BarGuestList, { rows, as: "html" }))
    expect(html).toContain('role="list"')
    expect(html).toContain('aria-label="Danh sách khách quầy bar"')
    expect(html).toContain('role="listitem"')
    expect(html).toContain('aria-label="Bar1, lúc 21:00, 2 khách, Nam, Trạng thái: Đã tới"')
    expect(html).toContain("sr-only")
    expect(html).toContain("(Đã tới)")
  })

  it("automatically derives rows from tables and states when rows prop is not passed", () => {
    const table: TableView = {
      id: 1,
      version: 1,
      code: "BAR01",
      displayName: "Ghế 1",
      zoneId: 2,
      zoneCode: "BAR",
      kind: "BAR_SEAT",
      capacity: 1,
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      x: 350,
      y: 400,
      w: 24,
      h: 24,
      seating: "bar",
    }

    const state: FloorTableState = {
      tableId: 1,
      state: "seated",
      staleFromPreviousDay: false,
      claim: {
        kind: "visit",
        visitId: 55,
        reservationId: null,
        waitlistEntryId: null,
        holdId: null,
        displayName: "Lan",
        phoneLast3: "111",
        partySize: 1,
        startsAt: new Date("2026-11-09T14:00:00.000Z"),
        deadlineAt: null,
        paid: false,
        origin: null,
        tableIds: [1],
        groupId: null,
        warning: null,
        minutesLate: 0,
        sourceCode: null,
        note: null,
        version: 1,
        reservedExpectedAt: null,
        flags: [],
        iconKeys: [],
      },
    }

    const html = renderToString(
      createElement(BarGuestList, {
        tables: [table],
        states: new Map([[1, state]]),
        as: "html",
      }),
    )

    expect(html).toContain("Bar1")
    expect(html).toContain("Lan")
  })

  it("handles BR-05 case: Bar2-4, 12 guests, 4 icons with at most 2 visible icons, +2 marker, and full accessible label", () => {
    const row = makeSampleRow({
      bookingKey: "res:234",
      seatNumbers: [2, 3, 4],
      seatsLabel: "Bar2-4",
      time: "22:00",
      partySize: 12,
      guestName: "Overflow guest",
      state: "reserved",
      icons: { cake: true, vip: true, returning: true, pin: true },
    })

    const html = renderToString(createElement(BarGuestList, { rows: [row], as: "html" }))

    // Seat label and status
    expect(html).toContain("Bar2-4")

    // Visible icons: at most 2 icons + (+2) marker
    expect(html).toContain("🎂")
    expect(html).toContain("⭐")
    expect(html).toContain("+2")

    // Full list in accessible label
    expect(html).toContain('aria-label="Bar2-4, lúc 22:00, 12 khách, Overflow guest, Sinh nhật, VIP, Khách quen, Chỉ định, Trạng thái: Đã đặt"')

    // Guest count 12 must be present and never clipped
    expect(html).toContain("22:00")
    expect(html).toContain("12")

    // Guest name
    expect(html).toContain("Overflow guest")

    // Accessible hidden icons for screen readers
    expect(html).toContain("sr-only")
    expect(html).toContain("Khách quen")
    expect(html).toContain("Chỉ định")
  })

  it.each([
    { viewport: 360, scale: 0.584, expectedWidth: 65 },
    { viewport: 390, scale: 0.635, expectedWidth: 71 },
    { viewport: 430, scale: 0.703, expectedWidth: 79 },
    { viewport: 768, scale: 1.28, expectedWidth: 143 },
    { viewport: 1366, scale: 1.5, expectedWidth: 168 },
  ])("renders Bar2-4 with 12 guests and 4 icons across viewport $viewport (scale $scale)", ({ scale, expectedWidth }) => {
    const row = makeSampleRow({
      bookingKey: "res:234",
      seatNumbers: [2, 3, 4],
      seatsLabel: "Bar2-4",
      time: "22:00",
      partySize: 12,
      guestName: "Overflow guest",
      state: "reserved",
      icons: { cake: true, vip: true, returning: true, pin: true },
    })

    const html = renderToString(
      createElement("svg", null, createElement(BarGuestList, { rows: [row], as: "svg", mapScale: scale })),
    )

    // Inner pixel width scales to real screen pixels
    expect(html).toContain(`width:${expectedWidth}px`)
    expect(html).toContain(`transform:scale(${1 / scale})`)

    // Bar2-4, 12 guests, 4 icons are properly rendered
    expect(html).toContain("Bar2-4")
    expect(html).toContain("22:00")
    expect(html).toContain("12")
    expect(html).toContain("🎂")
    expect(html).toContain("⭐")
    expect(html).toContain("+2")
  })
})
