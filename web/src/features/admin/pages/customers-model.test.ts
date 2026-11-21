import { describe, expect, it } from "vitest"
import type { CustomerProfile, CustomerSummary, ReservationView, VisitView } from "@/domain/models"
import {
  buildHistory,
  customerCode,
  daysBetween,
  groupByMonth,
  hasRealName,
  matchesSegment,
  profileNotice,
  relativeDays,
  visitsPerMonth,
} from "./customers-model"

// 20:00 giờ quán (UTC+7) để không vướng mốc qua ngày.
const at = (date: string) => new Date(`${date}T13:00:00Z`)
const now = at("2026-11-21")

const summary = (patch: Partial<CustomerSummary>): CustomerSummary => ({
  id: 1,
  displayName: "Nguyễn Văn A",
  phoneLast3: "321",
  phoneMasked: "*******321",
  visitCount: 0,
  lastVisitAt: null,
  ...patch,
})

const profile = (patch: Partial<CustomerProfile>): CustomerProfile => ({
  ...summary({}),
  version: 1,
  notes: null,
  createdAt: at("2026-01-01"),
  visits30d: 0,
  visits90d: 0,
  averageParty: null,
  visitsByMonth: [],
  visits: [],
  reservations: [],
  ...patch,
})

describe("customers model", () => {
  it("formats the customer code from the id only", () => {
    expect(customerCode(12)).toBe("KH-0012")
    expect(customerCode(123456)).toBe("KH-123456")
  })

  it("treats the mock fallback label as no real name", () => {
    expect(hasRealName("Khách ẩn danh")).toBe(false)
    expect(hasRealName("  ")).toBe(false)
    expect(hasRealName("Lan")).toBe(true)
  })

  it("counts calendar days in venue time", () => {
    expect(daysBetween(at("2026-11-20"), now)).toBe(1)
    expect(relativeDays(now, now)).toBe("Hôm nay")
    expect(relativeDays(at("2026-11-11"), now)).toBe("10 ngày trước")
    expect(relativeDays(at("2026-08-01"), now)).toBe("3 tháng trước")
    expect(relativeDays(null, now)).toBeNull()
  })

  it("filters segments on facts only", () => {
    const fresh = summary({ visitCount: 1, lastVisitAt: at("2026-11-01") })
    const old = summary({ visitCount: 3, lastVisitAt: at("2026-06-01") })
    const none = summary({})
    expect(matchesSegment(fresh, "recent30", now)).toBe(true)
    expect(matchesSegment(old, "recent30", now)).toBe(false)
    expect(matchesSegment(old, "returning", now)).toBe(true)
    expect(matchesSegment(fresh, "returning", now)).toBe(false)
    expect(matchesSegment(none, "noVisit", now)).toBe(true)
  })

  it("never turns missing data into zero", () => {
    expect(visitsPerMonth(profile({}))).toBeNull()
    expect(visitsPerMonth(profile({ visitCount: 4, visits90d: 4 }))).toBe(1.3)
  })

  it("reads merged and anonymized status when the API sends it", () => {
    expect(profileNotice(profile({}))).toBeNull()
    expect(profileNotice({ ...profile({}), status: "MERGED", mergedIntoCustomerId: 9 })).toEqual({
      kind: "merged",
      targetId: 9,
    })
    expect(profileNotice({ ...profile({}), status: "ANONYMIZED" })).toEqual({ kind: "anonymized" })
  })

  it("keeps bookings and visits as separate events, newest first, grouped by month", () => {
    const visit = { id: 1, startedAt: at("2026-11-02") } as VisitView
    const booking = { id: 2, expectedAt: at("2026-10-20") } as ReservationView
    const later = { id: 3, expectedAt: at("2026-11-05") } as ReservationView
    const p = profile({ visits: [visit], reservations: [booking, later] })

    const all = buildHistory(p)
    expect(all.map((e) => e.kind)).toEqual(["booking", "visit", "booking"])
    expect(buildHistory(p, "visit")).toHaveLength(1)
    expect(buildHistory(p, "booking")).toHaveLength(2)
    expect(groupByMonth(all).map((g) => [g.label, g.events.length])).toEqual([
      ["Tháng 11/2026", 2],
      ["Tháng 10/2026", 1],
    ])
  })
})
