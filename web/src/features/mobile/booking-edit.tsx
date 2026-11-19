import { useQueryClient } from "@tanstack/react-query"
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
import { bookingCalendarDate, isAfterMidnight, slotLabel, toggleClassification } from "@/domain/booking-rules"
import { formatBookingSource, type BookingClassification } from "@/domain/enums"
import type { ReservationView, TableAvailability } from "@/domain/models"
import { MOCK_NOTE, useAction } from "@/hooks/use-action"
import { qk, useReservations, useVenueSettings, useWaitlist } from "@/hooks/use-data"
import { addDays, fmtBusinessDate, fmtDayMonth, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useMobileActions } from "./actions"
import {
  BOOKING_NOTE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  buildUpdateReservationInput,
  diffBookingEditDraft,
  initialBookingEditDraft,
  parsePartySize,
  pinLoadedBooking,
  resolveBookingEditBackAction,
  syncBookingEditSession,
  validateBookingEditDraft,
  type BookingEditDraft,
  type BookingEditSessionState,
  type EditableFieldKey,
} from "./booking-edit-model"
import { useM } from "./context"
import { codesOf } from "./model"
import { useRestoreTriggerFocus } from "./overlay-focus"
import { EmptyBox, card } from "./ui"

const EMPTY_AVAIL_MAP: ReadonlyMap<number, TableAvailability> = new Map()

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const wasEditingRef = useRef(editing)
  const restoreOnCloseRef = useRef(false)

  useEffect(() => {
    const wasEditing = wasEditingRef.current
    wasEditingRef.current = editing
    if (editing && !wasEditing) {
      const container = contentRef.current
      if (!container) return
      const target =
        container.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
        container.querySelector<HTMLElement>(
          '[aria-checked="true"]:not([disabled]), [aria-pressed="true"]:not([disabled]), [aria-selected="true"]:not([disabled])',
        ) ??
        container.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
      target?.focus({ preventScroll: true })
    } else if (!editing && wasEditing && restoreOnCloseRef.current) {
      restoreOnCloseRef.current = false
      triggerRef.current?.focus({ preventScroll: true })
    } else if (!editing) {
      restoreOnCloseRef.current = false
    }
  }, [editing])

  const handleDone = () => {
    restoreOnCloseRef.current = true
    onDone()
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2.5 bg-surface-2/45 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-tx-strong">{label}</span>
          <button
            type="button"
            onClick={handleDone}
            className="gm-press -my-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint"
          >
            Xong
          </button>
        </div>
        <div ref={contentRef} className="flex flex-col">
          {children}
        </div>
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
        ref={triggerRef}
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
  const sessionKey = `${id}:${bd}`
  const [pinned, setPinned] = useState(() => pinLoadedBooking(null, sessionKey, r))
  const nextPinned = pinLoadedBooking(pinned, sessionKey, r)
  if (nextPinned !== pinned) {
    setPinned(nextPinned)
  }
  const initial = nextPinned?.record

  if (!initial) {
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
      key={sessionKey}
      initial={initial}
      r={r}
      bd={bd}
      onClose={onClose}
      parentOpen={parentOpen}
      requestCloseRef={requestCloseRef}
    />
  )
}

function BookingEditBody({
  initial,
  r,
  bd,
  onClose,
  parentOpen,
  requestCloseRef,
}: {
  initial: ReservationView
  r: ReservationView | undefined
  bd: BusinessDate
  onClose: () => void
  parentOpen: boolean
  requestCloseRef?: MutableRefObject<(() => void) | null>
}) {
  const m = useM()
  const a = useMobileActions()
  const qc = useQueryClient()
  const isReceptionist = m.role === "RECEPTIONIST"
  const { run, pending } = useAction()
  const settingsQuery = useVenueSettings()
  const quickTimes = useMemo(() => settingsQuery.data?.quickTimes ?? [], [settingsQuery.data?.quickTimes])
  useWaitlist(bd)

  const [session, setSession] = useState<BookingEditSessionState>(() => ({
    source: initial,
    draft: initialBookingEditDraft(initial),
  }))
  const { source, draft } = session
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmTableChange, setConfirmTableChange] = useState(false)
  const leaveFocus = useRestoreTriggerFocus(confirmLeave, { suppressRestore: !parentOpen })
  const tableChangeFocus = useRestoreTriggerFocus(confirmTableChange, { suppressRestore: !parentOpen })

  const diff = useMemo(() => diffBookingEditDraft(source, draft), [source, draft])

  // Sync source+draft together only while clean; dirty sessions keep their pinned source and version.
  const synced = syncBookingEditSession(session, r)
  if (synced !== session) {
    setSession(synced)
  }

  const updateDraft = (patch: Partial<BookingEditDraft>) => {
    setSession((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }))
  }

  const parsedParty = parsePartySize(draft.partySizeText)
  const validParty = parsedParty.ok ? parsedParty.value : source.partySize
  const isSameBusinessDate = m.model.floor?.businessDate
    ? draft.businessDate === m.model.floor.businessDate
    : draft.businessDate === m.today
  const bookableZoneIds = useMemo(
    () => new Set(m.model.catalog?.zones.filter((zone) => zone.isBookable).map((zone) => zone.id) ?? []),
    [m.model.catalog],
  )

  const validation = useMemo(
    () =>
      validateBookingEditDraft(source, draft, diff, {
        now: m.now,
        quickTimes,
        byId: m.model.byId,
        states: m.model.states,
        availMap: EMPTY_AVAIL_MAP,
        bookableZoneIds,
        availReady: false,
        isSameBusinessDate,
      }),
    [source, draft, diff, m.now, quickTimes, m.model.byId, m.model.states, bookableZoneIds, isSameBusinessDate],
  )

  const historyToken = useId()
  const hasSentinelRef = useRef(false)
  const ignoreNextPopRef = useRef(false)
  const isDirtyRef = useRef(diff.isDirty)
  const pendingRef = useRef(pending)
  const savingRef = useRef(false)
  useEffect(() => {
    isDirtyRef.current = diff.isDirty
    pendingRef.current = pending
  }, [diff.isDirty, pending])

  const isPendingNow = useCallback(() => pendingRef.current || savingRef.current, [])

  const releaseHistorySentinel = useCallback(() => {
    if (hasSentinelRef.current && typeof window !== "undefined") {
      hasSentinelRef.current = false
      ignoreNextPopRef.current = true
      window.history.back()
    }
  }, [])

  const leaveImmediately = useCallback(() => {
    setConfirmLeave(false)
    setConfirmTableChange(false)
    releaseHistorySentinel()
    onClose()
  }, [onClose, releaseHistorySentinel])

  const requestLeave = useCallback(() => {
    const action = resolveBookingEditBackAction({
      pending: isPendingNow(),
      isDirty: isDirtyRef.current,
    })
    if (action === "block_pending") return
    if (action === "confirm_discard") {
      setConfirmLeave(true)
      return
    }
    leaveImmediately()
  }, [isPendingNow, leaveImmediately])

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
      const action = resolveBookingEditBackAction({
        pending: isPendingNow(),
        isDirty: isDirtyRef.current,
      })
      if (action === "block_pending") {
        const state = window.history.state as Record<string, unknown> | null
        window.history.pushState({ ...state, __gmBookingEdit: historyToken }, "")
        return
      }
      if (action === "confirm_discard") {
        const state = window.history.state as Record<string, unknown> | null
        window.history.pushState({ ...state, __gmBookingEdit: historyToken }, "")
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
  }, [historyToken, isPendingNow, onClose, parentOpen])

  const hold = a.bookingPolicy(source)
  const canEditTables = m.can("table.assign") && hold.canReassign && source.status === "BOOKED"

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

  const saveFields = async (): Promise<boolean> => {
    if (!validation.canSave || isPendingNow()) return false
    savingRef.current = true
    try {
      const result = await run(async () => api.updateReservation(buildUpdateReservationInput(source, draft)), {
        silent: true,
      })
      if (!result) return false
      toast.success("Đã lưu thay đổi", {
        description: api.mode === "mock" ? MOCK_NOTE : undefined,
      })
      return true
    } finally {
      savingRef.current = false
    }
  }

  const save = async () => {
    const ok = await saveFields()
    if (ok) leaveImmediately()
  }

  const openTablePicker = useCallback(
    (target: ReservationView) => {
      releaseHistorySentinel()
      const targetPolicy = a.bookingPolicy(target)
      if (targetPolicy.entry) {
        a.reassignHold(targetPolicy.entry, target)
      } else {
        a.assign(target)
      }
    },
    [a, releaseHistorySentinel],
  )

  const requestTableChange = () => {
    if (isPendingNow() || !canEditTables) return
    if (diff.isDirty) {
      setConfirmTableChange(true)
      return
    }
    openTablePicker(source)
  }

  const discardAndPickTables = () => {
    if (isPendingNow()) return
    setConfirmTableChange(false)
    const cleanTarget = r && r.version !== source.version ? r : source
    setSession({ source: cleanTarget, draft: initialBookingEditDraft(cleanTarget) })
    openTablePicker(cleanTarget)
  }

  const saveAndPickTables = async () => {
    if (!validation.canSave || isPendingNow()) return
    setConfirmTableChange(false)
    const ok = await saveFields()
    if (!ok) return
    const targetBd = draft.businessDate
    let latest = qc
      .getQueryData<ReservationView[]>(qk.reservations(targetBd, ""))
      ?.find((item) => item.id === source.id)
    if (!latest) {
      const list = await qc.fetchQuery({
        queryKey: qk.reservations(targetBd, ""),
        queryFn: () => api.listReservations({ businessDate: targetBd, search: "" }),
      })
      latest = list.find((item) => item.id === source.id)
    }
    if (!latest || latest.status !== "BOOKED") {
      leaveImmediately()
      return
    }
    if (targetBd !== bd) {
      await qc.ensureQueryData({
        queryKey: qk.waitlist(targetBd),
        queryFn: () => api.listWaitlist(targetBd),
      })
    }
    setSession({ source: latest, draft: initialBookingEditDraft(latest) })
    openTablePicker(latest)
  }

  const nameId = useId()
  const partyId = useId()
  const noteId = useId()

  const isBooked = source.status === "BOOKED"
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
            #{source.id}
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
                {source.phoneLast3 ? (
                  <RevealPhone
                    key={source.customerId ?? source.id}
                    customerId={source.customerId}
                    last3={source.phoneLast3}
                    context={{ reservationId: source.id }}
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
                    value={parsedParty.ok ? parsedParty.value : validParty}
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
                      id={partyId}
                      data-autofocus=""
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
                {draft.businessDate !== source.businessDate && source.tableIds.length > 0 ? (
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
              <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Bàn</span>
                <div className="min-w-0 flex-1 text-[14px]">
                  <span className="tnum text-tx-1">
                    {source.tableIds.length > 0 ? codesOf(source.tableIds, m.model) : <EmptyPlaceholder />}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">Lưu ngay khi chọn bàn</span>
                </div>
                <button
                  type="button"
                  onClick={requestTableChange}
                  disabled={pending}
                  className="gm-press inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong bg-surface-1 px-3.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint disabled:pointer-events-none disabled:opacity-45"
                >
                  Đổi bàn
                </button>
              </div>
            ) : (
              <div className="flex min-h-12 items-center gap-3 px-4 py-3">
                <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Bàn</span>
                <div className="min-w-0 flex-1 text-[14px]">
                  {source.tableIds.length > 0 ? codesOf(source.tableIds, m.model) : <EmptyPlaceholder />}
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
            onClick={() => {
              if (!isPendingNow()) leaveImmediately()
            }}
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

      <AlertDialog open={confirmLeave && !pending} onOpenChange={setConfirmLeave}>
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
              onClick={() => {
                if (!isPendingNow()) leaveImmediately()
              }}
              className="h-12 rounded-xl text-[15px] font-semibold"
            >
              Đồng ý
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmTableChange && !pending} onOpenChange={setConfirmTableChange}>
        <AlertDialogContent
          data-gm
          data-gm-overlay-id={tableChangeFocus.overlayId}
          data-receptionist-frame={isReceptionist ? "true" : undefined}
          size="sm"
          onCloseAutoFocus={tableChangeFocus.onCloseAutoFocus}
          aria-label="Xác nhận trước khi đổi bàn"
          className="max-w-[min(calc(100%-2rem),380px)] gap-4 rounded-2xl border-border bg-surface-1 p-5 shadow-[var(--shadow-float)]"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="size-11 rounded-xl bg-st-late-tint text-st-late-ink">
              <AlertTriangle className="size-5" aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
              Lưu hoặc bỏ thay đổi trước khi đổi bàn?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] leading-relaxed text-pretty text-[var(--text-muted)]">
              Đổi bàn lưu riêng ngay trên sơ đồ. Hãy lưu hoặc bỏ các thay đổi đang sửa trước khi tiếp tục.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-2 pt-1 group-data-[size=sm]/alert-dialog-content:flex sm:flex-col">
            <AlertDialogAction
              variant="default"
              disabled={!validation.canSave || pending}
              onClick={() => void saveAndPickTables()}
              className="h-12 w-full rounded-xl text-[15px] font-semibold"
            >
              Lưu &amp; đổi bàn
            </AlertDialogAction>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={discardAndPickTables}
              className="h-12 w-full rounded-xl border-border-strong text-[15px] font-medium"
            >
              Bỏ thay đổi
            </Button>
            <AlertDialogCancel
              variant="outline"
              onClick={() => setConfirmTableChange(false)}
              className="h-12 w-full rounded-xl border-border-strong text-[15px] font-medium"
            >
              Ở lại
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
