import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { PreparationStation } from "./preparation-queue-data"
import { preparationTotalsEmptyText, preparationTotalsTitle, type PreparationAggregateItem } from "./preparation-totals"

function notedLineLabel(count: number): string {
  return `${count} dòng có ghi chú`
}

function pendingCancellationLabel(quantity: number): string {
  return `${quantity} phần đang chờ duyệt hủy`
}

export function PreparationTotalsPanel({
  station,
  items,
}: {
  station: PreparationStation
  items: readonly PreparationAggregateItem[]
}) {
  const isMobile = useIsMobile()
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const expanded = expandedOverride ?? !isMobile
  const contentId = useId()
  const title = preparationTotalsTitle(station)
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <section
      className="mb-3 min-w-0 rounded-2xl border border-border bg-surface-1"
      data-preparation-totals
      aria-label={title}
    >
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 w-full min-w-0 justify-between gap-2 rounded-2xl px-3 py-2 text-left"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpandedOverride(!expanded)}
      >
        <span className="min-w-0 truncate font-bold">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tnum rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-foreground">
            {`${totalQuantity} phần`}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </span>
      </Button>
      {expanded ? (
        <div
          id={contentId}
          tabIndex={0}
          aria-label={`Danh sách ${title}`}
          className="max-h-72 min-w-0 overflow-y-auto border-t border-border-subtle p-2.5 focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none md:max-h-44 lg:max-h-48"
        >
          <p className="mb-2 text-xs break-words text-muted-foreground">
            Tính trên toàn bộ hàng đợi, không phụ thuộc bộ lọc.
          </p>
          {items.length ? (
            <ul className="grid min-w-0 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={title}>
              {items.map((item) => (
                <li
                  key={item.menuItemVariantId}
                  className="grid min-w-0 gap-1 rounded-xl bg-surface-2 px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-2"
                >
                  <div className="flex min-w-0 gap-2">
                    <strong className="tnum shrink-0 text-primary-ink">{`${item.quantity}×`}</strong>
                    <div className="min-w-0">
                      <p className="font-medium break-words">{item.itemName}</p>
                      {item.variantDisplayName ? (
                        <p className="text-xs break-words text-muted-foreground">{item.variantDisplayName}</p>
                      ) : null}
                    </div>
                  </div>
                  {item.notedLineCount > 0 || item.pendingCancellationQuantity > 0 ? (
                    <div className="grid min-w-0 gap-1 text-xs sm:justify-items-end sm:text-right">
                      {item.notedLineCount > 0 ? <span>{notedLineLabel(item.notedLineCount)}</span> : null}
                      {item.pendingCancellationQuantity > 0 ? (
                        <span className="font-semibold text-destructive">
                          {pendingCancellationLabel(item.pendingCancellationQuantity)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{preparationTotalsEmptyText(station)}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
