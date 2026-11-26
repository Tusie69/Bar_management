/**
 * TU-45 — Màn 2 (Chi tiết Phiên) và Màn 3 (Bill tạm tính) của mockup NA-44.
 *
 * Hai màn trong một trang, vì trên điện thoại chúng là cùng một lần cuộn: danh
 * sách món ở trên, khối tiền và nút thu tiền ở dưới. Tab "Trên màn hình / Bản
 * in 80mm" là Màn 3.
 *
 * Ba điều màn này cố ý KHÔNG làm:
 *
 * 1. Không tính lại tiền. Mọi con số từ máy chủ. Tính lại ở trình duyệt là
 *    dựng nguồn sự thật thứ hai, và tổng trên màn sẽ lệch tổng trên tờ bill.
 * 2. Không optimistic update. Màn hình chỉ nói "đã chốt" khi máy chủ đã trả
 *    bill — một màn hình đoán trước rồi lùi lại là một màn hình đã có lần nói
 *    "đã chốt" cho một lần chốt thất bại.
 * 3. Không tự mở màn thanh toán. Chốt bill và thu tiền là hai bước, và bước
 *    thứ hai là TU-46.
 */
import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { AlertTriangle, ArrowLeft, Lock, Printer, ReceiptText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { useSession } from "@/state/session"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { fmtTime } from "@/lib/time"
import { isApiError } from "@/services"
import { toast } from "sonner"
import { BillAmountRows } from "./bill-amounts"
import {
  BILL_STATUS_LABEL,
  IN_DEVELOPMENT_LABEL,
  amountRows,
  blockerDisplays,
  canCloseBill,
  inDevelopmentLabels,
  seatingLabel,
} from "./bill-display"
import { BillLinesList } from "./bill-lines"
import { BillPrintView, type BillPrintData } from "./bill-print-view"
import { BILLING_BASE_PATH } from "./billing-access"
import { PaymentPanel } from "./payment-panel"
import { useBill, useBillPreview, useCloseBill } from "./use-bills"
import type { Bill, BillPreview } from "./billing-api"

/** Số lần bấm In, chỉ để nút nói thật rằng nó chưa in gì. */
function usePrintSimulation() {
  const [count, setCount] = useState(0)
  return {
    count,
    simulate: () => {
      setCount((previous) => previous + 1)
      toast.info("Chưa nối máy in thật — lần in này chỉ mô phỏng.")
    },
  }
}

function DetailSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
    </div>
  )
}

/** Nhãn của những tính năng có trên thiết kế mà chưa xây. Dựng từ dữ liệu máy chủ. */
function InDevelopmentRow({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="gap-1 text-muted-foreground" aria-disabled="true">
          <Lock aria-hidden className="size-3" />
          {`${label} · ${IN_DEVELOPMENT_LABEL}`}
        </Badge>
      ))}
    </div>
  )
}

export function BillSessionDetail() {
  const params = useParams<{ visitId: string }>()
  const navigate = useNavigate()
  const visitId = Number(params.visitId)
  const valid = Number.isSafeInteger(visitId) && visitId > 0

  const preview = useBillPreview(valid ? visitId : null)
  const openBillId = preview.data?.blockers.find((blocker) => blocker.code === "BILL_ALREADY_OPEN")?.context?.billId
  const bill = useBill(typeof openBillId === "number" ? openBillId : null)

  // TN-07-K7: Phục vụ và Bartender mở hoá đơn đã xuất thì KHÔNG thấy nút Tiền
  // mặt, Chuyển khoản hay Đã nhận tiền. Máy chủ đã chặn bằng `payment.collect`
  // (có test canh), nhưng một màn hình hiện nút rồi mới báo 403 là một màn hình
  // dạy nhân viên rằng lỗi là chuyện bình thường.
  const canCollect = useSession((state) => state.permissions.includes("payment.collect"))

  const closeBill = useCloseBill()
  const [idempotencyKey, renewKey] = useIdempotencyKey()
  const print = usePrintSimulation()
  const [view, setView] = useState<"screen" | "print">("screen")

  if (!valid) {
    return <p className="p-4 text-sm text-muted-foreground">Mã Phiên không hợp lệ.</p>
  }
  if (preview.isPending) return <DetailSkeleton />
  if (preview.isError) {
    const message = isApiError(preview.error) ? preview.error.message : "Không đọc được tạm tính của Phiên này."
    return (
      <div className="grid gap-3 p-4">
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          {message}
        </p>
        <Button variant="outline" onClick={() => void preview.refetch()}>
          Thử lại
        </Button>
      </div>
    )
  }

  const data: BillPreview = preview.data
  const closed: Bill | undefined = bill.data
  // `BILL_ALREADY_OPEN` bị bỏ khỏi danh sách cảnh báo một khi màn này ĐANG hiện
  // chính cái bill đó: nói "Phiên đã có bill B261126-0001 đang chờ thanh toán"
  // ngay bên trên bill B261126-0001 là một cảnh báo không có việc gì để làm, và
  // một cảnh báo như thế dạy người dùng bỏ qua mọi cảnh báo khác.
  const blockers = blockerDisplays(data.blockers).filter(
    (blocker) => !(blocker.code === "BILL_ALREADY_OPEN" && closed !== undefined),
  )
  // `BILL_ALREADY_OPEN` không phải bế tắc: bill đã chốt ở máy khác, và màn này
  // chuyển sang hiện chính bill đó.
  const closable = canCloseBill(data.blockers)

  const amounts = closed ?? data
  const printData: BillPrintData = {
    ...amounts,
    billCode: closed?.billCode ?? null,
    tableCodes: amounts.tableCodes,
    groupSymbol: amounts.groupSymbol,
    orderCount: amounts.orderCount,
    lines: amounts.lines,
    charges: amounts.charges,
    issuedAt: closed?.closedAt ?? data.previewedAt,
  }

  async function onCloseBill() {
    try {
      const created = await closeBill.mutateAsync({
        visitId,
        idempotencyKey,
        expectedTotalVnd: data.totalVnd,
      })
      renewKey()
      toast.success(`Đã xuất hóa đơn ${created.billCode} · ${formatVnd(created.totalVnd)}`)
    } catch (error) {
      if (!isApiError(error)) {
        toast.error("Không xuất được hóa đơn. Hóa đơn CHƯA được xuất.")
        return
      }
      if (error.code === "BILL_TOTAL_CHANGED") {
        // Khách gọi thêm giữa lúc đưa tạm tính cho khách xem và lúc bấm Chốt.
        // Đọc lại rồi để người bấm xem con số mới, không tự chốt số nào.
        await preview.refetch()
        toast.error("Tổng tiền đã thay đổi. Xem lại rồi chốt lại.")
        return
      }
      if (error.code === "BILL_ALREADY_OPEN") {
        await preview.refetch()
        toast.error("Máy khác vừa xuất hóa đơn cho bàn này.")
        return
      }
      toast.error(error.message)
    }
  }

  return (
    <div className="grid gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Về danh sách Phiên"
          disabled={closeBill.isPending}
          onClick={() => void navigate(BILLING_BASE_PATH)}
        >
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{seatingLabel(amounts.tableCodes, amounts.groupSymbol)}</h1>
          <p className="text-xs text-muted-foreground">
            {`${amounts.orderCount} đơn · ${closed ? `hóa đơn ${closed.billCode}` : "chưa xuất hóa đơn"}`}
          </p>
        </div>
        {closed ? (
          <Badge variant="secondary" className="ml-auto shrink-0">
            {BILL_STATUS_LABEL[closed.status]}
          </Badge>
        ) : (
          <Badge variant="outline" className="ml-auto shrink-0">
            Đang phục vụ
          </Badge>
        )}
      </div>

      <Tabs value={view} onValueChange={(next) => setView(next as "screen" | "print")}>
        <TabsList>
          <TabsTrigger value="screen">Trên màn hình</TabsTrigger>
          <TabsTrigger value="print">Bản in 80mm</TabsTrigger>
        </TabsList>

        <TabsContent value="screen" className="grid gap-3">
          <BillLinesList lines={amounts.lines} />
          <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5">
            <BillAmountRows rows={amountRows(amounts)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {closed
              ? `Xuất lúc ${fmtTime(new Date(closed.closedAt))} · ${closed.closedBy.displayName}`
              : `Tạm tính lúc ${fmtTime(new Date(data.previewedAt))} — chưa phải hoá đơn.`}
          </p>
        </TabsContent>

        <TabsContent value="print">
          <BillPrintView data={printData} />
        </TabsContent>
      </Tabs>

      <InDevelopmentRow labels={inDevelopmentLabels(amounts.notAvailable)} />

      {blockers.length > 0 ? (
        <ul className="grid gap-2">
          {blockers.map((blocker) => (
            <li
              key={blocker.code}
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span className="min-w-0">
                {blocker.message}
                {blocker.code === "ORDER_CANCELLATION_PENDING" && blocker.actionLabel ? (
                  <Button variant="link" className="h-auto p-0 text-sm" onClick={() => void navigate("/duyet-huy-mon")}>
                    {blocker.actionLabel}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={print.simulate}>
          <Printer aria-hidden className="size-4" />
          {print.count === 0 ? "In hóa đơn (mô phỏng)" : `In hóa đơn (đã mô phỏng ${print.count} lần)`}
        </Button>
        {/* Bill đã chốt thì chỗ này là luồng thu tiền, không còn nút chốt nữa. */}
        {closed === undefined ? (
          <Button
            disabled={!closable || closeBill.isPending}
            aria-describedby={closable ? undefined : "bill-close-blocked"}
            onClick={() => void onCloseBill()}
          >
            <ReceiptText aria-hidden className="size-4" />
            {closeBill.isPending ? "Đang ghi nhận…" : "Xuất hóa đơn"}
          </Button>
        ) : null}
      </div>

      {/* Nút vô hiệu luôn có lý do ngay cạnh nó. */}
      {closed === undefined && !closable ? (
        <p id="bill-close-blocked" className="text-xs text-muted-foreground">
          Chưa xuất hóa đơn được — xem lý do ở trên.
        </p>
      ) : null}

      {/* TU-46: Màn 4 → 7. Chỉ Thu ngân thấy, và chỉ khi hoá đơn chưa thu. */}
      {closed !== undefined && closed.status === "AWAITING_PAYMENT" && canCollect ? (
        <div className="border-t border-border pt-4">
          <PaymentPanel bill={closed} />
        </div>
      ) : null}

      {closed !== undefined && closed.status === "AWAITING_PAYMENT" && !canCollect ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-1 p-3 text-sm text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          Đưa hóa đơn này cho khách ra quầy Thu ngân. Chỉ Thu ngân thu tiền.
        </p>
      ) : null}

      {closed !== undefined && closed.status === "PAID" ? (
        <p className="rounded-lg border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
          {`Bill ${closed.billCode} đã thanh toán lúc ${fmtTime(new Date(closed.paidAt ?? closed.closedAt))}`}
          {closed.paidBy ? ` · ${closed.paidBy.displayName}` : ""}
        </p>
      ) : null}
    </div>
  )
}

export default BillSessionDetail
