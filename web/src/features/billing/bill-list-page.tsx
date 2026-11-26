/**
 * TU-45 — Màn 1 (Phiên đang mở) của mockup NA-44.
 *
 * Một CỤM BÀN GHÉP chỉ có MỘT thẻ. Việc đó không cần code ở đây: cả cụm dùng
 * một Phiên, nên máy chủ đã trả về một hàng. Màn hình chỉ phải không làm sai —
 * tức là không nhóm lại theo bàn.
 *
 * Bộ lọc ba nhóm và số đếm đi theo DỮ LIỆU, không đếm lại ở trình duyệt từ một
 * trang đã lọc: con số "Chờ thanh toán (3)" phải là ba Phiên thật của quán, kể
 * cả khi màn hình đang lọc nhóm khác.
 */
import { useState } from "react"
import { useNavigate } from "react-router"
import { AlertTriangle, Clock, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useBusinessDate, useNow } from "@/hooks/use-data"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { fmtTime } from "@/lib/time"
import { isApiError } from "@/services"
import {
  BILL_FILTER_LABEL,
  BILL_FILTER_ORDER,
  BILL_LIST_STATUS_LABEL,
  matchesFilter,
  seatedDurationLabel,
  seatingLabel,
  type BillFilter,
} from "./bill-display"
import { billingSessionPath } from "./billing-access"
import { useOpenBills } from "./use-bills"
import type { BillListItem } from "./billing-api"

function ListSkeleton() {
  // 1,4 giây khung xương, đúng như bảng Hành vi của mockup: thẻ Phiên hiện
  // khung trước, nút thu tiền chưa có.
  return (
    <ul className="grid gap-2">
      {[0, 1, 2].map((index) => (
        <li key={index} className="rounded-xl border border-border p-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
          <Skeleton className="mt-2 h-7 w-24" />
        </li>
      ))}
    </ul>
  )
}

function SessionCard({ item, now }: { item: BillListItem; now: Date }) {
  const navigate = useNavigate()
  const awaiting = item.status === "AWAITING_PAYMENT"
  return (
    <li>
      <button
        type="button"
        onClick={() => void navigate(billingSessionPath(item.visitId))}
        className="flex w-full items-start justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <strong className="truncate">{seatingLabel(item.tableCodes, item.groupSymbol)}</strong>
            {/* Trạng thái mang CHỮ và BIỂU TƯỢNG, không chỉ màu. */}
            <Badge variant={awaiting ? "secondary" : "outline"} className="shrink-0 gap-1">
              {awaiting ? <Clock aria-hidden className="size-3" /> : null}
              {BILL_LIST_STATUS_LABEL[item.status]}
            </Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {[
              `${item.orderCount} đơn`,
              item.itemCount > 0 ? `${item.itemCount} món` : null,
              `ngồi ${seatedDurationLabel(item.startedAt, now)}`,
              item.shortCode,
              item.closedAt ? `chốt ${fmtTime(new Date(item.closedAt))}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <strong className="tnum shrink-0 text-base">{formatVnd(item.totalVnd)}</strong>
      </button>
    </li>
  )
}

export function BillListPage() {
  const businessDate = useBusinessDate()
  const now = useNow(30_000)
  const [filter, setFilter] = useState<BillFilter>("all")
  const bills = useOpenBills(businessDate)

  const counts = bills.data?.counts ?? { all: 0, serving: 0, awaitingPayment: 0 }
  const items = (bills.data?.items ?? []).filter((item) => matchesFilter(item.status, filter))

  return (
    <div className="grid gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div>
        <h1 className="text-lg font-semibold">Phiên đang mở</h1>
        <p className="text-xs text-muted-foreground">{`Ngày kinh doanh ${businessDate}`}</p>
      </div>

      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(next) => {
          if (next) setFilter(next as BillFilter)
        }}
        variant="outline"
        className="w-full"
      >
        {BILL_FILTER_ORDER.map((option) => (
          <ToggleGroupItem key={option} value={option} className="flex-1">
            {`${BILL_FILTER_LABEL[option]} (${counts[option]})`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {bills.isPending ? <ListSkeleton /> : null}

      {bills.isError ? (
        <div className="grid gap-2">
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            {isApiError(bills.error) ? bills.error.message : "Không đọc được danh sách Phiên."}
          </p>
          <Button variant="outline" onClick={() => void bills.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : null}

      {bills.isSuccess && items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-1 p-4 text-sm text-muted-foreground">
          <Users aria-hidden className="size-4" />
          {filter === "all"
            ? "Chưa có Phiên nào đang mở trong ngày kinh doanh này."
            : `Không có Phiên nào ở nhóm “${BILL_FILTER_LABEL[filter]}”.`}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid gap-2">
          {items.map((item) => (
            <SessionCard key={item.visitId} item={item} now={now} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default BillListPage
