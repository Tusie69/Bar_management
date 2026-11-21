import { ApiError, httpClient } from "@/services"
import type { WaiterMenuView } from "./menu-model"

export async function fetchWaiterMenu(visitId: number): Promise<WaiterMenuView> {
  if (!httpClient) {
    throw new ApiError(501, "MENU_REQUIRES_HTTP", "Danh mục món cần kết nối API để đảm bảo giá hiện hành.")
  }
  return httpClient.get<WaiterMenuView>(`/waiter/menu?visitId=${visitId}`)
}
