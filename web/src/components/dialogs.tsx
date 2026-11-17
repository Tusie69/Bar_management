import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ShieldCheck } from "lucide-react"
import { useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { useUi } from "@/state/ui"

/** Global conflict dialog (409s): who changed what, and what to do next. */
export function ConflictDialog() {
  const qc = useQueryClient()
  const conflict = useUi((s) => s.conflict)
  const close = useUi((s) => s.closeConflict)
  const handleClose = () => {
    void qc.invalidateQueries()
    close()
  }
  return (
    <AlertDialog open={!!conflict} onOpenChange={(open) => !open && handleClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-1 grid size-11 place-items-center rounded-full bg-st-late-tint text-st-late">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle>{conflict?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] leading-relaxed text-foreground">
            {conflict?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict?.by ? (
          <p className="rounded-lg border border-border bg-surface-2/70 px-3.5 py-2.5 text-sm text-muted-foreground">
            Thay đổi gần nhất: <span className="font-medium text-foreground">{conflict.by}</span>
          </p>
        ) : null}
        {conflict?.hint ? <p className="text-sm text-muted-foreground">{conflict.hint}</p> : null}
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleClose}>Đã hiểu, xem dữ liệu mới</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * A yes/no the server asked for before it will write: over capacity, or a spare
 * table joining a cluster. The answer goes back as a confirmation flag and the
 * server checks it again, so dismissing this dialog genuinely saves nothing.
 */
export function ConfirmDialog() {
  const request = useUi((s) => s.confirmRequest)
  const resolve = useUi((s) => s.resolveConfirm)
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && resolve(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-1 grid size-11 place-items-center rounded-full bg-st-late-tint text-st-late">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] leading-relaxed text-foreground">
            {request?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" onClick={() => resolve(false)}>
            Hủy
          </AlertDialogCancel>
          <AlertDialogAction className="min-h-11" onClick={() => resolve(true)}>
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const OVERRIDE_QUICK = ["Khách quen, Chủ quán đồng ý", "Cuối tuần đông, mở bàn sơ cua", "Khách chấp nhận ngồi chật"]

/** Owner-only override reason (spare table, over capacity). */
export function OverrideDialog() {
  const req = useUi((s) => s.override)
  const resolve = useUi((s) => s.resolveOverride)
  const [lastNeeds, setLastNeeds] = useState("")
  const [sessionId, setSessionId] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)

  if (req && !wasOpen) {
    setWasOpen(true)
    setLastNeeds(req.needs)
    setSessionId((n) => n + 1)
  } else if (!req && wasOpen) {
    setWasOpen(false)
  }

  return (
    <Dialog open={!!req} onOpenChange={(open) => !open && resolve(null)}>
      <DialogContent>
        {lastNeeds ? <OverrideBody key={sessionId} needs={lastNeeds} resolve={resolve} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function OverrideBody({ needs, resolve }: { needs: string; resolve: (reason: string | null) => void }) {
  const [reason, setReason] = useState("")
  const invalid = noteHasPhoneNumber(reason)
  return (
    <>
      <DialogHeader>
        <div className="mb-1 grid size-11 place-items-center rounded-full border border-border-subtle bg-surface-2">
          <ShieldCheck className="size-5 text-primary-ink" aria-hidden />
        </div>
        <DialogTitle>Duyệt ngoại lệ</DialogTitle>
        <DialogDescription className="text-[0.9375rem] leading-relaxed text-foreground">{needs}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {OVERRIDE_QUICK.map((q) => (
          <Button key={q} type="button" size="sm" variant="outline" onClick={() => setReason(q)}>
            {q}
          </Button>
        ))}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="override-reason">Lý do (ghi vào nhật ký)</Label>
        <Textarea
          id="override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          aria-invalid={invalid}
        />
        {invalid ? (
          <p className="text-xs font-medium tracking-[0.008em] text-destructive" role="alert">
            {NOTE_PHONE_ERROR}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => resolve(null)}>
          Hủy
        </Button>
        <Button disabled={!reason.trim() || invalid} onClick={() => resolve(reason.trim())}>
          Duyệt và tiếp tục
        </Button>
      </DialogFooter>
    </>
  )
}

export interface ReasonOption {
  value: string
  label: string
}

interface ConfirmProps {
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  reasons?: ReasonOption[]
  requireNoteFor?: string
  onConfirm: (reason: string | null, note: string) => Promise<unknown> | void
  children?: ReactNode
}

/**
 * Confirmation for dangerous actions (cancel, release, no-show).
 * By policy (TH §1.6) there is no "don't ask again" option.
 */
export function ConfirmAction({
  open,
  onOpenChange,
  ...props
}: ConfirmProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [sessionId, setSessionId] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)

  if (open && !wasOpen) {
    setWasOpen(true)
    setSessionId((n) => n + 1)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {sessionId > 0 ? <ConfirmBody key={sessionId} {...props} close={() => onOpenChange(false)} /> : null}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ConfirmBody({
  title,
  description,
  confirmLabel,
  destructive = true,
  reasons,
  requireNoteFor,
  onConfirm,
  children,
  close,
}: ConfirmProps & { close: () => void }) {
  const [reason, setReason] = useState<string | null>(reasons?.[0]?.value ?? null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const noteInvalid = noteHasPhoneNumber(note)
  const needsNote = !!requireNoteFor && reason === requireNoteFor && !note.trim()
  return (
    <>
      <AlertDialogHeader>
        {destructive ? (
          <div className="mb-1 grid size-11 place-items-center rounded-full bg-st-late-tint text-st-late">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
        ) : null}
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {reasons ? (
        <RadioGroup value={reason ?? undefined} onValueChange={setReason} className="grid gap-1.5" aria-label="Lý do">
          {reasons.map((r) => (
            <Label
              key={r.value}
              htmlFor={`reason-${r.value}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-1 px-3.5 py-2 font-normal transition-colors duration-[var(--duration-press)] hover:bg-surface-2/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-tint"
            >
              <RadioGroupItem id={`reason-${r.value}`} value={r.value} />
              {r.label}
            </Label>
          ))}
        </RadioGroup>
      ) : null}
      {reasons ? (
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-note" className="text-muted-foreground">
            Ghi chú {requireNoteFor && reason === requireNoteFor ? "(bắt buộc)" : "(tùy chọn)"}
          </Label>
          <Textarea
            id="confirm-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteInvalid}
          />
          {noteInvalid ? (
            <p className="text-xs font-medium tracking-[0.008em] text-destructive" role="alert">
              {NOTE_PHONE_ERROR}
            </p>
          ) : null}
        </div>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel>Quay lại</AlertDialogCancel>
        <Button
          variant={destructive ? "destructive" : "default"}
          disabled={busy || noteInvalid || needsNote}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm(reason, note.trim())
              close()
            } finally {
              setBusy(false)
            }
          }}
        >
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
