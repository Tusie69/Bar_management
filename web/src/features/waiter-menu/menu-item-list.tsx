import { UtensilsCrossed } from "lucide-react"
import type { WaiterMenuItem } from "./menu-model"
import { MenuItemCard } from "./menu-item-card"

export function MenuItemList({ items, onOpen }: { items: WaiterMenuItem[]; onOpen: (item: WaiterMenuItem) => void }) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-surface-1 p-8 text-center">
        <div>
          <UtensilsCrossed className="mx-auto size-8 text-subtle" aria-hidden />
          <h2 className="mt-3 font-semibold">Không tìm thấy món</h2>
          <p className="mt-1 text-sm text-muted-foreground">Thử từ khóa khác hoặc chọn nhóm Tất cả.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <MenuItemCard key={item.id} item={item} onOpen={() => onOpen(item)} />
      ))}
    </div>
  )
}
