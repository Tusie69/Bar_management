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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
    <div className="grid min-w-0 gap-4">
      <div data-adm-reveal className="grid min-w-0 gap-3">
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
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-2.5">
          <DateField id="audit-from" label="Từ ngày" value={from} onChange={setFrom} />
          <DateField id="audit-to" label="Đến ngày" value={to} onChange={setTo} />
          <Button
            type="button"
            disabled={!filters.data?.canExport || exporting || rows.length === 0}
            title={
              filters.data && !filters.data.canExport
                ? "Tài khoản của bạn không được phép xuất file nhật ký."
                : undefined
            }
            onClick={exportFile}
            className="w-full sm:ml-auto sm:w-auto"
          >
            {exporting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            Xuất file
          </Button>
        </div>
      </div>

      <section data-adm-reveal className="adm-card min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="adm-h2">Nhật ký thao tác nhạy cảm</h2>
            <p className="adm-supporting mt-0.5 break-words text-[var(--adm-text-muted)]">
              Lưu vết để truy trách nhiệm khi có sự cố tiền hoặc dữ liệu khách
              {filters.data ? ` · giữ ${filters.data.retentionDays} ngày` : ""}.
            </p>
          </div>
          {!entries.isPending && !entries.isError ? (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {rows.length} bản ghi
            </Badge>
          ) : null}
        </div>

        {entries.isPending ? (
          <div className="mt-5 grid gap-3" aria-busy="true">
            <p className="sr-only">Đang tải nhật ký…</p>
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : entries.isError ? (
          <div className="mt-5 grid gap-2.5 rounded-xl border border-[var(--adm-state-late)]/25 bg-[var(--adm-tint-red)] p-4">
            <p className="adm-h3 flex items-center gap-2 text-[var(--admin-state-late-ink)]">
              <AlertTriangle className="size-4 shrink-0" aria-hidden /> Không tải được nhật ký
            </p>
            <p className="adm-body break-words text-[var(--adm-text-muted)]">
              {entries.error instanceof Error ? entries.error.message : "Lỗi không xác định."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void entries.refetch()}
              className="justify-self-start bg-[var(--adm-surface)]"
            >
              Thử lại
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="adm-body mt-5 rounded-xl border border-dashed border-[var(--adm-border)] bg-[var(--adm-canvas)]/60 p-6 text-center break-words text-[var(--adm-text-muted)]">
            {types.length || from || to
              ? "Không có thao tác nào khớp bộ lọc."
              : "Chưa có thao tác nào được ghi trong khoảng thời gian lưu nhật ký."}
          </p>
        ) : (
          <>
            {/* Mobile (< 768px): danh sách thẻ xếp chồng đọc trọn vẹn không cắt chữ */}
            <ul className="mt-4 grid gap-3 md:hidden">
              {rows.map((entry) => (
                <li
                  key={entry.id}
                  className="grid gap-2 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-surface)] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="secondary" className="max-w-full truncate">
                      {entry.actionLabel}
                    </Badge>
                    <span className="adm-caption font-medium text-[var(--adm-text-muted)] tabular-nums">
                      {fmtAuditTime(entry.occurredAt)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="adm-body font-medium break-words text-[var(--adm-text)]">{entry.target}</p>
                    {entry.detail ? (
                      <p className="adm-caption mt-0.5 break-words text-[var(--adm-text-muted)]">{entry.detail}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--adm-border-subtle)] pt-2 text-xs text-[var(--adm-text-muted)]">
                    <span className="min-w-0 break-words">
                      <strong className="font-medium text-[var(--adm-text)]">{entry.actor}</strong>
                      {entry.actorUsername ? ` (@${entry.actorUsername})` : ""}
                    </span>
                    <span className="shrink-0">{entry.device}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet & Desktop (>= 768px): Table primitive */}
            <div className="mt-4 hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Người thực hiện</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Đối tượng</TableHead>
                    <TableHead>Thiết bị</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </TableBody>
              </Table>
            </div>

            {entries.data?.hasMore ? (
              <p className="adm-caption mt-3 text-[var(--adm-text-muted)]">
                Còn thao tác cũ hơn. Thu hẹp khoảng ngày để xem tiếp.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntryView }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap tabular-nums">{fmtAuditTime(entry.occurredAt)}</TableCell>
      <TableCell className="whitespace-normal">
        <span className="block font-medium text-[var(--adm-text)]">{entry.actor}</span>
        {entry.actorUsername ? (
          <span className="adm-caption block text-[var(--adm-text-muted)]">@{entry.actorUsername}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{entry.actionLabel}</Badge>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="block break-words">{entry.target}</span>
        {entry.detail ? (
          <span className="adm-caption block break-words text-[var(--adm-text-muted)]">{entry.detail}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-[var(--adm-text-muted)]">{entry.device}</TableCell>
    </TableRow>
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
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "border-[var(--adm-action)] bg-[var(--adm-tint-blue)] text-[var(--adm-action)] hover:bg-[var(--adm-tint-blue-hover)] hover:text-[var(--adm-action)]"
          : "bg-[var(--adm-surface)] text-[var(--adm-text)]"
      }
    >
      {label}
    </Button>
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
    <div className="grid min-w-[140px] flex-1 gap-1.5 sm:w-44 sm:flex-initial">
      <Label htmlFor={id} className="adm-label text-[var(--adm-text-muted)]">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 bg-[var(--adm-surface)]"
      />
    </div>
  )
}
