import { Check, ChevronDown, Pencil, Users, X } from "lucide-react"
import { useEffect, useMemo, useState, type ReactElement } from "react"
import { toast } from "sonner"
import type { ReceptionGuestCount } from "@/domain/models"
import { useReceptionGuestCount, useUpdateReceptionGuestCount } from "@/hooks/use-data"
import type { BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { ApiError } from "@/services/contracts"
import { useCan } from "@/state/session"
import { guestCountDraft, guestCountKeys, parseGuestCountDraft, type GuestCountDraft, type GuestCountKey } from "./guest-count-values"

const emptyCount = (businessDate: BusinessDate): ReceptionGuestCount => ({
  businessDate, arrivedBefore: 0, arrivedAfter: 0, arrivedTotal: 0, bookedTables: 0,
  bookedGuests: 0, returningGuests: 0, version: 0, updatedAt: null,
})

function Row({ label, value, divided, editing, onChange }: {
  label: string; value: number | string; divided?: boolean; editing?: boolean; onChange?: (value: string) => void
}): ReactElement {
  return (
    <div className={cn("flex min-h-4 items-center justify-between gap-1", divided && "mt-0.5 border-t border-border/70 pt-1")}>
      <span className="min-w-0 truncate text-[9px] leading-tight text-tx-2">{label}</span>
      {editing ? (
        <input type="number" min={0} step={1} inputMode="numeric" aria-label={label} value={value}
          onChange={(event) => { const next = event.target.value; if (/^\d*$/.test(next)) onChange?.(next) }}
          className="tnum h-6 w-[60px] shrink-0 rounded-md border border-border bg-background px-1.5 text-right text-[11px] font-semibold text-tx-strong outline-none focus:border-primary" />
      ) : <span className="tnum shrink-0 text-[9px] leading-tight font-bold text-tx-strong">{value}</span>}
    </div>
  )
}

export function GuestCountCard({ businessDate, onOpen, initialOpen = true, tiny = false, className }: {
  businessDate: BusinessDate; onOpen?: () => void; initialOpen?: boolean; tiny?: boolean; className?: string
}): ReactElement {
  const [open, setOpen] = useState(initialOpen)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GuestCountDraft | null>(null)
  const [baseVersion, setBaseVersion] = useState(0)
  const query = useReceptionGuestCount(businessDate)
  const update = useUpdateReceptionGuestCount()
  const canEdit = useCan("reservation.update")
  const count = query.data ?? emptyCount(businessDate)
  const parsed = draft ? parseGuestCountDraft(draft) : null
  const dirty = useMemo(() => Boolean(draft && guestCountKeys.some((key) => draft[key] !== String(count[key]))), [count, draft])
  const remoteChanged = editing && count.version !== baseVersion

  useEffect(() => {
    if (!editing || !dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, editing])

  const discard = () => !dirty || window.confirm("Bỏ các thay đổi bộ đếm khách chưa lưu?")
  const startEdit = () => { setDraft(guestCountDraft(count)); setBaseVersion(count.version); setEditing(true) }
  const cancelEdit = () => { if (discard()) { setEditing(false); setDraft(null) } }
  const toggle = () => {
    if (open && editing && !discard()) return
    if (open) { setEditing(false); setDraft(null) }
    setOpen((value) => !value)
  }
  const reload = () => { setDraft(guestCountDraft(count)); setBaseVersion(count.version) }
  const save = async () => {
    if (!parsed || remoteChanged) return
    try {
      await update.mutateAsync({ businessDate, version: baseVersion, ...parsed })
      setEditing(false); setDraft(null); toast.success("Đã lưu bộ đếm khách")
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        void query.refetch()
        toast.error("Dữ liệu đã thay đổi trên máy khác. Bản nháp của bạn vẫn được giữ.")
      } else toast.error(error instanceof Error ? error.message : "Không thể lưu bộ đếm khách.")
    }
  }
  const shell = "rounded-lg border border-border/80 bg-background/95 shadow-lg backdrop-blur dark:border-slate-700/80 dark:bg-[#1e232d]/95"

  if (!open) return (
    <button type="button" onClick={toggle} aria-expanded={false} aria-label="Mở bảng đếm khách" data-testid="guest-count-card-collapsed"
      className={cn(shell, "inline-flex h-9 items-center gap-1.5 px-2.5 active:scale-95", tiny && "size-11 justify-center p-0", className)}>
      <Users className="size-4 shrink-0" aria-hidden />
      <span className={cn("text-[13px] font-semibold text-tx-strong", tiny && "sr-only")}>Đếm khách</span>
      {tiny ? null : <ChevronDown className="size-3.5 text-tx-2" aria-hidden />}
    </button>
  )

  const rows: [string, GuestCountKey, boolean?][] = [
    ["Trước 21:30", "arrivedBefore"], ["Sau 21:30", "arrivedAfter"], ["Tổng đã tới", "arrivedTotal", true],
    ["Tổng bàn đặt", "bookedTables"], ["Tổng khách đặt", "bookedGuests"], ["Đã từng đặt bàn", "returningGuests"],
  ]
  return (
    <div data-testid="guest-count-card" className={cn(shell, "flex w-[124px] flex-col gap-0.5 px-[7px] py-1.5 text-left", className)}>
      <div className="flex items-center gap-1">
        <Users className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[10px] leading-tight font-bold text-tx-strong">Đếm khách</span>
        {canEdit && !editing ? <button type="button" onClick={startEdit} aria-label="Sửa bộ đếm khách" title="Sửa"
          className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-0.5 text-[9px] font-semibold text-tx-2 active:scale-95"><Pencil className="size-3" aria-hidden />Sửa</button> : null}
        <button type="button" onClick={toggle} aria-expanded aria-label="Thu gọn bảng đếm khách"
          className="-mr-1 grid size-5 shrink-0 place-items-center rounded text-tx-2 active:scale-95"><ChevronDown className="size-3.5 rotate-180" aria-hidden /></button>
      </div>
      {editing ? <div className="flex flex-col gap-0.5">
        {rows.map(([label, key, divided]) => <Row key={key} label={label} value={draft?.[key] ?? ""} divided={divided}
          editing onChange={(value) => setDraft((current) => current ? { ...current, [key]: value } : current)} />)}
      </div> : <button type="button" onClick={onOpen} className="flex flex-col gap-0.5 text-left active:scale-[0.98]"
        aria-label={`Đếm khách. Trước 21:30 ${count.arrivedBefore}, sau 21:30 ${count.arrivedAfter}, tổng đã tới ${count.arrivedTotal}, tổng bàn đặt ${count.bookedTables}, tổng khách đặt ${count.bookedGuests}, đã từng đặt bàn ${count.returningGuests}.`}>
        {rows.map(([label, key, divided]) => <Row key={key} label={label} value={count[key]} divided={divided} />)}
      </button>}
      {editing ? <>
        {remoteChanged ? <button type="button" onClick={reload} className="mt-1 text-left text-[9px] leading-tight text-warning underline">Có dữ liệu mới · Tải lại</button> : null}
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button type="button" onClick={cancelEdit} disabled={update.isPending} className="inline-flex h-7 items-center justify-center gap-0.5 rounded-md border border-border text-[10px] font-semibold"><X className="size-3" aria-hidden /> Hủy</button>
          <button type="button" onClick={() => void save()} disabled={!parsed || remoteChanged || update.isPending} className="inline-flex h-7 items-center justify-center gap-0.5 rounded-md bg-primary text-[10px] font-semibold text-primary-foreground disabled:opacity-50"><Check className="size-3" aria-hidden /> Lưu</button>
        </div>
      </> : null}
    </div>
  )
}
