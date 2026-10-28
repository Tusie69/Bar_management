/**
 * Server-state hooks (TanStack Query) over GamApi + realtime sync.
 * Swapping the mock for the HTTP implementation does not change this file.
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { ReportQuery } from "@/domain/models"
import { businessDateOf, type BusinessDate } from "@/lib/time"
import { api, clock } from "@/services"
import { useSession } from "@/state/session"

export const qk = {
  catalog: ["catalog"] as const,
  floor: (at: string) => ["floor", at] as const,
  availability: (at: string, party: number) => ["availability", at, party] as const,
  overview: ["overview"] as const,
  reservations: (bd: string, search: string) => ["reservations", bd, search] as const,
  visits: (bd: string) => ["visits", bd] as const,
  waitlist: (bd: string) => ["waitlist", bd] as const,
  customers: (q: string) => ["customers", q] as const,
  customer: (id: number) => ["customer", id] as const,
  operations: (limit: number) => ["operations", limit] as const,
  allocations: (bd: string, tableId: number | null) => ["allocations", bd, tableId] as const,
  report: (q: ReportQuery) => ["report", q.from, q.to, q.zone] as const,
}

/* ---------------- time ---------------- */

/** Re-renders every `intervalMs` and whenever the simulated clock jumps. */
export function useNow(intervalMs = 1000): Date {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs)
    const off = clock.subscribe(() => setTick((t) => t + 1))
    return () => {
      clearInterval(id)
      off()
    }
  }, [intervalMs])
  return clock.now()
}

export function useBusinessDate(): BusinessDate {
  const now = useNow(30_000)
  return businessDateOf(now)
}

/* ---------------- queries ---------------- */

export function useCatalog() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: () => api.getCatalog(),
    staleTime: 60_000,
    retry: api.mode === "mock" ? 1 : false,
  })
}

export function useFloorState() {
  return useQuery({
    queryKey: qk.floor("live"),
    queryFn: () => api.getFloorState(clock.now()),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    retry: api.mode === "mock" ? 1 : false,
  })
}

export function useAvailability(at: Date | null, party: number) {
  return useQuery({
    queryKey: qk.availability(at?.toISOString() ?? "none", party),
    queryFn: () => api.getAvailability(at!, party),
    enabled: !!at,
    placeholderData: keepPreviousData,
  })
}

export function useOverview() {
  return useQuery({
    queryKey: qk.overview,
    queryFn: () => api.getShiftOverview(),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  })
}

export function useReservations(bd: BusinessDate, search = "") {
  return useQuery({
    queryKey: qk.reservations(bd, search.trim()),
    queryFn: () => api.listReservations({ businessDate: bd, search }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  })
}

export function useVisits(bd: BusinessDate) {
  return useQuery({ queryKey: qk.visits(bd), queryFn: () => api.listVisits(bd), placeholderData: keepPreviousData })
}

export function useWaitlist(bd: BusinessDate) {
  return useQuery({
    queryKey: qk.waitlist(bd),
    queryFn: () => api.listWaitlist(bd),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  })
}

export function useCustomers(q: string) {
  return useQuery({
    queryKey: qk.customers(q.trim()),
    queryFn: () => api.searchCustomers(q),
    placeholderData: keepPreviousData,
  })
}

export function useCustomer(id: number | null) {
  return useQuery({ queryKey: qk.customer(id ?? 0), queryFn: () => api.getCustomer(id!), enabled: id !== null })
}

export function useOperations(limit = 40) {
  return useQuery({
    queryKey: qk.operations(limit),
    queryFn: () => api.listOperations(limit),
    placeholderData: keepPreviousData,
  })
}

export function useTableHistory(tableId: number | null, bd: BusinessDate) {
  return useQuery({
    queryKey: qk.allocations(bd, tableId),
    queryFn: () => api.listAllocations(bd, tableId!),
    enabled: tableId !== null,
  })
}

export function useDayAllocations(bd: BusinessDate) {
  return useQuery({
    queryKey: qk.allocations(bd, null),
    queryFn: () => api.listAllocations(bd),
    placeholderData: keepPreviousData,
  })
}

export function useReport(q: ReportQuery, enabled: boolean) {
  return useQuery({
    queryKey: qk.report(q),
    queryFn: () => api.getReport(q),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/* ---------------- realtime ---------------- */

const WARNING_ACTIONS = new Set(["RESERVATION_LATE_WARNING", "RESERVATION_NO_SHOW_WARNING", "HOLD_DEADLINE_WARNING"])

/**
 * Mirrors db09: every committed change bumps change_seq and notifies clients;
 * clients refetch (no personal data travels in the event). Mounted once.
 */
export function useRealtimeSync() {
  const qc = useQueryClient()
  const userId = useSession((s) => s.user.id)
  useEffect(() => {
    const off = api.subscribe((event) => {
      qc.invalidateQueries()
      if (event.action === "RESET") return
      if (event.actorKind === "SYSTEM" && WARNING_ACTIONS.has(event.action)) {
        toast.warning(event.summary, { description: "Cảnh báo tự động. Không tự hủy booking hay nhả bàn." })
      } else if (event.actorKind === "USER" && event.actorUserId !== userId) {
        toast.info(`Thiết bị khác: ${event.summary}`, { description: "Đồng bộ mô phỏng giữa các máy" })
      }
    })
    const offClock = clock.subscribe(() => qc.invalidateQueries())
    return () => {
      off()
      offClock()
    }
  }, [qc, userId])
}
