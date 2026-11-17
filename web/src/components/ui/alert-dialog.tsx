"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import {
  OverlayMotionMount,
  prewarmMotionController,
  useAwaitingMotionController,
  usePresenceController,
  useStableNodeRef,
} from "@/lib/motion"
import { cn } from "@/lib/utils"

interface AlertMotionState {
  isOpen: boolean
  present: boolean
  markExited: () => void
}

const AlertDialogMotionContext = React.createContext<AlertMotionState | null>(null)

function AlertDialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  const { isOpen, present, handleOpenChange, markExited } = usePresenceController({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  const value = React.useMemo(() => ({ isOpen, present, markExited }), [isOpen, markExited, present])

  return (
    <AlertDialogMotionContext.Provider value={value}>
      <AlertDialogPrimitive.Root data-slot="alert-dialog" open={present} onOpenChange={handleOpenChange} {...props} />
    </AlertDialogMotionContext.Provider>
  )
}

function AlertDialogTrigger({
  onPointerEnter,
  onPointerDown,
  onFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      onPointerEnter={(event) => {
        void prewarmMotionController()
        onPointerEnter?.(event)
      }}
      onPointerDown={(event) => {
        void prewarmMotionController()
        onPointerDown?.(event)
      }}
      onFocus={(event) => {
        void prewarmMotionController()
        onFocus?.(event)
      }}
      {...props}
    />
  )
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  const motion = React.useContext(AlertDialogMotionContext)
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] bg-[var(--scrim)]",
        motion && !motion.isOpen && "pointer-events-none",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ref,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
}) {
  const motion = React.useContext(AlertDialogMotionContext)
  const isOpen = motion?.isOpen ?? true
  const present = motion?.present ?? true
  const [overlayEl, overlayCallbackRef] = useStableNodeRef<HTMLDivElement>()
  const [contentEl, contentCallbackRef] = useStableNodeRef<HTMLDivElement>(ref)
  const { awaitingMotion, fallbackShown } = useAwaitingMotionController(present, isOpen)
  const handleExitComplete = React.useCallback(() => {
    motion?.markExited()
  }, [motion])

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay ref={overlayCallbackRef} style={awaitingMotion ? { opacity: 0 } : undefined} />
      <AlertDialogPrimitive.Content
        ref={contentCallbackRef}
        data-slot="alert-dialog-content"
        data-size={size}
        data-motion-state={motion?.isOpen === false ? "closing" : "open"}
        style={awaitingMotion ? { opacity: 0, ...style } : style}
        className={cn(
          "group/alert-dialog-content fixed top-[50%] left-[50%] z-[var(--z-modal)] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-float outline-none data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg",
          motion && !motion.isOpen && "pointer-events-none",
          className,
        )}
        {...props}
      />
      {present && overlayEl && contentEl ? (
        <OverlayMotionMount
          kind="dialog"
          open={isOpen}
          skipInitialEnter={fallbackShown}
          overlay={overlayEl}
          content={contentEl}
          onExitComplete={handleExitComplete}
        />
      ) : null}
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 pt-1 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "text-lg leading-snug font-semibold tracking-[-0.015em] sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-14 items-center justify-center rounded-lg bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-7",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action data-slot="alert-dialog-action" className={cn(className)} {...props} />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" className={cn(className)} {...props} />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
