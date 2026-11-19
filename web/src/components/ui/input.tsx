import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-surface-1 px-3 py-1.5 text-base text-foreground shadow-xs transition-[border-color,box-shadow,background-color] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] outline-none",
        "selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground md:text-sm",
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

export { Input }
