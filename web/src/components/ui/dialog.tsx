"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import {
  OverlayMotionMount,
  prewarmMotionController,
  useAwaitingMotionController,
  usePresenceController,
  useStableNodeRef,
} from "@/lib/motion"
import { cn } from "@/lib/utils"

interface DialogMotionState {
  isOpen: boolean
  present: boolean
  markExited: () => void
}

const DialogMotionContext = React.createContext<DialogMotionState | null>(null)

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const { isOpen, present, handleOpenChange, markExited } = usePresenceController({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  const value = React.useMemo(() => ({ isOpen, present, markExited }), [isOpen, markExited, present])

  return (
    <DialogMotionContext.Provider value={value}>
      <DialogPrimitive.Root data-slot="dialog" open={present} onOpenChange={handleOpenChange} {...props} />
    </DialogMotionContext.Provider>
  )
}

function DialogTrigger({
  onPointerEnter,
  onPointerDown,
  onFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
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

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const motion = React.useContext(DialogMotionContext)
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] bg-[var(--scrim)]",
        motion && !motion.isOpen && "pointer-events-none",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ref,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const motion = React.useContext(DialogMotionContext)
  const isOpen = motion?.isOpen ?? true
  const present = motion?.present ?? true
  const [overlayEl, overlayCallbackRef] = useStableNodeRef<HTMLDivElement>()
  const [contentEl, contentCallbackRef] = useStableNodeRef<HTMLDivElement>(ref)
  const awaitingMotion = useAwaitingMotionController(present, isOpen)
  const handleExitComplete = React.useCallback(() => {
    motion?.markExited()
  }, [motion])

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay ref={overlayCallbackRef} style={awaitingMotion ? { opacity: 0 } : undefined} />
      <DialogPrimitive.Content
        ref={contentCallbackRef}
        data-slot="dialog-content"
        data-motion-state={motion?.isOpen === false ? "closing" : "open"}
        style={awaitingMotion ? { opacity: 0, ...style } : style}
        className={cn(
          "fixed top-[50%] left-[50%] z-[var(--z-modal)] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-float outline-none sm:max-w-lg",
          motion && !motion.isOpen && "pointer-events-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-md opacity-70 ring-offset-background transition-[opacity,background-color,transform] duration-[var(--duration-hover)] hover:bg-accent hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-hidden active:scale-95 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Đóng</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
      {present && overlayEl && contentEl ? (
        <OverlayMotionMount
          kind="dialog"
          open={isOpen}
          overlay={overlayEl}
          content={contentEl}
          onExitComplete={handleExitComplete}
        />
      ) : null}
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Đóng</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-snug font-semibold tracking-[-0.015em]", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
