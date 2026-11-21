/**
 * Module Phục vụ 5 — "Đơn của bàn".
 *
 * Màn này đọc `GET /waiter/visits/:visitId/orders`: đơn đi theo PHIÊN, không
 * theo bàn, nên đổi/ghép/tách bàn giữa tối không làm mất một đơn nào.
 *
 * Nó KHÔNG dựng lại tổng tiền từ danh mục hiện tại: mỗi đơn mang bản sao giá
 * tại lúc gửi, và đọc lại giá hôm nay sẽ hiện một con số khác với con số khách
 * đã nghe. Phần bị hủy nằm riêng khỏi tổng lúc gửi đơn, vì cả hai con số đều
 * cần đọc được: khách đã gọi bao nhiêu, và còn phải trả bao nhiêu.
 *
 * Phục vụ KHÔNG tự hủy món ở đây. Nút "Xin hủy món" tạo một yêu cầu có lý do;
 * quyết định nằm ở màn hàng chờ phê duyệt của người có quyền.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, ChevronDown, ReceiptText, RefreshCw } from "lucide-react"
import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { isApiError, newIdempotencyKey } from "@/services"
import { useCan, useSession } from "@/state/session"
import { formatVnd } from "./menu-price"
import { STATION_LABEL, orderBoardTotals, readyBadgeCount, readyNotificationsForVisit } from "./order-board-model"
import { CancelRequestDialog, OrderLineRow, ReadyBanner, type CancelRequestDraft } from "./order-board"
import {
  adjustOrderLineQuantity,
  fetchCancellationQueue,
  fetchReadyNotifications,
  fetchVisitOrders,
  fetchWaiterOrder,
  requestLineCancellation,
  type WaiterOrderLine,
  type WaiterOrderSummary,
} from "./waiter-order-api"

function submittedAtLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export default function WaiterOrdersPage() {
  const navigate = useNavigate()
  const params = useParams<{ visitId: string }>()
  const visitId = Number(params.visitId)
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const canAdjust = useCan("order.line.adjust")
  const canRequestCancel = useCan("order.cancel.request")
  const canRequestWaste = useCan("order.cancel.ready")
  const canApprove = useCan("order.cancel.approve")
  const validVisitId = Number.isSafeInteger(visitId) && visitId > 0
  const queryClient = useQueryClient()
  const [cancelTarget, setCancelTarget] = useState<{ line: WaiterOrderLine; orderId: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: ["waiter-orders", venueId, visitId],
    queryFn: () => fetchVisitOrders(visitId),
    enabled: validVisitId && venueId !== null,
    staleTime: 10_000,
    refetchInterval: 5_000,
  })
  const ready = useQuery({
    queryKey: ["ready-notifications", venueId],
    queryFn: fetchReadyNotifications,
    enabled: venueId !== null,
    staleTime: 10_000,
    // Món xong là tin cần tới trong vài giây, không phải sau khi nhân viên tự
    // bấm tải lại. Khoảng 20s đủ nhanh cho một quán và không làm nóng máy chủ.
    refetchInterval: 20_000,
  })
  const pendingApprovals = useQuery({
    queryKey: ["cancellation-queue", venueId, "PENDING"],
    queryFn: () => fetchCancellationQueue("PENDING"),
    enabled: canApprove && venueId !== null,
    staleTime: 10_000,
  })

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["waiter-orders", venueId, visitId] })
    void queryClient.invalidateQueries({ queryKey: ["waiter-order", venueId] })
    void queryClient.invalidateQueries({ queryKey: ["cancellation-queue", venueId, "PENDING"] })
  }

  const adjust = useMutation({
    mutationFn: (input: { line: WaiterOrderLine; orderId: number; quantity: number }) =>
      adjustOrderLineQuantity(input.orderId, input.line.lineNo, {
        expectedLineVersion: input.line.lineVersion,
        quantity: input.quantity,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      setActionError(null)
      refresh()
    },
    onError: (error: unknown) => {
      setActionError(isApiError(error) ? error.message : "Không sửa được số lượng. Tải lại đơn rồi thử lại.")
      refresh()
    },
  })

  const requestCancel = useMutation({
    mutationFn: (input: { draft: CancelRequestDraft; orderId: number }) =>
      requestLineCancellation(input.orderId, input.draft.line.lineNo, {
        expectedLineVersion: input.draft.line.lineVersion,
        quantity: input.draft.quantity,
        reason: input.draft.reason,
        ...(input.draft.acknowledgeWaste ? { acknowledgeWaste: true } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      setCancelTarget(null)
      setActionError(null)
      refresh()
    },
    onError: (error: unknown) => {
      setActionError(isApiError(error) ? error.message : "Không gửi được yêu cầu hủy.")
      refresh()
    },
  })

  if (!validVisitId || orders.isError) {
    const message = !validVisitId
      ? "Mã Phiên bàn không hợp lệ."
      : isApiError(orders.error)
        ? orders.error.message
        : "Không thể tải danh sách đơn."
    return (
      <section className="mx-auto grid max-w-md gap-4 p-6 text-center">
        <AlertCircle className="mx-auto size-9 text-destructive" aria-hidden />
        <div className="grid gap-1.5">
          <h1 className="text-lg font-semibold">Không mở được danh sách đơn</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => navigate("/phucvu")}>
            <ArrowLeft /> Về sơ đồ bàn
          </Button>
          {validVisitId ? (
            <Button onClick={() => void orders.refetch()}>
              <RefreshCw /> Thử lại
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  const view = orders.data
  const totals = orderBoardTotals(view)
  const visitReady = readyNotificationsForVisit(ready.data, visitId)
  return (
    <section className="mx-auto grid w-full max-w-3xl content-start gap-4 px-4 py-4 sm:px-5">
      <header className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          onClick={() => navigate("/phucvu")}
          aria-label="Quay lại sơ đồ bàn"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            Đơn của bàn · {view?.tableCodes.join(" + ") || `Phiên #${visitId}`}
          </h1>
          <p className="text-xs text-muted-foreground">
            {view ? `${totals.orderCount} đơn · còn phải trả ${formatVnd(totals.netAmountVnd)}` : "Đang tải"}
          </p>
        </div>
        {canApprove && (pendingApprovals.data?.pendingCount ?? 0) > 0 ? (
          <Button variant="outline" className="shrink-0" onClick={() => navigate("/duyet-huy-mon")}>
            Chờ duyệt
            <Badge variant="secondary" className="tnum ml-1">
              {pendingApprovals.data?.pendingCount}
            </Badge>
          </Button>
        ) : null}
      </header>

      <ReadyBanner count={readyBadgeCount(visitReady)} />

      {actionError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      {totals.hasCancellation ? (
        <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          Tổng đã gọi <strong className="tnum">{formatVnd(totals.totalAmountVnd)}</strong>, đã hủy{" "}
          <strong className="tnum">{formatVnd(totals.cancelledAmountVnd)}</strong>, còn phải trả{" "}
          <strong className="tnum">{formatVnd(totals.netAmountVnd)}</strong>.
        </p>
      ) : null}

      {orders.isPending ? (
        <div className="grid gap-3" aria-label="Đang tải danh sách đơn">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : view && view.orders.length > 0 ? (
        <ul className="grid gap-3">
          {view.orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              canAdjust={canAdjust}
              canRequestCancel={canRequestCancel}
              canRequestWaste={canRequestWaste}
              busy={adjust.isPending || requestCancel.isPending}
              onAdjust={(line, quantity) => adjust.mutate({ line, orderId: order.orderId, quantity })}
              onRequestCancel={(line) => {
                setActionError(null)
                if ((line.preparationStatus === "READY" || line.preparationStatus === "COLLECTED") && !canRequestWaste) {
                  setActionError("Bạn không có quyền ghi hao món đã làm xong. Hãy báo Thu ngân hoặc quản lý.")
                  return
                }
                setCancelTarget({ line, orderId: order.orderId })
              }}
            />
          ))}
        </ul>
      ) : (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border bg-surface-1 p-8 text-center">
          <div>
            <ReceiptText className="mx-auto size-8 text-subtle" aria-hidden />
            <h2 className="mt-3 font-semibold">Chưa có đơn nào cho Phiên này</h2>
            <p className="mt-1 text-sm text-muted-foreground">Gọi món từ danh mục để tạo đơn đầu tiên.</p>
          </div>
        </div>
      )}

      <CancelRequestDialog
        line={
          cancelTarget &&
          canRequestCancel &&
          ((cancelTarget.line.preparationStatus !== "READY" && cancelTarget.line.preparationStatus !== "COLLECTED") ||
            canRequestWaste)
            ? cancelTarget.line
            : null
        }
        submitting={requestCancel.isPending}
        errorMessage={actionError}
        onCancel={() => setCancelTarget(null)}
        onSubmit={(draft) => {
          if (!cancelTarget) return
          if (draft.acknowledgeWaste && !canRequestWaste) {
            setCancelTarget(null)
            setActionError("Bạn không có quyền ghi hao món đã làm xong. Hãy báo Thu ngân hoặc quản lý.")
            return
          }
          // `lineNo` chỉ duy nhất TRONG một đơn — hai đơn của cùng bàn đều có
          // dòng số 1 — nên mã đơn được giữ cùng dòng từ lúc mở hộp.
          requestCancel.mutate({ draft, orderId: cancelTarget.orderId })
        }}
      />
    </section>
  )
}

function OrderCard({
  order,
  canAdjust,
  canRequestCancel,
  canRequestWaste,
  busy,
  onAdjust,
  onRequestCancel,
}: {
  order: WaiterOrderSummary
  canAdjust: boolean
  canRequestCancel: boolean
  canRequestWaste: boolean
  busy: boolean
  onAdjust: (line: WaiterOrderLine, quantity: number) => void
  onRequestCancel: (line: WaiterOrderLine) => void
}) {
  const [open, setOpen] = useState(false)
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const detail = useQuery({
    queryKey: ["waiter-order", venueId, order.orderId],
    queryFn: () => fetchWaiterOrder(order.orderId),
    enabled: open,
    staleTime: 5_000,
    refetchInterval: open ? 5_000 : false,
  })

  return (
    <li className="rounded-2xl border border-border bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Đơn {order.visitSequence}</Badge>
            <span className="text-sm text-muted-foreground">{submittedAtLabel(order.submittedAt)}</span>
            {order.stations.map((station) => (
              <span key={station} className="text-xs text-muted-foreground">
                {STATION_LABEL[station]}
              </span>
            ))}
            {order.cancelledItemCount > 0 ? <Badge variant="outline">Đã hủy {order.cancelledItemCount}</Badge> : null}
          </div>
          <p className="mt-1.5 text-sm">
            {order.itemCount - order.cancelledItemCount} món ·{" "}
            <strong className="tnum">{formatVnd(order.netAmountVnd)}</strong>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Người gọi: {order.orderedByDisplayName}</p>
        </div>
        <ChevronDown className={`mt-1 size-5 shrink-0 text-subtle ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        detail.isPending ? (
          <Skeleton className="m-4 h-16" />
        ) : detail.isError ? (
          <p className="px-4 pb-4 text-sm text-destructive">
            {isApiError(detail.error) ? detail.error.message : "Không tải được chi tiết đơn."}
          </p>
        ) : (
          <ul className="border-t border-border">
            {(detail.data?.lines ?? []).map((line) => (
              <OrderLineRow
                key={line.lineNo}
                line={line}
                canAdjust={canAdjust}
                canRequestCancel={canRequestCancel}
                canRequestWaste={canRequestWaste}
                busy={busy}
                onAdjust={onAdjust}
                onRequestCancel={onRequestCancel}
              />
            ))}
          </ul>
        )
      ) : null}
    </li>
  )
}
