/**
 * Deterministic SYNTHETIC seed: catalogue from venue-layout.ts, 45 business
 * days of history (for reports and guest profiles) and a live shift tonight
 * that exercises every floor state: seated, reserved, late (15'), no-show
 * warning (30'), waitlist hold, overdue hold, combined groups, spare and
 * out-of-service positions.
 */
import { foldVietnamese } from "@/lib/text"
import { addDays, atBusinessTime, businessDateOf, MS, type BusinessDate } from "@/lib/time"
import type { AllocationReleaseReason, BookingSourceCode, VisitOrigin } from "@/domain/enums"
import { BAR_SEATS, COMBINATIONS, TABLES, ZONES, barSeatCode } from "@/domain/venue-layout"
import type { ReservationRow, VisitRow, WaitlistEntryRow } from "@/domain/schema"
import { emptyDb, allocId, ORG_ID, VENUE_ID, type MockDb, type MockUser } from "./db"

export const DEMO_USERS: MockUser[] = [
  { id: 1, displayName: "Lễ tân 1", role: "RECEPTIONIST", deviceLabel: "iPad quầy" },
  { id: 2, displayName: "Lễ tân 2", role: "RECEPTIONIST", deviceLabel: "iPad cửa" },
  { id: 3, displayName: "Chủ quán", role: "OWNER_ADMIN", deviceLabel: "Laptop văn phòng" },
  { id: 4, displayName: "CSKH", role: "CUSTOMER_CARE", deviceLabel: "Điện thoại CSKH" },
  { id: 5, displayName: "Thu ngân", role: "CASHIER", deviceLabel: "Máy thu ngân" },
]

export const REMOTE_USER_ID = 2

const SOURCES: { code: BookingSourceCode; name: string }[] = [
  { code: "HOTLINE", name: "Hotline" },
  { code: "FANPAGE", name: "Fanpage" },
  { code: "ZALO", name: "Zalo" },
  { code: "SHAREHOLDER", name: "Cổ đông" },
  { code: "STAFF", name: "Nhân viên" },
  { code: "SOCIAL", name: "Social" },
  { code: "OTHER", name: "Khác" },
]

const FAMILY = [
  "Nguyễn",
  "Trần",
  "Lê",
  "Phạm",
  "Hoàng",
  "Vũ",
  "Võ",
  "Đặng",
  "Bùi",
  "Đỗ",
  "Hồ",
  "Ngô",
  "Dương",
  "Lý",
  "Phan",
  "Trịnh",
  "Mai",
  "Đinh",
  "Tạ",
  "Châu",
]
const MIDDLE = [
  "Minh",
  "Thu",
  "Gia",
  "Ngọc",
  "Hoàng",
  "Quốc",
  "Thanh",
  "Khánh",
  "Phương",
  "Đức",
  "Hải",
  "Bảo",
  "Anh",
  "Mỹ",
  "Quang",
  "Tuấn",
]
const GIVEN = [
  "Anh",
  "Hà",
  "Long",
  "Bảo",
  "Trâm",
  "Huy",
  "Linh",
  "Tùng",
  "Thảo",
  "Khoa",
  "Yến",
  "Thịnh",
  "Thư",
  "Ngọc",
  "Vy",
  "Nam",
  "Phúc",
  "Hân",
  "Duy",
  "My",
  "Vinh",
  "Lan",
  "Tâm",
  "Quân",
]

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedDb(now: Date): MockDb {
  const db = emptyDb()
  const rng = mulberry32(21)
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
  const bd = businessDateOf(now)
  const created = new Date(now.getTime() - 120 * MS.DAY)

  DEMO_USERS.forEach((u) => db.users.set(u.id, u))

  db.venue.set(VENUE_ID, {
    id: VENUE_ID,
    organizationId: ORG_ID,
    code: "21GAM",
    name: "21GAM",
    status: "ACTIVE",
    timezone: "Asia/Ho_Chi_Minh",
    businessDayStartLocal: "17:00:00",
    businessDayCutoffLocal: "05:00:00",
    lateWarningMinutes: 15,
    noShowWarningMinutes: 30,
    waitlistHoldDefaultMinutes: 30,
    waitlistClaimLeaseSeconds: 300,
    reservationHoldPolicy: "SEQUENTIAL",
    reservationWindowMinutes: null,
    groupSymbolCount: 12,
    changeSeq: 1200,
    version: 1,
  })

  /* ---------- catalogue ---------- */
  const zoneId: Record<string, number> = {}
  ZONES.forEach((z, i) => {
    const id = allocId(db, "zones")
    zoneId[z.code] = id
    db.zones.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      floorId: null,
      code: z.code,
      name: z.name,
      isBookable: z.isBookable,
      isWaitingArea: z.isWaitingArea,
      sortOrder: i,
      isActive: true,
      version: 1,
    })
  })

  const tableId: Record<string, number> = {}
  TABLES.forEach((t) => {
    const id = allocId(db, "tables")
    tableId[t.code] = id
    db.tables.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      zoneId: zoneId[t.zone],
      code: t.code,
      displayName: `Bàn ${t.code}`,
      kind: "TABLE",
      capacity: t.capacity,
      seqNo: null,
      isSpare: t.isSpare,
      status: "ACTIVE",
      posX: t.x,
      posY: t.y,
      width: t.w,
      height: t.h,
      rotationDeg: 0,
      version: 1,
      seating: t.seating,
    })
  })
  db.nextId.tables = 101
  BAR_SEATS.forEach((s) => {
    const id = allocId(db, "tables")
    const code = barSeatCode(s.no)
    tableId[code] = id
    db.tables.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      zoneId: zoneId.BAR,
      code,
      displayName: `Ghế Bar ${s.no}`,
      kind: "BAR_SEAT",
      capacity: 1,
      seqNo: s.no,
      isSpare: false,
      status: s.no === 21 ? "OUT_OF_SERVICE" : "ACTIVE",
      posX: s.x,
      posY: s.y,
      width: 20,
      height: 20,
      rotationDeg: 0,
      version: 1,
      seating: "bar",
    })
  })

  COMBINATIONS.forEach((c) => {
    const id = allocId(db, "combinations")
    db.combinations.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      code: c.code,
      displayName: c.displayName,
      isActive: true,
      version: 1,
      members: c.members.map((m) => tableId[m]),
      pendingConfirmation: c.pendingConfirmation,
    })
  })

  const sourceId: Record<string, number> = {}
  SOURCES.forEach((s, i) => {
    const id = allocId(db, "sources")
    sourceId[s.code] = id
    db.sources.set(id, { id, organizationId: ORG_ID, code: s.code, name: s.name, isActive: true, sortOrder: i })
  })

  /* ---------- customers ---------- */
  const usedLast3 = new Set<string>()
  const customerIds: number[] = []
  for (let i = 0; i < 56; i++) {
    const name = `${pick(FAMILY)} ${pick(MIDDLE)} ${pick(GIVEN)}`
    let last3 = String(Math.floor(rng() * 1000)).padStart(3, "0")
    while (usedLast3.has(last3)) last3 = String(Math.floor(rng() * 1000)).padStart(3, "0")
    usedLast3.add(last3)
    const prefix = pick(["090", "093", "097", "098", "091", "035", "086", "070"])
    const mid = String(Math.floor(rng() * 10000)).padStart(4, "0")
    const phone = `+84${prefix.slice(1)}${mid}${last3}`
    const id = allocId(db, "customers")
    customerIds.push(id)
    db.customers.set(id, {
      id,
      organizationId: ORG_ID,
      displayName: name,
      nameSearch: foldVietnamese(name),
      phoneLast3: last3,
      status: "ACTIVE",
      mergedIntoCustomerId: null,
      anonymizedAt: null,
      createdAt: created,
      version: 1,
      phoneE164: phone,
      notes: i % 7 === 0 ? "Thích ngồi gần quầy Bar." : i % 9 === 0 ? "Hay đi nhóm đông, báo trước để ghép bàn." : null,
    })
  }
  // A handful of regulars get most of the visits.
  const regularWeight = customerIds.map((_, i) => (i < 10 ? 6 : i < 25 ? 2 : 1))
  const totalWeight = regularWeight.reduce((a, b) => a + b, 0)
  const pickCustomer = () => {
    let r = rng() * totalWeight
    for (let i = 0; i < customerIds.length; i++) {
      r -= regularWeight[i]
      if (r <= 0) return customerIds[i]
    }
    return customerIds[0]
  }
  const nameOf = (cid: number) => db.customers.get(cid)?.displayName ?? null

  /* ---------- helpers ---------- */
  const abTables = TABLES.filter((t) => !t.isSpare && t.zone !== "C").map((t) => tableId[t.code])
  const barSeatIds = BAR_SEATS.filter((s) => s.no !== 21).map((s) => tableId[barSeatCode(s.no)])

  function addReservation(p: {
    bd: BusinessDate
    time: string
    party: number
    customerId: number | null
    name: string
    source: BookingSourceCode
    status: ReservationRow["status"]
    note?: string | null
    createdBy?: number
    visitId?: number | null
    closeReason?: ReservationRow["closeReasonCode"]
  }): ReservationRow {
    const id = allocId(db, "reservations")
    const expectedAt = atBusinessTime(p.bd, p.time)
    const createdAt = new Date(expectedAt.getTime() - (2 + Math.floor(rng() * 70)) * MS.HOUR)
    const closed = p.status === "CANCELLED" || p.status === "NO_SHOW"
    const row: ReservationRow = {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      customerId: p.customerId,
      contactName: p.name,
      contactNameSearch: foldVietnamese(p.name),
      sourceId: sourceId[p.source],
      partySize: p.party,
      expectedAt,
      businessDate: p.bd,
      customerClassification: "UNCLASSIFIED",
      status: p.status,
      note: p.note ?? null,
      visitId: p.visitId ?? null,
      checkedInAt: p.status === "CHECKED_IN" ? new Date(expectedAt.getTime() + 4 * MS.MIN) : null,
      checkedInByUserId: p.status === "CHECKED_IN" ? 1 : null,
      closedAt: closed ? new Date(expectedAt.getTime() + (p.status === "NO_SHOW" ? 40 : -60) * MS.MIN) : null,
      closedByUserId: closed ? 1 : null,
      closeReasonCode: closed
        ? (p.closeReason ?? (p.status === "NO_SHOW" ? "NO_SHOW_CONFIRMED" : "CUSTOMER_REQUEST"))
        : null,
      closeReasonNote: null,
      lateWarnedAt: null,
      noShowWarnedAt: null,
      createdByUserId: p.createdBy ?? 1,
      createdAt,
      updatedByUserId: null,
      updatedAt: createdAt,
      version: 1,
    }
    db.reservations.set(id, row)
    return row
  }

  function addVisit(p: {
    bd: BusinessDate
    origin: VisitOrigin
    customerId: number | null
    name: string | null
    guests: number
    startedAt: Date
    endedAt: Date | null
    paid?: boolean
    note?: string | null
  }): VisitRow {
    const id = allocId(db, "visits")
    const row: VisitRow = {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      origin: p.origin,
      customerId: p.customerId,
      contactName: p.name,
      guestCount: p.guests,
      startedAt: p.startedAt,
      businessDate: p.bd,
      endedAt: p.endedAt,
      endedByUserId: p.endedAt ? 5 : null,
      endReason: p.endedAt ? "GUEST_LEFT" : null,
      mergedIntoVisitId: null,
      paidMarkedAt: p.paid ? new Date((p.endedAt ?? p.startedAt).getTime() - 10 * MS.MIN) : null,
      paidMarkedByUserId: p.paid ? 5 : null,
      note: p.note ?? null,
      createdByUserId: 1,
      createdAt: p.startedAt,
      version: 1,
    }
    db.visits.set(id, row)
    return row
  }

  function addGroup(bd: BusinessDate, symbolNo: number, formedAt: Date, dissolvedAt: Date | null) {
    const id = allocId(db, "groups")
    db.groups.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      businessDate: bd,
      symbolNo,
      formedAt,
      formedByUserId: 1,
      dissolvedAt,
      dissolvedByUserId: dissolvedAt ? 1 : null,
      version: 1,
    })
    return id
  }

  function addAlloc(p: {
    tableId: number
    kind: "HOLD" | "USAGE"
    holdId?: number | null
    visitId?: number | null
    groupId?: number | null
    startsAt: Date
    bd: BusinessDate
    releasedAt?: Date | null
    reason?: AllocationReleaseReason
  }) {
    const id = allocId(db, "allocations")
    db.allocations.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      tableId: p.tableId,
      kind: p.kind,
      holdId: p.holdId ?? null,
      visitId: p.visitId ?? null,
      groupId: p.groupId ?? null,
      startsAt: p.startsAt,
      plannedUntil: null,
      businessDate: p.bd,
      releasedAt: p.releasedAt ?? null,
      releasedByUserId: p.releasedAt ? 1 : null,
      releaseReason: p.releasedAt ? (p.reason ?? "GUEST_LEFT") : null,
      createdByUserId: 1,
      createdAt: p.startsAt,
      version: 1,
    })
    return id
  }

  function addReservationHold(res: ReservationRow, tables: number[], groupSymbol: number | null) {
    const id = allocId(db, "holds")
    db.holds.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      holdKind: "RESERVATION",
      reservationId: res.id,
      waitlistEntryId: null,
      status: "ACTIVE",
      startsAt: res.expectedAt,
      customerConfirmedAt: null,
      deadlineAt: null,
      deadlineBasis: null,
      defaultMinutesSnapshot: null,
      deadlineSetByUserId: null,
      deadlineReason: null,
      deadlineWarnedAt: null,
      convertedAt: null,
      convertedVisitId: null,
      releasedAt: null,
      releasedByUserId: null,
      releaseReasonCode: null,
      releaseReasonNote: null,
      createdByUserId: 1,
      createdAt: res.createdAt,
      version: 1,
    })
    const groupId =
      tables.length > 1 && groupSymbol ? addGroup(res.businessDate, groupSymbol, res.createdAt, null) : null
    tables.forEach((t) =>
      addAlloc({ tableId: t, kind: "HOLD", holdId: id, groupId, startsAt: res.createdAt, bd: res.businessDate }),
    )
    return id
  }

  /* ---------- history: 45 previous business days ---------- */
  for (let d = 45; d >= 1; d--) {
    const day = addDays(bd, -d)
    const weekday = new Date(atBusinessTime(day, "20:00").getTime() + 7 * MS.HOUR).getUTCDay()
    const busy = weekday === 5 || weekday === 6 ? 1.5 : 1
    const count = Math.round((16 + rng() * 16) * busy)
    for (let i = 0; i < count; i++) {
      const roll = rng()
      const origin: VisitOrigin = roll < 0.45 ? "RESERVATION" : roll < 0.9 ? "WALK_IN" : "WAITLIST"
      const atBar = rng() < 0.3
      const startMin = 30 + Math.floor(rng() * 450) // 17:30 .. 01:00
      const startedAt = new Date(atBusinessTime(day, "17:00").getTime() + startMin * MS.MIN)
      const endedAt = new Date(startedAt.getTime() + (60 + Math.floor(rng() * 180)) * MS.MIN)
      const cid = origin === "WALK_IN" && rng() < 0.7 ? null : pickCustomer()
      let tables: number[]
      let guests: number
      if (atBar) {
        const n = 1 + Math.floor(rng() * 3)
        const start = Math.floor(rng() * (barSeatIds.length - n))
        tables = barSeatIds.slice(start, start + n)
        guests = n
      } else if (rng() < 0.12) {
        const combo = pick([...db.combinations.values()])
        tables = combo.members
        guests = 5 + Math.floor(rng() * 4)
      } else {
        tables = [pick(abTables)]
        guests = 2 + Math.floor(rng() * 3)
      }
      const visit = addVisit({
        bd: day,
        origin,
        customerId: cid,
        name: cid ? nameOf(cid) : null,
        guests,
        startedAt,
        endedAt,
        paid: true,
      })
      if (origin === "RESERVATION" && cid) {
        const r = addReservation({
          bd: day,
          time: `${String((17 + Math.floor(startMin / 60)) % 24).padStart(2, "0")}:${startMin % 60 < 30 ? "00" : "30"}`,
          party: guests,
          customerId: cid,
          name: nameOf(cid) ?? "Khách",
          source: pick(["HOTLINE", "FANPAGE", "ZALO", "ZALO", "STAFF", "SHAREHOLDER"]),
          status: "CHECKED_IN",
          visitId: visit.id,
        })
        r.checkedInAt = startedAt
      }
      const groupId = tables.length > 1 ? addGroup(day, 1 + (i % 12), startedAt, endedAt) : null
      const moved = !atBar && tables.length === 1 && rng() < 0.12
      const combined = !atBar && tables.length === 1 && !moved && rng() < 0.07
      if (moved) {
        const mid = new Date(startedAt.getTime() + 25 * MS.MIN)
        addAlloc({
          tableId: tables[0],
          kind: "USAGE",
          visitId: visit.id,
          startsAt: startedAt,
          bd: day,
          releasedAt: mid,
          reason: "MOVED",
        })
        addAlloc({
          tableId: pick(abTables),
          kind: "USAGE",
          visitId: visit.id,
          startsAt: mid,
          bd: day,
          releasedAt: endedAt,
          reason: "GUEST_LEFT",
        })
      } else if (combined) {
        const mid = new Date(startedAt.getTime() + 40 * MS.MIN)
        const g = addGroup(day, 1 + ((i + 5) % 12), mid, endedAt)
        addAlloc({
          tableId: tables[0],
          kind: "USAGE",
          visitId: visit.id,
          startsAt: startedAt,
          bd: day,
          releasedAt: mid,
          reason: "REGROUPED",
        })
        addAlloc({
          tableId: tables[0],
          kind: "USAGE",
          visitId: visit.id,
          groupId: g,
          startsAt: mid,
          bd: day,
          releasedAt: endedAt,
          reason: "GUEST_LEFT",
        })
        addAlloc({
          tableId: pick(abTables),
          kind: "USAGE",
          visitId: visit.id,
          groupId: g,
          startsAt: mid,
          bd: day,
          releasedAt: endedAt,
          reason: "GUEST_LEFT",
        })
        visit.guestCount += 2
      } else {
        tables.forEach((t) =>
          addAlloc({
            tableId: t,
            kind: "USAGE",
            visitId: visit.id,
            groupId,
            startsAt: startedAt,
            bd: day,
            releasedAt: endedAt,
            reason: "GUEST_LEFT",
          }),
        )
      }
    }
    // Cancelled / no-show bookings for history
    if (rng() < 0.7) {
      const cid = pickCustomer()
      addReservation({
        bd: day,
        time: pick(["20:00", "21:00", "22:00"]),
        party: 2 + Math.floor(rng() * 4),
        customerId: cid,
        name: nameOf(cid) ?? "Khách",
        source: "HOTLINE",
        status: rng() < 0.5 ? "CANCELLED" : "NO_SHOW",
      })
    }
  }

  /* ---------- tonight ---------- */
  const T = (code: string) => tableId[code]
  const B = (no: number) => tableId[barSeatCode(no)]
  const at = (time: string) => atBusinessTime(bd, time)
  const C = customerIds

  const seatReservation = (opts: {
    cust: number
    time: string
    party: number
    source: BookingSourceCode
    tables: number[]
    seatedAt: string
    symbol?: number
    note?: string
    paid?: boolean
  }) => {
    const v = addVisit({
      bd,
      origin: "RESERVATION",
      customerId: opts.cust,
      name: nameOf(opts.cust),
      guests: opts.party,
      startedAt: at(opts.seatedAt),
      endedAt: null,
      paid: opts.paid,
      note: opts.note,
    })
    if (opts.paid) v.paidMarkedAt = new Date(now.getTime() - 6 * MS.MIN)
    const r = addReservation({
      bd,
      time: opts.time,
      party: opts.party,
      customerId: opts.cust,
      name: nameOf(opts.cust) ?? "",
      source: opts.source,
      status: "CHECKED_IN",
      visitId: v.id,
      note: opts.note,
    })
    r.checkedInAt = at(opts.seatedAt)
    const groupId = opts.tables.length > 1 ? addGroup(bd, opts.symbol ?? 1, at(opts.seatedAt), null) : null
    opts.tables.forEach((t) =>
      addAlloc({ tableId: t, kind: "USAGE", visitId: v.id, groupId, startsAt: at(opts.seatedAt), bd }),
    )
    return { v, r }
  }

  // Seated from reservations
  seatReservation({ cust: C[0], time: "19:00", party: 4, source: "HOTLINE", tables: [T("A3")], seatedAt: "19:04" })
  seatReservation({
    cust: C[1],
    time: "19:30",
    party: 7,
    source: "ZALO",
    tables: [T("B11"), T("B12")],
    seatedAt: "19:36",
    symbol: 2,
    note: "Sinh nhật, chuẩn bị nến.",
  })
  seatReservation({
    cust: C[2],
    time: "20:00",
    party: 2,
    source: "FANPAGE",
    tables: [B(5), B(6)],
    seatedAt: "20:02",
    symbol: 5,
  })
  // R12: seated at A1 then moved to A2 (history preserved)
  {
    const v = addVisit({
      bd,
      origin: "RESERVATION",
      customerId: C[11],
      name: nameOf(C[11]),
      guests: 3,
      startedAt: at("19:48"),
      endedAt: null,
    })
    const r = addReservation({
      bd,
      time: "19:45",
      party: 3,
      customerId: C[11],
      name: nameOf(C[11]) ?? "",
      source: "STAFF",
      status: "CHECKED_IN",
      visitId: v.id,
    })
    r.checkedInAt = at("19:48")
    addAlloc({
      tableId: T("A1"),
      kind: "USAGE",
      visitId: v.id,
      startsAt: at("19:48"),
      bd,
      releasedAt: at("20:10"),
      reason: "MOVED",
    })
    addAlloc({ tableId: T("A2"), kind: "USAGE", visitId: v.id, startsAt: at("20:10"), bd })
  }

  // Walk-ins
  {
    const v1 = addVisit({
      bd,
      origin: "WALK_IN",
      customerId: null,
      name: null,
      guests: 7,
      startedAt: at("21:08"),
      endedAt: null,
    })
    const g = addGroup(bd, 4, at("21:08"), null)
    ;[T("B8"), T("B6")].forEach((t) =>
      addAlloc({ tableId: t, kind: "USAGE", visitId: v1.id, groupId: g, startsAt: at("21:08"), bd }),
    )
    const v2 = addVisit({
      bd,
      origin: "WALK_IN",
      customerId: null,
      name: "Nhóm áo đen",
      guests: 3,
      startedAt: at("21:14"),
      endedAt: null,
    })
    const g2 = addGroup(bd, 6, at("21:14"), null)
    ;[B(10), B(11), B(12)].forEach((t) =>
      addAlloc({ tableId: t, kind: "USAGE", visitId: v2.id, groupId: g2, startsAt: at("21:14"), bd }),
    )
    const v3 = addVisit({
      bd,
      origin: "WALK_IN",
      customerId: null,
      name: null,
      guests: 1,
      startedAt: at("20:47"),
      endedAt: null,
    })
    addAlloc({ tableId: B(1), kind: "USAGE", visitId: v3.id, startsAt: at("20:47"), bd })
    const v4 = addVisit({
      bd,
      origin: "WALK_IN",
      customerId: null,
      name: null,
      guests: 1,
      startedAt: at("19:55"),
      endedAt: null,
      paid: true,
    })
    v4.paidMarkedAt = new Date(now.getTime() - 12 * MS.MIN)
    addAlloc({ tableId: B(14), kind: "USAGE", visitId: v4.id, startsAt: at("19:55"), bd })
    const v5 = addVisit({
      bd,
      origin: "WALK_IN",
      customerId: C[30],
      name: nameOf(C[30]),
      guests: 2,
      startedAt: at("20:20"),
      endedAt: null,
      paid: true,
    })
    v5.paidMarkedAt = new Date(now.getTime() - 4 * MS.MIN)
    addAlloc({ tableId: T("A0"), kind: "USAGE", visitId: v5.id, startsAt: at("20:20"), bd })
  }

  // Booked with table holds
  const late = addReservation({
    bd,
    time: "21:05",
    party: 4,
    customerId: C[3],
    name: nameOf(C[3]) ?? "",
    source: "HOTLINE",
    status: "BOOKED",
  })
  addReservationHold(late, [T("B3")], null)
  late.lateWarnedAt = at("21:20")
  const soon = addReservation({
    bd,
    time: "21:20",
    party: 3,
    customerId: C[4],
    name: nameOf(C[4]) ?? "",
    source: "ZALO",
    status: "BOOKED",
    note: "Khách quen, thích bàn sát tường.",
  })
  addReservationHold(soon, [T("A5")], null)
  const noshow = addReservation({
    bd,
    time: "20:55",
    party: 6,
    customerId: C[5],
    name: nameOf(C[5]) ?? "",
    source: "FANPAGE",
    status: "BOOKED",
  })
  addReservationHold(noshow, [T("A6"), T("A7")], 1)
  noshow.lateWarnedAt = at("21:10")
  noshow.noShowWarnedAt = at("21:25")
  const later = addReservation({
    bd,
    time: "22:00",
    party: 4,
    customerId: C[6],
    name: nameOf(C[6]) ?? "",
    source: "SHAREHOLDER",
    status: "BOOKED",
  })
  addReservationHold(later, [T("B4")], null)
  const big = addReservation({
    bd,
    time: "22:30",
    party: 8,
    customerId: C[7],
    name: nameOf(C[7]) ?? "",
    source: "ZALO",
    status: "BOOKED",
    note: "Đoàn công ty, cần 2 bàn sát nhau.",
  })
  addReservationHold(big, [T("B21"), T("B22")], 3)
  const barRes = addReservation({
    bd,
    time: "22:15",
    party: 2,
    customerId: C[12],
    name: nameOf(C[12]) ?? "",
    source: "SOCIAL",
    status: "BOOKED",
  })
  addReservationHold(barRes, [B(16), B(17)], 7)

  // Booked without table ("Chờ phân bàn")
  addReservation({
    bd,
    time: "22:15",
    party: 2,
    customerId: C[8],
    name: nameOf(C[8]) ?? "",
    source: "HOTLINE",
    status: "BOOKED",
  })
  addReservation({
    bd,
    time: "23:30",
    party: 4,
    customerId: C[13],
    name: nameOf(C[13]) ?? "",
    source: "FANPAGE",
    status: "BOOKED",
  })
  // Cancelled tonight
  addReservation({
    bd,
    time: "20:30",
    party: 4,
    customerId: C[10],
    name: nameOf(C[10]) ?? "",
    source: "HOTLINE",
    status: "CANCELLED",
    closeReason: "CUSTOMER_REQUEST",
  })

  /* ---------- waitlist tonight ---------- */
  const addEntry = (p: Partial<WaitlistEntryRow> & { kind: "ADVANCE_RESERVATION" | "WALK_IN"; queuedAt: Date }) => {
    const id = allocId(db, "waitlist")
    db.waitlist.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      priorityClass: p.kind === "ADVANCE_RESERVATION" ? 1 : 2,
      reservationId: null,
      customerId: null,
      contactName: null,
      partySize: null,
      preferenceMode: "ANY",
      contactChannel: "IN_PERSON",
      businessDate: bd,
      status: "WAITING",
      claimedByUserId: null,
      claimedAt: null,
      claimExpiresAt: null,
      offeredAt: null,
      visitId: null,
      closedAt: null,
      closedByUserId: null,
      closeReasonCode: null,
      closeReasonNote: null,
      note: null,
      createdByUserId: 1,
      createdAt: p.queuedAt,
      version: 1,
      ...p,
    })
    return id
  }
  const addPref = (entryId: number, rank: number, p: { tableId?: number; zoneId?: number; combinationId?: number }) => {
    const id = allocId(db, "prefs")
    db.prefs.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      entryId,
      prefRank: rank,
      tableId: p.tableId ?? null,
      combinationId: p.combinationId ?? null,
      zoneId: p.zoneId ?? null,
      version: 1,
    })
  }

  // ADVANCE: booked guest waiting for a specific busy table (B3)
  const advRes = addReservation({
    bd,
    time: "23:00",
    party: 4,
    customerId: C[9],
    name: nameOf(C[9]) ?? "",
    source: "ZALO",
    status: "BOOKED",
  })
  const w1 = addEntry({
    kind: "ADVANCE_RESERVATION",
    reservationId: advRes.id,
    contactChannel: "ZALO_THREAD",
    preferenceMode: "PREFERRED_ONLY",
    queuedAt: at("18:40"),
  })
  addPref(w1, 1, { tableId: T("B3") })
  // ADVANCE: group of 6 wants zone B, being contacted by the other tablet
  const advRes2 = addReservation({
    bd,
    time: "22:00",
    party: 6,
    customerId: C[14],
    name: nameOf(C[14]) ?? "",
    source: "HOTLINE",
    status: "BOOKED",
  })
  const w2 = addEntry({
    kind: "ADVANCE_RESERVATION",
    reservationId: advRes2.id,
    contactChannel: "PHONE_CALLBACK",
    preferenceMode: "PREFERRED_FIRST",
    queuedAt: at("19:10"),
    status: "CONTACTING",
    claimedByUserId: 2,
    claimedAt: new Date(now.getTime() - 70_000),
    claimExpiresAt: new Date(now.getTime() + 230_000),
  })
  addPref(w2, 1, { zoneId: zoneId.B })
  // WALK_IN: in person, zone A preferred
  const w3 = addEntry({
    kind: "WALK_IN",
    contactName: "Nhóm áo xanh",
    partySize: 4,
    contactChannel: "IN_PERSON",
    preferenceMode: "PREFERRED_FIRST",
    queuedAt: at("21:12"),
    note: "Đứng chờ ở khu C.",
  })
  addPref(w3, 1, { zoneId: zoneId.A })
  // WALK_IN: accepted an offer, table A4 held with a 30' deadline
  const w4 = addEntry({
    kind: "WALK_IN",
    customerId: C[20],
    contactName: nameOf(C[20]),
    partySize: 2,
    contactChannel: "PHONE_CALLBACK",
    preferenceMode: "ANY",
    queuedAt: at("20:58"),
    status: "HOLD_ACTIVE",
    offeredAt: at("21:16"),
  })
  // WALK_IN: accepted, deadline passed -> "Quá hạn giữ"
  const w5 = addEntry({
    kind: "WALK_IN",
    contactName: "Anh Tuấn",
    partySize: 4,
    contactChannel: "ZALO_THREAD",
    preferenceMode: "ANY",
    queuedAt: at("20:41"),
    status: "HOLD_ACTIVE",
    offeredAt: at("20:52"),
  })
  // WALK_IN: plain waiting, any table
  addEntry({
    kind: "WALK_IN",
    contactName: "Chị mặc váy đỏ",
    partySize: 2,
    contactChannel: "IN_PERSON",
    preferenceMode: "ANY",
    queuedAt: at("21:24"),
  })

  const addOfferHold = (entryId: number, tables: number[], confirmed: Date) => {
    const id = allocId(db, "holds")
    db.holds.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      holdKind: "WAITLIST_OFFER",
      reservationId: null,
      waitlistEntryId: entryId,
      status: "ACTIVE",
      startsAt: confirmed,
      customerConfirmedAt: confirmed,
      deadlineAt: new Date(confirmed.getTime() + 30 * MS.MIN),
      deadlineBasis: "DEFAULT",
      defaultMinutesSnapshot: 30,
      deadlineSetByUserId: null,
      deadlineReason: null,
      deadlineWarnedAt: null,
      convertedAt: null,
      convertedVisitId: null,
      releasedAt: null,
      releasedByUserId: null,
      releaseReasonCode: null,
      releaseReasonNote: null,
      createdByUserId: 1,
      createdAt: confirmed,
      version: 1,
    })
    tables.forEach((t) => addAlloc({ tableId: t, kind: "HOLD", holdId: id, startsAt: confirmed, bd }))
    const attemptId = allocId(db, "attempts")
    db.attempts.set(attemptId, {
      id: attemptId,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      entryId,
      attemptNo: 1,
      attemptedByUserId: 1,
      channel: "ZALO_THREAD",
      startedAt: new Date(confirmed.getTime() - 2 * MS.MIN),
      endedAt: confirmed,
      outcome: "ACCEPTED",
      offeredTableIds: tables,
      note: null,
      version: 1,
    })
    return id
  }
  addOfferHold(w4, [T("A4")], at("21:16"))
  const overdueHold = addOfferHold(w5, [T("A1")], at("20:52"))
  const oh = db.holds.get(overdueHold)
  if (oh) oh.deadlineWarnedAt = at("21:22")

  // Contact attempt history for the CONTACTING entry
  {
    const id = allocId(db, "attempts")
    db.attempts.set(id, {
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      entryId: w2,
      attemptNo: 1,
      attemptedByUserId: 4,
      channel: "PHONE_BY_AUTHORIZED",
      startedAt: at("20:30"),
      endedAt: at("20:31"),
      outcome: "NO_ANSWER",
      offeredTableIds: null,
      note: null,
      version: 1,
    })
  }

  /* ---------- upcoming days (availability is per date, not current state) ---------- */
  const tomorrow = addDays(bd, 1)
  const t1 = addReservation({
    bd: tomorrow,
    time: "20:00",
    party: 4,
    customerId: C[15],
    name: nameOf(C[15]) ?? "",
    source: "HOTLINE",
    status: "BOOKED",
  })
  addReservationHold(t1, [T("B3")], null)
  const t2 = addReservation({
    bd: tomorrow,
    time: "21:00",
    party: 2,
    customerId: C[16],
    name: nameOf(C[16]) ?? "",
    source: "FANPAGE",
    status: "BOOKED",
  })
  addReservationHold(t2, [B(8), B(9)], 1)
  const t3 = addReservation({
    bd: tomorrow,
    time: "21:30",
    party: 7,
    customerId: C[17],
    name: nameOf(C[17]) ?? "",
    source: "ZALO",
    status: "BOOKED",
    note: "Đặt cọc qua Zalo.",
  })
  addReservationHold(t3, [T("B11"), T("B12")], 2)
  addReservation({
    bd: tomorrow,
    time: "22:00",
    party: 4,
    customerId: C[18],
    name: nameOf(C[18]) ?? "",
    source: "STAFF",
    status: "BOOKED",
  })
  const d2 = addReservation({
    bd: addDays(bd, 2),
    time: "20:30",
    party: 4,
    customerId: C[19],
    name: nameOf(C[19]) ?? "",
    source: "HOTLINE",
    status: "BOOKED",
  })
  addReservationHold(d2, [T("A3")], null)

  /* ---------- seeded activity log (other devices, not undoable from here) ---------- */
  const seedOp = (
    minutesAgo: number,
    userId: number,
    action: string,
    entityType: string,
    entityId: number,
    summary: string,
  ) => {
    const id = allocId(db, "ops")
    db.ops.push({
      id,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      changeSeq: 1100 + id,
      occurredAt: new Date(now.getTime() - minutesAgo * MS.MIN),
      actorKind: userId === 0 ? "SYSTEM" : "USER",
      actorUserId: userId === 0 ? null : userId,
      actorMembershipId: null,
      authSessionId: null,
      requestId: null,
      idempotencyKey: null,
      action,
      entityType,
      entityId,
      entityVersionBefore: null,
      entityVersionAfter: 1,
      changes: null,
      reasonCode: null,
      reasonNote: null,
      isUndoable: false,
      compensatesOperationId: null,
      summary,
      businessDate: bd,
      undo: [],
      compensatedBy: null,
    })
  }
  seedOp(152, 1, "CHECKED_IN", "reservation", 0, "Check-in A3 · 4 khách")
  seedOp(80, 2, "TABLE_MOVED", "visit", 0, "Đổi bàn A1 → A2")
  seedOp(38, 4, "HOLD_ACCEPTED", "waitlist_entry", w5, "Khách chờ nhận bàn A1 · giữ 30'")
  seedOp(22, 1, "WALKIN_SEATED", "visit", 0, "Walk-in B8 + B6 · 7 khách · ký hiệu Vuông")
  seedOp(14, 0, "RESERVATION_LATE_WARNING", "reservation", late.id, "B3 · booking 21:05 đến muộn 15'")
  seedOp(14, 1, "HOLD_ACCEPTED", "waitlist_entry", w4, "Khách chờ nhận bàn A4 · giữ 30'")
  seedOp(8, 0, "HOLD_DEADLINE_WARNING", "table_hold", overdueHold, "A1 · quá hạn giữ cho khách chờ")
  seedOp(5, 0, "RESERVATION_NO_SHOW_WARNING", "reservation", noshow.id, "A6 + A7 · booking 20:55 chưa đến sau 30'")

  return db
}
