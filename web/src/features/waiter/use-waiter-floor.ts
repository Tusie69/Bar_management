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
import { useBusinessDate } from "@/hooks/use-data"
import { api } from "@/services"
import type { BusinessDate } from "@/lib/time"

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
  const businessDate = useBusinessDate()
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
