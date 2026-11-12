import { useState, useRef, useEffect } from "react"
import { Info, X } from "lucide-react"
import type { FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { calculateStatusCounts, type LegendStatusKey } from "./floor-visual-rules"

export interface StatusLegendProps {
  tables: (TableView & { state?: TableLiveState; liveState?: TableLiveState; claim?: FloorTableState["claim"] })[]
  states?: Map<number, FloorTableState>
  className?: string
  /**
   * "card": the full legend card (title + status chips + ⓘ).
   * "badge": just a round ⓘ button to float over the floor plan; the status
   * counts move inside its popover so they stop eating screen height.
   */
  variant?: "card" | "badge"
}

export type { LegendStatusKey }

export function StatusLegend({ tables = [], states, className, variant = "card" }: StatusLegendProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  // The popover renders through the house Popover portal (document.body), so it escapes the
  // legend's stacking context and any clipping ancestor. When the legend lives inside the mobile
  // shell, the portalled content re-applies [data-gm] so the mobile theme tokens still resolve.
  const [inMobileShell, setInMobileShell] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (triggerRef.current?.closest("[data-gm]")) {
      setInMobileShell(true)
    }
  }, [])

  const counts = calculateStatusCounts(tables, states)

  const onOpenChange = (open: boolean) => {
    if (open) setInMobileShell(Boolean(triggerRef.current?.closest("[data-gm]")))
    setPopoverOpen(open)
  }

  const CHIPS: Array<{
    key: LegendStatusKey
    label: string
    count: number
    colorVar: string
    tintVar?: string
    isDashed?: boolean
  }> = [
    { key: "free", label: "Trống", count: counts.free, colorVar: "var(--st-free)", tintVar: "var(--st-free-tint)" },
    { key: "reserved", label: "Đã đặt", count: counts.reserved, colorVar: "var(--st-reserved)" },
    { key: "upcoming", label: "Sắp tới", count: counts.upcoming, colorVar: "var(--st-upcoming)" },
    { key: "noshow", label: "Tới muộn", count: counts.noshow, colorVar: "var(--st-noshow)" },
    { key: "seated", label: "Đã tới", count: counts.seated, colorVar: "var(--st-seated)" },
    { key: "spare", label: "Sơ cua", count: counts.spare, colorVar: "var(--table-line)", tintVar: "var(--st-free-tint)", isDashed: true },
  ]

  /** Chips: 3-column grid on mobile (exact 2 rows of 3), 1 compact row on desktop if it fits */
  const chipsGrid = (
    <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
          {CHIPS.map((chip) => (
            <div
              key={chip.key}
              className="flex h-[26px] min-w-0 items-center justify-between gap-1 rounded-md border border-border/70 bg-background/80 px-1.5 text-[11px] font-medium text-foreground shadow-2xs sm:inline-flex sm:h-[26px] sm:w-auto sm:justify-start sm:gap-1.5 sm:px-2 sm:text-xs"
            >
              <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                {chip.isDashed ? (
                  <span
                    className="size-2.5 shrink-0 rounded-[2px] border border-dashed"
                    style={{ borderColor: chip.colorVar, background: chip.tintVar ?? "transparent" }}
                    aria-hidden
                  />
                ) : chip.key === "free" ? (
                  <span
                    className="size-2.5 shrink-0 rounded-[2px] border border-[var(--st-free)] bg-[var(--st-free-tint)]"
                    aria-hidden
                  />
                ) : (
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: chip.colorVar }}
                    aria-hidden
                  />
                )}
                <span className="truncate text-muted-foreground">{chip.label}</span>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-foreground">{chip.count}</span>
            </div>
          ))}
    </div>
  )

  return (
    <Popover open={popoverOpen} onOpenChange={onOpenChange}>
      {variant === "badge" ? (
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Ký hiệu: mở bảng chú giải trạng thái, ký hiệu khách và nhóm bàn"
            className={cn(
              "grid size-9 place-items-center rounded-full border border-border/80 bg-background/95 text-tx-strong shadow-lg backdrop-blur transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-slate-700/80 dark:bg-[#1e232d]/95",
              className,
            )}
          >
            <Info className="size-5 shrink-0" aria-hidden />
          </button>
        </PopoverTrigger>
      ) : (
        <div
          className={cn(
            "relative rounded-xl border border-border/80 bg-card/95 p-2 shadow-2xs backdrop-blur select-none sm:p-2.5",
            className,
          )}
          role="region"
          aria-label="Chú giải trạng thái bàn"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5 sm:mb-2">
            <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase sm:text-xs">
              Trạng thái · Số bàn / ghế
            </span>
            <PopoverTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className="inline-flex min-h-[44px] items-center gap-1 -my-2.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Ký hiệu: mở bảng chú giải ký hiệu khách và nhóm bàn"
              >
                <Info className="size-3.5 shrink-0" />
                <span>Ký hiệu</span>
              </button>
            </PopoverTrigger>
          </div>
          {chipsGrid}
        </div>
      )}

      {/* Popover dialog: portalled by the house Popover (Radix) - focus, Esc, outside and placement */}
      <PopoverContent
        data-gm={inMobileShell ? "" : undefined}
        role="dialog"
        aria-label="Chú giải ký hiệu"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        style={{ background: "var(--popover)", color: "var(--popover-foreground)" }}
        className="max-h-(--radix-popover-content-available-height) w-[calc(100vw-32px)] max-w-sm overflow-y-auto rounded-2xl border-border p-3.5 shadow-xl"
      >
          <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
            <h2 className="text-sm font-bold text-foreground">Chú giải ký hiệu</h2>
            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false)
                triggerRef.current?.focus()
              }}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Đóng bảng chú giải"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs">
            {/* Status counts live here in badge mode: off the plan, inside the ⓘ popup */}
            {variant === "badge" ? (
              <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                <div className="mb-2 font-semibold text-foreground">Trạng thái · Số bàn / ghế</div>
                {chipsGrid}
              </div>
            ) : null}

            {/* Customer flags */}
            <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
              <div className="mb-2 font-semibold text-foreground">
                Ký hiệu khách · góc TRÁI TRÊN bàn
              </div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>⭐</span>
                  <span>VIP</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>📌</span>
                  <span>Chỉ định</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>🎂</span>
                  <span>Sinh nhật</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>🔥</span>
                  <span>Khách quen</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>🆕</span>
                  <span>Khách mới</span>
                </div>
              </div>
            </div>

            {/* Merge group */}
            <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
              <div className="mb-1 font-semibold text-foreground">
                Ký hiệu nhóm · góc PHẢI TRÊN bàn
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-bold text-foreground">G01 / G02</span>: các bàn ghép thuộc cùng MỘT tốp khách. Khi ghép, mọi bàn trong nhóm có trạng thái giống nhau và tổng số khách chỉ tính 1 lần.
              </p>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Bàn tới muộn chuyển sang màu đỏ khi quá giờ hẹn. Mặc định ẩn chú giải icon dưới nút ⓘ để không che bàn; chú giải màu bàn vẫn luôn hiển thị.
            </p>

            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false)
                triggerRef.current?.focus()
              }}
              className="w-full rounded-lg bg-primary py-2 text-center text-xs font-semibold text-primary-foreground hover:bg-primary/90 active:scale-98"
            >
              Đã hiểu
            </button>
          </div>
      </PopoverContent>
    </Popover>
  )
}
