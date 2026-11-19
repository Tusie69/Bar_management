import type {
  ClaimView,
  FloorGroup,
  FloorTableState,
  ReceptionGuestCount,
  TableLiveState,
  TableView,
  WaitlistEntryView,
} from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import type { Alert } from "@/features/floor/alerts"
import { extractBarSeatNumber, isBarSeat } from "@/features/floor/bar-guest-rows"
import { isWaitingForTable } from "@/features/floor/reception-rules"
import {
  type BusinessDate,
  type BusinessShift,
  businessDateOf,
  FALLBACK_BUSINESS_SHIFT,
  fmtTime,
  MS,
  shiftHour,
} from "@/lib/time"

export type OverviewFloorStatus = "booked" | "soon" | "late" | "inuse" | "empty"

export interface FloorLegendItem {
  status: OverviewFloorStatus
  label: string
  colorToken: string
}

export const FLOOR_LEGEND_ITEMS: readonly FloorLegendItem[] = [
  { status: "booked", label: "Đã đặt", colorToken: "var(--so-chip-booked, #1d6fc2)" },
  { status: "soon", label: "Sắp tới", colorToken: "var(--so-chip-soon, #a16700)" },
  { status: "late", label: "Quá giờ", colorToken: "var(--so-chip-late, #d13b3b)" },
  { status: "inuse", label: "Đang sử dụng", colorToken: "var(--so-chip-inuse, #268549)" },
  { status: "empty", label: "Trống", colorToken: "var(--so-chip-empty, #77736c)" },
]

export const OVERVIEW_ZONE_ORDER: readonly ZoneCode[] = ["A", "B", "C", "BAR"]

export const FLOOR_ZONE_HEADINGS: Record<ZoneCode, string> = {
  A: "KHU A",
  B: "KHU B",
  C: "KHU C",
  BAR: "QUẦY BAR",
}

export const OCCUPANCY_ZONE_NAMES: Record<ZoneCode, string> = {
  A: "Khu A",
  B: "Khu B",
  C: "Khu C",
  BAR: "Quầy Bar",
}

export const MANUAL_UNENTERED_LABEL = "Chưa nhập"
export const NEW_GUEST_MISMATCH_TOOLTIP = "Số Lễ tân nhập chưa khớp"
export const NO_BAR_SEATS_NOTE = "Không tính ghế quầy Bar"

export interface OverviewKpiCard {
  id: string
  title: string
  caption: string
  subcaption?: string
  displayValue: string
  numericValue: number | null
  sourceKind: "manual" | "system"
  sourceNote: string
  tone: "default" | "inuse" | "soon" | "danger"
  isUnentered: boolean
  warningTooltip?: string
  infoTooltip?: string
  description?: string
}

export interface FloorChipItem {
  id: string
  code: string
  status: OverviewFloorStatus
  statusLabel: string
  tooltipText: string
  ariaLabel: string
  isGrouped: boolean
}

export interface FloorZoneRow {
  zone: ZoneCode
  heading: string
  chips: FloorChipItem[]
}

export interface ZoneOccupancyItem {
  zone: ZoneCode
  name: string
  inUse: number
  available: number
  percent: number
  unitLabel: "bàn" | "ghế"
}

export interface FloorMetricsSummary {
  seatedNow: number
  freeTables: number
  zones: FloorZoneRow[]
  occupancyByZone: ZoneOccupancyItem[]
}

export interface OperationalAlertItem {
  key: string
  severity: number
  severityType: "critical" | "warning"
  severityLabel: string
  title: string
  detail: string
}

/**
 * Timestamps before the shift's cutoff (e.g. 00:30) map to the previous business date.
 *
 * TU-38: the cutoff is the venue's `business_day_cutoff_local`, which a caller inside React
 * gets from `useBusinessShift()`. The default only covers callers with no venue in hand.
 */
export function shiftBusinessDateOf(at: Date, shift: BusinessShift = FALLBACK_BUSINESS_SHIFT): BusinessDate {
  return businessDateOf(at, shiftHour(shift.cutoffLocal))
}

/** Resolves effective live state for a physical table/seat from floor state + table fallback. */
export function resolveTableLiveState(table: TableView, fs?: FloorTableState): TableLiveState {
  return fs?.state ?? (table.isSpare ? "spare" : "free")
}

/** Maps a floor TableLiveState to one of the 5 read-only legend buckets, or spare/oos when inactive. */
export function mapLiveStateToOverviewStatus(state: TableLiveState): OverviewFloorStatus | "spare" | "oos" {
  switch (state) {
    case "reserved":
    case "hold":
      return "booked"
    case "upcoming":
      return "soon"
    case "late":
    case "late_confirmed":
    case "noshow":
    case "hold_overdue":
      return "late"
    case "seated":
      return "inuse"
    case "free":
      return "empty"
    case "spare":
      return "spare"
    case "oos":
      return "oos"
  }
}

function statusLabelOf(status: OverviewFloorStatus): string {
  switch (status) {
    case "booked":
      return "Đã đặt"
    case "soon":
      return "Sắp tới"
    case "late":
      return "Quá giờ"
    case "inuse":
      return "Đang sử dụng"
    case "empty":
      return "Trống"
  }
}

function buildGroupLookup(groups: FloorGroup[] | undefined): Map<number, FloorGroup> {
  const byTable = new Map<number, FloorGroup>()
  if (!groups) return byTable
  for (const g of groups) {
    for (const tid of g.tableIds) {
      byTable.set(tid, g)
    }
  }
  return byTable
}

function barClaimGroupKey(claim: ClaimView | null | undefined): string | null {
  if (!claim) return null
  if (claim.reservationId != null) return `bar-res:${claim.reservationId}`
  if (claim.visitId != null) return `bar-visit:${claim.visitId}`
  if (claim.holdId != null) return `bar-hold:${claim.holdId}`
  if (claim.waitlistEntryId != null) return `bar-wait:${claim.waitlistEntryId}`
  if (claim.groupId != null) return `bar-grp:${claim.groupId}`
  if (claim.tableIds && claim.tableIds.length > 1) {
    return `bar-tables:${[...claim.tableIds].sort((a, b) => a - b).join(",")}`
  }
  return null
}

function resolveLogicalUnitKey(
  table: TableView,
  fs: FloorTableState | undefined,
  floorGroupByTable: Map<number, FloorGroup>,
): string {
  const fg = floorGroupByTable.get(table.id)
  if (fg) return `fg:${fg.id}`
  const claim = fs?.claim
  if (claim?.groupId != null) return `cg:${claim.groupId}`
  if (claim?.groupDisplayCode) return `cgd:${claim.groupDisplayCode}`
  if (claim?.symbolNo) return `sym:${claim.symbolNo}`
  if (isBarSeat(table)) {
    const barKey = barClaimGroupKey(claim)
    if (barKey) return barKey
  }
  return `tbl:${table.id}`
}

/** Formats grouped bar seat numbers cleanly without the "Bar" prefix (e.g., [1, 2] -> "1-2", [5] -> "5"). */
export function formatBarChipNumbers(seatNumbers: number[]): string {
  if (!seatNumbers.length) return ""
  const sorted = Array.from(new Set(seatNumbers)).sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = cur
      prev = cur
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
  return ranges.join(", ")
}

function isExcludedAsSpareOrOos(table: TableView, rawState: TableLiveState): boolean {
  return Boolean(table.isSpare) || table.status === "OUT_OF_SERVICE" || rawState === "spare" || rawState === "oos"
}

/** Picks the higher-priority visual status when grouped bar seats have slightly mixed states. */
const STATUS_PRIORITY: Record<OverviewFloorStatus, number> = {
  late: 5,
  inuse: 4,
  soon: 3,
  booked: 2,
  empty: 1,
}

/**
 * Derives all floor-backed metrics for the admin shift overview:
 * - Đang ngồi (seated TABLE units only, LAYOUT/claim groups counted once; Bar seats excluded)
 * - Bàn trống (free non-spare/non-OOS TABLE units only, groups counted once; Bar seats excluded)
 * - Read-only zone table chips (with Bar seats grouped identically to the floor model)
 * - Zone occupancy percentages:
 *   - Khu A/B/C: in-use / available tables (spare & OOS excluded, groups counted once)
 *   - Quầy Bar: in-use / total Bar seats (x/21 seats, never mixed into table KPIs)
 */
export function selectFloorMetrics(
  tables: TableView[],
  states: Map<number, FloorTableState>,
  groups: FloorGroup[] = [],
): FloorMetricsSummary {
  const floorGroupByTable = buildGroupLookup(groups)
  const seatedUnits = new Set<string>()
  const freeUnits = new Set<string>()

  const zoneTables = new Map<ZoneCode, TableView[]>()
  for (const z of OVERVIEW_ZONE_ORDER) zoneTables.set(z, [])

  for (const t of tables) {
    if (zoneTables.has(t.zoneCode)) {
      zoneTables.get(t.zoneCode)!.push(t)
    }

    if (t.kind !== "TABLE") continue

    const fs = states.get(t.id)
    const rawState = resolveTableLiveState(t, fs)
    const unitKey = resolveLogicalUnitKey(t, fs, floorGroupByTable)
    const spareOrOos = isExcludedAsSpareOrOos(t, rawState)

    if (rawState === "seated" && t.status !== "OUT_OF_SERVICE") {
      seatedUnits.add(unitKey)
    }
    if (rawState === "free" && !spareOrOos) {
      freeUnits.add(unitKey)
    }
  }

  const occupancyByZone: ZoneOccupancyItem[] = []
  const zones: FloorZoneRow[] = []

  for (const zone of OVERVIEW_ZONE_ORDER) {
    const rawList = zoneTables.get(zone) ?? []

    if (zone === "BAR") {
      // Bar occupancy reports individual seats (x/21) rather than collapsed table groups.
      let barInUse = 0
      let barAvailable = 0
      for (const t of rawList) {
        if (t.isSpare) continue
        barAvailable += 1
        const fs = states.get(t.id)
        const rawState = resolveTableLiveState(t, fs)
        if (rawState === "seated" && t.status !== "OUT_OF_SERVICE") {
          barInUse += 1
        }
      }
      const percent = barAvailable > 0 ? Math.min(100, Math.round((barInUse / barAvailable) * 100)) : 0

      occupancyByZone.push({
        zone,
        name: OCCUPANCY_ZONE_NAMES[zone],
        inUse: barInUse,
        available: barAvailable,
        percent,
        unitLabel: "ghế",
      })

      const chips = buildBarFloorChips(rawList, states, floorGroupByTable)
      zones.push({ zone, heading: FLOOR_ZONE_HEADINGS[zone], chips })
    } else {
      const availableUnitIds = new Set<string>()
      const inUseUnitIds = new Set<string>()

      for (const t of rawList) {
        const fs = states.get(t.id)
        const rawState = resolveTableLiveState(t, fs)
        if (isExcludedAsSpareOrOos(t, rawState)) continue

        const unitKey = resolveLogicalUnitKey(t, fs, floorGroupByTable)
        availableUnitIds.add(unitKey)
        if (rawState === "seated") {
          inUseUnitIds.add(unitKey)
        }
      }

      const available = availableUnitIds.size
      const inUse = inUseUnitIds.size
      const percent = available > 0 ? Math.min(100, Math.round((inUse / available) * 100)) : 0

      occupancyByZone.push({
        zone,
        name: OCCUPANCY_ZONE_NAMES[zone],
        inUse,
        available,
        percent,
        unitLabel: "bàn",
      })

      const chips = buildRegularFloorChips(rawList, states, floorGroupByTable)
      zones.push({ zone, heading: FLOOR_ZONE_HEADINGS[zone], chips })
    }
  }

  return {
    seatedNow: seatedUnits.size,
    freeTables: freeUnits.size,
    zones,
    occupancyByZone,
  }
}

function buildRegularFloorChips(
  tables: TableView[],
  states: Map<number, FloorTableState>,
  floorGroupByTable: Map<number, FloorGroup>,
): FloorChipItem[] {
  const sorted = [...tables].sort((a, b) => (a.seqNo ?? 0) - (b.seqNo ?? 0) || a.code.localeCompare(b.code))
  const chips: FloorChipItem[] = []

  for (const t of sorted) {
    const fs = states.get(t.id)
    const rawState = resolveTableLiveState(t, fs)
    const mapped = mapLiveStateToOverviewStatus(rawState)

    // Hide inactive spare and out-of-service tables from the regular shift chips,
    // while keeping a spare table visible if reception actively seated/booked it.
    if (mapped === "oos" || t.status === "OUT_OF_SERVICE") continue
    if (mapped === "spare" || (t.isSpare && mapped === "empty")) continue

    const label = statusLabelOf(mapped)
    const fg = floorGroupByTable.get(t.id)
    const groupLabel = fg?.displayCode ?? fg?.name ?? (fg ? `G${String(fg.symbolNo).padStart(2, "0")}` : null)
    const groupSuffix = groupLabel ? ` · Ghép ${groupLabel}` : ""
    const tooltipText = `Bàn ${t.code} · ${label}${groupSuffix}`

    chips.push({
      id: `table-${t.id}`,
      code: t.code,
      status: mapped,
      statusLabel: label,
      tooltipText,
      ariaLabel: tooltipText,
      isGrouped: Boolean(fg),
    })
  }

  return chips
}

function buildBarFloorChips(
  tables: TableView[],
  states: Map<number, FloorTableState>,
  floorGroupByTable: Map<number, FloorGroup>,
): FloorChipItem[] {
  const sorted = [...tables].sort((a, b) => {
    const na = extractBarSeatNumber(a) ?? a.seqNo ?? 0
    const nb = extractBarSeatNumber(b) ?? b.seqNo ?? 0
    return na - nb
  })

  interface BarAccumulator {
    key: string
    seatNumbers: number[]
    fallbackCodes: string[]
    status: OverviewFloorStatus
    isGrouped: boolean
  }

  const orderedGroups: BarAccumulator[] = []
  const groupByKey = new Map<string, BarAccumulator>()

  for (const t of sorted) {
    const fs = states.get(t.id)
    const rawState = resolveTableLiveState(t, fs)
    const mapped = mapLiveStateToOverviewStatus(rawState)

    if (mapped === "oos" || t.status === "OUT_OF_SERVICE") continue
    if (mapped === "spare" || (t.isSpare && mapped === "empty")) continue

    const unitKey = resolveLogicalUnitKey(t, fs, floorGroupByTable)
    const seatNo = extractBarSeatNumber(t)
    const existing = groupByKey.get(unitKey)

    if (!existing) {
      const acc: BarAccumulator = {
        key: unitKey,
        seatNumbers: seatNo != null ? [seatNo] : [],
        fallbackCodes: [t.code],
        status: mapped,
        isGrouped: !unitKey.startsWith("tbl:"),
      }
      groupByKey.set(unitKey, acc)
      orderedGroups.push(acc)
    } else {
      if (seatNo != null && !existing.seatNumbers.includes(seatNo)) {
        existing.seatNumbers.push(seatNo)
      }
      existing.fallbackCodes.push(t.code)
      existing.isGrouped = true
      if (STATUS_PRIORITY[mapped] > STATUS_PRIORITY[existing.status]) {
        existing.status = mapped
      }
    }
  }

  return orderedGroups.map((item) => {
    const code = item.seatNumbers.length > 0 ? formatBarChipNumbers(item.seatNumbers) : item.fallbackCodes.join(", ")
    const label = statusLabelOf(item.status)
    const seatCountNote = item.seatNumbers.length > 1 ? ` (${item.seatNumbers.length} ghế)` : ""
    const tooltipText = `Ghế Bar ${code} · ${label}${seatCountNote}`

    return {
      id: `bar-${item.key}`,
      code,
      status: item.status,
      statusLabel: label,
      tooltipText,
      ariaLabel: tooltipText,
      isGrouped: item.isGrouped && item.seatNumbers.length > 1,
    }
  })
}

export function selectActiveWaitlistCount(waitlist: WaitlistEntryView[]): number {
  let count = 0
  for (const entry of waitlist) {
    if (isWaitingForTable(entry)) count += 1
  }
  return count
}

export interface KpiRowsModel {
  row1: OverviewKpiCard[]
  row2: OverviewKpiCard[]
}

/**
 * Builds the 6 primary KPI cards (Row 1) and 4 classification cards (Row 2)
 * strictly obeying the PO + BA Hung data definitions and manual-vs-system rules.
 */
export function selectKpiRows(
  guestCount: ReceptionGuestCount | undefined,
  floorMetrics: Pick<FloorMetricsSummary, "seatedNow" | "freeTables">,
  waitlistCount: number,
): KpiRowsModel {
  const hasEntered = Boolean(guestCount && guestCount.version > 0)
  const timeText = hasEntered && guestCount?.updatedAt ? fmtTime(guestCount.updatedAt) : null
  const manualNote = timeText ? `Lễ tân nhập · ${timeText}` : "Lễ tân nhập"

  const manualCard = (
    id: string,
    title: string,
    caption: string,
    raw: number | undefined,
    tone: OverviewKpiCard["tone"] = "default",
    extra?: Partial<OverviewKpiCard>,
  ): OverviewKpiCard => {
    const val = hasEntered && raw !== undefined ? raw : null
    return {
      id,
      title,
      caption,
      displayValue: val === null ? MANUAL_UNENTERED_LABEL : String(val),
      numericValue: val,
      sourceKind: "manual",
      sourceNote: manualNote,
      tone: val === null ? "default" : tone,
      isUnentered: val === null,
      ...extra,
    }
  }

  const newGuestsRaw = hasEntered && guestCount ? guestCount.arrivedTotal - guestCount.returningGuests : undefined
  const isNewGuestsNegative = newGuestsRaw !== undefined && newGuestsRaw < 0

  const row1: OverviewKpiCard[] = [
    manualCard("booked-tables", "Tổng bàn đặt", "luỹ kế trong ca", guestCount?.bookedTables),
    manualCard("booked-guests", "Tổng khách đặt", "luỹ kế trong ca", guestCount?.bookedGuests),
    manualCard("arrived-total", "Đã tới", "khách thực tế", guestCount?.arrivedTotal, "inuse"),
    {
      id: "seated-now",
      title: "Đang ngồi",
      caption: "bàn đang dùng",
      subcaption: NO_BAR_SEATS_NOTE,
      displayValue: String(floorMetrics.seatedNow),
      numericValue: floorMetrics.seatedNow,
      sourceKind: "system",
      sourceNote: "Tự động",
      tone: "inuse",
      isUnentered: false,
      infoTooltip: NO_BAR_SEATS_NOTE,
    },
    {
      id: "free-tables",
      title: "Bàn trống",
      caption: "sẵn sàng nhận",
      subcaption: NO_BAR_SEATS_NOTE,
      displayValue: String(floorMetrics.freeTables),
      numericValue: floorMetrics.freeTables,
      sourceKind: "system",
      sourceNote: "Tự động",
      tone: "default",
      isUnentered: false,
      infoTooltip: NO_BAR_SEATS_NOTE,
    },
    {
      id: "waitlist-count",
      title: "Bàn chờ",
      caption: "chưa có bàn",
      displayValue: String(waitlistCount),
      numericValue: waitlistCount,
      sourceKind: "system",
      sourceNote: "Tự động",
      tone: "soon",
      isUnentered: false,
    },
  ]

  const row2: OverviewKpiCard[] = [
    manualCard("arrived-before", "Khách trước 21:30", "vào sớm", guestCount?.arrivedBefore),
    manualCard("arrived-after", "Khách sau 21:30", "khung cao điểm", guestCount?.arrivedAfter),
    manualCard("returning-guests", "Khách quen (O)", "số thực", guestCount?.returningGuests, "default", {
      description: "Đã từng đặt bàn",
    }),
    manualCard(
      "new-guests",
      "Khách mới (N)",
      "số thực",
      newGuestsRaw,
      isNewGuestsNegative ? "danger" : "default",
      isNewGuestsNegative ? { warningTooltip: NEW_GUEST_MISMATCH_TOOLTIP } : undefined,
    ),
  ]

  return { row1, row2 }
}

/**
 * Merges floor operational alerts (late bookings, overdue holds, stale tables)
 * with active waitlist backlog so management sees every actionable bottleneck.
 */
export function buildOperationalAlerts(
  shiftAlerts: Alert[],
  waitlist: WaitlistEntryView[],
  now: Date,
): OperationalAlertItem[] {
  const items: OperationalAlertItem[] = shiftAlerts.map((a) => {
    const isCritical = a.tone === "noshow" || a.tone === "late"
    return {
      key: a.key,
      severity: a.severity,
      severityType: isCritical ? "critical" : "warning",
      severityLabel: isCritical ? "Khẩn" : "Chú ý",
      title: a.title,
      detail: a.detail,
    }
  })

  const waiting = waitlist.filter(isWaitingForTable)
  if (waiting.length > 0) {
    const oldestMs = Math.min(...waiting.map((e) => e.queuedAt.getTime()))
    const oldestMinutes = Math.max(0, Math.floor((now.getTime() - oldestMs) / MS.MIN))
    items.push({
      key: "waitlist-backlog",
      severity: oldestMinutes >= 30 ? 2 : 1,
      severityType: "warning",
      severityLabel: "Chú ý",
      title: `${waiting.length} đơn Bàn chờ tồn đọng`,
      detail: `cũ nhất ${oldestMinutes} phút, chưa gán bàn`,
    })
  }

  return items.sort((a, b) => b.severity - a.severity)
}
