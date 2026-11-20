/**
 * Module Phục vụ 3 — chọn đơn vị bán, số lượng và ghi chú rồi thêm vào giỏ.
 *
 * Biến thể tạm hết KHÔNG chọn được: nó vẫn hiện (để nhân viên trả lời khách
 * "chai thì hết rồi"), nhưng không bấm được và không vào giỏ. Một món hết hàng
 * bấm được là một đơn chắc chắn bị máy chủ từ chối sau khi nhân viên đã nói với
 * khách rằng đã gọi xong.
 */
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { MAX_LINE_NOTE_LENGTH, isOrderableAmount, type AddToCartInput } from "./cart-model"
import type { WaiterMenuItem, WaiterMenuVariant } from "./menu-model"
import { formatVnd } from "./menu-price"
import { QuantityStepper } from "./quantity-stepper"

/**
 * Biến thể chọn được: còn hàng VÀ có giá dùng được.
 *
 * Giá vượt trần tiền (hoặc 0, hoặc không phải số nguyên) thì không thêm vào giỏ
 * được, vì mọi tổng dựng từ nó đều là một con số đã bị làm tròn. Máy chủ cũng
 * từ chối (`MENU_PRICE_OUT_OF_RANGE`); chặn ở đây để nhân viên biết trước khi
 * nói với khách.
 */
export function sellableVariants(item: WaiterMenuItem): WaiterMenuVariant[] {
  return item.variants.filter(
    (variant) => variant.availabilityStatus === "AVAILABLE" && isOrderableAmount(variant.amountVnd),
  )
}

export function MenuItemSheet({
  item,
  onClose,
  onAdd,
  addDisabledReason = null,
}: {
  item: WaiterMenuItem | null
  onClose: () => void
  onAdd: (input: AddToCartInput) => void
  /** Lý do không thêm được vào giỏ ngay bây giờ (giỏ đã đầy, …), hoặc `null`. */
  addDisabledReason?: string | null
}) {
  const sellable = useMemo(() => (item ? sellableVariants(item) : []), [item])
  const [variantId, setVariantId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")

  // Mở món khác là một lần nhập mới: giữ lại số lượng 3 và ghi chú "ít đá" của
  // món trước sẽ âm thầm gắn chúng vào món sau.
  useEffect(() => {
    setVariantId(sellable[0]?.variantId ?? null)
    setQuantity(1)
    setNote("")
  }, [item, sellable])

  const selected = sellable.find((variant) => variant.variantId === variantId) ?? null

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:right-4 sm:bottom-4 sm:left-auto sm:w-[420px] sm:rounded-2xl sm:border"
      >
        {item ? (
          <>
            <SheetHeader className="pr-12 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{item.name}</SheetTitle>
                {item.availabilityStatus === "TEMPORARILY_UNAVAILABLE" ? (
                  <Badge variant="secondary">Tạm hết</Badge>
                ) : null}
              </div>
              <SheetDescription>{item.description || "Chưa có mô tả cho món này."}</SheetDescription>
            </SheetHeader>

            <div className="grid gap-4 px-4">
              <div className="grid gap-2" role="radiogroup" aria-label="Đơn vị bán">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Đơn vị bán và giá hiện hành
                </p>
                {item.variants.map((variant) => {
                  const unavailable = variant.availabilityStatus === "TEMPORARILY_UNAVAILABLE"
                  const active = selected?.variantId === variant.variantId
                  return (
                    <button
                      key={variant.variantId}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={unavailable}
                      onClick={() => setVariantId(variant.variantId)}
                      className={cn(
                        "flex min-h-14 items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none",
                        active ? "border-primary bg-primary/5" : "border-border bg-surface-1",
                        unavailable && "cursor-not-allowed opacity-55",
                      )}
                    >
                      <div>
                        <p className="font-medium">{variant.displayName}</p>
                        {unavailable ? <p className="text-xs text-muted-foreground">Tạm hết</p> : null}
                      </div>
                      <strong className="tnum shrink-0 text-primary-ink">{formatVnd(variant.amountVnd)}</strong>
                    </button>
                  )
                })}
              </div>

              {selected ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-medium">Số lượng</span>
                    <QuantityStepper value={quantity} onChange={setQuantity} label={item.name} />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium" htmlFor="menu-line-note">
                      Ghi chú cho Bar/Bếp
                    </label>
                    <Textarea
                      id="menu-line-note"
                      value={note}
                      maxLength={MAX_LINE_NOTE_LENGTH}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Ví dụ: ít đá, không đường"
                      className="min-h-20"
                    />
                    <p className="text-xs text-muted-foreground">Không ghi tên hay số điện thoại khách vào đây.</p>
                  </div>
                </>
              ) : (
                <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
                  Món này đang tạm hết ở mọi đơn vị bán, chưa thêm vào giỏ được.
                </p>
              )}
            </div>

            {addDisabledReason ? (
              <p
                role="alert"
                className="mx-4 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {addDisabledReason}
              </p>
            ) : null}
            <SheetFooter className="px-4">
              <Button
                type="button"
                className="h-12 w-full text-base"
                disabled={selected === null || addDisabledReason !== null}
                onClick={() => {
                  if (!selected) return
                  onAdd({ item, variant: selected, quantity, note })
                  onClose()
                }}
              >
                {selected ? `Thêm vào giỏ · ${formatVnd(selected.amountVnd * quantity)}` : "Thêm vào giỏ"}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
