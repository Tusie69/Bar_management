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

type Outcome = "CONTACTED" | "NO_ANSWER" | "LATE_CONFIRMED"

function supportsDirectPhoneCall(): boolean {
  return /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent)
}

export function CallCustomerControl({
  bookingId,
  bookingVersion,
  canCall,
  className,
}: {
  bookingId: number
  bookingVersion: number
  canCall: boolean
  className?: string
}) {
  const allowedToRecord = useCan("booking.phone.reveal")
  const allowedToReveal = useCan("customer.phone.reveal")
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  const [callId, setCallId] = useState<number | null>(null)
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

  const canStartCall = canCall && allowedToRecord && allowedToReveal
  const hasPendingOutcome = callId !== null && allowedToRecord
  if (!canStartCall && !hasPendingOutcome) return null

  const start = async () => {
    if (!supportsDirectPhoneCall()) {
      toast.info("Thiết bị này không hỗ trợ gọi trực tiếp", {
        description: "Hãy mở chức năng này trên điện thoại có ứng dụng gọi.",
      })
      return
    }
    setPending(true)
    try {
      const call = await api.startBookingCall(bookingId)
      setCallId(call.callId)
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
        outcome === "LATE_CONFIRMED" ? bookingVersion : undefined,
      )
      setOutcomeOpen(false)
      setCallId(null)
      leftPage.current = false
      toast.success(outcome === "LATE_CONFIRMED" ? "Đã ghi nhận khách sẽ tới muộn." : "Đã ghi kết quả cuộc gọi.")
      await queryClient.invalidateQueries()
    } catch (error) {
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
          permission="customer.phone.reveal"
          type="button"
          variant="outline"
          className={className}
          disabled={pending}
          onClick={() => void start()}
        >
          <Phone /> {pending ? "Đang mở cuộc gọi..." : "Gọi khách"}
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
          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" variant="outline" disabled={pending} onClick={() => void record("CONTACTED")}>
              <BadgeCheck /> Đã liên hệ
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void record("NO_ANSWER")}>
              <PhoneOff /> Không nghe máy
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void record("LATE_CONFIRMED")}>
              <TimerReset /> Tới muộn
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
