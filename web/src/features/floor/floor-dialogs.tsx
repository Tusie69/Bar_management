/**
 * Small task dialogs. Each body mounts only while open, so its local state
 * starts fresh from props every time (no reset effects).
 */
import { useState } from "react"
import { QuickCounts, Stepper } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { fmtTime, MS } from "@/lib/time"

function useBusy() {
  const [busy, setBusy] = useState(false)
  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return [busy, wrap] as const
}

/* ---------------- guest count ---------------- */

interface GuestCountProps {
  title: string
  description: React.ReactNode
  initial: number
  readOnly?: boolean
  confirmLabel: string
  onConfirm: (count: number) => Promise<unknown>
}

export function GuestCountDialog({
  open,
  onOpenChange,
  ...props
}: GuestCountProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <GuestCountBody {...props} onCancel={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function GuestCountBody({
  title,
  description,
  initial,
  readOnly = false,
  confirmLabel,
  onConfirm,
  onCancel,
}: GuestCountProps & { onCancel: () => void }) {
  const isReadOnly = readOnly || /check-in/i.test(title)
  const [count, setCount] = useState(initial)
  const [busy, run] = useBusy()
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="text-[15px] text-muted-foreground">{description}</div>
        </DialogDescription>
      </DialogHeader>
      {isReadOnly ? (
        <div className="grid gap-1.5 py-1">
          <Label>Số khách</Label>
          <div className="flex items-center justify-between rounded-xl border bg-surface-2 px-3.5 py-2.5 text-sm">
            <span className="font-semibold text-foreground">{initial} khách</span>
            <span className="text-xs text-muted-foreground">Đổi số khách cần sửa booking trước</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <Label>Số khách thực tế</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Stepper value={count} onChange={setCount} label="số khách" max={60} />
            <QuickCounts value={count} onChange={setCount} options={[1, 2, 3, 4, 6, 8]} />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Quay lại
        </Button>
        <Button disabled={busy} onClick={() => run(() => onConfirm(isReadOnly ? initial : count))}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  )
}

/* ---------------- split ---------------- */

interface SplitProps {
  tables: { id: number; label: string }[]
  onConfirm: (keepIds: number[]) => Promise<unknown>
}

export function SplitDialog({
  open,
  onOpenChange,
  ...props
}: SplitProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <SplitBody {...props} onCancel={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function SplitBody({ tables, onConfirm, onCancel }: SplitProps & { onCancel: () => void }) {
  const [keep, setKeep] = useState<number[]>(() => tables.map((t) => t.id))
  const [busy, run] = useBusy()
  const released = tables.filter((t) => !keep.includes(t.id))
  return (
    <>
      <DialogHeader>
        <DialogTitle>Tách bàn</DialogTitle>
        <DialogDescription>
          Ký hiệu ghép sẽ biến mất. Chọn bàn giữ lại cho đoàn khách; bàn bỏ chọn sẽ được nhả. Lịch sử sử dụng vẫn được
          giữ.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        {tables.map((t) => (
          <Label
            key={t.id}
            htmlFor={`keep-${t.id}`}
            className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 font-normal has-[[data-state=checked]]:bg-surface-2"
          >
            <Checkbox
              id={`keep-${t.id}`}
              checked={keep.includes(t.id)}
              onCheckedChange={(v) => setKeep((k) => (v ? [...k, t.id] : k.filter((x) => x !== t.id)))}
            />
            <span className="font-semibold">{t.label}</span>
            <span className="ml-auto text-sm text-muted-foreground">
              {keep.includes(t.id) ? "Giữ cho đoàn" : "Nhả bàn"}
            </span>
          </Label>
        ))}
      </div>
      {keep.length === 0 ? (
        <p className="text-sm text-destructive">Giữ ít nhất một bàn. Muốn trả hết bàn hãy dùng Nhả bàn.</p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Quay lại
        </Button>
        <Button disabled={busy || keep.length === 0} onClick={() => run(() => onConfirm(keep))}>
          {released.length ? `Tách và nhả ${released.map((t) => t.label).join(", ")}` : "Bỏ ký hiệu ghép"}
        </Button>
      </DialogFooter>
    </>
  )
}

/* ---------------- extend hold ---------------- */

interface ExtendProps {
  deadline: Date
  onConfirm: (deadline: Date, reason: string) => Promise<unknown>
}

export function ExtendHoldDialog({
  open,
  onOpenChange,
  ...props
}: ExtendProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <ExtendBody {...props} onCancel={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function ExtendBody({ deadline, onConfirm, onCancel }: ExtendProps & { onCancel: () => void }) {
  const [minutes, setMinutes] = useState(15)
  const [reason, setReason] = useState("")
  const [busy, run] = useBusy()
  const next = new Date(deadline.getTime() + minutes * MS.MIN)
  const invalid = noteHasPhoneNumber(reason)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Gia hạn giữ bàn</DialogTitle>
        <DialogDescription>
          Hạn hiện tại {fmtTime(deadline)}. Gia hạn là thỏa thuận với khách (NEGOTIATED) và được ghi nhật ký.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Thêm thời gian">
        {[10, 15, 30, 45].map((m) => (
          <Button
            key={m}
            type="button"
            role="radio"
            aria-checked={minutes === m}
            variant={minutes === m ? "default" : "outline"}
            onClick={() => setMinutes(m)}
          >
            +{m}'
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Hạn mới: <span className="text-foreground">{fmtTime(next)}</span>
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="extend-reason">Lý do</Label>
        <Textarea
          id="extend-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: khách báo kẹt xe, tới trễ 15 phút"
          aria-invalid={invalid}
        />
        {invalid ? <p className="text-sm text-destructive">{NOTE_PHONE_ERROR}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Quay lại
        </Button>
        <Button disabled={busy || !reason.trim() || invalid} onClick={() => run(() => onConfirm(next, reason.trim()))}>
          Gia hạn đến {fmtTime(next)}
        </Button>
      </DialogFooter>
    </>
  )
}
