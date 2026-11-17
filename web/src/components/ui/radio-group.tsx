"use client"

import * as React from "react"
import { CircleIcon } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-2.5", className)} {...props} />
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "relative aspect-square size-[18px] shrink-0 rounded-full border border-input bg-surface-1 text-primary shadow-xs transition-[border-color,box-shadow,transform] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] outline-none",
        "hover:border-border-strong active:scale-95",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25",
        "data-[state=checked]:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/35",
        "[@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:active:after:scale-[1.06]",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 fill-primary text-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
