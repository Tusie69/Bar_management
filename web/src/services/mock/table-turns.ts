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
        status: "CLOSED",
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
        checkedInByUserId: staffId,
        checkedInByDisplayName: `Lễ tân ${staffId}`,
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
        (params.closedByUserId === undefined || row.closedByUserId === params.closedByUserId) &&
        (params.checkedInByUserId === undefined || row.checkedInByUserId === params.checkedInByUserId),
    )
    .sort(
      (a, b) =>
        b.businessDate.localeCompare(a.businessDate) || b.seatedAt.localeCompare(a.seatedAt) || b.visitId - a.visitId,
    )
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
/**
 * TU-38 — the venue's countable scopes, which the averages divide by and the zero rows list.
 *
 * The mock floor has no fixed (LAYOUT) cluster, so every countable scope is an ACTIVE
 * non-spare table. `physicalTableTotal` counts the same tables; the two differ only on a
 * real floor where a cluster owns several of them.
 */
export interface MockScopeInventory {
  scopes: { scope: "TABLE" | "GROUP"; tableId: number | null; groupId: number | null; label: string }[]
  physicalTableTotal: number
}

/** Rounds to two decimals, and never divides by zero. */
function ratio(total: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((total / denominator) * 100) / 100
}

export function mockTableTurnSummary(
  rows: TableTurnView[],
  params: TableTurnQuery,
  inventory: MockScopeInventory = { scopes: [], physicalTableTotal: 0 },
): TableTurnSummary {
  const filtered = filteredTurns(rows, params).sort(
    (a, b) =>
      Number(b.status === "OPEN") - Number(a.status === "OPEN") ||
      (b.turnId ?? 0) - (a.turnId ?? 0) ||
      b.visitId - a.visitId,
  )
  const dates = new Map<string, TableTurnSummary["byBusinessDate"][number]>()
  const months = new Map<string, TableTurnSummary["byMonth"][number]>()
  const staff = new Map<number | null, TableTurnSummary["byStaff"][number]>()
  const scopes = new Map<string, TableTurnSummary["byScope"][number]>()
  for (const row of filtered) {
    const date = dates.get(row.businessDate) ?? { businessDate: row.businessDate, turns: 0, guests: 0 }
    const monthKey = row.businessDate.slice(0, 7)
    const month = months.get(monthKey) ?? { month: monthKey, turns: 0, guests: 0 }
    const person = staff.get(row.checkedInByUserId) ?? {
      checkedInByUserId: row.checkedInByUserId,
      checkedInByDisplayName: row.checkedInByDisplayName,
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
    for (const aggregate of [date, month, person, scope]) {
      aggregate.turns++
      aggregate.guests += row.guestCount
    }
    dates.set(row.businessDate, date)
    months.set(monthKey, month)
    staff.set(row.checkedInByUserId, person)
    scopes.set(key, scope)
  }
  const measured = [...scopes.values()]
  const measuredKeys = new Set(measured.map((row) => `${row.scope}:${row.groupId ?? row.tableId ?? row.label}`))
  const zeroRows = params.includeZeroScopes
    ? inventory.scopes
        .filter((entry) => !measuredKeys.has(`${entry.scope}:${entry.groupId ?? entry.tableId ?? entry.label}`))
        .map((entry) => ({ ...entry, turns: 0, guests: 0 }))
    : []
  const counted = totals(filtered)
  return {
    from: params.from,
    to: params.to,
    ...counted,
    openTotal: filtered.filter((row) => row.status === "OPEN").length,
    scopeTotal: inventory.scopes.length,
    physicalTableTotal: inventory.physicalTableTotal,
    averagePerScope: ratio(counted.completedTotal, inventory.scopes.length),
    averagePerPhysicalTable: ratio(counted.completedTotal, inventory.physicalTableTotal),
    byBusinessDate: [...dates.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    byStaff: [...staff.values()].sort(
      (a, b) =>
        b.turns - a.turns ||
        (a.checkedInByDisplayName ?? "").localeCompare(b.checkedInByDisplayName ?? "") ||
        (a.checkedInByUserId ?? 0) - (b.checkedInByUserId ?? 0),
    ),
    byScope: [...measured, ...zeroRows].sort((a, b) => b.turns - a.turns || a.label.localeCompare(b.label)),
  }
}
