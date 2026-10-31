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
  bookingExport: (bd: string) => ["booking-export", bd] as const,
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
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getCatalog(),
    staleTime: 60_000,
  })
}

export function useFloorState(businessDate?: BusinessDate) {
  const today = useBusinessDate()
  const selectedDate = businessDate ?? today
  return useQuery({
    queryKey: qk.floor(selectedDate),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getFloorState(clock.now(), selectedDate),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  })
}

export function useAvailability(at: Date | null, party: number) {
  return useQuery({
    queryKey: qk.availability(at?.toISOString() ?? "none", party),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getAvailability(at!, party),
    enabled: !!at,
    placeholderData: keepPreviousData,
  })
}

export function useOverview() {
  return useQuery({
    queryKey: qk.overview,
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getShiftOverview(),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  })
}

export function useReservations(bd: BusinessDate, search = "") {
  return useQuery({
    queryKey: qk.reservations(bd, search.trim()),
    enabled: Boolean(bd),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.listReservations({ businessDate: bd, search }),
    refetchInterval: 15_000,
  })
}

export function useBookingExport(bd: BusinessDate, enabled: boolean) {
  return useQuery({
    queryKey: qk.bookingExport(bd),
    queryFn: () => api.exportDailyBookingText(bd),
    enabled: enabled && Boolean(bd),
    retry: false,
    refetchInterval: enabled ? 15_000 : false,
  })
}

export function useVisits(bd: BusinessDate) {
  return useQuery({
    retry: api.mode === "mock" ? 1 : false,
    queryKey: qk.visits(bd),
    queryFn: () => api.listVisits(bd),
  })
}

export function useWaitlist(bd: BusinessDate) {
  return useQuery({
    queryKey: qk.waitlist(bd),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.listWaitlist(bd),
    refetchInterval: 15_000,
  })
}

export function useCustomers(q: string) {
  return useQuery({
    queryKey: qk.customers(q.trim()),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.searchCustomers(q),
    placeholderData: keepPreviousData,
  })
}

export function useCustomer(id: number | null) {
  return useQuery({
    retry: api.mode === "mock" ? 1 : false,
    queryKey: qk.customer(id ?? 0),
    queryFn: () => api.getCustomer(id!),
    enabled: id !== null,
  })
}

export function useOperations(limit = 40) {
  return useQuery({
    queryKey: qk.operations(limit),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.listOperations(limit),
    placeholderData: keepPreviousData,
  })
}

export function useTableHistory(tableId: number | null, bd: BusinessDate) {
  return useQuery({
    queryKey: qk.allocations(bd, tableId),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.listAllocations(bd, tableId!),
    enabled: tableId !== null,
  })
}

export function useDayAllocations(bd: BusinessDate) {
  return useQuery({
    queryKey: qk.allocations(bd, null),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.listAllocations(bd),
  })
}

export function useReport(q: ReportQuery, enabled: boolean) {
  return useQuery({
    queryKey: qk.report(q),
    retry: api.mode === "mock" ? 1 : false,
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
