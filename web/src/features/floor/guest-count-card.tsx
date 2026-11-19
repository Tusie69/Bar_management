import { Check, Pencil, Users, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { ReceptionGuestCount } from "@/domain/models"
import { useReceptionGuestCount, useUpdateReceptionGuestCount } from "@/hooks/use-data"
import type { BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { ApiError } from "@/services/contracts"
import { useCan } from "@/state/session"
import {
  guestCountDraft,
  guestCountKeys,
  parseGuestCountDraft,
  type GuestCountDraft,
  type GuestCountKey,
} from "./guest-count-values"

const emptyCount = (businessDate: BusinessDate): ReceptionGuestCount => ({
  businessDate,
  arrivedBefore: 0,
  arrivedAfter: 0,
  arrivedTotal: 0,
  bookedTables: 0,
  bookedGuests: 0,
  returningGuests: 0,
  version: 0,
  updatedAt: null,
})

interface FieldMeta {
  key: GuestCountKey
  label: string
  shortLabel: string
  highlighted?: boolean
}

const FIELDS: FieldMeta[] = [
  { key: "arrivedBefore", label: "Trước 21:30", shortLabel: "Trước 21:30" },
  { key: "bookedTables", label: "Tổng bàn đặt", shortLabel: "Bàn đặt" },
  { key: "arrivedAfter", label: "Sau 21:30", shortLabel: "Sau 21:30" },
  { key: "bookedGuests", label: "Tổng khách đặt", shortLabel: "Khách đặt" },
  { key: "arrivedTotal", label: "Tổng đã tới", shortLabel: "Tổng đã tới", highlighted: true },
  { key: "returningGuests", label: "Đã từng đặt bàn", shortLabel: "Đã từng đặt" },
]

function StatCell({ field, value }: { field: FieldMeta; value: number }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col md:flex-row md:items-center md:justify-between md:gap-1">
      <span
        data-testid={`guest-count-label-${field.key}`}
        className={cn(
          "text-[8px] leading-[1.15] whitespace-nowrap md:text-[9.5px] md:leading-[1.2]",
          field.highlighted ? "font-semibold text-tx-strong" : "text-tx-2",
        )}
      >
        <span className="md:hidden">{field.shortLabel}</span>
        <span className="hidden md:inline">{field.label}</span>
      </span>
      <span
        data-testid={`guest-count-value-${field.key}`}
        className="tnum shrink-0 text-[9.5px] leading-[1.15] font-bold text-tx-strong md:text-right md:text-[10px] md:leading-[1.2]"
      >
        {value}
      </span>
    </div>
  )
}

export function GuestCountCard({
  businessDate,
  onOpen,
  onEdit,
  className,
}: {
  businessDate: BusinessDate
  onOpen?: () => void
  onEdit?: () => void
  className?: string
}): ReactElement {
  const query = useReceptionGuestCount(businessDate)
  const canEdit = useCan("reservation.update")
  const count = query.data ?? emptyCount(businessDate)
  const shell = "rounded-xl border border-border bg-surface-1/92 shadow-sm backdrop-blur-md"

  return (
    <div
      data-testid="guest-count-card"
      className={cn(
        shell,
        "flex w-[144px] flex-col gap-0.5 px-1.5 py-1 text-left md:w-[244px] md:gap-1 md:px-2.5 md:py-1.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Users className="size-3 shrink-0" aria-hidden />
          <span className="text-[10px] leading-tight font-bold whitespace-nowrap text-tx-strong md:text-[11px]">
            Đếm khách
          </span>
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit ?? onOpen}
            aria-label="Sửa bộ đếm khách"
            title="Sửa"
            className="relative inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm px-1 text-[9px] font-semibold text-tx-2 transition-colors hover:bg-surface-2 hover:text-tx-strong focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none active:scale-95 md:h-5 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:min-h-[44px] [@media(pointer:coarse)]:after:min-w-[44px] [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2"
          >
            <Pencil className="size-2.5" aria-hidden />
            Sửa
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-left active:scale-[0.98] md:gap-x-3 md:gap-y-1"
        aria-label={`Đếm khách. Trước 21:30 ${count.arrivedBefore}, sau 21:30 ${count.arrivedAfter}, tổng đã tới ${count.arrivedTotal}, tổng bàn đặt ${count.bookedTables}, tổng khách đặt ${count.bookedGuests}, đã từng đặt bàn ${count.returningGuests}.`}
      >
        {FIELDS.map((field) => (
          <StatCell key={field.key} field={field} value={count[field.key]} />
        ))}
      </button>
    </div>
  )
}

export function GuestCountSheetPanel({
  count,
  editing,
  canEdit,
  draft,
  valid,
  remoteChanged,
  pending,
  onStartEdit,
  onDraftChange,
  onReload,
  onCancel,
  onSave,
}: {
  count: ReceptionGuestCount
  editing: boolean
  canEdit: boolean
  draft: GuestCountDraft | null
  valid: boolean
  remoteChanged: boolean
  pending: boolean
  onStartEdit: () => void
  onDraftChange: (key: GuestCountKey, value: string) => void
  onReload: () => void
  onCancel: () => void
  onSave: () => void
}): ReactElement {
  if (!editing) {
    return (
      <>
        <div className="grid grid-cols-2 gap-2.5" data-testid="guest-count-summary">
          {FIELDS.map((field) => (
            <div key={field.key} className="rounded-xl border border-border bg-surface-1 px-3.5 py-3 shadow-xs">
              <div className="text-xs font-medium text-tx-2">{field.label}</div>
              <div className="tnum mt-1 text-2xl leading-tight font-bold tracking-[-0.02em] text-tx-strong">
                {count[field.key]}
              </div>
            </div>
          ))}
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            onClick={onStartEdit}
            aria-label="Sửa bộ đếm khách"
            className="mt-4 w-full font-semibold"
          >
            <Pencil aria-hidden />
            Sửa bộ đếm khách
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5" data-testid="guest-count-editor">
        {FIELDS.map((field) => (
          <label
            key={field.key}
            className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-1 px-3 py-2.5 shadow-xs"
          >
            <span className={cn("text-xs", field.highlighted ? "font-semibold text-tx-strong" : "text-tx-2")}>
              {field.label}
            </span>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label={field.label}
              value={draft?.[field.key] ?? ""}
              onChange={(event) => {
                const next = event.target.value
                if (/^\d*$/.test(next)) onDraftChange(field.key, next)
              }}
              className="tnum h-11 text-right text-base font-bold text-tx-strong"
            />
          </label>
        ))}
      </div>
      {!valid ? (
        <p role="status" className="mt-2.5 text-xs font-medium text-destructive">
          Nhập số nguyên không âm (≥ 0) cho cả 6 mục.
        </p>
      ) : null}
      {remoteChanged ? (
        <button
          type="button"
          onClick={onReload}
          className="mt-2.5 min-h-11 text-left text-xs font-medium text-st-upcoming-ink underline"
        >
          Có dữ liệu mới · Tải lại
        </button>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={pending}>
          <X aria-hidden /> Hủy
        </Button>
        <Button type="button" size="lg" onClick={onSave} disabled={!valid || remoteChanged || pending}>
          <Check aria-hidden /> Lưu
        </Button>
      </div>
    </>
  )
}

function GuestCountSheetInner({
  businessDate,
  initialMode,
  onClose,
  isReceptionist,
  closeRef,
}: {
  businessDate: BusinessDate
  initialMode: "view" | "edit"
  onClose: () => void
  isReceptionist: boolean
  closeRef: { current: (() => void) | null }
}): ReactElement {
  const query = useReceptionGuestCount(businessDate)
  const update = useUpdateReceptionGuestCount()
  const canEdit = useCan("reservation.update")
  const count = query.data ?? emptyCount(businessDate)
  const startInEdit = initialMode === "edit" && canEdit
  const [editing, setEditing] = useState(startInEdit)
  const [draft, setDraft] = useState<GuestCountDraft | null>(() => (startInEdit ? guestCountDraft(count) : null))
  const [baseVersion, setBaseVersion] = useState(() => count.version)
  const parsed = draft ? parseGuestCountDraft(draft) : null
  const dirty = useMemo(
    () => Boolean(editing && draft && guestCountKeys.some((key) => draft[key] !== String(count[key]))),
    [count, draft, editing],
  )
  const remoteChanged = editing && count.version !== baseVersion

  useEffect(() => {
    if (!editing || !dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, editing])

  const discard = () => !dirty || window.confirm("Bỏ các thay đổi bộ đếm khách chưa lưu?")
  const startEdit = () => {
    setDraft(guestCountDraft(count))
    setBaseVersion(count.version)
    setEditing(true)
  }
  const requestClose = () => {
    if (editing && !discard()) return
    setEditing(false)
    setDraft(null)
    onClose()
  }
  useEffect(() => {
    closeRef.current = requestClose
  })
  const reload = () => {
    setDraft(guestCountDraft(count))
    setBaseVersion(count.version)
  }
  const save = async () => {
    if (!parsed || remoteChanged) return
    try {
      await update.mutateAsync({ businessDate, version: baseVersion, ...parsed })
      setEditing(false)
      setDraft(null)
      toast.success("Đã lưu bộ đếm khách")
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        void query.refetch()
        toast.error("Dữ liệu đã thay đổi trên máy khác. Bản nháp của bạn vẫn được giữ.")
      } else {
        toast.error(error instanceof Error ? error.message : "Không thể lưu bộ đếm khách.")
      }
    }
  }

  return (
    <SheetContent
      data-gm
      data-receptionist-frame={isReceptionist ? "true" : undefined}
      side="bottom"
      className={cn(
        "w-full gap-0 rounded-t-[24px] px-4 pt-5 pb-[calc(24px+env(safe-area-inset-bottom))]",
        isReceptionist && "mx-auto max-w-[var(--gm-max-w)]",
      )}
    >
      <SheetTitle className="text-lg">{editing ? "Sửa bộ đếm khách" : "Đếm khách"}</SheetTitle>
      <SheetDescription className="pb-3 text-xs">
        {editing ? "Cập nhật số liệu đếm khách trong ngày đang xem." : "Tổng hợp khách và bàn đặt trong ngày đang xem."}
      </SheetDescription>
      <GuestCountSheetPanel
        count={count}
        editing={editing}
        canEdit={canEdit}
        draft={draft}
        valid={Boolean(parsed)}
        remoteChanged={remoteChanged}
        pending={update.isPending}
        onStartEdit={startEdit}
        onDraftChange={(key, value) => setDraft((current) => (current ? { ...current, [key]: value } : current))}
        onReload={reload}
        onCancel={requestClose}
        onSave={() => void save()}
      />
    </SheetContent>
  )
}

export function GuestCountSheet({
  businessDate,
  open,
  initialMode,
  onClose,
  isReceptionist,
}: {
  businessDate: BusinessDate
  open: boolean
  initialMode: "view" | "edit"
  onClose: () => void
  isReceptionist: boolean
}): ReactElement {
  const closeRef = useRef<(() => void) | null>(null)
  const [sessionId, setSessionId] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)

  if (open && !wasOpen) {
    setWasOpen(true)
    setSessionId((n) => n + 1)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && (closeRef.current ?? onClose)()}>
      {sessionId > 0 ? (
        <GuestCountSheetInner
          key={`${sessionId}-${businessDate}-${initialMode}`}
          businessDate={businessDate}
          initialMode={initialMode}
          onClose={onClose}
          isReceptionist={isReceptionist}
          closeRef={closeRef}
        />
      ) : null}
    </Sheet>
  )
}
