/**
 * Module Phục vụ 5 — một thẻ yêu cầu hủy trên hàng chờ phê duyệt.
 *
 * Tách khỏi trang để test render được: trang import `@/state/session`, và
 * module đó chạm `document` ngay khi được nạp, nên một test render không có DOM
 * sẽ chết trước khi vẽ được gì.
 */
import { Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { PREPARATION_LABEL, POLICY_LABEL, STATION_LABEL } from "@/features/waiter-menu/order-board-model"
import type { CancellationQueueEntry } from "@/features/waiter-menu/waiter-order-api"

function timeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export function CancellationCard({
  entry,
  note,
  busy,
  onNoteChange,
  onDecide,
}: {
  entry: CancellationQueueEntry
  note: string
  busy: boolean
  onNoteChange: (value: string) => void
  onDecide: (decision: "approve" | "reject") => void
}) {
  const waste = entry.policy === "READY_WASTE"
  return (
    <li className="grid gap-3 rounded-2xl border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            <span className="tnum">{entry.quantity}×</span> {entry.itemName}{" "}
            <span className="text-muted-foreground">({entry.variantDisplayName})</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={waste ? "destructive" : "secondary"}>{POLICY_LABEL[entry.policy]}</Badge>
            <span>
              Bàn {entry.tableCodes.join(" + ") || `#${entry.visitId}`} · đơn {entry.visitSequence} · dòng{" "}
              {entry.lineNo}
            </span>
            <span>{STATION_LABEL[entry.station]}</span>
            <span>{PREPARATION_LABEL[entry.ticketStatusAtRequest]} khi xin hủy</span>
          </div>
        </div>
        <strong className="tnum shrink-0">{formatVnd(entry.amountVnd)}</strong>
      </div>

      <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Lý do: </span>
        {entry.reason}
      </p>
      <p className="text-xs text-muted-foreground">
        {entry.requestedByDisplayName} xin lúc {timeLabel(entry.requestedAt)}
        {entry.decidedAt ? ` · ${entry.decidedByDisplayName ?? "—"} quyết định lúc ${timeLabel(entry.decidedAt)}` : ""}
      </p>
      {entry.decisionNote ? (
        <p className="text-xs text-muted-foreground">Ghi chú quyết định: {entry.decisionNote}</p>
      ) : null}

      {entry.status === "PENDING" ? (
        <div className="grid gap-2">
          <Input
            value={note}
            maxLength={200}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Ghi chú (không bắt buộc)"
            aria-label={`Ghi chú quyết định cho yêu cầu ${entry.cancellationId}`}
            className="h-11"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onDecide("reject")}>
              <X className="size-4" aria-hidden /> Từ chối
            </Button>
            <Button
              type="button"
              variant={waste ? "destructive" : "default"}
              disabled={busy}
              onClick={() => onDecide("approve")}
            >
              <Check className="size-4" aria-hidden /> {waste ? "Duyệt ghi hao" : "Duyệt hủy"}
            </Button>
          </div>
        </div>
      ) : (
        <Badge variant="outline" className="w-fit">
          {entry.status === "APPROVED" ? "Đã duyệt" : "Đã từ chối"}
        </Badge>
      )}
    </li>
  )
}
