import { AlertTriangle, ChevronLeft, LoaderCircle, Lock, Pencil } from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import {
  BookingTimePicker,
  HonorificPicker,
  IconPicker,
  SOCIAL_PLATFORMS,
  SourcePicker,
  formatBookingIcons,
  type SocialPlatform,
} from "@/components/booking-pickers"
import { Stepper } from "@/components/common"
import { RevealPhone } from "@/components/reveal-phone"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  bookingCalendarDate,
  bookingInstant,
  isAfterMidnight,
  slotLabel,
  toggleClassification,
} from "@/domain/booking-rules"
import { formatBookingSource, type BookingClassification } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { MOCK_NOTE, useAction } from "@/hooks/use-action"
import { useAvailability, useReservations, useVenueSettings, useWaitlist } from "@/hooks/use-data"
import { addDays, fmtBusinessDate, fmtDayMonth, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useHeldOrderActions, useMobileActions } from "./actions"
import {
  BOOKING_NOTE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  buildUpdateReservationInput,
  diffBookingEditDraft,
  initialBookingEditDraft,
  parsePartySize,
  tableContextForEditedBooking,
  validateBookingEditDraft,
  type BookingEditDraft,
  type EditableFieldKey,
} from "./booking-edit-model"
import { bookingTableCanSelect } from "./booking-table-selection"
import { useM } from "./context"
import { codesOf } from "./model"
import { useRestoreTriggerFocus } from "./overlay-focus"
import { EmptyBox, card } from "./ui"

function scrollFocusedIntoView(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = event.currentTarget
  if (typeof window === "undefined") return
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  window.requestAnimationFrame(() => {
    el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" })
  })
}

function EmptyPlaceholder() {
  return <span className="text-tx-3">(Trống)</span>
}

function EditableRow({
  label,
  editing,
  changed,
  error,
  display,
  onOpen,
  onDone,
  children,
}: {
  label: string
  editing: boolean
  changed?: boolean
  error?: string | null
  display: ReactNode
  onOpen: () => void
  onDone: () => void
  children: ReactNode
}) {
  if (editing) {
    return (
      <div className="flex flex-col gap-2.5 bg-surface-2/45 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-tx-strong">{label}</span>
          <button
            type="button"
            onClick={onDone}
            className="gm-press -my-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint"
          >
            Xong
          </button>
        </div>
        {children}
        {error ? (
          <p role="alert" className="m-0 text-xs font-medium text-st-noshow-ink">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={false}
        className="gm-press-card flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/55"
      >
        <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">{label}</span>
        <span className="min-w-0 flex-1 text-[14px] text-pretty break-words text-tx-1">{display}</span>
        {changed ? <span className="size-2 shrink-0 rounded-full bg-primary" title="Đã thay đổi" /> : null}
        <Pencil className="size-3.5 shrink-0 text-subtle" aria-hidden />
      </button>
      {error ? (
        <p role="alert" className="m-0 px-4 pb-2.5 text-xs font-medium text-st-noshow-ink">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function BookingEditScreen({
  id,
  bd,
  onClose,
  parentOpen = true,
  requestCloseRef,
}: {
  id: number
  bd: BusinessDate
  onClose: () => void
  parentOpen?: boolean
  requestCloseRef?: MutableRefObject<(() => void) | null>
}) {
  const resQuery = useReservations(bd)
  const r = resQuery.data?.find((x) => x.id === id)

  if (!r) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <header className="gm-glass-chrome shrink-0 border-b border-border/70 bg-[var(--glass-chrome)] px-4 pt-[var(--top-safe)] pb-2 backdrop-blur-md">
          <div className="-ml-2 flex h-12 items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Quay lại"
              className="gm-press grid size-11 shrink-0 place-items-center rounded-xl text-tx-1 hover:bg-surface-2"
            >
              <ChevronLeft className="size-[22px]" aria-hidden />
            </button>
            <h1 className="m-0 truncate text-[18px] font-bold tracking-[-0.02em] text-tx-strong">Sửa booking</h1>
          </div>
        </header>
        <div className="p-4">
          {resQuery.data ? (
            <EmptyBox title="Không tìm thấy booking" body="Booking có thể đã được chuyển ngày hoặc xóa." />
          ) : (
            <p className="text-[14px] text-[var(--text-muted)]">Đang tải...</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <BookingEditBody
      key={r.id}
      r={r}
      bd={bd}
      onClose={onClose}
      parentOpen={parentOpen}
      requestCloseRef={requestCloseRef}
    />
  )
}

function BookingEditBody({
  r,
  bd,
  onClose,
  parentOpen,
  requestCloseRef,
}: {
  r: ReservationView
  bd: BusinessDate
  onClose: () => void
  parentOpen: boolean
  requestCloseRef?: MutableRefObject<(() => void) | null>
}) {
  const m = useM()
  const a = useMobileActions()
  const held = useHeldOrderActions(m.model)
  const isReceptionist = m.role === "RECEPTIONIST"
  const { run, pending } = useAction()
  const quickTimes = useVenueSettings().data?.quickTimes ?? []
  useWaitlist(bd)

  const [draft, setDraft] = useState<BookingEditDraft>(() => initialBookingEditDraft(r))
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [syncedVersion, setSyncedVersion] = useState(r.version)
  const leaveFocus = useRestoreTriggerFocus(confirmLeave, { suppressRestore: !parentOpen })

  const nameInputRef = useRef<HTMLInputElement>(null)
  const partyInputRef = useRef<HTMLInputElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const diff = useMemo(() => diffBookingEditDraft(r, draft), [r, draft])

  // Sync draft when server version refreshes and user has not made local edits
  if (r.version !== syncedVersion) {
    setSyncedVersion(r.version)
    if (!diff.isDirty) {
      setDraft(initialBookingEditDraft(r))
    }
  }

  const updateDraft = (patch: Partial<BookingEditDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const parsedParty = parsePartySize(draft.partySizeText)
  const validParty = parsedParty.ok ? parsedParty.value : r.partySize
  const isSameBusinessDate = m.model.floor?.businessDate
    ? draft.businessDate === m.model.floor.businessDate
    : draft.businessDate === m.today
  const bookableZoneIds = useMemo(
    () => new Set(m.model.catalog?.zones.filter((zone) => zone.isBookable).map((zone) => zone.id) ?? []),
    [m.model.catalog],
  )
  const atForAvailability = useMemo(() => {
    if (!draft.time) return null
    try {
      return bookingInstant(draft.businessDate, draft.time)
    } catch {
      return null
    }
  }, [draft.businessDate, draft.time])

  const availability = useAvailability(
    editingField === "tables" || diff.tablesDirty ? atForAvailability : null,
    validParty,
  )
  const avail = availability.isPlaceholderData || availability.isError ? undefined : availability.data
  const availMap = useMemo(() => new Map((avail?.tables ?? []).map((t) => [t.tableId, t])), [avail?.tables])

  const validation = useMemo(
    () =>
      validateBookingEditDraft(r, draft, diff, {
        now: m.now,
        quickTimes,
        byId: m.model.byId,
        states: m.model.states,
        availMap,
        bookableZoneIds,
        availReady: !!avail,
        isSameBusinessDate,
      }),
    [
      r,
      draft,
      diff,
      m.now,
      quickTimes,
      m.model.byId,
      m.model.states,
      availMap,
      bookableZoneIds,
      avail,
      isSameBusinessDate,
    ],
  )

  const historyToken = useId()
  const hasSentinelRef = useRef(false)
  const ignoreNextPopRef = useRef(false)
  const isDirtyRef = useRef(diff.isDirty)
  const pendingRef = useRef(pending)
  isDirtyRef.current = diff.isDirty
  pendingRef.current = pending

  const leaveImmediately = useCallback(() => {
    setConfirmLeave(false)
    if (hasSentinelRef.current && typeof window !== "undefined") {
      hasSentinelRef.current = false
      ignoreNextPopRef.current = true
      window.history.back()
    }
    onClose()
  }, [onClose])

  const requestLeave = useCallback(() => {
    if (pendingRef.current) return
    if (isDirtyRef.current) {
      setConfirmLeave(true)
      return
    }
    leaveImmediately()
  }, [leaveImmediately])

  useEffect(() => {
    if (!requestCloseRef) return
    requestCloseRef.current = requestLeave
    return () => {
      requestCloseRef.current = null
    }
  }, [requestCloseRef, requestLeave])

  // Intercept browser/hardware back button while the edit screen is open.
  useEffect(() => {
    if (!parentOpen || typeof window === "undefined") return
    const currentState = window.history.state as { __gmBookingEdit?: string } | null
    if (currentState?.__gmBookingEdit !== historyToken) {
      window.history.pushState({ ...currentState, __gmBookingEdit: historyToken }, "")
    }
    hasSentinelRef.current = true

    const onPopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false
        return
      }
      if (!hasSentinelRef.current) return
      if (pendingRef.current || isDirtyRef.current) {
        window.history.pushState({ __gmBookingEdit: historyToken }, "")
        setConfirmLeave(true)
        return
      }
      hasSentinelRef.current = false
      onClose()
    }

    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
    }
  }, [historyToken, onClose, parentOpen])

  useEffect(() => {
    if (editingField === "name") {
      nameInputRef.current?.focus({ preventScroll: true })
    } else if (editingField === "partySize") {
      partyInputRef.current?.focus({ preventScroll: true })
    } else if (editingField === "note") {
      noteInputRef.current?.focus({ preventScroll: true })
    }
  }, [editingField])

  const hold = a.bookingPolicy(r)
  const heldEntry = hold.entry
  const canEditTables = m.can("table.assign") && hold.canReassign && r.status === "BOOKED"

  const dayOptions = useMemo(() => {
    const offsets = Array.from({ length: 7 }, (_, i) => i)
    const dates = offsets.map((i) => ({
      date: addDays(m.today, i),
      top: i === 0 ? "Hôm nay" : fmtBusinessDate(addDays(m.today, i), "short").split(", ")[0],
      day: fmtDayMonth(addDays(m.today, i)),
    }))
    if (!dates.some((d) => d.date === draft.businessDate)) {
      const [top, day] = fmtBusinessDate(draft.businessDate, "short").split(", ")
      dates.unshift({ date: draft.businessDate, top: top ?? "", day: day ?? draft.businessDate })
    }
    return dates
  }, [m.today, draft.businessDate])

  const effectiveTableCtx = useMemo(
    () => tableContextForEditedBooking(r, draft.businessDate, availMap, m.model.states),
    [r, draft.businessDate, availMap, m.model.states],
  )

  const tableOptions = useMemo(() => {
    const anchor = m.model.byId.get(draft.tableIds[0])
    return m.model.tables
      .filter((t) => bookableZoneIds.has(t.zoneId) || draft.tableIds.includes(t.id))
      .filter((t) => (t.status === "ACTIVE" && !t.isSpare) || draft.tableIds.includes(t.id))
      .map((t) => {
        const selected = draft.tableIds.includes(t.id)
        const availRow = effectiveTableCtx.availMap.get(t.id)
        const stRow = effectiveTableCtx.states.get(t.id)
        const liveBlocked = isSameBusinessDate && stRow && stRow.state !== "free"
        const canPick =
          selected ||
          (!!avail &&
            !liveBlocked &&
            bookingTableCanSelect(t, availRow, anchor) &&
            !(availRow?.bookingConflicts && availRow.bookingConflicts.length > 0))
        const reason = !avail
          ? "Đang kiểm tra bàn trống"
          : liveBlocked
            ? "Bàn đang có khách hoặc được giữ"
            : availRow?.reason ||
              (anchor && (anchor.zoneId !== t.zoneId || anchor.kind !== t.kind)
                ? "Khác khu hoặc khác loại bàn"
                : undefined)
        return { table: t, selected, canPick, reason }
      })
  }, [m.model.tables, m.model.byId, bookableZoneIds, draft.tableIds, effectiveTableCtx, isSameBusinessDate, avail])

  const toggleTable = (tableId: number) => {
    updateDraft({
      tableIds: draft.tableIds.includes(tableId)
        ? draft.tableIds.filter((idItem) => idItem !== tableId)
        : [...draft.tableIds, tableId],
    })
  }

  const save = async () => {
    if (!validation.canSave || pending) return
    const result = await run(
      async (overrideReason) => {
        let latestVersion = r.version
        let lastResult = null
        if (diff.fieldsDirty) {
          lastResult = await api.updateReservation(buildUpdateReservationInput(r, draft))
          if (diff.tablesDirty) {
            const list = await api.listReservations({ businessDate: draft.businessDate })
            const updated = list.find((item) => item.id === r.id)
            latestVersion = updated?.version ?? r.version + 1
          }
        }
        if (diff.tablesDirty) {
          if (heldEntry && api.mode === "mock" && held.policy(heldEntry, r).kind === "offer") {
            lastResult = await api.moveClaim({
              claim: { waitlistEntryId: heldEntry.id, version: heldEntry.hold!.version },
              tableIds: draft.tableIds,
              overrideReason,
            })
          } else {
            lastResult = await api.assignTables(r.id, latestVersion, draft.tableIds, overrideReason)
          }
        }
        return lastResult!
      },
      { silent: true },
    )
    if (result) {
      toast.success("Đã lưu thay đổi", {
        description: api.mode === "mock" ? MOCK_NOTE : undefined,
      })
      leaveImmediately()
    }
  }

  const nameId = useId()
  const partyId = useId()
  const noteId = useId()

  const isBooked = r.status === "BOOKED"
  const platformLabel = SOCIAL_PLATFORMS.find((p) => p.value === draft.platform)?.label ?? draft.platform
  const sourceDisplay =
    draft.source === "SOCIAL" ? (
      draft.platform ? (
        `Social · ${platformLabel}`
      ) : (
        <span>
          Social · <EmptyPlaceholder />
        </span>
      )
    ) : (
      formatBookingSource(draft.source, null)
    )

  const timeNextDay = !!draft.time && isAfterMidnight(draft.time)
  const timeDisplay = draft.time ? (
    `${slotLabel(draft.time)}${timeNextDay ? ` (sáng ${fmtDayMonth(bookingCalendarDate(draft.businessDate, draft.time))})` : ""}`
  ) : (
    <EmptyPlaceholder />
  )

  const classificationDisplay =
    draft.classification === "RETURNING" ? (
      "Đã từng đặt bàn"
    ) : draft.classification === "NEW" ? (
      "Chưa từng đặt bàn"
    ) : (
      <EmptyPlaceholder />
    )

  const formattedIcons = formatBookingIcons(draft.isBirthday, draft.iconKeys)
  const iconsDisplay = formattedIcons !== "Không có" ? formattedIcons : <EmptyPlaceholder />

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <header className="gm-glass-chrome shrink-0 border-b border-border/70 bg-[var(--glass-chrome)] px-4 pt-[var(--top-safe)] pb-2 backdrop-blur-md">
        <div className="-ml-2 flex h-12 items-center gap-1.5">
          <button
            type="button"
            onClick={requestLeave}
            disabled={pending}
            aria-label="Quay lại"
            className="gm-press grid size-11 shrink-0 place-items-center rounded-xl text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
          >
            <ChevronLeft className="size-[22px]" aria-hidden />
          </button>
          <h1 className="m-0 min-w-0 flex-1 truncate text-[18px] font-bold tracking-[-0.02em] text-tx-strong">
            Sửa booking
          </h1>
          <span className="tnum shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]">
            #{r.id}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-6">
        {!isBooked ? (
          <p
            role="status"
            className="m-0 rounded-2xl border border-st-late/30 bg-st-late-tint px-4 py-3 text-[13.5px] font-medium text-st-late-ink"
          >
            Booking không còn ở trạng thái Đã đặt nên không thể chỉnh sửa.
          </p>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow m-0 px-1">Khách hàng</h2>
          <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
            <EditableRow
              label="Tên khách"
              editing={isBooked && editingField === "name"}
              changed={diff.changed.name}
              error={validation.errors.name}
              display={draft.name.trim() ? draft.name : <EmptyPlaceholder />}
              onOpen={() => isBooked && setEditingField("name")}
              onDone={() => setEditingField(null)}
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={nameId} className="sr-only">
                    Tên khách
                  </label>
                  <span className="tnum ml-auto text-xs text-[var(--text-muted)]">
                    {draft.name.trim().length}/{GUEST_NAME_MAX_LENGTH}
                  </span>
                </div>
                <Input
                  ref={nameInputRef}
                  id={nameId}
                  type="text"
                  autoComplete="name"
                  value={draft.name}
                  placeholder="(Trống)"
                  disabled={pending}
                  aria-invalid={Boolean(validation.errors.name) || undefined}
                  onFocus={scrollFocusedIntoView}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  className="h-11 rounded-xl bg-surface-1 text-base"
                />
              </div>
            </EditableRow>

            <EditableRow
              label="Danh xưng"
              editing={isBooked && editingField === "honorific"}
              changed={diff.changed.honorific}
              display={draft.honorific === "MR" ? "Mr" : draft.honorific === "MS" ? "Ms" : <EmptyPlaceholder />}
              onOpen={() => isBooked && setEditingField("honorific")}
              onDone={() => setEditingField(null)}
            >
              <HonorificPicker
                value={draft.honorific}
                onChange={(honorific) => updateDraft({ honorific })}
                disabled={pending}
                size="lg"
              />
            </EditableRow>

            <div className="flex min-h-12 items-center gap-3 px-4 py-3">
              <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Số điện thoại</span>
              <div className="min-w-0 flex-1">
                {r.phoneLast3 ? (
                  <RevealPhone
                    key={r.customerId ?? r.id}
                    customerId={r.customerId}
                    last3={r.phoneLast3}
                    context={{ reservationId: r.id }}
                  />
                ) : (
                  <span className="text-[14px]">
                    <EmptyPlaceholder />
                  </span>
                )}
              </div>
              <Lock className="size-3.5 shrink-0 text-subtle" aria-hidden />
            </div>

            <EditableRow
              label="Loại khách"
              editing={isBooked && editingField === "classification"}
              changed={diff.changed.classification}
              display={classificationDisplay}
              onOpen={() => isBooked && setEditingField("classification")}
              onDone={() => setEditingField(null)}
            >
              <div role="radiogroup" aria-label="Loại khách" className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: "RETURNING", label: "Đã từng đặt" },
                    { value: "NEW", label: "Chưa từng đặt" },
                    { value: "UNCLASSIFIED", label: "Chưa phân loại" },
                  ] as const
                ).map((opt) => {
                  const selected = draft.classification === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pending}
                      onClick={() =>
                        updateDraft({
                          classification:
                            opt.value === "UNCLASSIFIED"
                              ? "UNCLASSIFIED"
                              : toggleClassification(
                                  draft.classification,
                                  opt.value as Exclude<BookingClassification, "UNCLASSIFIED">,
                                ),
                        })
                      }
                      className={cn(
                        "gm-press min-h-11 rounded-xl border px-2 py-1.5 text-[12.5px] leading-tight font-medium",
                        selected
                          ? "border-primary bg-primary-tint font-semibold text-primary-ink"
                          : "border-border-strong bg-surface-1 text-tx-1 hover:bg-surface-2",
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </EditableRow>
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow m-0 px-1">Thời gian & Bàn</h2>
          <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
            <EditableRow
              label="Số khách"
              editing={isBooked && editingField === "partySize"}
              changed={diff.changed.partySize}
              error={validation.errors.partySize}
              display={
                <span className="tnum">
                  {parsedParty.ok ? `${parsedParty.value} khách` : draft.partySizeText || <EmptyPlaceholder />}
                </span>
              }
              onOpen={() => isBooked && setEditingField("partySize")}
              onDone={() => setEditingField(null)}
            >
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <Stepper
                    value={parsedParty.ok ? parsedParty.value : r.partySize}
                    onChange={(n) => updateDraft({ partySizeText: String(n) })}
                    min={1}
                    max={500}
                    label="số khách"
                  />
                  <div className="flex items-center gap-2">
                    <label htmlFor={partyId} className="sr-only">
                      Nhập số khách
                    </label>
                    <Input
                      ref={partyInputRef}
                      id={partyId}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={draft.partySizeText}
                      placeholder="(Trống)"
                      disabled={pending}
                      aria-invalid={Boolean(validation.errors.partySize) || undefined}
                      onFocus={scrollFocusedIntoView}
                      onChange={(e) => updateDraft({ partySizeText: e.target.value })}
                      className="tnum h-11 w-24 rounded-xl bg-surface-1 text-center text-base font-semibold"
                    />
                  </div>
                </div>
                {validation.capacityWarning ? (
                  <p
                    role="status"
                    className="m-0 rounded-xl border border-st-late/30 bg-st-late-tint px-3 py-2 text-xs font-medium text-st-late-ink"
                  >
                    {validation.capacityWarning}
                  </p>
                ) : null}
              </div>
            </EditableRow>

            <EditableRow
              label="Ngày đặt"
              editing={isBooked && editingField === "businessDate"}
              changed={diff.changed.businessDate}
              display={<span className="tnum">{fmtBusinessDate(draft.businessDate)}</span>}
              onOpen={() => isBooked && setEditingField("businessDate")}
              onDone={() => setEditingField(null)}
            >
              <div className="flex flex-col gap-2">
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
                  {dayOptions.map((d) => {
                    const on = draft.businessDate === d.date
                    return (
                      <button
                        key={d.date}
                        type="button"
                        aria-pressed={on}
                        disabled={pending}
                        onClick={() => updateDraft({ businessDate: d.date })}
                        className={cn(
                          "gm-press flex h-14 min-w-[72px] shrink-0 flex-col items-center justify-center gap-px rounded-xl border px-2.5",
                          on
                            ? "border-tx-strong bg-tx-strong text-background shadow-[var(--shadow-xs)]"
                            : "border-border bg-surface-1 text-tx-1 hover:border-border-strong",
                        )}
                      >
                        <span className="text-[11px] opacity-85">{d.top}</span>
                        <span className="tnum text-[14px] font-semibold">{d.day}</span>
                      </button>
                    )
                  })}
                </div>
                {draft.businessDate !== r.businessDate && r.tableIds.length > 0 ? (
                  <p role="status" className="m-0 text-xs text-st-late-ink">
                    Đổi sang ngày khác sẽ kiểm tra lại hoặc nhả bàn đang giữ.
                  </p>
                ) : null}
              </div>
            </EditableRow>

            <EditableRow
              label="Giờ hẹn"
              editing={isBooked && editingField === "time"}
              changed={diff.changed.time}
              error={validation.errors.time}
              display={<span className="tnum">{timeDisplay}</span>}
              onOpen={() => isBooked && setEditingField("time")}
              onDone={() => setEditingField(null)}
            >
              <BookingTimePicker
                date={draft.businessDate}
                value={draft.time}
                now={m.now}
                quickTimes={quickTimes}
                onChange={(time) => updateDraft({ time })}
                error={validation.errors.time}
                legacyValue={validation.legacyTime}
                compact
              />
            </EditableRow>

            {canEditTables ? (
              <EditableRow
                label="Bàn"
                editing={editingField === "tables"}
                changed={diff.changed.tables}
                error={validation.errors.tables}
                display={draft.tableIds.length > 0 ? codesOf(draft.tableIds, m.model) : <EmptyPlaceholder />}
                onOpen={() => setEditingField("tables")}
                onDone={() => setEditingField(null)}
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {draft.tableIds.length > 0
                        ? `Đang chọn: ${codesOf(draft.tableIds, m.model)}`
                        : "Chưa chọn bàn (chạm để chọn)"}
                    </span>
                    {r.tableIds.length === 0 && draft.tableIds.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => updateDraft({ tableIds: [] })}
                        className="text-xs font-semibold text-primary-ink underline"
                      >
                        Bỏ chọn hết
                      </button>
                    ) : null}
                  </div>
                  {availability.isError ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void availability.refetch()}
                      className="min-h-11 rounded-xl"
                    >
                      Tải lại bàn khả dụng
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chọn bàn">
                      {tableOptions.map(({ table: t, selected, canPick, reason }) => (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={pending || !canPick}
                          title={!canPick ? reason : undefined}
                          onClick={() => toggleTable(t.id)}
                          className={cn(
                            "gm-press tnum flex min-h-11 flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-left",
                            selected
                              ? "border-primary bg-primary-tint text-primary-ink shadow-[var(--shadow-xs)]"
                              : "border-border bg-surface-1 text-tx-1 hover:border-border-strong",
                            (!canPick || pending) && "cursor-not-allowed opacity-45",
                          )}
                        >
                          <span className="text-[13.5px] font-semibold">
                            {t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">{t.capacity} chỗ</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {validation.capacityWarning ? (
                    <p
                      role="status"
                      className="m-0 rounded-xl border border-st-late/30 bg-st-late-tint px-3 py-2 text-xs font-medium text-st-late-ink"
                    >
                      {validation.capacityWarning}
                    </p>
                  ) : null}
                </div>
              </EditableRow>
            ) : (
              <div className="flex min-h-12 items-center gap-3 px-4 py-3">
                <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Bàn</span>
                <div className="min-w-0 flex-1 text-[14px]">
                  {draft.tableIds.length > 0 ? codesOf(draft.tableIds, m.model) : <EmptyPlaceholder />}
                  {hold.reason || !hold.canReassign ? (
                    <span className="block text-xs text-[var(--text-muted)]">
                      {hold.reason ?? "Chưa hỗ trợ đổi bàn cho đơn giữ chỗ"}
                    </span>
                  ) : null}
                </div>
                <Lock className="size-3.5 shrink-0 text-subtle" aria-hidden />
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow m-0 px-1">Chi tiết & Ghi chú</h2>
          <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
            <EditableRow
              label="Nguồn đặt"
              editing={isBooked && editingField === "source"}
              changed={diff.changed.source || diff.changed.platform}
              error={validation.errors.platform}
              display={sourceDisplay}
              onOpen={() => isBooked && setEditingField("source")}
              onDone={() => setEditingField(null)}
            >
              <SourcePicker
                source={draft.source}
                onSourceChange={(source) => updateDraft({ source, platform: "" })}
                platform={draft.platform}
                onPlatformChange={(platform: SocialPlatform | "") => updateDraft({ platform })}
                error={validation.errors.platform}
              />
            </EditableRow>

            <EditableRow
              label="Đặc điểm"
              editing={isBooked && editingField === "icons"}
              changed={diff.changed.icons}
              display={iconsDisplay}
              onOpen={() => isBooked && setEditingField("icons")}
              onDone={() => setEditingField(null)}
            >
              <IconPicker
                isBirthday={draft.isBirthday}
                onBirthdayChange={(isBirthday) => updateDraft({ isBirthday })}
                iconKeys={draft.iconKeys}
                onIconKeysChange={(iconKeys) => updateDraft({ iconKeys })}
              />
            </EditableRow>

            <EditableRow
              label="Ghi chú"
              editing={isBooked && editingField === "note"}
              changed={diff.changed.note}
              error={validation.errors.note}
              display={draft.note.trim() ? draft.note : <EmptyPlaceholder />}
              onOpen={() => isBooked && setEditingField("note")}
              onDone={() => setEditingField(null)}
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={noteId} className="sr-only">
                    Ghi chú
                  </label>
                  <span
                    className={cn(
                      "tnum ml-auto text-xs font-medium",
                      draft.note.trim().length > BOOKING_NOTE_MAX_LENGTH
                        ? "text-st-noshow-ink"
                        : "text-[var(--text-muted)]",
                    )}
                  >
                    {draft.note.trim().length}/{BOOKING_NOTE_MAX_LENGTH}
                  </span>
                </div>
                <Textarea
                  ref={noteInputRef}
                  id={noteId}
                  rows={3}
                  value={draft.note}
                  placeholder="(Trống)"
                  disabled={pending}
                  aria-invalid={Boolean(validation.errors.note) || undefined}
                  onFocus={scrollFocusedIntoView}
                  onChange={(e) => updateDraft({ note: e.target.value })}
                  className="min-h-24 resize-none rounded-xl bg-surface-1 text-base leading-[1.45]"
                />
              </div>
            </EditableRow>
          </div>
        </section>
      </div>

      <footer className="gm-glass-chrome shrink-0 border-t border-border/70 bg-surface-1/95 px-4 pt-3 pb-[calc(12px+var(--bottom-safe))] backdrop-blur-md">
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={leaveImmediately}
            className="h-12 rounded-xl border-border-strong text-[15px] font-semibold"
          >
            Hủy
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!validation.canSave || pending}
            aria-busy={pending}
            onClick={() => void save()}
            className={cn(
              "h-12 rounded-xl text-[15px] font-semibold",
              (!validation.canSave || pending) &&
                "border border-border bg-surface-3 text-[var(--text-muted)] opacity-75 shadow-none",
            )}
          >
            {pending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                <span>Đang lưu...</span>
              </>
            ) : (
              "Lưu thay đổi"
            )}
          </Button>
        </div>
      </footer>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent
          data-gm
          data-gm-overlay-id={leaveFocus.overlayId}
          data-receptionist-frame={isReceptionist ? "true" : undefined}
          size="sm"
          onCloseAutoFocus={leaveFocus.onCloseAutoFocus}
          aria-label="Xác nhận rời trang sửa booking"
          className="max-w-[min(calc(100%-2rem),380px)] gap-4 rounded-2xl border-border bg-surface-1 p-5 shadow-[var(--shadow-float)]"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="size-11 rounded-xl bg-st-late-tint text-st-late-ink">
              <AlertTriangle className="size-5" aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
              Chưa lưu thay đổi?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] leading-relaxed text-pretty text-[var(--text-muted)]">
              Những thay đổi bạn vừa thực hiện sẽ không được lưu lại.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 gap-2.5 pt-1">
            <AlertDialogCancel
              variant="outline"
              onClick={() => setConfirmLeave(false)}
              className="h-12 rounded-xl border-border-strong text-[15px] font-medium"
            >
              Ở lại
            </AlertDialogCancel>
            <AlertDialogAction
              variant="default"
              onClick={leaveImmediately}
              className="h-12 rounded-xl text-[15px] font-semibold"
            >
              Đồng ý
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
