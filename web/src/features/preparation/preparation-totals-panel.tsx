import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()
  const title = preparationTotalsTitle(station)

  return (
    <section
      className="mb-3 min-w-0 rounded-2xl border border-border bg-surface-1"
      data-preparation-totals
      aria-label={title}
    >
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 w-full min-w-0 justify-between rounded-2xl px-3 py-2 text-left"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 font-bold break-words">{title}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </Button>
      <p className="px-3 pb-2 text-xs break-words text-muted-foreground">
        Tính trên toàn bộ hàng đợi, không phụ thuộc bộ lọc.
      </p>
      {expanded ? (
        <div id={contentId} className="max-h-72 min-w-0 overflow-y-auto border-t border-border-subtle p-3">
          {items.length ? (
            <ul className="grid min-w-0 gap-2" aria-label={title}>
              {items.map((item) => (
                <li
                  key={item.menuItemVariantId}
                  className="grid min-w-0 gap-1 rounded-xl bg-surface-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-3"
                >
                  <div className="flex min-w-0 gap-2">
                    <strong className="shrink-0 text-primary-ink">{`${item.quantity}×`}</strong>
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
