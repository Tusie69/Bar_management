import type { TableLiveState } from "@/domain/models"
import { cn } from "@/lib/utils"
import { STATE_META } from "./status-meta"

export function StateSwatch({ state, className }: { state: TableLiveState; className?: string }) {
  const meta = STATE_META[state]
  const dashed = state === "spare" || state === "hold" || state === "hold_overdue"
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3 shrink-0 rounded-[3px] border-[1.5px]", className)}
      style={{
        borderColor: meta.color,
        borderStyle: dashed ? "dashed" : "solid",
        background:
          state === "seated"
            ? "var(--st-seated-fill)"
            : state === "oos"
              ? "repeating-linear-gradient(135deg, var(--st-oos) 0 1.5px, transparent 1.5px 4px)"
              : meta.tint,
      }}
    />
  )
}

export function StateChip({
  state,
  className,
  children,
}: {
  state: TableLiveState
  className?: string
  children?: React.ReactNode
}) {
  const meta = STATE_META[state]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklch, ${meta.color} 45%, transparent)`,
        color: meta.ink,
        background: meta.tint,
      }}
    >
      <Icon className="size-3.5" aria-hidden />
      {children ?? meta.label}
    </span>
  )
}

export function WarningChip({ warning, minutes }: { warning: "late" | "noshow" | null; minutes: number }) {
  if (!warning) return null
  return (
    <StateChip state={warning === "late" ? "late" : "noshow"}>
      {warning === "late" ? "Đến muộn" : "Chưa đến"} +{minutes}'
    </StateChip>
  )
}
