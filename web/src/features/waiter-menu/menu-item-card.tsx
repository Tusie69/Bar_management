/**
 * Module Phục vụ 3 (v1.1) — thẻ món MỘT HÀNG.
 *
 * Mockup P7: tên · giá · − / +. Bỏ mô tả, quầy chế biến và mũi tên. Thẻ thấp
 * hơn nên một màn điện thoại thấy khoảng 11 món thay vì 5–6, và đó là khác
 * biệt giữa "cuộn tìm" và "nhìn thấy".
 *
 * Chạm vào TÊN món vẫn mở cửa sổ chi tiết (bước 6): chọn đơn vị, số lượng, ghi
 * chú. Nút "+" là lối tắt cho trường hợp thường gặp nhất — một món, một đơn
 * vị, không ghi chú.
 */
import { Minus, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { cardAddMode, cardPriceLabel } from "./menu-card-model"
import type { WaiterMenuItem } from "./menu-model"
import { formatVnd } from "./menu-price"

export function MenuItemCard({
  item,
  quantity,
  onOpen,
  onAdd,
  onRemove,
}: {
  item: WaiterMenuItem
  /** Số phần của món này đang có trong giỏ, mọi biến thể. 0 nghĩa là chưa gọi. */
  quantity: number
  /** Mở cửa sổ chi tiết (bước 6). */
  onOpen: () => void
  /** Thêm nhanh một phần. Món nhiều đơn vị thì người gọi mở cửa sổ thay vì đoán. */
  onAdd: () => void
  /** Bớt một phần của dòng không ghi chú; `null` khi không có dòng nào để bớt. */
  onRemove: (() => void) | null
}) {
  const mode = cardAddMode(item)
  const inCart = quantity > 0
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border bg-surface-1 px-3 py-2 transition-colors",
        inCart ? "border-2 border-primary" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 py-1 text-left focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
      >
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="text-sm leading-snug font-semibold text-foreground">{item.name}</span>
          {mode === "blocked" ? <Badge variant="secondary">Tạm hết</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-primary-ink">{cardPriceLabel(item, formatVnd)}</span>
      </button>

      {onRemove ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label={`Bớt một phần ${item.name}`}
          onClick={onRemove}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
      ) : null}
      {inCart ? (
        <output className="tnum min-w-5 shrink-0 text-center text-sm font-bold" aria-label={`${item.name} trong giỏ`}>
          {quantity}
        </output>
      ) : null}
      <Button
        type="button"
        size="icon"
        className="size-10 shrink-0"
        disabled={mode === "blocked"}
        aria-label={
          mode === "sheet" ? `Chọn đơn vị cho ${item.name}` : `Gọi thêm một phần ${item.name}`
        }
        onClick={mode === "sheet" ? onOpen : onAdd}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  )
}
