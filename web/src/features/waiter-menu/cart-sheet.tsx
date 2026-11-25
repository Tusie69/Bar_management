/**
 * Module Phục vụ 3 — giỏ gọi món và nút gửi đơn.
 *
 * Ba điều quan trọng hơn vẻ ngoài của màn này:
 *
 * 1. Nút "Gửi đơn" bị khóa trong lúc đang gửi và mở ra một bước xác nhận. Một
 *    nút gửi bấm được hai lần là hai lần khách nhận món.
 * 2. Lỗi KHÔNG xóa giỏ. Câu lỗi hiện ngay trong giỏ, bên trên nút gửi, và mọi
 *    dòng vẫn còn đó để sửa.
 * 3. Giỏ chỉ trống sau khi máy chủ trả về đơn. Màn này không bao giờ tự nói
 *    "đã gửi" trước khi có đơn thật.
 */
import { AlertCircle, Check, Send, ShoppingCart, Trash2, X } from "lucide-react"
import { useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { MAX_LINE_NOTE_LENGTH, cartStations, type Cart, type CartLine } from "./cart-model"
import { formatVnd } from "./menu-price"
import { QuantityStepper } from "./quantity-stepper"

const STATION_LABEL = { BAR: "Quầy bar", KITCHEN: "Bếp" } as const

/**
 * Nhãn trợ năng của một dòng giỏ.
 *
 * Phải mang theo ghi chú: hai dòng cùng biến thể khác ghi chú là hai dòng, và
 * hai nút "Bỏ MACALLAN 12 khỏi giỏ" giống nhau thì trình đọc màn hình (và
 * test) không biết nút nào bỏ dòng nào.
 */
function lineLabel(line: CartLine, prefix?: string, suffix?: string): string {
  const base = `${line.itemName} ${line.variantDisplayName}${line.note ? ` · ${line.note}` : ""}`
  return [prefix, base, suffix].filter(Boolean).join(" ")
}

/** Thanh giỏ dính đáy màn. Không có dòng nào thì không có thanh nào. */
export function CartBar({ itemCount, totalVnd, onOpen }: { itemCount: number; totalVnd: number; onOpen: () => void }) {
  if (itemCount === 0) return null
  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-5">
      <div className="mx-auto w-full max-w-7xl">
        <Button type="button" className="h-13 w-full justify-between text-base" onClick={onOpen}>
          <span className="inline-flex items-center gap-2">
            <ShoppingCart className="size-5" aria-hidden />
            Giỏ gọi món · {itemCount} món
          </span>
          <span className="tnum font-semibold">{formatVnd(totalVnd)}</span>
        </Button>
      </div>
    </div>
  )
}

export function CartSheet({
  open,
  onOpenChange,
  cart,
  itemCount,
  totalVnd,
  submitting,
  errorMessage,
  tableLabel,
  onQuantityChange,
  onNoteChange,
  onRemove,
  onSubmit,
  exceedsMoneyLimit = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cart: Cart
  itemCount: number
  totalVnd: number
  submitting: boolean
  errorMessage: string | null
  tableLabel: string
  onQuantityChange: (cartLineId: string, quantity: number) => void
  onNoteChange: (cartLineId: string, note: string) => void
  onRemove: (cartLineId: string) => void
  onSubmit: () => void
  /** Tổng tiền vượt trần hoặc có dòng mang giá không dùng được. */
  exceedsMoneyLimit?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const stations = cartStations(cart)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:right-4 sm:bottom-4 sm:left-auto sm:w-[460px] sm:rounded-2xl sm:border"
      >
        <SheetHeader className="border-b border-border px-4 pr-12 pb-3">
          <SheetTitle>Giỏ gọi món · {tableLabel}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {itemCount} món · {stations.map((station) => STATION_LABEL[station]).join(" + ") || "Chưa có món"}
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <CartLineList
            lines={cart.lines}
            onQuantityChange={onQuantityChange}
            onNoteChange={onNoteChange}
            onRemove={onRemove}
          />
        </div>

        <div className="grid gap-3 border-t border-border px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {errorMessage ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{errorMessage}</span>
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Tổng tiền</span>
            <strong className="tnum text-xl">{formatVnd(totalVnd)}</strong>
          </div>
          {exceedsMoneyLimit ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              Tổng tiền của giỏ vượt mức một đơn giữ được chính xác. Bỏ bớt món hoặc chia thành nhiều đơn.
            </p>
          ) : null}
          <Button
            type="button"
            className="h-13 w-full text-base"
            disabled={submitting || cart.lines.length === 0 || exceedsMoneyLimit}
            onClick={() => setConfirming(true)}
          >
            {submitting ? (
              "Đang gửi đơn…"
            ) : (
              <>
                <Send className="size-5" aria-hidden /> Gửi đơn
              </>
            )}
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gửi đơn tới {stations.map((s) => STATION_LABEL[s]).join(" và ")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemCount} món cho {tableLabel}, tổng {formatVnd(totalVnd)}. Đơn đã gửi chỉ Thu ngân hoặc quản lý mới sửa
              được.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <X className="size-4" aria-hidden /> Xem lại giỏ
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                setConfirming(false)
                onSubmit()
              }}
            >
              <Send className="size-4" aria-hidden /> Gửi đơn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

/**
 * Danh sách dòng giỏ.
 *
 * Tách riêng khỏi `CartSheet` để test render được: `Sheet` của Radix vẽ vào
 * portal, nên `renderToStaticMarkup` không thấy gì bên trong nó.
 */
export function CartLineList({
  lines,
  onQuantityChange,
  onNoteChange,
  onRemove,
}: {
  lines: readonly CartLine[]
  onQuantityChange: (cartLineId: string, quantity: number) => void
  onNoteChange: (cartLineId: string, note: string) => void
  onRemove: (cartLineId: string) => void
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted-foreground">
        Giỏ đang trống. Chọn món từ danh mục để thêm vào đây.
      </p>
    )
  }
  return (
    <ul className="grid gap-3">
      {lines.map((line) => (
        <li key={line.cartLineId} className="grid gap-2 rounded-xl border border-border bg-surface-1 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{line.itemName}</p>
              <p className="text-xs text-muted-foreground">
                {line.variantDisplayName} · {formatVnd(line.amountVnd)} · {STATION_LABEL[line.preparationStation]}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <strong className="tnum text-primary-ink">{formatVnd(line.amountVnd * line.quantity)}</strong>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(line.cartLineId)}
                aria-label={lineLabel(line, "Bỏ", "khỏi giỏ")}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <QuantityStepper
              value={line.quantity}
              min={0}
              label={lineLabel(line)}
              onChange={(next) => onQuantityChange(line.cartLineId, next)}
            />
            <Input
              value={line.note}
              maxLength={MAX_LINE_NOTE_LENGTH}
              onChange={(event) => onNoteChange(line.cartLineId, event.target.value)}
              placeholder="Ghi chú món"
              aria-label={lineLabel(line, "Ghi chú cho")}
              className="h-11 min-w-32 flex-1"
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Hiện sau mỗi lần gửi thành công. Số đơn là số mà Bar đọc được trên phiếu. */
/**
 * Thông báo "đã lên đơn", thu về MỘT DÒNG (mockup P9).
 *
 * Bản cũ chiếm ba dòng để nói số món, hai quầy nhận và tổng tiền. Màn này là
 * màn gọi món: chỗ đó thuộc về danh sách món, và mọi chi tiết của đơn vừa gửi
 * nằm sau nút "Xem" — một cú bấm cho người cần, không phải ba dòng cho mọi
 * người.
 */
export function OrderSentBanner({
  tableLabel,
  submittedAtLabel,
  onView,
  onDismiss,
}: {
  /** "A3" hoặc "B11 + B12". */
  tableLabel: string
  /** Giờ gửi, dạng HH:MM. */
  submittedAtLabel: string
  onView: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
      style={{ borderColor: "var(--st-seated)", background: "var(--st-seated-tint)" }}
    >
      <Check className="size-4 shrink-0" style={{ color: "var(--st-seated-ink)" }} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{`Đã lên đơn cho ${tableLabel} · ${submittedAtLabel}`}</span>
      <Button type="button" variant="outline" className="min-h-11 shrink-0 px-3" onClick={onView}>
        Xem
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label="Đóng thông báo đã lên đơn"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )
}
