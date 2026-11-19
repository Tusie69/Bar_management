import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("gam-skeleton rounded-md bg-surface-2 dark:bg-surface-3", className)}
      {...props}
    />
  )
}

export { Skeleton }
