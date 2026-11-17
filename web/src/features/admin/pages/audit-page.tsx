/**
 * TU-35 — 03 · Nhật ký thao tác.
 *
 * Bố cục theo prototype: hàng nút lọc theo loại hành động + nút Xuất file, rồi
 * bảng năm cột Thời gian · Người thực hiện · Hành động · Đối tượng · Thiết bị.
 * Thêm hai ô ngày vì AC yêu cầu lọc được theo khoảng ngày — prototype vẽ ở
 * mức ca hiện tại, nhưng nhật ký giữ tới 90 ngày.
 *
 * Màn này không hiện số điện thoại: backend ghi VIỆC xem số, không ghi số.
 */
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Download, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import type { AuditEntryView } from "@/services/contracts"
import { fmtAuditTime } from "../audit-format"

const PAGE_SIZE = 50

export default function AdminAuditPage() {
  const [types, setTypes] = useState<string[]>([])
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [exporting, setExporting] = useState(false)

  const filters = useQuery({
    queryKey: ["admin", "audit-filters"],
    queryFn: () => api.getAuditFilters(),
    retry: false,
  })

  const query = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(types.length ? { types } : {}),
  }

  const entries = useQuery({
    queryKey: ["admin", "audit", from, to, [...types].sort().join(",")],
    queryFn: () => api.listAuditEntries({ ...query, limit: PAGE_SIZE }),
    retry: false,
  })

  const toggle = (type: string) =>
    setTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]))

  const exportFile = () => {
    if (exporting) return
    setExporting(true)
    void api
      .exportAuditCsv(query)
      .then((csv) => {
        // Tạo file ngay trên trình duyệt: nội dung đã qua kiểm quyền ở server,
        // không cần một đường tải riêng không kèm cookie phiên.
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `nhat-ky-thao-tac-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
        toast.success("Đã tải file nhật ký.")
      })
      .catch(reportError)
      .finally(() => setExporting(false))
  }

  const rows = entries.data?.entries ?? []

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="Tất cả" active={types.length === 0} onClick={() => setTypes([])} />
        {(filters.data?.filters ?? []).map((filter) => (
          <FilterChip
            key={filter.type}
            label={filter.label}
            active={types.includes(filter.type)}
            disabled={!filter.supported}
            title={filter.note}
            onClick={() => toggle(filter.type)}
          />
        ))}
        <div className="flex items-center gap-2 md:ml-auto">
          <DateField id="audit-from" label="Từ ngày" value={from} onChange={setFrom} />
          <DateField id="audit-to" label="Đến ngày" value={to} onChange={setTo} />
          <button
            type="button"
            disabled={!filters.data?.canExport || exporting || rows.length === 0}
            title={
              filters.data && !filters.data.canExport
                ? "Tài khoản của bạn không được phép xuất file nhật ký."
                : undefined
            }
            onClick={exportFile}
            className="adm-body inline-flex h-11 items-center gap-2 self-end rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {exporting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
            Xuất file
          </button>
        </div>
      </div>

      <section className="adm-card min-w-0 p-5">
        <h2 className="adm-h2">Nhật ký thao tác nhạy cảm</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Lưu vết để truy trách nhiệm khi có sự cố tiền hoặc dữ liệu khách
          {filters.data ? ` · giữ ${filters.data.retentionDays} ngày` : ""}.
        </p>

        {entries.isPending ? (
          <p className="adm-body mt-6 flex items-center gap-2 text-[var(--adm-text-muted)]">
            <LoaderCircle className="size-4 animate-spin" /> Đang tải nhật ký…
          </p>
        ) : entries.isError ? (
          <div className="mt-6 grid gap-2 rounded-lg bg-[var(--adm-tint-red)] p-4">
            <p className="adm-h3 flex items-center gap-2">
              <AlertTriangle className="size-4" /> Không tải được nhật ký
            </p>
            <p className="adm-body text-[var(--adm-text-muted)]">
              {entries.error instanceof Error ? entries.error.message : "Lỗi không xác định."}
            </p>
            <button
              type="button"
              onClick={() => void entries.refetch()}
              className="adm-body h-10 justify-self-start rounded-lg border border-[var(--adm-border)] px-4"
            >
              Thử lại
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="adm-body mt-6 text-[var(--adm-text-muted)]">
            {types.length || from || to
              ? "Không có thao tác nào khớp bộ lọc."
              : "Chưa có thao tác nào được ghi trong khoảng thời gian lưu nhật ký."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--adm-border)]">
                  {["Thời gian", "Người thực hiện", "Hành động", "Đối tượng", "Thiết bị"].map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className="adm-label pb-2 tracking-wide text-[var(--adm-text-muted)] uppercase"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
            {entries.data?.hasMore ? (
              <p className="adm-label mt-3 text-[var(--adm-text-muted)]">
                Còn thao tác cũ hơn. Thu hẹp khoảng ngày để xem tiếp.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntryView }) {
  return (
    <tr className="border-b border-[var(--adm-border)] last:border-0">
      <td className="adm-body py-3 whitespace-nowrap tabular-nums">{fmtAuditTime(entry.occurredAt)}</td>
      <td className="adm-body py-3">
        {entry.actor}
        {entry.actorUsername ? (
          <span className="adm-label block text-[var(--adm-text-muted)]">@{entry.actorUsername}</span>
        ) : null}
      </td>
      <td className="adm-body py-3">{entry.actionLabel}</td>
      <td className="adm-body py-3">
        {entry.target}
        {entry.detail ? <span className="adm-label block text-[var(--adm-text-muted)]">{entry.detail}</span> : null}
      </td>
      <td className="adm-body py-3 text-[var(--adm-text-muted)]">{entry.device}</td>
    </tr>
  )
}

function FilterChip({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className="adm-body h-11 rounded-lg border px-4 disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        borderColor: active ? "var(--adm-action)" : "var(--adm-border)",
        background: active ? "var(--adm-tint-blue)" : "var(--adm-surface)",
        color: active ? "var(--adm-action)" : "var(--adm-text)",
      }}
    >
      {label}
    </button>
  )
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="adm-label text-[var(--adm-text-muted)]">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="adm-body h-11 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-3"
      />
    </div>
  )
}
