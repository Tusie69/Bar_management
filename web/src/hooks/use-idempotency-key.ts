import { useCallback, useState } from "react"
import { newIdempotencyKey } from "@/services"

/**
 * FX-04: một mã chống trùng (Idempotency-Key) cho form tạo booking / walk-in / Bàn chờ.
 * Giữ nguyên mã khi bấm Lưu lặp hoặc gửi lại sau lỗi (máy chủ không ghi nhớ lần lỗi);
 * gọi `renew()` sau khi tạo thành công để lần tạo kế tiếp trong cùng form không bị coi là trùng.
 */
export function useIdempotencyKey(): readonly [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey)
  const renew = useCallback(() => setKey(newIdempotencyKey()), [])
  return [key, renew] as const
}
