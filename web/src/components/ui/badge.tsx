import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "tnum inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium tracking-[0.01em] whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-[var(--primary-hover)]",
        secondary: "border-border-subtle bg-secondary text-secondary-foreground [a&]:hover:bg-surface-3",
        destructive:
          "bg-[var(--destructive-badge-bg)] text-[var(--destructive-foreground)] focus-visible:ring-destructive/25 dark:focus-visible:ring-destructive/40 [a&]:hover:brightness-95",
        outline: "border-border bg-surface-1 text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary-ink underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
