import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium tracking-[-0.005em] whitespace-nowrap outline-none select-none",
    "transition-[transform,background-color,border-color,color,box-shadow] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)]",
    "active:scale-[0.97] active:duration-[var(--duration-press)] active:ease-[var(--ease-press)]",
    "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25",
    "disabled:pointer-events-none disabled:opacity-45",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/35",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]",
        destructive:
          "bg-destructive text-[var(--destructive-foreground)] shadow-xs hover:brightness-95 focus-visible:border-destructive focus-visible:ring-destructive/30 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border bg-surface-1 text-foreground shadow-xs hover:border-border-strong hover:bg-surface-2 dark:border-input dark:bg-surface-1 dark:hover:bg-surface-2",
        secondary: "border border-border-subtle bg-secondary text-secondary-foreground hover:bg-surface-3",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/60",
        link: "text-primary-ink underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-11 px-4 py-2 has-[>svg]:px-3.5",
        xs: "relative h-7 gap-1 rounded-sm px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:active:after:scale-[1.04]",
        sm: "relative h-9 gap-1.5 rounded-sm px-3 has-[>svg]:px-2.5 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:active:after:scale-[1.04]",
        lg: "h-12 rounded-lg px-6 text-base has-[>svg]:px-5",
        icon: "size-11",
        "icon-xs":
          "relative size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:active:after:scale-[1.04]",
        "icon-sm":
          "relative size-9 rounded-sm [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:active:after:scale-[1.04]",
        "icon-lg": "size-12 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
