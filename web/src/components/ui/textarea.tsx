import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-surface-1 px-3 py-2 text-base text-foreground shadow-xs transition-[border-color,box-shadow,background-color] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] outline-none",
        "placeholder:text-muted-foreground md:text-sm",
        "hover:border-border-strong",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/35",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
