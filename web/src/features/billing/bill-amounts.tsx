/**
 * TU-45 — khối tổng tiền, dùng chung cho Màn 2, Màn 3 và bản in.
 *
 * Một component duy nhất cho mọi chỗ hiện tiền, vì ba khối tiền viết ba lần là
 * ba lần có thể quên dòng "Làm tròn lên nghìn" — và tờ bill thiếu dòng đó thì
 * tổng không cộng đúng từ các dòng của nó.
 *
 * `tnum` (tabular numbers) trên mọi con số: cột tiền phải thẳng hàng để đọc
 * nhanh được ở khoảng cách một cánh tay, trên điện thoại, trong quán tối.
 */
import { formatVnd } from "@/features/waiter-menu/menu-price"
import type { AmountRow } from "./bill-display"

export function BillAmountRows({ rows, dense = false }: { rows: readonly AmountRow[]; dense?: boolean }) {
  return (
    <dl className={dense ? "grid gap-1 text-sm" : "grid gap-1.5 text-sm"}>
      {rows.map((row) => (
        <div
          key={row.key}
          className={
            row.emphasis
              ? "mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2"
              : "flex items-baseline justify-between gap-3"
          }
        >
          <dt className={row.emphasis ? "font-semibold" : "text-muted-foreground"}>
            {row.label}
            {row.hint ? <span className="block text-xs text-muted-foreground">{row.hint}</span> : null}
          </dt>
          <dd className={row.emphasis ? "tnum text-lg font-bold" : "tnum"}>{formatVnd(row.amountVnd)}</dd>
        </div>
      ))}
    </dl>
  )
}
