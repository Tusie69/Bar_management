import { useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, PhoneOff, Smartphone, TimerReset } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CallTarget } from "@/domain/models"
import { reportError } from "@/hooks/use-action"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useCan } from "@/state/session"
import { usePendingCall, usePendingCalls } from "./pending-calls"

type Outcome = "CONTACTED" | "NO_ANSWER" | "LATE_CONFIRMED"

/**
 * Xanh lá, không phải viền xám như mọi nút khác.
 *
 * Gọi khách là thao tác lễ tân tìm bằng mắt giữa một rổ nút cùng màu, dưới
 * ánh sáng quán bar, trong lúc khách đang đứng trước mặt. Màu riêng và biểu
 * tượng điện thoại di động làm nó nhận ra được mà không cần đọc chữ. Dùng
 * token st-seated nên tự đổi theo nền sáng/tối, không phải mã màu cứng.
 */
const CALL_TONE = "border-st-seated bg-st-seated-tint text-st-seated-ink hover:bg-st-seated-tint hover:brightness-95"

export function CallCustomerControl({
  target,
  canCall,
  className,
  label,
}: {
  /**
   * Người đang được gọi: một booking, một mục chờ hay một lượt ghé.
   *
   * Booking mang thêm `version` vì kết quả "Tới muộn" còn chuyển trạng thái
   * đặt bàn. Nơi nào không cầm version - danh sách chờ chỉ biết version của
   * mục chờ - thì bỏ trống, hộp kết quả khi đó chỉ hiện hai lựa chọn chạm vào
   * nhật ký gọi, thay vì gửi một version chắc chắn bị từ chối.
   */
  target: CallTarget
  /**
   * Whether the server believes this guest has a number to dial. False only
   * disables the button and says why - it never hides it. A receptionist who
   * cannot find the button assumes the feature is broken and rings the owner
   * for the number, which is exactly what this control exists to avoid.
   */
  canCall: boolean
  className?: string
  /** Defaults to "Gọi khách". */
  label?: string
}) {
  const allowedToCall = useCan("booking.phone.call")
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  // Giữ trong bộ nhớ của lần gọi hiện tại, không ghi vào localStorage: dùng
  // cho liên kết mở lại trình gọi khi máy không bắt được tel: lần đầu (máy
  // tính lễ tân chưa gán ứng dụng gọi, hoặc trình duyệt chặn điều hướng).
  const [telUri, setTelUri] = useState<string | null>(null)
  // Kept outside the component: this sheet is closed and reopened constantly,
  // and an unfinished call must survive that, and a reload.
  const startPendingCall = usePendingCalls((s) => s.start)
  const clearPendingCall = usePendingCalls((s) => s.clear)
  const callId = usePendingCall(target)?.callId ?? null
  const leftPage = useRef(false)
  const bookingVersion = target.kind === "booking" ? target.version ?? null : null

  useEffect(() => {
    if (callId === null) return
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leftPage.current = true
      if (document.visibilityState === "visible" && leftPage.current) setOutcomeOpen(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [callId])

  // Chỉ ẩn khi tài khoản không có quyền gọi (thu ngân, CSKH): với họ đây là
  // thao tác không tồn tại. Người có quyền thì luôn thấy nút.
  if (!allowedToCall) return null

  const start = async () => {
    setPending(true)
    try {
      const call = await api.startCall(target)
      startPendingCall(target, call.callId)
      setTelUri(call.telUri)
      leftPage.current = false
      // window.location thay cho thẻ <a> rời: thẻ chưa gắn vào document bị một
      // số WebView bỏ qua, cuộc gọi không mở mà lễ tân vẫn thấy "đang gọi".
      window.location.href = call.telUri
    } catch (error) {
      reportError(error)
    } finally {
      setPending(false)
    }
  }

  const record = async (outcome: Outcome) => {
    if (callId === null || pending) return
    setPending(true)
    try {
      await api.recordCallOutcome(
        target,
        callId,
        outcome,
        outcome === "LATE_CONFIRMED" && bookingVersion !== null ? bookingVersion : undefined,
      )
      setOutcomeOpen(false)
      clearPendingCall(target)
      setTelUri(null)
      leftPage.current = false
      toast.success(outcome === "LATE_CONFIRMED" ? "Đã ghi nhận khách sẽ tới muộn." : "Đã ghi kết quả cuộc gọi.")
      await queryClient.invalidateQueries()
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === "BOOKING_CALL_NOT_FOUND" || code === "BOOKING_CALL_OUTCOME_CONFLICT") {
        // The server has closed this call already - from another device, or an
        // earlier attempt whose reply never arrived. Nothing left to record.
        clearPendingCall(target)
        setOutcomeOpen(false)
        setTelUri(null)
      }
      reportError(error)
      await queryClient.invalidateQueries()
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {callId === null ? (
        <GuardedButton
          permission="booking.phone.call"
          type="button"
          variant="outline"
          className={cn(CALL_TONE, className)}
          disabled={pending}
          disabledReason={canCall ? null : "Khách này chưa có số điện thoại"}
          onClick={() => void start()}
        >
          <Smartphone /> {pending ? "Đang mở..." : (label ?? "Gọi khách")}
        </GuardedButton>
      ) : (
        <Button
          type="button"
          variant="outline"
          className={cn(CALL_TONE, className)}
          onClick={() => setOutcomeOpen(true)}
        >
          <Smartphone /> Ghi kết quả
        </Button>
      )}
      <Dialog open={outcomeOpen} onOpenChange={setOutcomeOpen}>
        <DialogContent aria-describedby="call-outcome-description">
          <DialogHeader>
            <DialogTitle>Kết quả cuộc gọi</DialogTitle>
            <DialogDescription id="call-outcome-description">
              Trình duyệt không thể biết cuộc gọi có kết nối hay không. Hãy chọn kết quả thực tế.
            </DialogDescription>
          </DialogHeader>
          {telUri ? (
            <a
              href={telUri}
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium"
            >
              <Smartphone className="size-4" /> Máy chưa mở trình gọi? Bấm để gọi lại
            </a>
          ) : null}
          <div className={bookingVersion === null ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-3"}>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void record("CONTACTED")}>
              <BadgeCheck /> Đã liên hệ
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void record("NO_ANSWER")}>
              <PhoneOff /> Không nghe máy
            </Button>
            {bookingVersion === null ? null : (
              <Button type="button" variant="outline" disabled={pending} onClick={() => void record("LATE_CONFIRMED")}>
                <TimerReset /> Tới muộn
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
