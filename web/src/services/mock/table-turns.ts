import type {
  TableTurnQuery,
  TableTurnSummary,
  TableTurnsParams,
  TableTurnsResult,
  TableTurnView,
} from "@/domain/models"
import { addDays, atBusinessTime, businessDateOf } from "@/lib/time"

export function seedTableTurns(now: Date): TableTurnView[] {
  const today = businessDateOf(now)
  const rows: TableTurnView[] = []
  for (let day = -13; day <= 0; day++) {
    const businessDate = addDays(today, day)
    for (let index = 0; index < 5; index++) {
      const group = index === 2
      const endReason = index === 3 ? "ENTRY_ERROR" : index === 4 ? "BUSINESS_DAY_END" : "GUEST_LEFT"
      const system = endReason === "BUSINESS_DAY_END"
      const staffId = (index % 2) + 1
      const tableCodes = group ? ["B3", "B4"] : [index === 1 ? "B2" : "B1"]
      const tableId = index === 1 ? 2 : 1
      const turnId = rows.length + 1
      rows.push({
        turnId,
        turnNo: index === 0 || index === 1 || group ? 1 : index - 1,
        businessDate,
        scope: group ? "GROUP" : "TABLE",
        groupCode: group ? "C1" : null,
        groupId: group ? 10 : null,
        tableId: group ? null : tableId,
        tableCodes,
        memberTableIds: group ? [3, 4] : [tableId],
        guestName: ["Anh Minh", "Chị Lan", "Nhóm bạn Hà", "Nhập nhầm bàn", "Khách cuối ca"][index]!,
        guestCount: group ? 8 : index + 2,
        sourceCode: "HOTLINE",
        origin: "RESERVATION",
        seatedAt: atBusinessTime(businessDate, `20:${String(index * 5).padStart(2, "0")}`).toISOString(),
        releasedAt: atBusinessTime(businessDate, `23:${String(index * 5).padStart(2, "0")}`).toISOString(),
        endReason,
        counted: endReason === "GUEST_LEFT",
        visitId: 1000 + turnId,
        reservationId: 2000 + turnId,
        closedByUserId: system ? null : staffId,
        closedByDisplayName: system ? null : `Lễ tân ${staffId}`,
      })
    }
  }
  return rows
}

function filteredTurns(rows: TableTurnView[], params: TableTurnQuery): TableTurnView[] {
  return rows
    .filter(
      (row) =>
        row.businessDate >= params.from &&
        row.businessDate <= params.to &&
        (params.includeUncounted || row.counted) &&
        (params.closedByUserId === undefined || row.closedByUserId === params.closedByUserId),
    )
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.turnId - a.turnId)
}
function totals(rows: TableTurnView[]) {
  const counted = rows.filter((row) => row.counted)
  return { completedTotal: counted.length, guestTotal: counted.reduce((sum, row) => sum + row.guestCount, 0) }
}
export function mockTableTurns(rows: TableTurnView[], params: TableTurnsParams): TableTurnsResult {
  const filtered = filteredTurns(rows, params)
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 50
  return {
    from: params.from,
    to: params.to,
    page,
    pageSize,
    total: filtered.length,
    ...totals(filtered),
    turns: filtered.slice((page - 1) * pageSize, page * pageSize),
  }
}
export function mockTableTurnSummary(rows: TableTurnView[], params: TableTurnQuery): TableTurnSummary {
  const filtered = filteredTurns(rows, params).sort((a, b) => b.turnId - a.turnId)
  const dates = new Map<string, TableTurnSummary["byBusinessDate"][number]>()
  const staff = new Map<number | null, TableTurnSummary["byStaff"][number]>()
  const scopes = new Map<string, TableTurnSummary["byScope"][number]>()
  for (const row of filtered) {
    const date = dates.get(row.businessDate) ?? { businessDate: row.businessDate, turns: 0, guests: 0 }
    const person = staff.get(row.closedByUserId) ?? {
      closedByUserId: row.closedByUserId,
      closedByDisplayName: row.closedByDisplayName,
      turns: 0,
      guests: 0,
    }
    const key = `${row.scope}:${row.groupId ?? row.tableId}`
    const scope = scopes.get(key) ?? {
      scope: row.scope,
      tableId: row.tableId,
      groupId: row.groupId,
      label: row.groupCode ?? row.tableCodes.join(" + "),
      turns: 0,
      guests: 0,
    }
    for (const aggregate of [date, person, scope]) {
      aggregate.turns++
      aggregate.guests += row.guestCount
    }
    dates.set(row.businessDate, date)
    staff.set(row.closedByUserId, person)
    scopes.set(key, scope)
  }
  return {
    from: params.from,
    to: params.to,
    ...totals(filtered),
    byBusinessDate: [...dates.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
    byStaff: [...staff.values()].sort(
      (a, b) =>
        b.turns - a.turns ||
        (a.closedByDisplayName ?? "").localeCompare(b.closedByDisplayName ?? "") ||
        (a.closedByUserId ?? 0) - (b.closedByUserId ?? 0),
    ),
    byScope: [...scopes.values()].sort((a, b) => b.turns - a.turns || a.label.localeCompare(b.label)),
  }
}
