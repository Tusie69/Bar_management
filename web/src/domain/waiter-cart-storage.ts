/**
 * Module Phục vụ 3 — nơi lưu nháp giỏ gọi món.
 *
 * `sessionStorage`, không phải `localStorage`. Giỏ là việc của ĐÚNG cái tab
 * đang mở trước mặt khách: máy Phục vụ là máy dùng chung, và một giỏ còn sót
 * lại sau khi người khác đăng nhập sẽ được gửi cho sai bàn.
 *
 * Khóa phân vùng theo `userId + venueId + visitId`. Thiếu một trong ba thì hai
 * nhân viên dùng chung một máy, hoặc hai Phiên bàn mở trong hai tab, sẽ ghi lên
 * nháp của nhau. `visitId` không đủ: id Phiên lặp lại giữa hai địa điểm.
 *
 * File này cố ý KHÔNG biết hình dạng của giỏ. Nó chỉ đọc/ghi JSON và dọn sạch
 * theo tiền tố, nên `state/session.ts` gọi được `clearWaiterCartDrafts()` lúc
 * đăng xuất mà không phải import một module của feature.
 */
export const WAITER_CART_PREFIX = "21gam.waiter-cart.v1"

export function waiterCartKey(userId: number, venueId: number, visitId: number): string {
  return `${WAITER_CART_PREFIX}:${userId}:${venueId}:${visitId}`
}

export function readWaiterCartDraft(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Nháp đọc không được thì coi như chưa có nháp. Giỏ trống là trạng thái
    // nhân viên nhìn thấy và sửa được; một ngoại lệ chưa bắt thì làm trắng màn.
    return null
  }
}

export function writeWaiterCartDraft(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* hết chỗ lưu hoặc storage bị khóa: giỏ vẫn nằm trong bộ nhớ của tab */
  }
}

export function removeWaiterCartDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* không xóa được nháp thì lần mở sau sẽ dọn theo reconcile */
  }
}

/**
 * Dọn mọi nháp giỏ của mọi Phiên trên tab này.
 *
 * Gọi lúc đăng xuất và lúc phiên bị thu hồi: người tiếp theo đăng nhập trên
 * cùng cái máy không được thấy giỏ của người trước, kể cả khi họ mở đúng Phiên
 * bàn đó.
 */
export function clearWaiterCartDrafts(): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(`${WAITER_CART_PREFIX}:`)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    /* storage không dùng được: không có nháp nào để dọn */
  }
}
