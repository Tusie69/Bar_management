import { useLayoutEffect, type RefObject } from "react"

/**
 * Khi một thẻ hàng chờ bị gỡ khỏi DOM (sau khi duyệt/từ chối và refetch),
 * nếu focus đang nằm trong thẻ đó thì chuyển về điểm ổn định trên hàng chờ
 * trước khi node bị tách để tránh rơi focus về `document.body`.
 */
export function useFocusFallbackOnUnmount(
  containerRef: RefObject<HTMLElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const el = containerRef.current
    const fallbackEl = fallbackRef?.current
    return () => {
      if (!el) return
      const active = document.activeElement
      if (active && el.contains(active) && fallbackEl?.isConnected) {
        fallbackEl.focus({ preventScroll: true })
      }
    }
  }, [containerRef, fallbackRef])
}
