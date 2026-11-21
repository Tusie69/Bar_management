/**
 * Module Phục vụ (v1.1) — PV-20: chuông thông báo kết quả duyệt hủy.
 *
 * Mockup P15. Thẻ nói đủ những gì Phục vụ cần để quay lại bàn trả lời khách:
 * đơn nào, bàn nào, bao nhiêu món, bao nhiêu tiền, ai duyệt, lúc mấy giờ, lý
 * do đã gửi và ghi chú của người duyệt. Bị từ chối dùng cùng mẫu, thẻ đỏ.
 *
 * Chuông gộp HAI nguồn: "món đã xong" của Module 4 và tin duyệt hủy ở đây. Hai
 * cái chuông cạnh nhau là hai cái không ai nhìn.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, Check, CircleX } from "lucide-react"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { readyBadgeCount } from "@/features/waiter-menu/order-board-model"
import {
  acknowledgeStaffNotification,
  fetchReadyNotifications,
  fetchStaffNotifications,
  type StaffNotification,
} from "@/features/waiter-menu/waiter-order-api"
import { cn } from "@/lib/utils"
import { useSession } from "@/state/session"
import { waiterOrdersViewPath } from "./waiter-access"

function decidedAtLabel(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export function CancellationDecisionCard({
  notification,
  onOpen,
  onAcknowledge,
  busy,
}: {
  notification: StaffNotification
  onOpen: () => void
  onAcknowledge: () => void
  busy: boolean
}) {
  const approved = notification.decision === "APPROVED"
  const scope = notification.cancellationGroupId === null ? "món" : "cả đơn"
  const table = notification.tableCodes.join(" + ") || "—"
  const order = notification.visitSequence === null ? "" : `Đơn ${notification.visitSequence} · `
  return (
    <li
      className={cn(
        "grid gap-1.5 rounded-xl border px-3 py-2.5 text-sm",
        approved ? "border-border bg-surface-1" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <p className="flex items-start gap-2 font-semibold">
        {approved ? (
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        )}
        <span className={approved ? undefined : "text-destructive"}>
          {`${approved ? "Đã duyệt hủy" : "Từ chối hủy"} ${scope} · ${order}${table}`}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        {`${notification.quantity} phần · ${formatVnd(notification.amountVnd)}`}
        {notification.wasteQuantity > 0 ? ` · ghi hao ${notification.wasteQuantity} phần` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        {`${notification.decidedByDisplayName ?? "—"} · ${decidedAtLabel(notification.decidedAt)}`}
      </p>
      {notification.reason ? (
        <p className="text-xs text-muted-foreground">{`Lý do đã gửi: ${notification.reason}`}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {`Ghi chú duyệt: ${notification.decisionNote?.trim() || "Không có ghi chú."}`}
      </p>
      {!approved ? (
        <p className="text-xs font-medium text-destructive">Hãy báo lại khách rằng yêu cầu hủy không được duyệt.</p>
      ) : null}
      <div className="flex gap-2">
        {notification.visitId !== null ? (
          <Button type="button" variant="outline" size="sm" className="h-9 flex-1" onClick={onOpen}>
            Mở bàn
          </Button>
        ) : null}
        <Button type="button" size="sm" className="h-9 flex-1" disabled={busy} onClick={onAcknowledge}>
          Đã đọc
        </Button>
      </div>
    </li>
  )
}

export function WaiterNotificationsButton() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const venueId = useSession((state) => state.principal?.venueId ?? null)

  const ready = useQuery({
    queryKey: ["ready-notifications", venueId],
    queryFn: fetchReadyNotifications,
    enabled: venueId !== null,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
  const decisions = useQuery({
    queryKey: ["staff-notifications", venueId],
    queryFn: fetchStaffNotifications,
    enabled: venueId !== null,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })

  const acknowledge = useMutation({
    mutationFn: (notificationId: number) => acknowledgeStaffNotification(notificationId),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["staff-notifications", venueId] }),
  })

  const readyPending = (ready.data ?? []).filter((entry) => entry.acknowledgedAt === null)
  const decisionList = decisions.data ?? []
  const count = readyBadgeCount(ready.data) + decisionList.length
  const firstReady = readyPending[0]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count === 0 ? "Thông báo: chưa có gì mới" : `Thông báo: ${count} tin chưa đọc`}
        >
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 ? (
            <span className="tnum absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-y-auto">
        {count === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">Chưa có thông báo nào.</p>
        ) : (
          <ul className="grid gap-2">
            {firstReady ? (
              <li className="grid gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm">
                <p className="font-semibold">{`${readyBadgeCount(ready.data)} phiếu món đã xong`}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() => navigate(waiterOrdersViewPath(firstReady.visitId))}
                >
                  Mở bàn mới nhất
                </Button>
              </li>
            ) : null}
            {decisionList.map((notification) => (
              <CancellationDecisionCard
                key={notification.notificationId}
                notification={notification}
                busy={acknowledge.isPending}
                onOpen={() =>
                  notification.visitId !== null && navigate(waiterOrdersViewPath(notification.visitId))
                }
                onAcknowledge={() => acknowledge.mutate(notification.notificationId)}
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
