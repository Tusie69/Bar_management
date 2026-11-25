/**
 * Module Phục vụ 3 (v1.1) — lọc khoảng giá và sắp xếp (nút "☰" cạnh ô tìm).
 *
 * Khoảng giá bằng NÚT CHỌN SẴN, không bằng hai ô nhập số. Khách hỏi "có gì
 * tầm hai trăm không" chứ không hỏi "từ 180.000 đến 220.000", và hai ô nhập
 * trên điện thoại là hai lần bật bàn phím số giữa lúc đang đứng cạnh bàn.
 */
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { formatVnd } from "./menu-price"
import { MENU_SORT_LABEL, activeFilterCount, type MenuQuery, type MenuSort } from "./menu-model"

/** Các bậc giá của quán, theo bảng giá hiện hành (cocktail 280k, chai vài triệu). */
const PRICE_BANDS: readonly { label: string; minVnd: number | null; maxVnd: number | null }[] = [
  { label: "Mọi mức giá", minVnd: null, maxVnd: null },
  { label: "Dưới 200.000đ", minVnd: null, maxVnd: 199_999 },
  { label: "200.000 – 500.000đ", minVnd: 200_000, maxVnd: 500_000 },
  { label: "500.000 – 1.500.000đ", minVnd: 500_001, maxVnd: 1_500_000 },
  { label: "Trên 1.500.000đ", minVnd: 1_500_001, maxVnd: null },
]

const SORTS: readonly MenuSort[] = ["default", "price_asc", "price_desc", "name"]

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-1 text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function MenuFilterSheet({
  query,
  onChange,
  open,
  onOpenChange,
}: {
  query: MenuQuery
  onChange: (next: MenuQuery) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const count = activeFilterCount(query)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative size-11 shrink-0"
          aria-label={count === 0 ? "Lọc giá và sắp xếp" : `Lọc giá và sắp xếp: ${count} bộ lọc đang bật`}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {count > 0 ? (
            <span className="tnum absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Lọc và sắp xếp</SheetTitle>
          <SheetDescription className="sr-only">Chọn khoảng giá và thứ tự hiện món.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-6">
          <section className="grid gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Khoảng giá</h3>
            <div className="grid grid-cols-2 gap-2">
              {PRICE_BANDS.map((band) => (
                <Choice
                  key={band.label}
                  active={query.minVnd === band.minVnd && query.maxVnd === band.maxVnd}
                  onClick={() => onChange({ ...query, minVnd: band.minVnd, maxVnd: band.maxVnd })}
                >
                  {band.label}
                </Choice>
              ))}
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              Lọc theo giá thấp nhất của món. Món có cả ly và chai vẫn hiện khi giá ly nằm trong khoảng.
            </p>
          </section>

          <section className="grid gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sắp xếp</h3>
            <div className="grid gap-2">
              {SORTS.map((sort) => (
                <Choice key={sort} active={query.sort === sort} onClick={() => onChange({ ...query, sort })}>
                  {MENU_SORT_LABEL[sort]}
                </Choice>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={count === 0}
              onClick={() => onChange({ ...query, minVnd: null, maxVnd: null, sort: "default" })}
            >
              Bỏ bộ lọc
            </Button>
            <Button type="button" className="h-11" onClick={() => onOpenChange(false)}>
              Xong
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Dòng tóm tắt dưới ô tìm khi có bộ lọc đang bật, để không ai quên mình đã lọc. */
export function MenuFilterSummary({ query, onClear }: { query: MenuQuery; onClear: () => void }) {
  if (activeFilterCount(query) === 0) return null
  const band =
    query.minVnd === null && query.maxVnd === null
      ? null
      : query.minVnd === null
        ? `dưới ${formatVnd(query.maxVnd ?? 0)}`
        : query.maxVnd === null
          ? `trên ${formatVnd(query.minVnd)}`
          : `${formatVnd(query.minVnd)} – ${formatVnd(query.maxVnd)}`
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        Đang lọc: {[band, query.sort === "default" ? null : MENU_SORT_LABEL[query.sort]].filter(Boolean).join(" · ")}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 underline focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
      >
        Bỏ lọc
      </button>
    </p>
  )
}
