/**
 * Module Phục vụ 1 — dữ liệu của màn `/phucvu`.
 *
 * Một query duy nhất, gọi endpoint riêng của Phục vụ. KHÔNG dùng `useFloorModel`
 * của Lễ tân: hook đó gọi `GET /tables` và `GET /tables/catalog` bằng quyền
 * `customer.view_masked`, nên với tài khoản Phục vụ nó sẽ trả 403 và màn hình
 * trắng. Đổi lấy một chút trùng lặp ở tầng gọi dữ liệu, đổi lại không có đường
 * nào để dữ liệu khách đi vào màn này.
 *
 * Khoá query mang tiền tố riêng, nên `qc.invalidateQueries()` của
 * `useRealtimeSync` vẫn làm nó tải lại khi sơ đồ đổi ở máy khác — kênh SSE chỉ
 * báo "đã đổi", không chở dữ liệu.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import type { FloorGroup, FloorTableState, TableView, ZoneView } from "@/domain/models"
import { useNow } from "@/hooks/use-data"
import { api } from "@/services"
import { businessDateOf, FALLBACK_BUSINESS_SHIFT, shiftHour, type BusinessDate, type BusinessShift } from "@/lib/time"

export const waiterCatalogQueryKey = ["waiter-catalog"] as const

/**
 * Catalog của màn Phục vụ. KHÔNG dùng `useCatalog` của Lễ tân: hook đó gọi
 * `api.getCatalog()`, vốn nạp kèm `GET /bookings/sources` với quyền
 * `customer.view_masked` mà tài khoản Phục vụ không có.
 *
 * Hỏng ở đó không hiện ra như một lỗi: `useBusinessShift` chỉ lặng lẽ trả
 * `FALLBACK_BUSINESS_SHIFT`, nên máy Phục vụ tính ngày nghiệp vụ theo 17:00
 * –05:00 cứng thay vì theo ca mà quán đã cấu hình (TU-38). Quán đổi giờ đóng
 * ca là Phục vụ hỏi sai ngày và thấy sơ đồ rỗng, không một thông báo nào.
 */
export function useWaiterCatalogQuery() {
  return useQuery({
    queryKey: waiterCatalogQueryKey,
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getWaiterCatalog(),
    staleTime: 60_000,
  })
}

/** Ca vận hành thật của quán, đọc qua catalog mà Phục vụ có quyền. */
export function useWaiterBusinessShift(): BusinessShift {
  const venue = useWaiterCatalogQuery().data?.venue
  if (!venue) return FALLBACK_BUSINESS_SHIFT
  return { startLocal: venue.businessDayStartLocal, cutoffLocal: venue.businessDayCutoffLocal }
}

/** Ngày nghiệp vụ theo ca thật, không theo hằng số mặc định. */
export function useWaiterBusinessDate(): BusinessDate {
  const now = useNow(30_000)
  const shift = useWaiterBusinessShift()
  return businessDateOf(now, shiftHour(shift.cutoffLocal))
}

export const waiterFloorQueryKey = (businessDate: string) => ["waiter-floor", businessDate] as const

export function useWaiterFloorQuery(businessDate: BusinessDate) {
  return useQuery({
    queryKey: waiterFloorQueryKey(businessDate),
    retry: api.mode === "mock" ? 1 : false,
    queryFn: () => api.getWaiterFloor(businessDate),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    enabled: Boolean(businessDate),
  })
}

export interface WaiterFloorModel {
  loading: boolean
  error: unknown
  businessDate: BusinessDate
  /** Mốc thời gian của MÁY CHỦ, để "đã phục vụ 40 phút" giống nhau trên mọi máy. */
  serverNow: Date | null
  tables: TableView[]
  zones: ZoneView[]
  byId: Map<number, TableView>
  states: Map<number, FloorTableState>
  groups: FloorGroup[]
  refetch: () => void
}

export function useWaiterFloor(): WaiterFloorModel {
  const businessDate = useWaiterBusinessDate()
  const query = useWaiterFloorQuery(businessDate)
  const { data } = query
  return useMemo(() => {
    const tables = data?.catalog.tables ?? []
    return {
      loading: query.isLoading,
      error: query.error,
      businessDate,
      serverNow: data?.floor.at ?? null,
      tables,
      zones: data?.catalog.zones ?? [],
      byId: new Map(tables.map((table) => [table.id, table])),
      states: new Map((data?.floor.tables ?? []).map((state) => [state.tableId, state])),
      groups: data?.floor.groups ?? [],
      refetch: () => void query.refetch(),
    }
  }, [businessDate, data, query])
}
