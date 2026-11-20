/**
 * Module Phục vụ 3 — hỏi lại khi giá vừa đổi.
 *
 * Máy chủ từ chối đơn với `MENU_PRICE_CHANGED` và trả về giá mới. Màn này in ra
 * "380.000đ → 420.000đ" cho từng món, vì nhân viên phải nói lại con số đó với
 * khách trước khi gửi. Một câu "giá đã đổi, bấm lại để tiếp tục" đẩy việc đó
 * sang lúc khách nhận hoá đơn.
 *
 * Bấm "Xác nhận giá mới" KHÔNG gửi đơn: nó chỉ cập nhật giỏ. Nhân viên bấm
 * "Gửi đơn" lần nữa — một lần bấm, một lần gửi, không có cú gửi nào xảy ra sau
 * lưng người dùng.
 */
import { ArrowRight } from "lucide-react"
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
import type { PriceChangeView } from "./cart-model"
import { formatVnd } from "./menu-price"

export function PriceChangeDialog({
  changes,
  onCancel,
  onAccept,
}: {
  changes: PriceChangeView[] | null
  onCancel: () => void
  onAccept: () => void
}) {
  return (
    <AlertDialog open={changes !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Giá vừa thay đổi</AlertDialogTitle>
          <AlertDialogDescription>
            Đơn chưa được gửi. Nói lại giá mới với khách, rồi xác nhận để cập nhật giỏ.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-2">
          {(changes ?? []).map((change) => (
            <li
              key={change.variantId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <strong className="font-medium">{change.itemName}</strong>{" "}
                <span className="text-muted-foreground">({change.variantDisplayName})</span>
              </span>
              <span className="tnum inline-flex shrink-0 items-center gap-1.5">
                <s className="text-muted-foreground">{formatVnd(change.previousAmountVnd)}</s>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                <strong className="text-primary-ink">{formatVnd(change.currentAmountVnd)}</strong>
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Giữ giỏ, chưa gửi</AlertDialogCancel>
          <AlertDialogAction onClick={onAccept}>Xác nhận giá mới</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
