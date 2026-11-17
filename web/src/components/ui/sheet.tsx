"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { mergeRefs, usePresenceController, useSheetPresenceMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

interface SheetMotionState {
  isOpen: boolean
  present: boolean
  markExited: () => void
}

const SheetMotionContext = React.createContext<SheetMotionState | null>(null)

function Sheet({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const { isOpen, present, handleOpenChange, markExited } = usePresenceController({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  const value = React.useMemo(() => ({ isOpen, present, markExited }), [isOpen, markExited, present])

  return (
    <SheetMotionContext.Provider value={value}>
      <SheetPrimitive.Root data-slot="sheet" open={present} onOpenChange={handleOpenChange} {...props} />
    </SheetMotionContext.Provider>
  )
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const motion = React.useContext(SheetMotionContext)
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-[var(--z-drawer)] bg-[var(--scrim)]",
        motion && !motion.isOpen && "pointer-events-none",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ref,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  const motion = React.useContext(SheetMotionContext)
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  useSheetPresenceMotion({
    open: motion?.isOpen ?? true,
    present: motion?.present ?? true,
    side,
    overlayRef,
    contentRef,
    onExitComplete: () => motion?.markExited(),
  })

  return (
    <SheetPortal>
      <SheetOverlay ref={overlayRef} />
      <SheetPrimitive.Content
        ref={mergeRefs(ref, contentRef)}
        data-slot="sheet-content"
        data-side={side}
        data-motion-state={motion?.isOpen === false ? "closing" : "open"}
        className={cn(
          "fixed z-[var(--z-drawer)] flex flex-col gap-4 bg-popover text-popover-foreground shadow-float outline-none",
          side === "right" && "inset-y-0 right-0 h-full w-3/4 border-l border-border sm:max-w-sm",
          side === "left" && "inset-y-0 left-0 h-full w-3/4 border-r border-border sm:max-w-sm",
          side === "top" && "inset-x-0 top-0 h-auto rounded-b-2xl border-b border-border",
          side === "bottom" && "inset-x-0 bottom-0 h-auto rounded-t-2xl border-t border-border",
          motion && !motion.isOpen && "pointer-events-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-3 right-3 grid size-11 place-items-center rounded-md opacity-70 ring-offset-background transition-[opacity,background-color,transform] duration-[var(--duration-hover)] hover:bg-accent hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-hidden active:scale-95 disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Đóng</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg leading-snug font-semibold tracking-[-0.015em] text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
