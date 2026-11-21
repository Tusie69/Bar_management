/**
 * Module Phục vụ (v1.1) — PV-18: bill TẠM TÍNH (mockup P13).
 *
 * Một con số để khách xem trước khi quyết định thanh toán. Bàn vẫn Đang dùng,
 * vẫn gọi thêm được sau khi in — và màn hình nói thẳng điều đó, vì "bill" là
 * từ khách hiểu là "xong rồi".
 *
 * V11 chưa chốt: in ra giấy hay chỉ hiện trên màn. Màn này làm phần chắc chắn
 * đúng trong cả hai trường hợp — hiện đủ và đọc được ở khoảng cách một cánh
 * tay — và không giả vờ có máy in.
 */
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ReceiptText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { fetchVisitBill, type VisitBill } from "@/features/waiter-menu/waiter-order-api"
import { fmtTime } from "@/lib/time"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"

/** "10%", "8%", "10,5%" — dựng từ điểm cơ bản, không hard-code. */
export function formatVatRate(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, "").replace(".", ",")}%`
}

export function VisitBillBody({ bill }: { bill: VisitBill }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {`${bill.tableCodes.join(" + ") || "—"} · ${bill.orderCount} đơn · in lúc ${fmtTime(new Date(bill.printedAt))}`}
      </p>

      {bill.lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-1 p-3 text-sm text-muted-foreground">
          Bàn chưa gọi món nào, nên chưa có gì để tính.
        </p>
      ) : (
        <ul className="rounded-xl border border-border px-3">
          {bill.lines.map((line, index) => (
            <li
              key={`${line.itemName}-${line.variantDisplayName}-${line.note ?? ""}-${index}`}
              className="flex items-start justify-between gap-3 border-t border-border-subtle py-2 text-sm first:border-t-0"
            >
              <span className="min-w-0">
                <span className="tnum font-medium">{line.quantity}× </span>
                {line.itemName}
                <span className="block text-xs text-muted-foreground">
                  {`${line.variantDisplayName} · ${formatVnd(line.unitPriceVnd)}${line.note ? ` · ${line.note}` : ""}`}
                </span>
              </span>
              <strong className="tnum shrink-0">{formatVnd(line.amountVnd)}</strong>
            </li>
          ))}
        </ul>
      )}

      <dl className="grid gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Tạm tính</dt>
          <dd className="tnum font-medium">{formatVnd(bill.subtotalVnd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{`VAT ${formatVatRate(bill.vatRateBasisPoints)}`}</dt>
          <dd className="tnum font-medium">{formatVnd(bill.vatVnd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-1.5">
          <dt className="font-semibold">Khách cần trả</dt>
          <dd className="tnum text-base font-bold text-primary-ink">{formatVnd(bill.totalVnd)}</dd>
        </div>
      </dl>

      <p className="text-center text-xs text-muted-foreground">
        Đây là bill tạm tính. Bàn vẫn đang dùng và gọi thêm được.
      </p>
    </div>
  )
}

export function WaiterBillSheet({
  visitId,
  open,
  onClose,
}: {
  visitId: number | null
  open: boolean
  onClose: () => void
}) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const bill = useQuery({
    queryKey: ["waiter-visit-bill", venueId, visitId],
    queryFn: () => fetchVisitBill(visitId as number),
    enabled: open && visitId !== null,
    // Không giữ cache: mỗi lần bấm "In bill tạm tính" phải là con số của lúc
    // bấm. Một tờ bill cũ vài phút là một tờ thiếu mấy món khách vừa gọi.
    staleTime: 0,
    gcTime: 0,
  })

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/*
        Cao gần hết màn và KHÔNG có nút X mặc định.
        Bill mở chồng lên bảng thao tác bàn — hai bottom sheet cùng 85dvh xếp
        lên nhau làm tờ bill bắt đầu ở lưng chừng màn và phần tổng tiền rơi
        xuống dưới mép. Tổng tiền là dòng duy nhất khách nhìn, nên nó không
        được nằm ngoài màn hình.
      */}
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[94dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ReceiptText className="size-5" aria-hidden /> Bill tạm tính
          </SheetTitle>
          <SheetDescription className="sr-only">
            Các món đã gọi, tạm tính, thuế và tổng khách cần trả.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-6">
          {bill.isPending ? (
            <Skeleton className="h-48" />
          ) : bill.isError ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>{isApiError(bill.error) ? bill.error.message : "Không tính được bill."}</span>
            </p>
          ) : bill.data ? (
            <VisitBillBody bill={bill.data} />
          ) : null}
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
