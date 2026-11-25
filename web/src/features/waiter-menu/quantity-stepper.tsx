import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MAX_LINE_QUANTITY } from "./cart-model"

/**
 * Nút trừ / số / nút cộng.
 *
 * Ô số là `output` chứ không phải `input`: bàn phím số trên điện thoại che mất
 * nửa màn hình và một ô trống gõ dở ("1" rồi xóa) là một số lượng không xác
 * định. Hai nút 44px đủ cho ngón tay và không bao giờ cho ra giá trị sai.
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  min = 1,
}: {
  value: number
  onChange: (next: number) => void
  label: string
  /** 0 cho giỏ hàng: nút trừ cuối cùng là nút bỏ món. */
  min?: number
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-1 p-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={`Giảm số lượng ${label}`}
      >
        <Minus />
      </Button>
      <output className="tnum min-w-9 text-center text-base font-semibold" aria-label={`Số lượng ${label}`}>
        {value}
      </output>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={value >= MAX_LINE_QUANTITY}
        onClick={() => onChange(value + 1)}
        aria-label={`Tăng số lượng ${label}`}
      >
        <Plus />
      </Button>
    </div>
  )
}
