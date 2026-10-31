import { Eye, EyeOff, Lock } from "lucide-react"
import { useState } from "react"
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
import { reportError } from "@/hooks/use-action"
import { maskedPhone } from "@/lib/text"
import { api } from "@/services"
import { useCan } from "@/state/session"

const REASONS = [
  { value: "CALLBACK", label: "Gọi lại cho khách trong danh sách chờ" },
  { value: "CONFIRM_BOOKING", label: "Xác nhận booking" },
  { value: "SERVICE_ISSUE", label: "Xử lý sự cố phục vụ" },
]

/**
 * db08: only OWNER_ADMIN may reveal a full number, with a reason, audited as
 * CUSTOMER_PHONE_REVEALED. The number lives only in this component's state
 * (never in URL, storage or query cache) and is gone on unmount. Callers key
 * this component by customer id so a number never leaks across customers.
 */
export function RevealPhone({
  customerId,
  last3,
  context,
}: {
  customerId: number | null
  last3: string | null
  context?: { reservationId?: number; entryId?: number }
}) {
  const allowed = useCan("customer.phone.reveal")
  const canReveal = allowed && (api.mode === "http" ? !!context?.reservationId : !!customerId)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REASONS[0].value)
  const [phone, setPhone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!last3) return <span className="text-sm text-subtle">Không có SĐT</span>

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tnum text-sm">{phone ? formatVn(phone) : maskedPhone(last3)}</span>
      {canReveal ? (
        phone ? (
          <Button variant="ghost" size="xs" onClick={() => setPhone(null)}>
            <EyeOff /> Ẩn
          </Button>
        ) : (
          <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
            <Eye /> Xem số
          </Button>
        )
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-subtle" title="Chỉ Chủ quán xem được số đầy đủ">
          <Lock className="size-3" /> 3 số cuối
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xem số điện thoại đầy đủ</DialogTitle>
            <DialogDescription>
              Thao tác được ghi nhật ký (CUSTOMER_PHONE_REVEALED). Số chỉ hiện trong phiên này, không lưu trên máy.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={setReason} className="grid gap-1" aria-label="Lý do">
            {REASONS.map((r) => (
              <Label
                key={r.value}
                htmlFor={`rv-${r.value}`}
                className="flex h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-surface-2"
              >
                <RadioGroupItem id={`rv-${r.value}`} value={r.value} />
                {r.label}
              </Label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const targetId = api.mode === "http" ? context!.reservationId! : customerId!
                  const res = await api.revealPhone(targetId, reason, context ?? {})
                  setPhone(res.phoneE164)
                  setOpen(false)
                } catch (e) {
                  reportError(e)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Xem số
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  )
}

function formatVn(e164: string) {
  const local = e164.startsWith("+84") ? `0${e164.slice(3)}` : e164
  return local.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3")
}
