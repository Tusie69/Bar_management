"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium tracking-[-0.005em] whitespace-nowrap outline-none select-none",
    "transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)]",
    "hover:bg-accent hover:text-foreground active:scale-[0.97]",
    "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25",
    "disabled:pointer-events-none disabled:opacity-45",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/35",
    "data-[state=on]:bg-surface-1 data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-xs",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-transparent text-muted-foreground",
        outline:
          "border border-input bg-surface-1 text-foreground hover:bg-surface-2 data-[state=on]:border-primary data-[state=on]:bg-primary-tint data-[state=on]:text-primary-ink",
      },
      size: {
        default: "h-9 min-w-9 px-3",
        sm: "h-8 min-w-8 rounded-sm px-2.5 text-xs",
        lg: "h-11 min-w-11 px-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
  )
}

export { Toggle, toggleVariants }
