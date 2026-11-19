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
import { isBarSeat } from "@/features/floor/bar-guest-rows"
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

export const OVERVIEW_ZONE_ORDER: readonly ZoneCode[] = ["A", "B", "C", "BAR"]

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

function isExcludedAsSpareOrOos(table: TableView, rawState: TableLiveState): boolean {
  return Boolean(table.isSpare) || table.status === "OUT_OF_SERVICE" || rawState === "spare" || rawState === "oos"
}

/**
 * Derives all floor-backed metrics for the admin shift overview:
 * - Đang ngồi (seated TABLE units only, LAYOUT/claim groups counted once; Bar seats excluded)
 * - Bàn trống (free non-spare/non-OOS TABLE units only, groups counted once; Bar seats excluded)
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
    }
  }

  return {
    seatedNow: seatedUnits.size,
    freeTables: freeUnits.size,
    occupancyByZone,
  }
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
