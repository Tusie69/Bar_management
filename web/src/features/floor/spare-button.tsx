import { useState } from "react"
import { CircleDashed, Loader2 } from "lucide-react"
import type { TableLiveState, TableView } from "@/domain/models"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCan } from "@/state/session"
import { spareDecision, useSpareToggle } from "./spare-table"

export interface SpareButtonProps {
  table: TableView
  state?: TableLiveState
  hasClaim?: boolean
  inGroup?: boolean
  canConfigure?: boolean
  className?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  showReason?: boolean
  onSuccess?: () => void
}

/**
 * SpareButton: Single component for desktop table panel and mobile sheet.
 * Toggles whether a table is marked as a spare ("Sơ cua") table.
 *
 * Rules:
 * - Label: "Sơ cua" for normal table, "Bỏ sơ cua" for spare table.
 * - Disabled with visible reason when action is not allowed.
 * - Shows pending state and blocks double tap.
 * - Min 44px touch target on mobile (WCAG 2.5.5).
 * - No optimistic state.
 */
export function SpareButton({
  table,
  state: stateProp,
  hasClaim: hasClaimProp,
  inGroup: inGroupProp,
  canConfigure: canConfigureProp,
  className,
  variant = "outline",
  size = "default",
  showReason = true,
  onSuccess,
}: SpareButtonProps) {
  const userCanConfigure = useCan("venue.configure")
  const canConfigure = canConfigureProp ?? userCanConfigure

  const state: TableLiveState =
    stateProp ??
    (table as { state?: TableLiveState; liveState?: TableLiveState }).state ??
    (table as { state?: TableLiveState; liveState?: TableLiveState }).liveState ??
    (table.isSpare ? "spare" : "free")

  const hasClaim = hasClaimProp ?? Boolean((table as { claim?: unknown }).claim)
  const inGroup =
    inGroupProp ??
    Boolean(
      (table as { groupId?: unknown; groupCode?: unknown }).groupId ||
        (table as { groupId?: unknown; groupCode?: unknown }).groupCode,
    )

  const decision = spareDecision({
    table,
    state,
    hasClaim,
    inGroup,
    canConfigure,
  })

  const { toggle, pending: togglePending } = useSpareToggle()
  const [localPending, setLocalPending] = useState(false)
  const pending = togglePending || localPending

  const label = decision.action === "unmark" ? "Bỏ sơ cua" : "Sơ cua"
  const disabled = !decision.allowed || pending

  const handleClick = async () => {
    if (pending || !decision.allowed) return
    setLocalPending(true)
    try {
      const ok = await toggle(table)
      if (ok) {
        onSuccess?.()
      }
    } finally {
      setLocalPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 w-full" data-slot="spare-button-container">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        aria-disabled={disabled}
        title={!decision.allowed ? decision.reason : undefined}
        aria-label={label}
        className={cn("min-h-[44px] w-full", className)}
        onClick={handleClick}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>Đang lưu...</span>
          </>
        ) : (
          <>
            <CircleDashed className="size-4" aria-hidden />
            <span>{label}</span>
          </>
        )}
      </Button>
      {showReason && !decision.allowed && decision.reason ? (
        <span
          className="text-[11px] leading-tight text-muted-foreground text-center px-1"
          role="note"
          data-slot="spare-button-reason"
        >
          {decision.reason}
        </span>
      ) : null}
    </div>
  )
}
