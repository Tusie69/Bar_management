/** Mảnh giao diện dùng chung giữa danh sách và hồ sơ khách (Admin). */
import { UserRound } from "lucide-react"
import { GuestAvatar } from "@/components/common"
import type { CustomerSummary } from "@/domain/models"
import { cn } from "@/lib/utils"
import { ADMIN_BASE_PATH } from "../admin-pages"
import { hasRealName } from "./customers-model"

export const CUSTOMERS_PATH = `${ADMIN_BASE_PATH}/customers`

export function CustomerName({ name, className }: { name: string; className?: string }) {
  return hasRealName(name) ? (
    <span className={cn("font-semibold text-[var(--adm-text)]", className)}>{name}</span>
  ) : (
    <span className={cn("font-medium text-[var(--adm-text-muted)] italic", className)}>
      {name.trim() || "Chưa có tên"}
    </span>
  )
}

export function CustomerAvatar({
  customer,
  size = 36,
}: {
  customer: Pick<CustomerSummary, "id" | "displayName">
  size?: number
}) {
  if (hasRealName(customer.displayName))
    return <GuestAvatar name={customer.displayName} seed={customer.id} size={size} />
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full border border-dashed border-[var(--adm-border-strong)] bg-[var(--adm-surface-sunken)] text-[var(--adm-text-muted)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <UserRound style={{ width: size * 0.45, height: size * 0.45 }} />
    </span>
  )
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Đây là dữ liệu mô phỏng để xem giao diện, không phải khách thật."
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--adm-state-soon)]/30 bg-[var(--adm-tint-amber)] px-2.5 text-xs font-semibold text-[var(--admin-state-soon-ink)]",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-[var(--adm-state-soon)]" aria-hidden />
      DEMO · dữ liệu mô phỏng
    </span>
  )
}
