import { cn } from "@/lib/utils"
import { orderedMenuCategories, type WaiterMenuCategory } from "./menu-model"

export function MenuCategoryTabs({
  categories,
  selected,
  onSelect,
}: {
  categories: WaiterMenuCategory[]
  selected: number | null
  onSelect: (categoryId: number | null) => void
}) {
  const visible = orderedMenuCategories(categories)
  return (
    <div
      className="-mx-4 min-h-12 shrink-0 touch-pan-x overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      role="tablist"
      aria-label="Nhóm món"
    >
      <div className="flex min-h-12 w-max min-w-full items-start gap-2 pb-1">
        <CategoryButton active={selected === null} onClick={() => onSelect(null)}>
          Tất cả
        </CategoryButton>
        {visible.map((category) => (
          <CategoryButton
            key={category.id}
            active={selected === category.id}
            onClick={() => onSelect(category.id)}
            title={category.parentId === null ? undefined : category.name}
          >
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
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onClick}
      className={cn(
        "min-h-10 max-w-56 shrink-0 truncate rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface-1 text-tx-2 hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
