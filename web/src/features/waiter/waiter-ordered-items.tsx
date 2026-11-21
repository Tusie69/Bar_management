/**
 * Module Phục vụ 1 (v1.1) — "Món đã gọi" và nút "+" trên bảng thao tác bàn.
 *
 * Thay cho nút "Xem đơn đã gọi": thứ Phục vụ cần khi mở một bàn là danh sách
 * món đang có trên bàn, không phải một nút dẫn sang màn khác rồi quay lại.
 *
 * Hai luật quan trọng hơn vẻ ngoài:
 *
 * 1. Giỏ gọi thêm chỉ trống SAU khi máy chủ trả về đơn. Lỗi giữ nguyên giỏ,
 *    và câu lỗi hiện ngay trên nút gửi.
 * 2. Một lần bấm = một đơn. `submittingRef` chặn cú bấm thứ hai trước khi
 *    React kịp render lại; mã chống trùng lo phần còn lại ở máy chủ.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2, Plus, ReceiptText } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { fetchVisitItems, type WaiterVisitItem } from "@/features/waiter-menu/waiter-order-api"
import { submitWaiterOrder } from "@/features/waiter-menu/waiter-order-api"
import { isApiError, newIdempotencyKey } from "@/services"
import { useSession } from "@/state/session"
import { cn } from "@/lib/utils"
import {
  addReorder,
  reorderBlockedReason,
  reorderItemCount,
  reorderKey,
  reorderLines,
  reorderPayload,
  reorderPriceChange,
  reorderSummary,
  reorderTotalVnd,
  type ReorderDraft,
} from "./reorder-model"

export const waiterVisitItemsKey = (venueId: number | null, visitId: number) =>
  ["waiter-visit-items", venueId, visitId] as const

/**
 * Món đã gọi của một Phiên.
 *
 * Bảng thao tác gọi hook này hai lần — một lần để vẽ danh sách, một lần để
 * biết có nên hiện nút "In bill tạm tính" hay không. TanStack Query gộp hai
 * lời gọi cùng khoá thành MỘT request, nên đây không phải là tải hai lần; đổi
 * lại, "bàn đã có đơn chưa" chỉ có một nguồn trả lời.
 */
export function useVisitItems(visitId: number | null) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  return useQuery({
    queryKey: waiterVisitItemsKey(venueId, visitId ?? 0),
    queryFn: () => fetchVisitItems(visitId as number),
    enabled: visitId !== null,
    staleTime: 10_000,
  })
}

function ItemRow({
  item,
  added,
  disabled,
  onAdd,
  onOpenOrders,
}: {
  item: WaiterVisitItem
  added: number
  disabled: boolean
  onAdd: () => void
  onOpenOrders: () => void
}) {
  const blocked = reorderBlockedReason(item)
  const priceChange = reorderPriceChange(item)
  const detail = [item.variantDisplayName, item.preparationStation === "KITCHEN" ? "Bếp" : null]
    .filter(Boolean)
    .join(" · ")
  return (
    <li className="flex items-start gap-3 border-t border-border-subtle py-2.5 first:border-t-0">
      {/*
        Chạm giữ mở màn Đơn của bàn, nơi có Xin hủy món và Xin ghi hao (V6).
        Nút "Xem chi tiết đơn" ở cuối danh sách là đường vào nhìn thấy được;
        chạm giữ chỉ là lối tắt, vì không ai tự đoán ra một cử chỉ.
      */}
      <button
        type="button"
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenOrders()
        }}
        onClick={onOpenOrders}
        className="min-w-0 flex-1 text-left"
      >
        <p className="text-sm font-semibold text-foreground">
          <span className="tnum">{item.quantity}×</span> {item.itemName}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detail} · <span className="tnum">{formatVnd(item.unitPriceVnd)}</span>
          {item.note ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">{item.note}</span> : null}
        </p>
        {blocked ? <p className="mt-1 text-xs text-destructive">{blocked}</p> : null}
        {priceChange ? (
          <p className="mt-1 text-xs text-amber-700">
            Giá mới <span className="tnum font-semibold">{formatVnd(priceChange.to)}</span> — gọi thêm sẽ tính giá này.
          </p>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {added > 0 ? (
          <span className="tnum rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary-ink">
            +{added}
          </span>
        ) : null}
        <Button
          type="button"
          size="icon"
          className="size-11"
          disabled={disabled || blocked !== null}
          aria-label={`Gọi thêm một phần ${item.itemName}${item.note ? ` (${item.note})` : ""}`}
          onClick={onAdd}
        >
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
    </li>
  )
}

export interface WaiterOrderedItemsProps {
  visitId: number
  /** Quyền `order.create`: không có thì danh sách chỉ để đọc. */
  canOrder: boolean
  /** Mở màn "Đơn của bàn" — nơi có Xin hủy món và Xin ghi hao. */
  onOpenOrders: () => void
}

export function WaiterOrderedItems({ visitId, canOrder, onOpenOrders }: WaiterOrderedItemsProps) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ReorderDraft>({})
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const items = useVisitItems(visitId)

  const lines = reorderLines(draft, items.data?.items ?? [])
  const count = reorderItemCount(lines)

  const submit = useMutation({
    mutationFn: () => submitWaiterOrder(reorderPayload({ visitId, idempotencyKey: newIdempotencyKey(), lines })),
    onSuccess: () => {
      // Thứ tự quan trọng: xoá giỏ CHỈ sau khi có đơn thật trong tay.
      setDraft({})
      setError(null)
      void queryClient.invalidateQueries({ queryKey: waiterVisitItemsKey(venueId, visitId) })
      void queryClient.invalidateQueries({ queryKey: ["waiter-orders", venueId, visitId] })
      void queryClient.invalidateQueries({ queryKey: ["waiter-floor"] })
    },
    onError: (cause: unknown) => {
      setError(isApiError(cause) ? cause.message : "Không gửi được. Giỏ vẫn được giữ, thử lại sau.")
      void queryClient.invalidateQueries({ queryKey: waiterVisitItemsKey(venueId, visitId) })
    },
    onSettled: () => {
      submittingRef.current = false
    },
  })

  if (items.isPending) {
    return (
      <section className="grid gap-2" aria-label="Đang tải món đã gọi">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16" />
      </section>
    )
  }

  if (items.isError) {
    // Bản demo không có đơn và nói thẳng điều đó, thay vì hiện một lỗi đỏ ở
    // mọi bàn và làm người xem demo tưởng hệ thống đang hỏng.
    if (isApiError(items.error) && items.error.code === "ORDER_REQUIRES_HTTP") {
      return (
        <p className="rounded-lg border border-dashed border-border bg-surface-1 p-3 text-sm text-muted-foreground">
          Bản demo không tạo đơn, nên chưa có món nào để liệt kê.
        </p>
      )
    }
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>
          Không tải được món đã gọi.{" "}
          <button type="button" className="underline" onClick={() => void items.refetch()}>
            Thử lại
          </button>
        </span>
      </p>
    )
  }

  const view = items.data
  if (!view || view.items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-1 p-3 text-sm text-muted-foreground">
        Bàn chưa gọi món nào. Bấm <strong className="text-foreground">Gọi món</strong> để lên đơn đầu tiên.
      </p>
    )
  }

  return (
    <section className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">
          Món đã gọi <span className="text-muted-foreground">· {view.orderCount} đơn</span>
        </h3>
        <span className="text-sm text-muted-foreground">
          Tổng <strong className="tnum text-foreground">{formatVnd(view.netAmountVnd)}</strong>
        </span>
      </div>

      <ul className="rounded-lg border border-border px-3">
        {view.items.map((item) => (
          <ItemRow
            key={reorderKey(item)}
            item={item}
            added={draft[reorderKey(item)] ?? 0}
            disabled={!canOrder || submit.isPending}
            onAdd={() => {
              setError(null)
              setDraft((current) => addReorder(current, item))
            }}
            onOpenOrders={onOpenOrders}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={onOpenOrders}
        className="justify-self-start py-1 text-xs text-muted-foreground underline"
      >
        <ReceiptText className="mr-1 inline size-3.5" aria-hidden />
        Xem chi tiết đơn · xin hủy món
      </button>

      {count > 0 ? (
        <div className="mt-1 grid gap-2 rounded-xl border-2 border-primary bg-surface-1 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Gọi thêm · {count} món</span>
            <strong className="tnum text-base text-primary-ink">{formatVnd(reorderTotalVnd(lines))}</strong>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{reorderSummary(lines)}</p>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={submit.isPending}
              onClick={() => {
                setDraft({})
                setError(null)
              }}
            >
              Bỏ chọn
            </Button>
            <Button
              type="button"
              className={cn("h-11", submit.isPending && "opacity-80")}
              disabled={submit.isPending}
              onClick={() => {
                if (submittingRef.current) return
                submittingRef.current = true
                submit.mutate()
              }}
            >
              {submit.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Xác nhận lên đơn
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
