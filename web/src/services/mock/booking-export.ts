// Development mock uses the backend US-07 formatter; HTTP exports are always server-produced.
import type { ReservationStatus as BookingStatus } from "@/domain/enums"

export interface BookingExportMetadata {
  bossTable: boolean
  returningCustomer: boolean | null
  designated: boolean
  birthday: boolean
  round: 1 | 2 | null
}

export interface DailyBookingTextItem {
  id: number
  guestName: string
  partySize: number
  expectedAt: Date
  checkedInAt: Date | null
  status: BookingStatus
  tables: Array<{ code: string; zoneCode: string; zoneName: string }>
  metadata: BookingExportMetadata
}

export interface DailyBookingTextInput {
  businessDate: string
  bookings: DailyBookingTextItem[]
  waitlistCount: number
  outTables: Array<{ code: string; zoneCode: string; zoneName: string }>
  arrivalCutoff: {
    hour: 21
    minute: 30
    basis: "EXPECTED_AT"
    atCutoff: "AFTER"
  }
}

const ZONE_ORDER = ["A", "B", "C", "BAR"] as const
const FIXED_TABLE_ORDER: Record<(typeof ZONE_ORDER)[number], string[]> = {
  A: ["A1", "A2", "A3", "A4", "A5", "A6", "A0", "A10"],
  B: ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"],
  C: ["C1", "C2", "C4", "C5"],
  BAR: ["1+2", "3+4", "5+6", "7+8", "9+10", "11+12", "13+14", "15+16", "17+18", "19", "20+21"],
}
const ZONE_LABEL: Record<(typeof ZONE_ORDER)[number], string> = {
  A: "KHU A",
  B: "KHU B",
  C: "KHU C",
  BAR: "QUẦY BAR",
}
const PHONE_LIKE = /(?:\+?84|0)(?:[\s().-]*\d){8,10}/g

function safeText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(PHONE_LIKE, "[đã ẩn SĐT]")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function dateTitle(businessDate: string): string {
  const parts = businessDate.split("-")
  const year = Number(parts[0] ?? Number.NaN)
  const month = Number(parts[1] ?? Number.NaN)
  const day = Number(parts[2] ?? Number.NaN)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Invalid business date")
  }
  const weekday = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"][
    new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
  ]
  return `Danh sách bàn đặt 21Gam ${weekday}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
}

function venueTime(value: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value)
}

function barSeatNumber(code: string): number | null {
  const match = /^BAR0?([1-9]|1\d|2[01])$/.exec(code.toUpperCase())
  return match ? Number(match[1]) : null
}

function barLabel(codes: string[]): string {
  const seats = codes
    .map(barSeatNumber)
    .filter((seat): seat is number => seat !== null)
    .sort((a, b) => a - b)
  if (seats.length === codes.length && seats.length > 0) return seats.join("+")
  return codes.join("+")
}

function tableLabel(item: DailyBookingTextItem): string {
  const codes = item.tables.map((table) => table.code.toUpperCase())
  const set = new Set(codes)
  if (set.size === 2 && set.has("B11") && set.has("B12")) return "B1"
  if (set.size === 2 && set.has("B21") && set.has("B22")) return "B2"
  if (item.tables.length && item.tables.every((table) => table.zoneCode === "BAR")) return barLabel(codes)
  return codes.join("+") || "Chưa gán"
}

function zoneKey(item: DailyBookingTextItem): string {
  const zones = [...new Set(item.tables.map((table) => table.zoneCode.toUpperCase()))]
  if (!zones.length) return "UNASSIGNED"
  return zones.length === 1 ? zones[0]! : "MULTI_ZONE"
}

function tableRank(zone: string, label: string): number {
  if (!ZONE_ORDER.includes(zone as (typeof ZONE_ORDER)[number])) return Number.MAX_SAFE_INTEGER
  const order = FIXED_TABLE_ORDER[zone as (typeof ZONE_ORDER)[number]]
  const exact = order.indexOf(label)
  if (exact >= 0) return exact
  if (zone === "BAR") {
    const firstSeat = Number(label.split("+")[0])
    const containing = order.findIndex((slot) => slot.split("+").map(Number).includes(firstSeat))
    if (containing >= 0) return containing
  }
  const firstCode = label.split("+")[0] ?? label
  const prefix = order.findIndex((slot) => firstCode.startsWith(slot))
  return prefix >= 0 ? prefix : order.length
}

function icons(item: DailyBookingTextItem): string {
  const values = [
    item.metadata.bossTable ? "⭐️" : "",
    item.metadata.returningCustomer === true ? "🔥" : "",
    item.metadata.designated ? "📌" : "",
    item.metadata.birthday ? "🎂" : "",
    item.status === "CHECKED_IN" ? "✅" : "",
    item.metadata.round === 1 ? "1️⃣" : "",
    item.metadata.round === 2 ? "2️⃣" : "",
  ].filter(Boolean)
  return values.length ? ` ${values.join(" ")}` : ""
}

function bookingLine(item: DailyBookingTextItem): string {
  return `${tableLabel(item)}: ${venueTime(item.expectedAt)} · ${safeText(item.guestName)} · ${item.partySize} khách${icons(item)}`
}

function ordered(items: DailyBookingTextItem[], zone: string): DailyBookingTextItem[] {
  return [...items].sort((left, right) => {
    const leftLabel = tableLabel(left)
    const rightLabel = tableLabel(right)
    const leftZone = zone || zoneKey(left)
    const rightZone = zone || zoneKey(right)
    const leftZoneRank = ZONE_ORDER.indexOf(leftZone as (typeof ZONE_ORDER)[number])
    const rightZoneRank = ZONE_ORDER.indexOf(rightZone as (typeof ZONE_ORDER)[number])
    return (
      (leftZoneRank < 0 ? ZONE_ORDER.length : leftZoneRank) - (rightZoneRank < 0 ? ZONE_ORDER.length : rightZoneRank) ||
      tableRank(leftZone, leftLabel) - tableRank(rightZone, rightLabel) ||
      leftLabel.localeCompare(rightLabel, "vi", { numeric: true }) ||
      left.expectedAt.getTime() - right.expectedAt.getTime() ||
      left.id - right.id
    )
  })
}

function arrivalCounts(
  input: DailyBookingTextInput,
  active: DailyBookingTextItem[],
): { before: string; after: string } {
  const hour = String(input.arrivalCutoff.hour).padStart(2, "0")
  const minute = String(input.arrivalCutoff.minute).padStart(2, "0")
  const cutoff = new Date(`${input.businessDate}T${hour}:${minute}:00+07:00`).getTime()
  let before = 0
  let after = 0
  for (const item of active) {
    if (item.expectedAt.getTime() < cutoff) before += item.partySize
    else after += item.partySize
  }
  return { before: String(before), after: String(after) }
}

/** Pure, deterministic and privacy-allowlisted formatter for US-07. */
export function formatDailyBookingText(input: DailyBookingTextInput): string {
  const active = input.bookings.filter((item) => item.status === "BOOKED" || item.status === "CHECKED_IN")
  const cancelled = input.bookings.filter((item) => item.status === "CANCELLED")
  const noShows = input.bookings.filter((item) => item.status === "NO_SHOW")
  const lines = [dateTitle(input.businessDate), ""]

  for (const zone of ZONE_ORDER) {
    lines.push(ZONE_LABEL[zone])
    if (zone === "A") lines.push(`BC (Bàn Chờ +${input.waitlistCount})`)
    const zoneItems = active.filter((item) => zoneKey(item) === zone)
    lines.push(...ordered(zoneItems, zone).map(bookingLine), "")
  }

  const additionalZones = [...new Set(active.map(zoneKey))]
    .filter(
      (zone) =>
        !ZONE_ORDER.includes(zone as (typeof ZONE_ORDER)[number]) && zone !== "UNASSIGNED" && zone !== "MULTI_ZONE",
    )
    .sort((left, right) => left.localeCompare(right, "vi", { numeric: true }))
  for (const zone of additionalZones) {
    const zoneName = active.flatMap((item) => item.tables).find((table) => table.zoneCode === zone)?.zoneName
    lines.push(
      `KHU ${safeText(zoneName ?? zone)}`,
      ...ordered(
        active.filter((item) => zoneKey(item) === zone),
        zone,
      ).map(bookingLine),
      "",
    )
  }

  const unassigned = active.filter((item) => zoneKey(item) === "UNASSIGNED")
  const multiZone = active.filter((item) => zoneKey(item) === "MULTI_ZONE")
  if (unassigned.length) lines.push("CHƯA GÁN BÀN", ...ordered(unassigned, "UNASSIGNED").map(bookingLine), "")
  if (multiZone.length) lines.push("LIÊN KHU", ...ordered(multiZone, "MULTI_ZONE").map(bookingLine), "")

  lines.push("BÀN OUT")
  if (input.outTables.length) {
    const out = [...input.outTables].sort((left, right) => {
      const leftZone = ZONE_ORDER.indexOf(left.zoneCode as (typeof ZONE_ORDER)[number])
      const rightZone = ZONE_ORDER.indexOf(right.zoneCode as (typeof ZONE_ORDER)[number])
      return (
        (leftZone < 0 ? ZONE_ORDER.length : leftZone) - (rightZone < 0 ? ZONE_ORDER.length : rightZone) ||
        tableRank(left.zoneCode, left.code) - tableRank(right.zoneCode, right.code) ||
        left.code.localeCompare(right.code, "vi", { numeric: true })
      )
    })
    lines.push(...out.map((table) => table.code))
  } else lines.push("Không có")
  lines.push("", "BÀN HUỶ")
  lines.push(...(cancelled.length ? ordered(cancelled, "").map(bookingLine) : ["Không có"]))
  if (noShows.length) lines.push("", "KHÔNG ĐẾN", ...ordered(noShows, "").map(bookingLine))

  const arrivals = arrivalCounts(input, active)
  const returning = active.filter((item) => item.metadata.returningCustomer === true).length
  const newCustomers = active.filter((item) => item.metadata.returningCustomer === false).length
  const unclassified = active.filter((item) => item.metadata.returningCustomer === null).length
  lines.push(
    "",
    "THỐNG KÊ",
    `Khách vào trước 21:30: ${arrivals.before}`,
    `Khách vào sau 21:30: ${arrivals.after}`,
    `Tổng bàn đặt: ${active.length}`,
    `Tổng khách đặt: ${active.reduce((total, item) => total + item.partySize, 0)}`,
    `Bàn khách quen O: ${returning}`,
    `Bàn khách mới N: ${newCustomers}`,
    `Bàn chưa phân loại: ${unclassified}`,
    `Tổng khách đã đến: ${active.filter((item) => item.status === "CHECKED_IN").reduce((total, item) => total + item.partySize, 0)}`,
  )
  return `${lines.join("\n").trimEnd()}\n`
}
