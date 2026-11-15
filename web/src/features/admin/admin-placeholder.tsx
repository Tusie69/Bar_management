/**
 * TU-39 — Trang "Đang xây dựng" cho mọi mục chưa có nội dung nghiệp vụ.
 *
 * Có quyền xem mà gặp màn trắng thì người dùng sẽ báo là app hỏng. Placeholder
 * nói rõ trang sẽ có gì và ai đang làm, và không giả lập dữ liệu Figma: số
 * liệu mẫu trong prototype là số mẫu, đưa vào đây sẽ bị đọc như số thật.
 */
import { Hammer } from "lucide-react"
import type { AdminPage } from "./admin-pages"

const STATUS_NOTE: Record<AdminPage["status"], string> = {
  integrated: "Đang hoàn thiện.",
  pending: "Màn hình đang được phát triển trong một task riêng và sẽ ghép vào khung này.",
  phase2: "Thuộc đợt 2. Một phần dữ liệu (tiền, hóa đơn) chưa có trong hệ thống nên chưa dựng được.",
}

export function AdminPlaceholder({ page }: { page: AdminPage }) {
  return (
    <section className="adm-card grid gap-3 p-6" aria-labelledby={`adm-placeholder-${page.path}`}>
      <span className="grid size-10 place-items-center rounded-lg bg-[var(--adm-tint-amber)]">
        <Hammer className="size-5 text-[var(--adm-state-soon)]" />
      </span>
      <h2 id={`adm-placeholder-${page.path}`} className="adm-h2">
        {page.title} — đang xây dựng
      </h2>
      {page.note ? <p className="adm-body max-w-2xl text-[var(--adm-text-muted)]">{page.note}</p> : null}
      <p className="adm-body text-[var(--adm-text-muted)]">
        {STATUS_NOTE[page.status]}
        {page.owner ? ` Mã task: ${page.owner}.` : ""}
      </p>
    </section>
  )
}
