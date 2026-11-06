import type { FloorTableState, TableAvailability, TableView } from "@/domain/models"

const occupiedLiveReason: Partial<Record<FloorTableState["state"], string>> = {
  reserved: "đã được giữ",
  hold: "đang được giữ",
  hold_overdue: "đang được giữ",
  upcoming: "đang giữ cho khách sắp đến",
  late: "đang giữ cho khách không tới",
  late_confirmed: "đang giữ cho khách không tới (đã xác nhận)",
  noshow: "đang giữ cho khách không tới",
  seated: "đang có khách",
  oos: "ngưng phục vụ",
  spare: "là bàn sơ cua",
}

export function bookingTableBadge(
  table: TableView,
  liveState: FloorTableState | undefined,
  availTable: TableAvailability | undefined,
  isSameBusinessDate: boolean,
): string {
  if (table.isSpare) return "Bàn sơ cua"
  if (table.status !== "ACTIVE") return "Ngưng phục vụ"

  // Only use live floor state when booking is for the exact same business date
  if (isSameBusinessDate && liveState && liveState.state !== "free") {
    switch (liveState.state) {
      case "spare":
        return "Bàn sơ cua"
      case "oos":
        return "Ngưng phục vụ"
      case "reserved":
        return "Đã được giữ"
      case "hold":
      case "hold_overdue":
        return "Đang được giữ"
      case "upcoming":
        return "Sắp đến"
      case "late":
      case "late_confirmed":
      case "noshow":
        return "Không tới"
      case "seated":
        return "Đang có khách"
      default:
        break
    }
  }

  if (availTable) {
    switch (availTable.status) {
      case "spare":
        return "Bàn sơ cua"
      case "oos":
        return "Ngưng phục vụ"
      case "reserved":
        return "Đã được giữ"
      case "occupied_unknown_end":
        return "Đang có khách"
      case "too_small":
        return "Thiếu chỗ"
      case "not_bookable":
        return "Không nhận đặt"
      case "past":
        return "Đã qua giờ"
      default:
        break
    }
    if (availTable.bookingConflicts && availTable.bookingConflicts.length > 0) {
      return "Đã được giữ"
    }
  }

  return "Không khả dụng"
}

export function bookingTableBlockReason(
  table: TableView,
  liveState: FloorTableState | undefined,
  availTable: TableAvailability | undefined,
  bookableZoneIds: ReadonlySet<number>,
  isSameBusinessDate: boolean,
  guests?: number,
): string | null {
  const label = table.kind === "BAR_SEAT" ? `Ghế Bar ${table.seqNo}` : `Bàn ${table.code}`

  // 1. Static catalog checks (true across all dates)
  if (!bookableZoneIds.has(table.zoneId)) {
    return `${label} không thuộc khu vực nhận đặt bàn.`
  }
  if (table.status !== "ACTIVE") {
    return `${label} đang ngưng phục vụ.`
  }
  if (table.isSpare) {
    return `${label} là bàn sơ cua và không nhận đặt trước.`
  }

  // 2. Same-date live floor checks (ONLY when isSameBusinessDate is true)
  if (isSameBusinessDate && liveState) {
    if (liveState.state === "oos") {
      return `${label} đang ngưng phục vụ.`
    }
    if (liveState.state === "spare") {
      return `${label} là bàn sơ cua và không nhận đặt trước.`
    }
    if (liveState.staleFromPreviousDay) {
      return `${label} chưa nhả từ hôm trước.`
    }
    if (liveState.state !== "free") {
      const min = liveState.claim?.minutesLate
      const minSuffix = min && min > 0 ? ` · ${min} phút` : ""
      if (
        liveState.state === "late" ||
        liveState.state === "late_confirmed" ||
        liveState.state === "noshow"
      ) {
        const base = occupiedLiveReason[liveState.state]
        return `${label} ${base}${minSuffix}.`
      }
      const desc = occupiedLiveReason[liveState.state] ?? "không còn trống"
      return `${label} ${desc}.`
    }
  }

  // 3. Availability query checks (target date/time availability from API)
  if (availTable) {
    if (availTable.status === "oos") {
      return `${label} đang ngưng phục vụ.`
    }
    if (availTable.status === "spare") {
      return `${label} là bàn sơ cua và không nhận đặt trước.`
    }
    if (availTable.status === "not_bookable") {
      return `${label} không thuộc khu vực nhận đặt bàn.`
    }
    if (availTable.status === "past") {
      return `${label} đã qua thời điểm đặt bàn.`
    }
    if (availTable.status === "reserved") {
      return availTable.reason || `${label} đã được giữ.`
    }
    if (availTable.status === "occupied_unknown_end") {
      return availTable.reason || `${label} đang có khách.`
    }
    if (availTable.status === "too_small" && guests !== undefined) {
      return `${label} chỉ có ${table.capacity} chỗ, không đủ cho ${guests ?? "?"} khách.`
    }
    if (availTable.status !== "available" && availTable.status !== "too_small") {
      return availTable.reason || `${label} không còn khả dụng.`
    }
    if (availTable.bookingConflicts && availTable.bookingConflicts.length > 0) {
      return `${label} đã có lịch đặt trước tại thời điểm này.`
    }
  }

  if (!availTable) return `${label} chưa được xác minh khả dụng.`

  // 4. Capacity check
  if (guests !== undefined && table.capacity < guests) {
    return `${label} chỉ có ${table.capacity} chỗ, không đủ cho ${guests} khách.`
  }

  return null
}

export function isTableAvailableForBooking(
  table: TableView,
  liveState: FloorTableState | undefined,
  availTable: TableAvailability | undefined,
  bookableZoneIds: ReadonlySet<number>,
  isSameBusinessDate: boolean,
  guests?: number,
): boolean {
  return (
    bookingTableBlockReason(
      table,
      liveState,
      availTable,
      bookableZoneIds,
      isSameBusinessDate,
      guests,
    ) === null
  )
}

export function checkBookingCompatibility(
  tableIds: number[],
  byId: ReadonlyMap<number, TableView>,
): string | null {
  if (tableIds.length <= 1) return null
  const first = byId.get(tableIds[0])
  if (!first) return null
  for (let i = 1; i < tableIds.length; i++) {
    const t = byId.get(tableIds[i])
    if (!t) continue
    if (t.zoneId !== first.zoneId) {
      return "Chỉ có thể chọn các bàn trong cùng một khu vực."
    }
    if (t.kind !== first.kind) {
      return "Không thể ghép bàn thường với ghế Bar."
    }
  }
  return null
}

export function bookingSelectionIssues(
  selectedIds: number[],
  byId: ReadonlyMap<number, TableView>,
  states: ReadonlyMap<number, FloorTableState>,
  availMap: ReadonlyMap<number, TableAvailability>,
  bookableZoneIds: ReadonlySet<number>,
  isSameBusinessDate: boolean,
  guests?: number,
): string[] {
  if (!selectedIds.length) return []

  const compat = checkBookingCompatibility(selectedIds, byId)
  if (compat) return [compat]

  const totalCap = selectedIds.reduce((sum, id) => sum + (byId.get(id)?.capacity ?? 0), 0)
  if (guests !== undefined && totalCap < guests) {
    return [`Các bàn đã chọn chỉ có ${totalCap} chỗ cho ${guests} khách.`]
  }

  const issues: string[] = []
  for (const id of selectedIds) {
    const table = byId.get(id)
    if (!table) {
      issues.push(`Bàn #${id} không còn trong sơ đồ.`)
      continue
    }
    const reason = bookingTableBlockReason(
      table,
      states.get(id),
      availMap.get(id),
      bookableZoneIds,
      isSameBusinessDate,
      // For multi-table combos, individual table capacity check is handled by totalCap above
      selectedIds.length > 1 ? undefined : guests,
    )
    if (reason) {
      issues.push(reason)
    }
  }

  return issues
}


export function bookingTableCanSelect(table: TableView, availability?: TableAvailability, anchor?: TableView) {
  return table.status === "ACTIVE" && !table.isSpare
    && (availability?.status === "available" || availability?.status === "too_small")
    && (!anchor || (table.zoneId === anchor.zoneId && table.kind === anchor.kind))
}
