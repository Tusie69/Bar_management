import { useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, Phone, PhoneOff, TimerReset } from "lucide-react"
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
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import { useCan } from "@/state/session"
import { usePendingCall, usePendingCalls } from "./pending-calls"

type Outcome = "CONTACTED" | "NO_ANSWER" | "LATE_CONFIRMED"

export function CallCustomerControl({
  bookingId,
  bookingVersion,
  canCall,
  className,
  label,
}: {
  bookingId: number
  /**
   * Version of the booking, required by the "Tới muộn" outcome because that
   * one also moves the reservation. Pass null where the screen does not hold
   * it - the waitlist knows the entry version, not the booking's - and the
   * outcome dialog then offers only the two that touch the call log alone,
   * rather than sending a version that would be refused.
   */
  bookingVersion: number | null
  canCall: boolean
  className?: string
  /** Defaults to "Gọi khách". */
  label?: string
}) {
  const allowedToCall = useCan("booking.phone.call")
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  // Kept outside the component: this sheet is closed and reopened constantly,
  // and an unfinished call must survive that, and a reload.
  const startPendingCall = usePendingCalls((s) => s.start)
  const clearPendingCall = usePendingCalls((s) => s.clear)
  const callId = usePendingCall(bookingId)?.callId ?? null
  const leftPage = useRef(false)

  useEffect(() => {
    if (callId === null) return
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leftPage.current = true
      if (document.visibilityState === "visible" && leftPage.current) setOutcomeOpen(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [callId])

  const canStartCall = canCall && allowedToCall
  const hasPendingOutcome = callId !== null && allowedToCall
  if (!canStartCall && !hasPendingOutcome) return null

  const start = async () => {
    setPending(true)
    try {
      const call = await api.startBookingCall(bookingId)
      startPendingCall(bookingId, call.callId)
      leftPage.current = false
      const link = document.createElement("a")
      link.href = call.telUri
      link.rel = "noreferrer"
      link.click()
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
      await api.recordBookingCallOutcome(
        bookingId,
        callId,
        outcome,
        outcome === "LATE_CONFIRMED" && bookingVersion !== null ? bookingVersion : undefined,
      )
      setOutcomeOpen(false)
      clearPendingCall(bookingId)
      leftPage.current = false
      toast.success(outcome === "LATE_CONFIRMED" ? "Đã ghi nhận khách sẽ tới muộn." : "Đã ghi kết quả cuộc gọi.")
      await queryClient.invalidateQueries()
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === "BOOKING_CALL_NOT_FOUND" || code === "BOOKING_CALL_OUTCOME_CONFLICT") {
        // The server has closed this call already - from another device, or an
        // earlier attempt whose reply never arrived. Nothing left to record.
        clearPendingCall(bookingId)
        setOutcomeOpen(false)
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
          className={className}
          disabled={pending}
          onClick={() => void start()}
        >
          <Phone /> {pending ? "Đang mở cuộc gọi..." : (label ?? "Gọi khách")}
        </GuardedButton>
      ) : (
        <Button type="button" variant="outline" className={className} onClick={() => setOutcomeOpen(true)}>
          <Phone /> Ghi kết quả cuộc gọi
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
