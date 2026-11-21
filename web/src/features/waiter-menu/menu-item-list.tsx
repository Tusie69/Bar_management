import { UtensilsCrossed } from "lucide-react"
import type { Cart } from "./cart-model"
import { cardCartLine, cardCartQuantity } from "./menu-card-model"
import { MenuItemCard } from "./menu-item-card"
import type { WaiterMenuItem } from "./menu-model"

/**
 * Danh sách món.
 *
 * v1.1: thẻ một hàng nên danh sách MỘT CỘT ở mọi bề ngang. Chia hai, ba cột
 * trên màn lớn làm mắt phải quét ngang rồi mới xuống, và thứ tự danh mục —
 * thứ nhân viên đã thuộc — không còn đọc được từ trên xuống.
 */
export function MenuItemList({
  items,
  cart,
  onOpen,
  onAdd,
  onRemove,
}: {
  items: WaiterMenuItem[]
  cart: Cart
  onOpen: (item: WaiterMenuItem) => void
  onAdd: (item: WaiterMenuItem) => void
  onRemove: (cartLineId: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-surface-1 p-8 text-center">
        <div>
          <UtensilsCrossed className="mx-auto size-8 text-subtle" aria-hidden />
          <h2 className="mt-3 font-semibold">Không tìm thấy món</h2>
          <p className="mt-1 text-sm text-muted-foreground">Thử từ khóa khác, bỏ bớt bộ lọc, hoặc chọn nhóm Tất cả.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const line = cardCartLine(cart, item)
        return (
          <MenuItemCard
            key={item.id}
            item={item}
            quantity={cardCartQuantity(cart, item)}
            onOpen={() => onOpen(item)}
            onAdd={() => onAdd(item)}
            onRemove={line === null ? null : () => onRemove(line.cartLineId)}
          />
        )
      })}
    </div>
  )
}
