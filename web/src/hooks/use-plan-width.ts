import { useSyncExternalStore } from "react"

/**
 * Chiều rộng máy thật (pt) để chọn cỡ chrome nổi trên sơ đồ.
 *
 * Safari iOS nhớ mức "Page Zoom" riêng cho từng trang. Thu nhỏ còn ~75% thì một
 * chiếc iPhone X 375pt báo `innerWidth` ~506px: app tưởng đang chạy trên máy to
 * nên bật bộ chrome cỡ lớn (thẻ Đếm khách mở sẵn, nút "Bàn chờ" đầy chữ), trong
 * khi màn hình thật vẫn 375pt - các thẻ đó đè lên Khu C và Khu B. `screen.width`
 * không đổi theo mức zoom, nên lấy số nhỏ hơn giữa hai giá trị mới ra đúng cỡ
 * máy. Media query CSS không đọc được `screen.width`, vì vậy chỗ nào cần phân
 * nhánh theo cỡ máy thì dùng hook này thay cho `min-[481px]`.
 */
function readPlanWidth(): number {
  if (typeof window === "undefined") return 1024
  const screenWidth = window.screen?.width
  const physical = typeof screenWidth === "number" && screenWidth > 0 ? screenWidth : Number.POSITIVE_INFINITY
  return Math.min(window.innerWidth, physical)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange)
  window.addEventListener("orientationchange", onChange)
  return () => {
    window.removeEventListener("resize", onChange)
    window.removeEventListener("orientationchange", onChange)
  }
}

export function usePlanWidth(): number {
  return useSyncExternalStore(subscribe, readPlanWidth, () => 1024)
}
