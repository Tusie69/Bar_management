import { useCallback, useEffect, useRef, useState } from "react"
import type { PreparationQueueStatus } from "./preparation-presentation"

/**
 * Kéo một phiếu sang cột khác bằng con trỏ.
 *
 * Dùng Pointer Events chứ không phải HTML5 drag-and-drop: màn hình của quầy là
 * máy tính bảng, và `dragstart` không bao giờ xảy ra khi người ta chạm ngón
 * tay. Pointer Events là một đường cho cả chuột, cảm ứng và bút.
 *
 * Cú kéo bắt đầu từ MỘT TAY NẮM riêng, không phải từ cả thẻ. Thẻ có nút cộng
 * trừ tiến độ và nút chuyển bước; biến cả thẻ thành vùng kéo thì mỗi lần vuốt
 * để cuộn danh sách lại thành một lần đổi trạng thái. Tay nắm đặt
 * `touch-action: none` để trình duyệt nhường chuyển động cho mình, và chỉ
 * riêng nó.
 *
 * Hook không biết luật nào cả: nó chỉ nói "phiếu X đang ở trên cột Y" và
 * "phiếu X vừa được thả trên cột Y". Việc đó có nghĩa gì là của
 * `planPreparationDrop`.
 */
export interface PreparationDragState {
  ticketId: number
  overStatus: PreparationQueueStatus | null
  x: number
  y: number
}

/** Ngưỡng để phân biệt một cú chạm với một cú kéo (pixel). */
const DRAG_THRESHOLD_PX = 6

function statusUnderPointer(x: number, y: number): PreparationQueueStatus | null {
  const element = document.elementFromPoint(x, y)
  const column = element?.closest<HTMLElement>("[data-queue-status]")
  const status = column?.dataset.queueStatus
  return status ? (status as PreparationQueueStatus) : null
}

export function usePreparationDrag(onDrop: (ticketId: number, status: PreparationQueueStatus) => void) {
  /** `null` khi không có ngón tay nào đang đặt trên một tay nắm. */
  const [drag, setDrag] = useState<PreparationDragState | null>(null)
  const pressed = useRef<{ x: number; y: number; ticketId: number } | null>(null)
  // onDrop đổi mỗi lần component vẽ lại; giữ trong ref để listener không phải
  // gắn lại giữa chừng, và để cú thả vẫn gọi đúng hàm mới nhất.
  const dropRef = useRef(onDrop)
  useEffect(() => {
    dropRef.current = onDrop
  }, [onDrop])
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!listening) return undefined

    const move = (event: PointerEvent) => {
      const start = pressed.current
      if (!start) return
      const far =
        Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX
      if (!far) return
      setDrag({
        ticketId: start.ticketId,
        overStatus: statusUnderPointer(event.clientX, event.clientY),
        x: event.clientX,
        y: event.clientY,
      })
    }

    const stop = () => {
      pressed.current = null
      setDrag(null)
      setListening(false)
    }

    const finish = (event: PointerEvent) => {
      const start = pressed.current
      const far =
        start !== null &&
        (Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX)
      const ticketId = start?.ticketId
      stop()
      // Một cú chạm không di chuyển là một cú chạm, không phải một lần thả:
      // nó không được âm thầm đổi trạng thái phiếu.
      if (!far || ticketId === undefined) return
      const status = statusUnderPointer(event.clientX, event.clientY)
      if (status) dropRef.current(ticketId, status)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", stop)
    }
  }, [listening])

  const startDrag = useCallback((event: React.PointerEvent, ticketId: number) => {
    // Chỉ nút trái của chuột; chuột phải mở menu ngữ cảnh chứ không kéo.
    if (event.button !== 0) return
    pressed.current = { x: event.clientX, y: event.clientY, ticketId }
    setListening(true)
  }, [])

  return { drag, startDrag }
}
