import { useEffect, useRef } from "react"

/**
 * Enables smooth mouse drag-to-scroll for horizontal containers on desktop/mouse devices,
 * while leaving native touch gestures intact for mobile devices.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let isDown = false
    let startX = 0
    let scrollLeft = 0
    let isDragging = false

    const onMouseDown = (e: MouseEvent) => {
      // Only handle primary (left) mouse button
      if (e.button !== 0) return
      isDown = true
      isDragging = false
      startX = e.pageX - el.offsetLeft
      scrollLeft = el.scrollLeft
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return
      const x = e.pageX - el.offsetLeft
      const walk = x - startX
      if (!isDragging && Math.abs(walk) > 4) {
        isDragging = true
        document.body.style.userSelect = "none"
      }
      if (isDragging) {
        el.scrollLeft = scrollLeft - walk
      }
    }

    const onMouseUp = () => {
      if (isDown) {
        if (isDragging) {
          // Suppress upcoming click on children caused by drag release
          const captureClick = (e: MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            window.removeEventListener("click", captureClick, true)
          }
          window.addEventListener("click", captureClick, true)
          document.body.style.userSelect = ""
        }
        isDown = false
        isDragging = false
      }
    }

    el.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)

    return () => {
      el.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      document.body.style.userSelect = ""
    }
  }, [])

  return ref
}
