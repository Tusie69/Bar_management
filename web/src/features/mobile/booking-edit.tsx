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
  GuestPicker,
  HonorificPicker,
  IconPicker,
  SOCIAL_PLATFORMS,
  SourcePicker,
  formatBookingIcons,
  type SocialPlatform,
} from "@/components/booking-pickers"
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
  guestCount,
  guestError,
  isAfterMidnight,
  slotLabel,
  toggleClassification,
} from "@/domain/booking-rules"
import { formatBookingSource } from "@/domain/enums"
import type { ReservationView, TableAvailability, WaitlistEntryView } from "@/domain/models"
import { MOCK_NOTE, useAction } from "@/hooks/use-action"
import { qk, useReservations, useVenueSettings, useWaitlist } from "@/hooks/use-data"
import { addDays, fmtBusinessDate, fmtDayMonth, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useMobileActions } from "./actions"
import {
  BOOKING_NOTE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  applySavedBookingEdit,
  buildUpdateReservationInput,
  diffBookingEditDraft,
  initialBookingEditDraft,
  pinLoadedBooking,
  prepareTablePickerTarget,
  resolveBookingEditBackAction,
  syncBookingEditSession,
  validateBookingEditDraft,
  type BookingEditDraft,
  type BookingEditSessionState,
  type EditableFieldKey,
  type TablePickerLoadStage,
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
  disabled,
  changed,
  error,
  display,
  onOpen,
  onDone,
  children,
}: {
  label: string
  editing: boolean
  disabled?: boolean
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
          "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
        ) ??
        container.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
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
          <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col border-0 p-0 disabled:opacity-60">
            {children}
          </fieldset>
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
        disabled={disabled}
        onClick={onOpen}
        aria-expanded={false}
        className="gm-press-card flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-surface-2/55 disabled:cursor-not-allowed disabled:opacity-60"
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
  const [session, setSession] = useState<BookingEditSessionState>(() => ({
    source: initial,
    draft: initialBookingEditDraft(initial),
    versionConfirmed: true,
  }))
  const { source, draft } = session
  const versionConfirmed = session.versionConfirmed !== false
  const targetResQuery = useReservations(source.businessDate)
  const waitlistQuery = useWaitlist(source.businessDate)
  const liveRecord = source.businessDate === bd ? r : targetResQuery.data?.find((x) => x.id === source.id)
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmTableChange, setConfirmTableChange] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<{
    savedBeforePick: boolean
    stage: TablePickerLoadStage
    message: string
  } | null>(null)
  const leaveFocus = useRestoreTriggerFocus(confirmLeave, { suppressRestore: !parentOpen })
  const tableChangeFocus = useRestoreTriggerFocus(confirmTableChange, { suppressRestore: !parentOpen })

  const diff = useMemo(() => diffBookingEditDraft(source, draft), [source, draft])

  // Sync source+draft together only while clean; dirty sessions keep their pinned source and version.
  const synced = syncBookingEditSession(session, liveRecord)
  if (synced !== session) {
    setSession(synced)
  }

  const isBusy = pending || pickerLoading
  const fieldsDisabled = isBusy || !versionConfirmed

  const updateDraft = (patch: Partial<BookingEditDraft>) => {
    if (fieldsDisabled) return
    setSession((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }))
  }

  const partyCount = guestCount(draft.guest)
  const partyGuestError = guestError(draft.guest)
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
  const pickerLoadingRef = useRef(false)
  const versionConfirmedRef = useRef(versionConfirmed)
  versionConfirmedRef.current = versionConfirmed
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
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
  const hasTableLoadError =
    m.can("table.assign") && source.status === "BOOKED" && (Boolean(pickerError) || waitlistQuery.isError)
  const canAccessTablePicker =
    m.can("table.assign") &&
    source.status === "BOOKED" &&
    (hold.canReassign || Boolean(pickerError) || waitlistQuery.isError || pickerLoading || !versionConfirmed)

  const dayOptions = useMemo(() => {
    const offsets = Array.from({ length: 7 }, (_, i) => i)
    const dates = offsets.map((i) => ({
      date: addDays(m.today, i),
      top: i === 0 ? "Hôm nay" : fmtBusinessDate(addDays(m.today, i), "short").split(", ")[0],
      day: fmtDayMonth(addDays(m.today, i)),
    }))
    const extras = [source.businessDate, draft.businessDate].filter(
      (d, idx, arr) => arr.indexOf(d) === idx && !dates.some((item) => item.date === d),
    )
    extras.sort()
    for (const extraDate of extras) {
      const [top, day] = fmtBusinessDate(extraDate, "short").split(", ")
      const entry = { date: extraDate, top: top ?? "", day: day ?? extraDate }
      if (extraDate < dates[0].date) dates.unshift(entry)
      else dates.push(entry)
    }
    return dates
  }, [m.today, source.businessDate, draft.businessDate])

  const saveFields = async (): Promise<ReservationView | null> => {
    if (!validation.canSave || !versionConfirmedRef.current || isPendingNow() || pickerLoadingRef.current) return null
    savingRef.current = true
    try {
      const result = await run(async () => api.updateReservation(buildUpdateReservationInput(source, draft)), {
        silent: true,
      })
      if (!result) return null
      const saved = applySavedBookingEdit(source, draft)
      if (mountedRef.current) {
        setSession({ source: saved, draft: initialBookingEditDraft(saved), versionConfirmed: false })
        setPickerError(null)
      }
      toast.success("Đã lưu thay đổi", {
        description: api.mode === "mock" ? MOCK_NOTE : undefined,
      })
      return saved
    } finally {
      savingRef.current = false
    }
  }

  const save = async () => {
    const saved = await saveFields()
    if (saved && mountedRef.current) leaveImmediately()
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

  const runTablePickerPreparation = async (target: ReservationView, fromSave: boolean) => {
    if (pickerLoadingRef.current || savingRef.current) return
    pickerLoadingRef.current = true
    setPickerLoading(true)
    setPickerError(null)
    try {
      const result = await prepareTablePickerTarget(target, fromSave, {
        isMounted: () => mountedRef.current,
        loadBooking: async (targetId, targetBd) => {
          if (!fromSave && versionConfirmedRef.current) {
            const resState = qc.getQueryState<ReservationView[]>(qk.reservations(targetBd, ""))
            const cached =
              resState?.status === "success" && !resState.isInvalidated && !resState.error
                ? resState.data?.find((item) => item.id === targetId)
                : undefined
            if (cached) return cached
          }
          const list = await qc.fetchQuery({
            queryKey: qk.reservations(targetBd, ""),
            queryFn: () => api.listReservations({ businessDate: targetBd, search: "" }),
            staleTime: 0,
            retry: false,
          })
          return list.find((item) => item.id === targetId)
        },
        ensureWaitlist: async (targetBd) => {
          const wlState = qc.getQueryState<WaitlistEntryView[]>(qk.waitlist(targetBd))
          if (
            !wlState ||
            wlState.status !== "success" ||
            wlState.isInvalidated ||
            wlState.data === undefined ||
            wlState.fetchStatus === "fetching"
          ) {
            await qc.fetchQuery({
              queryKey: qk.waitlist(targetBd),
              queryFn: () => api.listWaitlist(targetBd),
              retry: false,
            })
          }
        },
        checkPolicy: (latest) => a.bookingPolicy(latest),
        onSessionSync: (latest) =>
          setSession({ source: latest, draft: initialBookingEditDraft(latest), versionConfirmed: true }),
        onMissingOrClosed: leaveImmediately,
        openPicker: openTablePicker,
      })
      if (result.status === "error" && mountedRef.current) {
        setPickerError({ savedBeforePick: result.savedBeforePick, stage: result.stage, message: result.message })
      }
    } finally {
      pickerLoadingRef.current = false
      if (mountedRef.current) setPickerLoading(false)
    }
  }

  const requestTableChange = () => {
    if (isPendingNow() || pickerLoadingRef.current || !canAccessTablePicker || !versionConfirmed) return
    if (diff.isDirty) {
      setConfirmTableChange(true)
      return
    }
    void runTablePickerPreparation(source, Boolean(pickerError?.savedBeforePick))
  }

  const retryConfirmedRead = () => {
    if (isPendingNow() || pickerLoadingRef.current || versionConfirmed) return
    void runTablePickerPreparation(source, true)
  }

  const discardAndPickTables = () => {
    if (isPendingNow() || pickerLoadingRef.current || !versionConfirmed) return
    setConfirmTableChange(false)
    const cleanTarget = liveRecord && liveRecord.version !== source.version ? liveRecord : source
    setSession({ source: cleanTarget, draft: initialBookingEditDraft(cleanTarget), versionConfirmed: true })
    setPickerError(null)
    void runTablePickerPreparation(cleanTarget, false)
  }

  const saveAndPickTables = async () => {
    if (!validation.canSave || !versionConfirmedRef.current || isPendingNow() || pickerLoadingRef.current) return
    setConfirmTableChange(false)
    const saved = await saveFields()
    if (!saved || !mountedRef.current) return
    await runTablePickerPreparation(saved, true)
  }

  const nameId = useId()
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

        {isBusy ? (
          <p
            role="status"
            className="m-0 flex items-center gap-2 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-[13px] font-medium text-[var(--text-muted)]"
          >
            <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
            <span>
              {pending
                ? "Đang lưu thay đổi..."
                : !versionConfirmed
                  ? "Đã lưu thay đổi · Đang đồng bộ dữ liệu đặt bàn..."
                  : "Đang tải dữ liệu đổi bàn..."}
            </span>
          </p>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow m-0 px-1">Khách hàng</h2>
          <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
            <EditableRow
              label="Tên khách"
              editing={isBooked && editingField === "name"}
              disabled={fieldsDisabled}
              changed={diff.changed.name}
              error={validation.errors.name}
              display={draft.name.trim() ? draft.name : <EmptyPlaceholder />}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("name")}
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
                  disabled={fieldsDisabled}
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
              disabled={fieldsDisabled}
              changed={diff.changed.honorific}
              display={draft.honorific === "MR" ? "Mr" : draft.honorific === "MS" ? "Ms" : <EmptyPlaceholder />}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("honorific")}
              onDone={() => setEditingField(null)}
            >
              <HonorificPicker
                value={draft.honorific}
                onChange={(honorific) => updateDraft({ honorific })}
                disabled={fieldsDisabled}
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
              disabled={fieldsDisabled}
              changed={diff.changed.classification}
              display={classificationDisplay}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("classification")}
              onDone={() => setEditingField(null)}
            >
              <div role="radiogroup" aria-label="Khách đã từng / chưa từng đặt bàn" className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.classification === "RETURNING"}
                  disabled={fieldsDisabled}
                  className={cn(
                    "gm-press h-12 rounded-xl border px-2 text-[13px] leading-tight font-medium",
                    draft.classification === "RETURNING"
                      ? "border-primary bg-primary-tint font-semibold text-primary-ink"
                      : "border-border-strong bg-surface-1 text-tx-1 hover:bg-surface-2",
                  )}
                  onClick={() =>
                    updateDraft({
                      classification: toggleClassification(draft.classification, "RETURNING"),
                    })
                  }
                >
                  Đã từng đặt bàn
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.classification === "NEW"}
                  disabled={fieldsDisabled}
                  className={cn(
                    "gm-press h-12 rounded-xl border px-2 text-[13px] leading-tight font-medium",
                    draft.classification === "NEW"
                      ? "border-primary bg-primary-tint font-semibold text-primary-ink"
                      : "border-border-strong bg-surface-1 text-tx-1 hover:bg-surface-2",
                  )}
                  onClick={() =>
                    updateDraft({
                      classification: toggleClassification(draft.classification, "NEW"),
                    })
                  }
                >
                  Chưa từng đặt bàn
                </button>
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
              disabled={fieldsDisabled}
              changed={diff.changed.partySize}
              error={editingField === "partySize" && partyGuestError ? null : validation.errors.partySize}
              display={
                <span className="tnum">
                  {partyCount !== null ? `${partyCount} khách` : draft.guest.otherText.trim() || <EmptyPlaceholder />}
                </span>
              }
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("partySize")}
              onDone={() => setEditingField(null)}
            >
              <div className="flex flex-col gap-2.5">
                <GuestPicker value={draft.guest} onChange={(guest) => updateDraft({ guest })} showErrors />
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
              disabled={fieldsDisabled}
              changed={diff.changed.businessDate}
              display={<span className="tnum">{fmtBusinessDate(draft.businessDate)}</span>}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("businessDate")}
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
                        disabled={fieldsDisabled}
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
              disabled={fieldsDisabled}
              changed={diff.changed.time}
              error={editingField === "time" && draft.time ? null : validation.errors.time}
              display={<span className="tnum">{timeDisplay}</span>}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("time")}
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

            {canAccessTablePicker ? (
              <div className="flex flex-col">
                <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                  <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Bàn</span>
                  <div className="min-w-0 flex-1 text-[14px]">
                    <span className="tnum text-tx-1">
                      {source.tableIds.length > 0 ? codesOf(source.tableIds, m.model) : <EmptyPlaceholder />}
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">Lưu ngay khi chọn bàn</span>
                  </div>
                  {!hasTableLoadError || !versionConfirmed ? (
                    <button
                      type="button"
                      onClick={requestTableChange}
                      disabled={isBusy || !versionConfirmed}
                      className="gm-press inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong bg-surface-1 px-3.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint disabled:pointer-events-none disabled:opacity-45"
                    >
                      {pickerLoading ? "Đang tải..." : "Đổi bàn"}
                    </button>
                  ) : null}
                </div>
                {hasTableLoadError ? (
                  <div role="alert" className="flex flex-col gap-2 border-t border-border bg-st-noshow-tint px-4 py-3">
                    <p className="m-0 text-xs font-medium text-st-noshow-ink">
                      {pickerError?.message ?? "Không tải được đơn chờ để đổi bàn. Vui lòng thử lại."}
                    </p>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy}
                        onClick={!versionConfirmed ? retryConfirmedRead : requestTableChange}
                        className="h-11 rounded-xl border-border-strong bg-surface-1 px-3.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint"
                      >
                        {pickerLoading ? "Đang tải..." : !versionConfirmed ? "Thử lại đọc booking" : "Thử lại đổi bàn"}
                      </Button>
                    </div>
                  </div>
                ) : null}
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
              disabled={fieldsDisabled}
              changed={diff.changed.source || diff.changed.platform}
              error={editingField === "source" ? null : validation.errors.platform}
              display={sourceDisplay}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("source")}
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
              disabled={fieldsDisabled}
              changed={diff.changed.icons}
              display={iconsDisplay}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("icons")}
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
              disabled={fieldsDisabled}
              changed={diff.changed.note}
              error={validation.errors.note}
              display={draft.note.trim() ? draft.note : <EmptyPlaceholder />}
              onOpen={() => isBooked && !fieldsDisabled && setEditingField("note")}
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
                  disabled={fieldsDisabled}
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
            disabled={!validation.canSave || !versionConfirmed || isBusy}
            aria-busy={pending}
            onClick={() => void save()}
            className={cn(
              "h-12 rounded-xl text-[15px] font-semibold",
              (!validation.canSave || !versionConfirmed || isBusy) &&
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

      <AlertDialog open={confirmTableChange && !pending && versionConfirmed} onOpenChange={setConfirmTableChange}>
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
              disabled={!validation.canSave || !versionConfirmed || isBusy}
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
