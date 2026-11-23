/**
 * TU-39 + Redesign P1 — Trang "Đang xây dựng" cho mọi mục chưa có nội dung nghiệp vụ.
 */
import { Hammer } from "lucide-react"
import type { AdminPage } from "./admin-pages"

const STATUS_NOTE: Record<AdminPage["status"], string> = {
  integrated: "Đang hoàn thiện.",
  pending: "Màn hình đang được phát triển trong một task riêng và sẽ ghép vào khung này.",
  phase2: "Thuộc đợt 2. Một phần dữ liệu (tiền, hóa đơn) chưa có trong hệ thống nên chưa dựng được.",
}

const STATUS_BADGE: Record<AdminPage["status"], string> = {
  integrated: "Đang hoàn thiện",
  pending: "Đang phát triển",
  phase2: "Đợt 2",
}

export function AdminPlaceholder({ page }: { page: AdminPage }) {
  return (
    <section
      data-adm-reveal
      className="adm-card grid max-w-2xl min-w-0 gap-4 p-4 sm:p-6"
      aria-labelledby={`adm-placeholder-${page.path}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--adm-state-soon)]/25 bg-[var(--adm-tint-amber)]">
          <Hammer className="size-5 text-[var(--adm-state-soon)]" aria-hidden />
        </span>
        <span className="adm-caption shrink-0 rounded-full border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] px-2.5 py-1 font-medium text-[var(--adm-text)]">
          {STATUS_BADGE[page.status]}
        </span>
      </div>
      <div className="grid min-w-0 gap-1.5">
        <h2 id={`adm-placeholder-${page.path}`} className="adm-h2 break-words">
          {page.title} — đang xây dựng
        </h2>
        {page.note ? <p className="adm-body break-words text-[var(--adm-text-muted)]">{page.note}</p> : null}
      </div>
      <p className="adm-supporting border-t border-[var(--adm-border-subtle)] pt-3 break-words">
        {STATUS_NOTE[page.status]}
        {page.owner ? ` Mã task: ${page.owner}.` : ""}
      </p>
    </section>
  )
}
