import { AlertTriangle, Check } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { useEffect, useId, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CANCEL_REASONS, type BookingCancelReason } from "@/domain/enums"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { CANCEL_NOTE_MAX_LENGTH, DEFAULT_CANCEL_REASON, validateCancelBookingInput } from "./cancel-booking"
import { useM, type CancelBookingRequest } from "./context"
import { useRestoreTriggerFocus } from "./overlay-focus"

export function CancelBookingDialog({ req, onClose }: { req: CancelBookingRequest | null; onClose: () => void }) {
  const m = useM()
  const isReceptionist = m.role === "RECEPTIONIST"
  const focus = useRestoreTriggerFocus(Boolean(req))
  const contentRef = useRef<HTMLDivElement>(null)
  const reasonLabelId = useId()
  const noteId = useId()
  const noteHelpId = useId()

  const [cachedReq, setCachedReq] = useState<CancelBookingRequest | null>(req)
  const [reason, setReason] = useState<BookingCancelReason>(DEFAULT_CANCEL_REASON)
  const [note, setNote] = useState("")
  const [inProgress, setInProgress] = useState(false)

  if (req && req !== cachedReq) {
    setCachedReq(req)
    setReason(DEFAULT_CANCEL_REASON)
    setNote("")
    if (inProgress) setInProgress(false)
  }

  // Allow scrim clicks to dismiss without cancelling while keeping AlertDialog semantics.
  useEffect(() => {
    if (!req || inProgress || typeof document === "undefined") return
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.getAttribute("data-slot") !== "alert-dialog-overlay") return
      if (contentRef.current && target.parentElement === contentRef.current.parentElement) {
        onClose()
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [inProgress, onClose, req])

  const active = req ?? cachedReq
  const r = active?.reservation
  const validation = validateCancelBookingInput(reason, note)
  const charCount = note.length
  const nearLimit = charCount >= CANCEL_NOTE_MAX_LENGTH - 20

  return (
    <AlertDialog
      open={Boolean(req)}
      onOpenChange={(next) => {
        if (!next && !inProgress) onClose()
      }}
    >
      <AlertDialogContent
        ref={contentRef}
        data-gm
        data-gm-overlay-id={focus.overlayId}
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        aria-label={r ? `Hủy booking của ${r.displayName}` : "Hủy booking"}
        className="inset-x-0 top-3 bottom-[calc(var(--kb-inset,0px)+12px)] mx-auto my-auto h-fit max-h-[calc(100dvh-var(--kb-inset,0px)-24px)] w-[min(calc(100%-2rem),420px)] max-w-[min(calc(100%-2rem),420px)] translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border-border bg-surface-1 p-0 shadow-[var(--shadow-float)] sm:max-w-[420px]"
      >
        <AlertDialogHeader className="px-5 pt-4 pb-2.5 sm:pt-5 sm:pb-3">
          <AlertDialogMedia className="size-10 rounded-xl bg-st-late-tint text-st-late-ink sm:size-11">
            <AlertTriangle className="size-5" aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
            {r ? `Hủy booking của ${r.displayName}?` : "Hủy booking?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13.5px] leading-snug text-pretty text-[var(--text-muted)] sm:text-[14px] sm:leading-relaxed">
            {r
              ? `Booking ${fmtTime(r.expectedAt)} (${r.partySize} khách). Bàn đang giữ sẽ được nhả và ghi vào nhật ký.`
              : "Booking bị hủy và bàn được nhả. Thao tác được ghi vào nhật ký."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-0 scroll-pt-8 space-y-3 overflow-y-auto px-5 py-2">
          <div className="space-y-2">
            <span id={reasonLabelId} className="block text-[13px] font-medium tracking-[0.005em] text-tx-1">
              Lý do hủy
            </span>
            <RadioGroupPrimitive.Root
              value={reason}
              onValueChange={(value) => setReason(value as BookingCancelReason)}
              aria-labelledby={reasonLabelId}
              className="flex flex-wrap gap-2"
            >
              {CANCEL_REASONS.map((opt) => {
                const selected = reason === opt.value
                return (
                  <RadioGroupPrimitive.Item
                    key={opt.value}
                    value={opt.value}
                    disabled={inProgress}
                    className={cn(
                      "gm-press inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition-[background-color,border-color,color,box-shadow,transform] outline-none",
                      "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25",
                      "disabled:pointer-events-none disabled:opacity-45",
                      selected
                        ? "border-primary bg-primary-tint font-semibold text-primary-ink shadow-[var(--shadow-xs)]"
                        : "border-border bg-surface-2/65 font-medium text-tx-1 hover:border-border-strong hover:bg-surface-2",
                    )}
                  >
                    {selected ? <Check className="size-3.5 shrink-0" strokeWidth={2.4} aria-hidden /> : null}
                    <span>{opt.label}</span>
                  </RadioGroupPrimitive.Item>
                )
              })}
            </RadioGroupPrimitive.Root>
          </div>

          <div className="space-y-1.5 pb-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={noteId} className="text-tx-1">
                Ghi chú {reason === "OTHER" ? "(bắt buộc)" : "(tùy chọn)"}
              </Label>
              <span
                className={cn(
                  "tnum text-xs font-medium",
                  validation.tooLong ? "text-destructive" : nearLimit ? "text-st-late-ink" : "text-[var(--text-muted)]",
                )}
              >
                {charCount}/{CANCEL_NOTE_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id={noteId}
              rows={2}
              maxLength={CANCEL_NOTE_MAX_LENGTH}
              disabled={inProgress}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={reason === "OTHER" ? "Nhập lý do hủy cụ thể..." : "Ví dụ: Khách báo bận đột xuất"}
              aria-invalid={Boolean(validation.error) || undefined}
              aria-describedby={validation.error || validation.missingRequiredNote ? noteHelpId : undefined}
              className="min-h-[76px] resize-none rounded-xl border-border-strong bg-background text-base md:text-sm"
            />
            {validation.error ? (
              <p id={noteHelpId} role="alert" className="text-xs font-medium text-destructive">
                {validation.error}
              </p>
            ) : validation.missingRequiredNote ? (
              <p id={noteHelpId} className="text-xs text-[var(--text-muted)]">
                Vui lòng nhập ghi chú khi chọn Lý do khác.
              </p>
            ) : null}
          </div>
        </div>

        <AlertDialogFooter className="grid grid-cols-2 gap-2.5 border-t border-border/70 bg-surface-1 px-5 pt-3 pb-4">
          <AlertDialogCancel
            disabled={inProgress}
            onClick={onClose}
            className="h-12 rounded-xl border-border-strong text-[15px] font-medium"
          >
            Quay lại
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={inProgress || !validation.canSubmit}
            onClick={(event) => {
              event.preventDefault()
              if (inProgress || !active || !validation.canSubmit) return
              setInProgress(true)
              void active.run(reason, validation.trimmedNote).finally(() => {
                setInProgress(false)
                onClose()
              })
            }}
            className="h-12 rounded-xl text-[15px] font-semibold"
          >
            Hủy booking
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
