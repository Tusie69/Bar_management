/**
 * TU-45 — danh sách dòng món của bill.
 *
 * Dùng chung cho tạm tính (preview) và bill đã chốt: hai màn hình phải hiện
 * CÙNG một danh sách, vì cùng một phép gộp ở máy chủ sinh ra chúng. Viết hai
 * component là mở đường cho hai cách hiện khác nhau cho cùng một bàn.
 */
import { formatVnd } from "@/features/waiter-menu/menu-price"
import type { BillLine } from "./billing-api"

export function BillLinesList({ lines }: { lines: readonly BillLine[] }) {
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-1 p-3 text-sm text-muted-foreground">
        Bàn chưa gọi món nào, nên chưa có gì để tính.
      </p>
    )
  }
  return (
    <ul className="rounded-xl border border-border px-3">
      {lines.map((line) => (
        <li
          key={line.lineNo}
          className="flex items-start justify-between gap-3 border-t border-border-subtle py-2 text-sm first:border-t-0"
        >
          <span className="min-w-0">
            <span className="tnum font-medium">{line.quantity}× </span>
            {line.itemName}
            <span className="block text-xs text-muted-foreground">
              {`${line.variantDisplayName} · ${formatVnd(line.unitPriceVnd)}${line.note ? ` · ${line.note}` : ""}`}
            </span>
          </span>
          <strong className="tnum shrink-0">{formatVnd(line.amountVnd)}</strong>
        </li>
      ))}
    </ul>
  )
}
