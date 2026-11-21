import type { WaiterMenuVariant } from "./menu-model"

export function formatVnd(amountVnd: number): string {
  if (!Number.isSafeInteger(amountVnd) || amountVnd < 0) return "Giá không hợp lệ"
  return `${amountVnd.toLocaleString("vi-VN")}đ`
}

export function menuPriceSummary(variants: WaiterMenuVariant[]): string {
  const amounts = variants.map((variant) => variant.amountVnd)
  if (amounts.length === 0) return "Chưa có giá"
  const low = Math.min(...amounts)
  const high = Math.max(...amounts)
  return low === high ? formatVnd(low) : `${formatVnd(low)} – ${formatVnd(high)}`
}
