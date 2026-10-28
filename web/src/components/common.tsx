import { Lock, Minus, Plus } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PERMISSION_LABEL, type Permission } from "@/domain/access"
import { symbolByNo } from "@/domain/symbols"
import { maskedPhone } from "@/lib/text"
import { cn } from "@/lib/utils"
import { initialsOf, toneFor } from "./tone"
import { useCan } from "@/state/session"

export function GroupSymbolIcon({
  no,
  size = 14,
  className,
  title,
}: {
  no: number | null | undefined
  size?: number
  className?: string
  title?: string
}) {
  const sym = symbolByNo(no)
  if (!sym) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title ?? `Ký hiệu ghép: ${sym.name}`}
    >
      <path d={sym.path} fill="currentColor" />
    </svg>
  )
}

export function TableCodes({
  codes,
  symbolNo,
  className,
}: {
  codes: string[]
  symbolNo?: number | null
  className?: string
}) {
  if (codes.length === 0) return <span className={cn("text-sm text-subtle", className)}>Chưa có bàn</span>
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {symbolNo ? <GroupSymbolIcon no={symbolNo} size={13} className="text-foreground" /> : null}
      <span className="text-sm font-semibold tracking-tight">{codes.join(" + ")}</span>
    </span>
  )
}

export function MaskedPhone({ last3, className }: { last3: string | null; className?: string }) {
  return (
    <span
      className={cn("tnum inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
      title="Lễ tân chỉ thấy 3 số cuối. Số đầy đủ chỉ Chủ quán được xem (có ghi nhật ký)."
    >
      {maskedPhone(last3)}
    </span>
  )
}

/** Button that stays visible but disabled (with the reason) when the role lacks permission. */
export function GuardedButton({
  permission,
  children,
  disabledReason,
  ...props
}: React.ComponentProps<typeof Button> & { permission?: Permission; disabledReason?: string | null }) {
  const allowed = useCan(permission ?? "customer.view_masked")
  const reason = !allowed && permission ? `Cần quyền: ${PERMISSION_LABEL[permission]}` : (disabledReason ?? null)
  if (!reason) return <Button {...props}>{children}</Button>
  const layout = (props.className ?? "")
    .split(/\s+/)
    .filter((c) => /^((sm|md|lg|xl|2xl):)?(col-span-|w-full|flex-1|justify-self-|self-|hidden$)/.test(c))
    .join(" ")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("grid", layout)} tabIndex={0}>
          <Button {...props} className={cn(props.className, "w-full")} disabled aria-disabled>
            {!allowed ? <Lock className="size-3.5" aria-hidden /> : null}
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 60,
  label,
  size = "default",
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label: string
  size?: "default" | "sm"
}) {
  const sm = size === "sm"
  const btn = sm ? "size-10 rounded-full" : undefined
  return (
    <div
      className={cn("inline-flex items-center border bg-surface-2", sm ? "h-10 rounded-full" : "rounded-xl")}
      role="group"
      aria-label={label}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={btn}
        aria-label={`Giảm ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus />
      </Button>
      <output
        className={cn(
          "tnum text-center font-semibold",
          sm ? "min-w-12 px-1 text-sm whitespace-nowrap" : "w-10 text-lg",
        )}
        aria-live="polite"
      >
        {value}
        {sm ? <span className="ml-0.5 text-xs font-normal text-muted-foreground">khách</span> : null}
      </output>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={btn}
        aria-label={`Tăng ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus />
      </Button>
    </div>
  )
}

export function QuickCounts({
  value,
  onChange,
  options = [1, 2, 3, 4, 5, 6, 8, 10],
}: {
  value: number
  onChange: (v: number) => void
  options?: number[]
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Số khách nhanh">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={cn(
            "tnum h-11 min-w-11 rounded-lg border px-3 text-base font-semibold transition-colors",
            value === n ? "border-primary bg-primary text-primary-foreground" : "bg-surface-1 hover:bg-accent",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="eyebrow">{children}</h2>
      {aside}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon ? <div className="text-subtle [&_svg]:size-6">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-sm text-sm text-muted-foreground">{children}</div> : null}
    </div>
  )
}

export function PendingTag({ children = "Chờ PO duyệt" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-md border border-dashed border-strong px-1.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-surface-2 px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
}

/** Initials on an identity tone. Decorative: the name is always printed next to it. */
export function GuestAvatar({
  name,
  seed,
  size = 36,
  className,
}: {
  name: string
  seed?: string | number
  size?: number
  className?: string
}) {
  return (
    <span
      className={cn("tone grid shrink-0 place-items-center rounded-full font-semibold", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ["--h" as string]: toneFor(seed ?? name) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  )
}

/** Small icon + value line. The label is for screen readers only, to keep the drawer quiet. */
export function Fact({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      <dt className="flex shrink-0 items-center">
        <Icon className="size-4 text-subtle" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}
