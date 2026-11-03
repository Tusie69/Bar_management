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
          <div className="mb-1 grid size-10 place-items-center rounded-full bg-st-late-tint text-st-late">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle>{conflict?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] leading-relaxed text-foreground">
            {conflict?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict?.by ? (
          <p className="rounded-lg border bg-surface-1 px-3 py-2 text-sm text-muted-foreground">
            Thay đổi gần nhất: <span className="text-foreground">{conflict.by}</span>
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

const OVERRIDE_QUICK = ["Khách quen, Chủ quán đồng ý", "Cuối tuần đông, mở bàn sơ cua", "Khách chấp nhận ngồi chật"]

/** Owner-only override reason (spare table, over capacity). */
export function OverrideDialog() {
  const req = useUi((s) => s.override)
  const resolve = useUi((s) => s.resolveOverride)
  return (
    <Dialog open={!!req} onOpenChange={(open) => !open && resolve(null)}>
      <DialogContent>{req ? <OverrideBody needs={req.needs} resolve={resolve} /> : null}</DialogContent>
    </Dialog>
  )
}

function OverrideBody({ needs, resolve }: { needs: string; resolve: (reason: string | null) => void }) {
  const [reason, setReason] = useState("")
  const invalid = noteHasPhoneNumber(reason)
  return (
    <>
      <DialogHeader>
        <div className="mb-1 grid size-10 place-items-center rounded-full bg-surface-3">
          <ShieldCheck className="size-5" aria-hidden />
        </div>
        <DialogTitle>Duyệt ngoại lệ</DialogTitle>
        <DialogDescription className="text-[15px] text-foreground">{needs}</DialogDescription>
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
        {invalid ? <p className="text-sm text-destructive">{NOTE_PHONE_ERROR}</p> : null}
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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {open ? <ConfirmBody {...props} close={() => onOpenChange(false)} /> : null}
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
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="text-[15px] leading-relaxed text-muted-foreground">{description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {reasons ? (
        <RadioGroup value={reason ?? undefined} onValueChange={setReason} className="grid gap-1" aria-label="Lý do">
          {reasons.map((r) => (
            <Label
              key={r.value}
              htmlFor={`reason-${r.value}`}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-surface-2"
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
          {noteInvalid ? <p className="text-sm text-destructive">{NOTE_PHONE_ERROR}</p> : null}
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
