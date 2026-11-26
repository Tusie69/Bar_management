/**
 * Module Phục vụ 1 (v1.1) — chú giải nút "!" của khu vực Phục vụ.
 *
 * Component RIÊNG, không phải một `variant` thứ tư của `StatusLegend`. Chú
 * giải của Lễ tân nói về đặt bàn: đã đặt, sắp tới, tới muộn, và một khối "một
 * ô bàn mang gì" với giờ hẹn, icon 🔥 khách quen, 📌 bàn chỉ định. Phục vụ
 * không được thấy một chữ nào trong đó, và cách chắc chắn nhất để họ không
 * thấy là những dòng ấy không tồn tại trong cây component này.
 *
 * Nội dung theo mockup P2 đã duyệt: sáu màu kèm câu giải thích, rồi ba ký hiệu
 * đọc được trên ô bàn — số khách, cụm bàn ghép, bàn sơ cua.
 */
import { Info } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import type { FloorTableState, WaiterVisitPhase } from "@/domain/models"
import { useMediaQuery } from "@/hooks/use-media"
import { cn } from "@/lib/utils"
import { WAITER_PHASE_HINT, WAITER_PHASE_ORDER, WAITER_PHASE_TONE, waiterPhaseCounts } from "./waiter-phase"

function PhaseRow({ phase, count }: { phase: WaiterVisitPhase; count: number }) {
  const tone = WAITER_PHASE_TONE[phase]
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-0.5 size-3.5 shrink-0 rounded-[4px] border-2"
        style={{ borderColor: tone.color, background: tone.tint }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">{tone.label}</span>
          <span className="tnum shrink-0 text-xs font-bold text-foreground">{count}</span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{WAITER_PHASE_HINT[phase]}</p>
      </div>
    </li>
  )
}

/**
 * Thân chú giải, tách khỏi Popover/Sheet để test render được ở Node: hai thứ
 * kia vẽ vào portal và `renderToStaticMarkup` không thấy gì bên trong.
 */
export function WaiterStatusLegendBody({
  counts,
  onClose,
}: {
  counts: Record<WaiterVisitPhase, number>
  onClose?: () => void
}) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <h3 className="mb-2 font-semibold text-foreground">Màu ô bàn · trạng thái · số bàn</h3>
        <ul className="grid gap-2">
          {WAITER_PHASE_ORDER.map((phase) => (
            <PhaseRow key={phase} phase={phase} count={counts[phase]} />
          ))}
        </ul>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          Ô bàn trắng là bàn trống. Bàn khách đã đặt mà chưa tới cũng hiện trắng — việc đặt bàn là của Lễ tân.
        </p>
      </section>

      <section className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <h3 className="mb-2 font-semibold text-foreground">Ký hiệu trên ô bàn</h3>
        <ul className="grid gap-2.5">
          <li className="flex items-start gap-3">
            <span className="relative mt-1 ml-1.5 shrink-0" aria-hidden>
              <span
                className="flex h-[30px] w-[52px] items-center justify-center rounded-md border-2 text-[10px] font-bold"
                style={{
                  borderColor: WAITER_PHASE_TONE.DINING.color,
                  background: WAITER_PHASE_TONE.DINING.tint,
                  color: WAITER_PHASE_TONE.DINING.ink,
                }}
              >
                B7
              </span>
              <span
                className="absolute -top-1.5 -left-1.5 grid size-4 place-items-center rounded-full border border-white/90 text-[8px] font-bold text-white"
                style={{ background: WAITER_PHASE_TONE.DINING.color }}
              >
                4
              </span>
            </span>
            <p className="flex-1 text-xs leading-snug text-muted-foreground">
              Số tròn góc trên trái là <span className="font-semibold text-foreground">số khách</span> của cả đoàn, đếm
              một lần cho mỗi lượt khách chứ không nhân lên theo số bàn.
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="relative mt-1 ml-1 shrink-0" aria-hidden>
              <span className="flex h-[30px] w-[52px] items-center justify-center rounded-md border-2 border-sky-500 bg-sky-50 text-[10px] font-bold text-sky-900">
                B8
              </span>
              <span className="absolute -top-2 -left-1 rounded-sm bg-sky-700 px-1 text-[7px] font-bold text-white">
                G04
              </span>
            </span>
            <p className="flex-1 text-xs leading-snug text-muted-foreground">
              Khung bao quanh nhiều ô kèm nhãn <span className="font-semibold text-foreground">G04</span> là{" "}
              <span className="font-semibold text-foreground">cụm bàn ghép</span>. Chạm vào ô nào cũng mở cùng một
              Phiên, nên không thể lên hai đơn cho một đoàn.
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span
              className="mt-1 ml-1.5 flex h-[30px] w-[52px] shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] font-bold"
              style={{ borderColor: "var(--table-line)", background: "var(--st-free-tint)" }}
              aria-hidden
            >
              A10
            </span>
            <p className="flex-1 text-xs leading-snug text-muted-foreground">
              Viền nét đứt là <span className="font-semibold text-foreground">Bàn sơ cua</span>, chỉ kê thêm khi khu
              chính đã kín.
            </p>
          </li>
        </ul>
      </section>

      {onClose ? (
        <Button type="button" onClick={onClose} className="w-full">
          Đã hiểu
        </Button>
      ) : null}
    </div>
  )
}

export interface WaiterStatusLegendProps {
  states: ReadonlyMap<number, FloorTableState>
  className?: string
}

export function WaiterStatusLegend({ states, className }: WaiterStatusLegendProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useMediaQuery("(min-width: 640px)")
  const counts = waiterPhaseCounts(states)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const trigger: ReactNode = (
    <button
      ref={triggerRef}
      type="button"
      aria-label="Chú giải: sáu trạng thái lượt khách và ký hiệu trên ô bàn"
      className={cn(
        "grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-full border border-border bg-surface-1 text-tx-strong shadow-sm transition-[transform,background-color,border-color] hover:border-border-strong hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-95",
        className,
      )}
    >
      <Info className="size-5 shrink-0" aria-hidden />
    </button>
  )

  if (!isDesktop) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Chú giải sơ đồ</SheetTitle>
            <SheetDescription className="sr-only">
              Sáu trạng thái lượt khách và ký hiệu đọc được trên ô bàn.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <WaiterStatusLegendBody counts={counts} onClose={close} />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent role="dialog" aria-label="Chú giải sơ đồ" align="end" className="w-80">
        <WaiterStatusLegendBody counts={counts} onClose={close} />
      </PopoverContent>
    </Popover>
  )
}
