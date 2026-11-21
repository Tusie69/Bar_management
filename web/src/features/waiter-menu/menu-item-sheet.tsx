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
import { MAX_LINE_NOTE_LENGTH, type AddToCartInput } from "./cart-model"
import { sellableVariants } from "./menu-card-model"
import type { WaiterMenuItem } from "./menu-model"
import { formatVnd } from "./menu-price"
import { QuantityStepper } from "./quantity-stepper"

export { sellableVariants }

/**
 * Ghi chú nhanh theo QUẦY NHẬN, theo mockup P8.
 *
 * Danh sách là hằng số trong code, không phải cấu hình: chưa có bảng nào chứa
 * chúng, và dựng một bảng cho bốn chuỗi là làm phức tạp một thứ sẽ đổi vài lần
 * một năm. Khi quán muốn tự sửa thì đó là một việc riêng, có màn quản trị.
 *
 * Bấm một nút là BẬT/TẮT một mẩu ghi chú, không phải ghi đè ô chữ: nhân viên
 * vẫn gõ thêm được "cho chị kia ngồi trong" bên cạnh "Ít đá".
 */
export const NOTE_PRESETS: Record<"BAR" | "KITCHEN", readonly string[]> = {
  BAR: ["Ít đá", "Không đá", "Ít ngọt", "Thêm chanh"],
  KITCHEN: ["Ít cay", "Không hành", "Ít mặn", "Mang ra sau"],
}

/** Bật/tắt một mẩu ghi chú trong ô chữ, giữ nguyên phần người dùng tự gõ. */
export function toggleNotePreset(note: string, preset: string): string {
  const parts = note
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === preset.toLowerCase())
  if (index >= 0) parts.splice(index, 1)
  else parts.push(preset)
  return parts.join(" · ")
}

export function notePresetActive(note: string, preset: string): boolean {
  return note
    .split("·")
    .map((part) => part.trim().toLowerCase())
    .includes(preset.toLowerCase())
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
                      Ghi chú cho {item.preparationStation === "BAR" ? "Bar" : "Bếp"}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {NOTE_PRESETS[item.preparationStation].map((preset) => {
                        const active = notePresetActive(note, preset)
                        return (
                          <button
                            key={preset}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setNote((current) => toggleNotePreset(current, preset))}
                            className={cn(
                              "min-h-10 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-surface-1 text-foreground",
                            )}
                          >
                            {preset}
                          </button>
                        )
                      })}
                    </div>
                    <Textarea
                      id="menu-line-note"
                      value={note}
                      maxLength={MAX_LINE_NOTE_LENGTH}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Ghi thêm nếu khách dặn gì khác"
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
