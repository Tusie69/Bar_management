import { useState, useRef, useEffect, type ReactNode } from "react"
import { Info, X } from "lucide-react"
import type { FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media"
import { prewarmMotionController } from "@/lib/motion"
import { cn } from "@/lib/utils"
import {
  buildLegendChips,
  calculateStatusCounts,
  type LegendChipItem,
  type LegendStatusKey,
} from "./floor-visual-rules"

export interface StatusLegendProps {
  tables: (TableView & { state?: TableLiveState; liveState?: TableLiveState; claim?: FloorTableState["claim"] })[]
  states?: Map<number, FloorTableState>
  className?: string
  /**
   * "card": the full legend card (title + status chips + ⓘ).
   * "badge": just a round ⓘ button to float over the floor plan; the status
   * counts move inside its popover so they stop eating screen height.
   * "admin": round "!" button for Admin Shift Overview (desktop Popover, phone Sheet).
   */
  variant?: "card" | "badge" | "admin"
}

export type { LegendStatusKey }

export function LegendChipsGrid({ chips }: { chips: LegendChipItem[] }) {
  return (
    <div
      className={cn(
        chips.length > 6
          ? "flex flex-wrap items-center gap-1.5 sm:gap-2"
          : "grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2",
      )}
    >
      {chips.map((chip) => (
        <div
          key={chip.key}
          className="flex min-h-7 min-w-0 items-center justify-between gap-1.5 rounded-md border border-border-subtle bg-surface-2/65 px-2 py-1 text-xs font-medium text-foreground sm:inline-flex sm:w-auto sm:justify-start sm:px-2.5"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {chip.isDashed ? (
              <span
                className="size-2.5 shrink-0 rounded-[3px] border border-dashed"
                style={{ borderColor: chip.colorVar, background: chip.tintVar ?? "transparent" }}
                aria-hidden
              />
            ) : chip.key === "oos" ? (
              <span
                className="size-2.5 shrink-0 rounded-[3px] border border-[var(--st-oos)]"
                style={{
                  background: "repeating-linear-gradient(135deg, var(--st-oos) 0 1.5px, transparent 1.5px 4px)",
                }}
                aria-hidden
              />
            ) : chip.key === "free" ? (
              <span
                className="size-2.5 shrink-0 rounded-[3px] border border-[var(--st-free)] bg-[var(--st-free-tint)]"
                aria-hidden
              />
            ) : (
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: chip.colorVar }} aria-hidden />
            )}
            <span className="leading-tight text-muted-foreground">{chip.label}</span>
          </div>
          <span className="shrink-0 font-bold text-foreground tabular-nums">{chip.count}</span>
        </div>
      ))}
    </div>
  )
}

function StatusLegendContent({
  chipsGrid,
  showStatusChips,
  showSpareSection,
  showReceptionNote,
  onClose,
}: {
  chipsGrid: ReactNode
  showStatusChips: boolean
  showSpareSection: boolean
  showReceptionNote: boolean
  onClose: () => void
}) {
  return (
    <div className="space-y-3 text-xs">
      {/* Status counts live here in badge/admin modes */}
      {showStatusChips ? (
        <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
          <div className="mb-2 font-semibold text-foreground">Màu ô bàn · trạng thái · số bàn</div>
          {chipsGrid}
        </div>
      ) : null}

      {/* What one table cell carries, corner by corner (mockup 06) */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <div className="mb-2 font-semibold text-foreground">Thông tin trong 1 ô bàn</div>
        <div className="flex items-start gap-4">
          <div className="relative mt-1 ml-1.5 shrink-0" aria-hidden>
            <div className="flex h-[34px] w-[56px] flex-col items-center justify-center rounded-md border-2 border-[var(--st-reserved)] bg-[var(--st-reserved-tint)] leading-none">
              <span className="text-[10px] font-bold text-foreground">A4</span>
              <span className="mt-0.5 text-[8px] text-muted-foreground">21:35</span>
            </div>
            <span className="absolute -top-1.5 -left-1.5 grid size-4 place-items-center rounded-full bg-[var(--st-reserved)] text-[8px] font-bold text-white">
              2
            </span>
            <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full border border-white/90 bg-black text-[8px] font-bold text-white">
              2
            </span>
            <span className="absolute -bottom-2 -left-2 text-[11px]">🔥</span>
            <span className="absolute -right-2 -bottom-2 text-[11px]">📌</span>
          </div>
          <ul className="grid flex-1 gap-1 text-xs leading-snug text-muted-foreground">
            <li>
              <span className="font-semibold text-foreground">Số khách</span> · góc trên trái
            </li>
            <li>
              <span className="font-semibold text-foreground">Số lượt khách</span> · góc trên phải, chỉ hiện từ lượt thứ
              2 trong ca
            </li>
            <li>
              <span className="font-semibold text-foreground">Khách quen / mới</span> · góc dưới trái
            </li>
            <li>
              <span className="font-semibold text-foreground">VIP / Sinh nhật / Chỉ định</span> · góc dưới phải
            </li>
          </ul>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Mã bàn và giờ khách đến nằm trong ô bàn.</p>
      </div>

      {/* Bottom-left corner: who the guest is */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <div className="mb-2 font-semibold text-foreground">Icon góc dưới trái · phân loại khách</div>
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="text-base" aria-hidden>
              🔥
            </span>
            <span>Đã từng đặt bàn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base" aria-hidden>
              🆕
            </span>
            <span>Chưa từng đặt bàn</span>
          </div>
        </div>
      </div>

      {/* Bottom-right corner: what the table is */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <div className="mb-2 font-semibold text-foreground">Icon góc dưới phải · phân loại bàn</div>
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="text-base" aria-hidden>
              ⭐
            </span>
            <span>Bàn sếp / VIP</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base" aria-hidden>
              🎂
            </span>
            <span>Sinh nhật</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base" aria-hidden>
              📌
            </span>
            <span>Chỉ định</span>
          </div>
        </div>
      </div>

      {/* Merge group */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <div className="mb-1 font-semibold text-foreground">Nhóm bàn ghép</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-bold text-foreground">G01 / G02</span>: các bàn ghép thuộc cùng MỘT tốp khách. Khi ghép,
          mọi bàn trong nhóm có trạng thái giống nhau và tổng số khách chỉ tính 1 lần.
        </p>
      </div>

      {/* Bar panel rows */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
        <div className="mb-1.5 font-semibold text-foreground">Khu quầy bar</div>
        <div className="mb-1.5 rounded border border-border/50 bg-background px-1.5 py-1 leading-tight">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground">
            <span className="inline-block size-1.5 rounded-full bg-[var(--st-seated)]" aria-hidden />
            Bar5-6
          </div>
          <div className="text-[10px] text-muted-foreground">20:00 · 2</div>
          <div className="text-[10.5px] font-medium text-foreground">Dương Quốc Long</div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Mỗi dòng luôn có đủ: mã ghế (ghép thì nối bằng dấu gạch) · giờ đặt · số khách. Khách vào thẳng chưa đặt trước
          thì giờ ghi là <span className="font-semibold text-foreground">vào HH:MM</span>. Màu chấm theo trạng thái
          khách.
        </p>
      </div>

      {showSpareSection ? (
        <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-foreground">
            <span
              className="inline-flex h-4 w-6 items-center justify-center rounded-[4px] border border-dashed text-[8px] font-bold"
              style={{ borderColor: "var(--table-line)", background: "var(--st-free-tint)" }}
              aria-hidden
            >
              A10
            </span>
            <span>Bàn sơ cua</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ô bàn viền nét đứt dùng dự phòng khi khu vực chính đã kín hoặc cần kê thêm bàn (ví dụ A10). Bình thường
            không tính vào số bàn trống sẵn sàng nhận; chỉ chuyển sang màu trạng thái tương ứng khi Lễ tân xếp khách.
          </p>
        </div>
      ) : null}

      {showReceptionNote ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Bàn tới muộn chuyển sang màu đỏ khi quá giờ hẹn. Mặc định ẩn chú giải icon dưới nút ⓘ để không che bàn; chú
          giải màu bàn vẫn luôn hiển thị.
        </p>
      ) : null}

      <Button type="button" onClick={onClose} className="w-full">
        Đã hiểu
      </Button>
    </div>
  )
}

export function StatusLegend({ tables = [], states, className, variant = "card" }: StatusLegendProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  // The popover renders through the house Popover portal (document.body), so it escapes the
  // legend's stacking context and any clipping ancestor. When the legend lives inside the mobile
  // shell, the portalled content re-applies [data-gm] so the mobile theme tokens still resolve.
  const [inMobileShell, setInMobileShell] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useMediaQuery("(min-width: 640px)")

  useEffect(() => {
    if (triggerRef.current?.closest("[data-gm]")) {
      setInMobileShell(true)
    }
  }, [])

  const includeOos = variant === "admin"
  const counts = calculateStatusCounts(tables, states, { includeOos })
  const chips = buildLegendChips(counts, includeOos)

  const onOpenChange = (open: boolean) => {
    if (open) setInMobileShell(Boolean(triggerRef.current?.closest("[data-gm]")))
    setPopoverOpen(open)
  }

  const closeAndReturnFocus = () => {
    setPopoverOpen(false)
    triggerRef.current?.focus()
  }

  /** Chips: 3-column grid on mobile (exact 2 rows of 3), 1 compact row on desktop if it fits */
  const chipsGrid = <LegendChipsGrid chips={chips} />

  if (variant === "admin") {
    const triggerButton = (
      <button
        ref={triggerRef}
        type="button"
        aria-label="Chú giải ký hiệu"
        data-testid="so-legend-trigger"
        onPointerEnter={() => void prewarmMotionController()}
        onPointerDown={() => void prewarmMotionController()}
        onFocus={() => void prewarmMotionController()}
        className={cn(
          "group inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-[34px] place-items-center rounded-full border border-[var(--adm-border,#e2dfd8)] bg-[var(--adm-surface,#ffffff)] text-[15px] leading-none font-bold text-[var(--adm-brand-navy,#102a43)] shadow-xs transition-[transform,background-color,border-color,color,box-shadow] duration-[var(--duration-hover,160ms)] ease-[var(--ease-spring-default,ease)] group-hover:border-[var(--adm-border-strong,#b8b3a8)] group-hover:bg-[var(--adm-surface-sunken,#f0eee9)] group-focus-visible:border-[var(--adm-action,#1d6fc2)] group-focus-visible:ring-[3px] group-focus-visible:ring-[var(--adm-action,#1d6fc2)]/25 group-active:scale-95 group-data-[state=open]:border-[var(--adm-action,#1d6fc2)] group-data-[state=open]:bg-[var(--adm-tint-blue,#e8f1fa)] group-data-[state=open]:text-[var(--adm-action,#1d6fc2)]"
        >
          !
        </span>
      </button>
    )

    const body = (
      <StatusLegendContent
        chipsGrid={chipsGrid}
        showStatusChips
        showSpareSection
        showReceptionNote={false}
        onClose={closeAndReturnFocus}
      />
    )

    if (!isDesktop) {
      return (
        <Sheet open={popoverOpen} onOpenChange={onOpenChange}>
          <SheetTrigger asChild>{triggerButton}</SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            data-testid="so-legend-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              triggerRef.current?.focus()
            }}
            className="admin-portal adm-dialog max-h-[85dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
          >
            <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-border-strong" />
            </div>
            <SheetHeader className="flex-row items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <div className="min-w-0">
                <SheetTitle className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">
                  Chú giải ký hiệu
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Giải thích màu ô bàn, thông tin trong ô bàn, phân loại khách, loại bàn, nhóm bàn ghép, khu quầy bar và
                  bàn sơ cua.
                </SheetDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPopoverOpen(false)}
                className="rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Đóng bảng chú giải"
              >
                <X className="size-4" />
              </Button>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <StatusLegendContent
                chipsGrid={chipsGrid}
                showStatusChips
                showSpareSection
                showReceptionNote={false}
                onClose={() => setPopoverOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )
    }

    return (
      <Popover open={popoverOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label="Chú giải ký hiệu"
          data-testid="so-legend-dialog"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="admin-portal adm-dialog max-h-[min(78dvh,var(--radix-popover-content-available-height))] w-[calc(100vw-32px)] max-w-sm overflow-y-auto rounded-xl border-border p-4 shadow-float"
        >
          <div className="mb-3 flex items-center justify-between border-b border-border-subtle pb-2.5">
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">Chú giải ký hiệu</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={closeAndReturnFocus}
              className="rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Đóng bảng chú giải"
            >
              <X className="size-4" />
            </Button>
          </div>
          {body}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={popoverOpen} onOpenChange={onOpenChange}>
      {variant === "badge" ? (
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Ký hiệu: mở bảng chú giải trạng thái, ký hiệu khách và nhóm bàn"
            className={cn(
              "grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-full border border-border bg-surface-1 text-tx-strong shadow-[var(--shadow-xs)] transition-[transform,background-color,border-color] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] hover:border-border-strong hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-95",
              className,
            )}
          >
            <Info className="size-5 shrink-0" aria-hidden />
          </button>
        </PopoverTrigger>
      ) : (
        <div
          className={cn("relative rounded-xl border border-border bg-surface-1 p-2.5 shadow-xs select-none", className)}
          role="region"
          aria-label="Chú giải trạng thái bàn"
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
            <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              Trạng thái · Số bàn / ghế
            </span>
            <PopoverTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className="-my-2.5 inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-[var(--duration-hover)] hover:bg-surface-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
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
        className="max-h-(--radix-popover-content-available-height) w-[calc(100vw-32px)] max-w-sm overflow-y-auto rounded-xl border-border p-4 shadow-float"
      >
        <div className="mb-3 flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">Chú giải ký hiệu</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={closeAndReturnFocus}
            className="rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Đóng bảng chú giải"
          >
            <X className="size-4" />
          </Button>
        </div>

        <StatusLegendContent
          chipsGrid={chipsGrid}
          showStatusChips={variant === "badge"}
          showSpareSection={false}
          showReceptionNote
          onClose={closeAndReturnFocus}
        />
      </PopoverContent>
    </Popover>
  )
}
