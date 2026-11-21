import { ChevronRight, MapPin } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { WaiterMenuItem } from "./menu-model"
import { menuPriceSummary } from "./menu-price"

export function MenuItemCard({ item, onOpen }: { item: WaiterMenuItem; onOpen: () => void }) {
  const unavailable = item.availabilityStatus === "TEMPORARILY_UNAVAILABLE"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex min-h-32 w-full items-start gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-left shadow-xs transition-[border-color,box-shadow,transform,opacity] hover:border-border-strong hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-[0.99]",
        unavailable && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] leading-snug font-semibold text-foreground">{item.name}</h2>
          {unavailable ? <Badge variant="secondary">Tạm hết</Badge> : null}
        </div>
        {item.description ? (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <strong className="text-sm font-semibold text-primary-ink">{menuPriceSummary(item.variants)}</strong>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {item.preparationStation === "BAR" ? "Quầy bar" : "Bếp"}
          </span>
        </div>
      </div>
      <ChevronRight
        className="mt-1 size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  )
}
