import { cn } from "@/lib/utils"
import type { WaiterMenuCategory } from "./menu-model"

export function MenuCategoryTabs({
  categories,
  selected,
  onSelect,
}: {
  categories: WaiterMenuCategory[]
  selected: number | null
  onSelect: (categoryId: number | null) => void
}) {
  const visible = categories.filter((category) => category.parentId === null)
  return (
    <div
      className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0"
      role="tablist"
      aria-label="Nhóm món"
    >
      <div className="flex w-max min-w-full gap-2 pb-1">
        <CategoryButton active={selected === null} onClick={() => onSelect(null)}>
          Tất cả
        </CategoryButton>
        {visible.map((category) => (
          <CategoryButton key={category.id} active={selected === category.id} onClick={() => onSelect(category.id)}>
            {category.name}
          </CategoryButton>
        ))}
      </div>
    </div>
  )
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface-1 text-tx-2 hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
