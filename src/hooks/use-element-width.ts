import { useCallback, useState } from "react"

/** Content-box width of an element, kept current with a ResizeObserver (callback ref). */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
