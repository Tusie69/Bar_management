import { AlertTriangle, ListOrdered, Menu, MessageSquareText, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
import type { ReservationView, TableLiveState, TableView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability } from "@/hooks/use-data"
import {
  OverlayMotionMount,
  prewarmMotionController,
  useAwaitingMotionController,
  usePresenceController,
  useStableNodeRef,
} from "@/lib/motion"
import { fmtBusinessDate, fmtTime, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import { useReceptionSearch } from "@/hooks/use-reception-search"
import { FloorCanvas } from "../floor/floor-canvas"
import { SpareButton } from "../floor/spare-button"
import { LayoutActions, LayoutMergeControls } from "../floor/layout-merge-controls"
import { clusterMembersForDisplay, independentLayoutEnabled, toggleLayoutTable } from "../floor/layout-merge"
import { GuestCountCard } from "../floor/guest-count-card"
import { StatusLegend } from "../floor/status-legend"
import { claimCallTarget } from "@/domain/call-target"
import { CallCustomerControl } from "../bookings/call-customer"
import { CallHistory } from "../bookings/call-history"
import { groupCode, groupDisplayName } from "../floor/floor-visual-rules"
import { ReceptionDatePicker, ReceptionSearchField, ReceptionSearchResults } from "../floor/reception-controls"
import { ZaloBookingExport } from "../reservations/zalo-booking-export"
import { QuickForm } from "../floor/quick-form"
import { capacityWarningText, isWaitingForTable, selectedTablesCapacity } from "../floor/reception-rules"
import { useBookingDraft } from "../floor/use-booking-draft"
import { useMobileActions } from "./actions"
import { useM, type TablePick } from "./context"
import { menuButtonLabel } from "./menu-alerts"
import { codesOf, duration, type Tone, toneStyle } from "./model"
import { useRestoreTriggerFocus } from "./overlay-focus"
import { useQuickFormEscape, useQuickFormPresence } from "./quick-form-presence"
import { MenuUnreadDot, PlainHeader, UndoRedoButtons } from "./ui"

const ZONE_TABS: [ZoneCode | "ALL", string][] = [
  ["ALL", "Tất cả"],
  ["A", "Khu A"],
  ["B", "Khu B"],
  ["C", "Khu C"],
  ["BAR", "Bar"],
]

function isQuickFormDirty(container: HTMLElement | null): boolean {
  if (!container) return false
  const name = container.querySelector<HTMLInputElement>("#qf-name")?.value.trim() ?? ""
  const phone = container.querySelector<HTMLInputElement>("#qf-phone")?.value.trim() ?? ""
  const note = container.querySelector<HTMLTextAreaElement>("#qf-note")?.value.trim() ?? ""
  const honorific = container.querySelector(
    '[role="group"][aria-label="Danh xưng"] [role="radio"][aria-checked="true"]',
  )
  return Boolean(name || phone || note || honorific)
}

export function MapScreen({
  selected,
  onSelect,
  pick,
  pickSel,
  onPickToggle,
  onPickCancel,
  onPickConfirm,
  pickBusy,
  keyboardSafeHeight = null,
}: {
  selected: number | null
  onSelect: (id: number | null) => void
  pick: TablePick | null
  pickSel: number[]
  onPickToggle: (id: number) => void
  onPickCancel: () => void
  onPickConfirm: () => void
  pickBusy: boolean
  keyboardSafeHeight?: number | null
}) {
  const m = useM()
  const receptionist = m.role === "RECEPTIONIST"
  const search = useReceptionSearch(m.businessDate, receptionist)
  const zone = useUi((s) => (receptionist ? "ALL" : s.zone))
  const setZone = useUi((s) => s.setZone)
  const d = useBookingDraft(m.model)
  const quickForm = useQuickFormPresence()
  const draft = quickForm.activeDraft
  const layoutPick = useUi((s) => s.pick?.intent === "layout")
  const layoutIds = useUi((s) => s.pickSelection)
  const waitingCount = (m.waitlist ?? []).filter(isWaitingForTable).length
  const canExport = m.can("customer.view_masked")
  // The plan owns the screen: its own controls float on it instead of stacking above it.
  const planChrome = receptionist && !pick && !draft

  // While the booking form is open the map only gets the upper half, so fitting
  // the whole venue into it leaves the tables too small to aim at. Focus the
  // zone the chosen table sits in instead: that zone fills the strip, and the
  // canvas dims every other zone, which is what "mờ các khu khác" means.
  const draftZone = useMemo<ZoneCode | null>(() => {
    const first = draft?.tableIds?.[0]
    if (first === undefined) return null
    return (m.model.byId.get(first)?.zoneCode as ZoneCode | undefined) ?? null
  }, [draft, m.model])

  const isAssignPick = !!pick?.targetExpectedAt
  const pickAvail = useAvailability(isAssignPick ? pick.targetExpectedAt! : null, pick?.targetParty ?? 2)
  const pickSnapshot = pickAvail.isPlaceholderData || pickAvail.isError ? undefined : pickAvail.data
  const pickAvailMap = useMemo(() => new Map((pickSnapshot?.tables ?? []).map((t) => [t.tableId, t])), [pickSnapshot])

  const pickable = useMemo(() => {
    if (!pick) return null
    if (isAssignPick) {
      const availTables = pickSnapshot?.tables ?? []
      const ids = new Set<number>()
      for (const t of availTables) {
        if (t.status === "available" || t.status === "too_small") {
          ids.add(t.tableId)
        }
      }
      for (const id of pick.preselected ?? []) ids.add(id)
      for (const id of pick.exclude ?? []) ids.delete(id)
      return ids
    }
    const ids = new Set(pick.only ?? [...m.model.freeIds, ...(pick.preselected ?? [])])
    for (const id of pick.exclude ?? []) ids.delete(id)
    return ids
  }, [pick, isAssignPick, pickSnapshot, m.model.freeIds])

  const [draftOverlayEl, draftOverlayRef] = useStableNodeRef<HTMLDivElement>()
  const [draftContentEl, draftContentRef] = useStableNodeRef<HTMLElement>()
  const { awaitingMotion: draftAwaiting, fallbackShown: draftFallback } = useAwaitingMotionController(
    quickForm.present,
    quickForm.isOpen,
  )
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [lastSessionKey, setLastSessionKey] = useState(quickForm.sessionKey)
  if (quickForm.sessionKey !== lastSessionKey) {
    setLastSessionKey(quickForm.sessionKey)
    if (confirmLeave) setConfirmLeave(false)
  }
  if (!quickForm.isOpen && confirmLeave) {
    setConfirmLeave(false)
  }

  const quickFormFocus = useRestoreTriggerFocus(quickForm.isOpen, { modal: false })
  const leaveFocus = useRestoreTriggerFocus(confirmLeave, { suppressRestore: !quickForm.isOpen })
  const floorPointerRef = useRef<{ id: number; x: number; y: number; dragged: boolean } | null>(null)
  const wasQuickFormPresentRef = useRef(false)
  const quickFormPresentRef = useRef(quickForm.present)
  useLayoutEffect(() => {
    quickFormPresentRef.current = quickForm.present
  }, [quickForm.present])

  const closeQuickFormNow = useCallback(() => {
    const kind = useUi.getState().draft?.kind
    if (kind === "walkin") useUi.getState().closeWalkIn()
    else if (kind === "booking") useUi.getState().closeBooking()
  }, [])

  const requestQuickFormClose = useCallback(() => {
    if (!quickForm.isOpen || confirmLeave) return
    if (isQuickFormDirty(draftContentEl)) {
      setConfirmLeave(true)
    } else {
      closeQuickFormNow()
    }
  }, [closeQuickFormNow, confirmLeave, draftContentEl, quickForm.isOpen])

  // Move keyboard focus into the quick-form container on entry without opening the virtual keyboard.
  useEffect(() => {
    if (!quickForm.isOpen || !draftContentEl || confirmLeave) return
    const active = document.activeElement
    if (active && draftContentEl.contains(active)) return
    draftContentEl.focus({ preventScroll: true })
  }, [confirmLeave, draftContentEl, quickForm.isOpen, quickForm.sessionKey])

  // Restore focus to the surviving opener once QuickForm finishes its exit (and any leave alert is gone).
  useEffect(() => {
    const wasPresent = wasQuickFormPresentRef.current
    wasQuickFormPresentRef.current = quickForm.present
    if (wasPresent && !quickForm.present) {
      const alertStillOpen = Boolean(document.querySelector(`[data-gm-overlay-id="${leaveFocus.overlayId}"]`))
      if (!alertStillOpen) {
        quickFormFocus.restoreNonModal()
      }
    }
  }, [leaveFocus.overlayId, quickForm.present, quickFormFocus])

  // Handle Escape before any outgoing tooltip's document-capture DismissableLayer while keeping live modals in control.
  useQuickFormEscape({
    open: quickForm.isOpen,
    suppressed: confirmLeave,
    onClose: requestQuickFormClose,
  })

  return (
    <main className="contents">
      {receptionist ? (
        <header className="gm-glass-chrome z-[5] shrink-0 border-b border-border/70 bg-[var(--glass-chrome)] px-3 pt-[var(--top-safe)] backdrop-blur-md">
          {/* A single 48px row is the whole fixed chrome: menu, search, export.
              Undo/redo, date, Đếm khách and ⓘ float on the plan itself. */}
          <div className="flex h-[48px] items-center justify-between gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={m.openAccount}
              onPointerEnter={() => void prewarmMotionController()}
              onPointerDown={() => void prewarmMotionController()}
              aria-label={menuButtonLabel("Menu", m.unread)}
              className="gm-press relative grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-1 text-tx-strong shadow-[var(--shadow-xs)] hover:border-border-strong hover:bg-surface-2"
            >
              <Menu className="size-5" aria-hidden />
              <MenuUnreadDot unread={m.unread} />
            </button>
            {planChrome ? (
              <>
                <h1 className="sr-only">Sơ đồ bàn</h1>
                <ReceptionSearchField
                  search={search}
                  className="md:mx-auto md:max-w-md [&_button]:min-h-[44px] [&_button]:min-w-[44px] [&_input]:h-11 [&_input]:min-h-[44px] [&_input]:rounded-xl [&_input]:border-border [&_input]:bg-surface-1 [&_input]:pr-2 [&_input]:pl-10 [&_input]:text-[13px] [&_input]:shadow-[var(--shadow-xs)] sm:[&_input]:pl-11 sm:[&_input]:text-sm"
                />
              </>
            ) : (
              <h1 className="m-0 min-w-0 flex-1 truncate text-[18px] font-bold tracking-[-0.015em] text-tx-strong">
                Sơ đồ bàn
              </h1>
            )}
            <ZaloBookingExport businessDate={m.businessDate} enabled={canExport}>
              {({ copy, loading }) => (
                <button
                  type="button"
                  disabled={!canExport || loading}
                  onClick={() => void copy()}
                  aria-label="Xuất text Zalo"
                  title="Xuất text booking để gửi nhóm Zalo"
                  className={cn(
                    "gm-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-2.5 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)] sm:px-3.5 sm:text-[14px]",
                    (!canExport || loading) && "cursor-not-allowed opacity-50",
                  )}
                >
                  <MessageSquareText className="size-4 shrink-0" aria-hidden />
                  <span>Xuất Text</span>
                </button>
              )}
            </ZaloBookingExport>
          </div>
        </header>
      ) : (
        <PlainHeader
          title={pick?.targetDate ? `Sơ đồ bàn · ${fmtBusinessDate(pick.targetDate, "short")}` : "Sơ đồ bàn"}
        />
      )}
      {/* The receptionist works on the whole floor and reads the counts inside the ⓘ popup,
          so neither the zone tabs nor the legend card take screen height from the plan. */}
      {!receptionist && !pick ? (
        <div className="z-[4] flex shrink-0 flex-col gap-1.5 bg-background px-4 pt-1 pb-1.5">
          <div
            role="tablist"
            aria-label="Lọc khu"
            className="flex w-full max-w-full gap-1 overflow-x-auto rounded-xl border border-border/60 bg-surface-3/85 p-1 shadow-[var(--shadow-xs)]"
          >
            {ZONE_TABS.map(([k, label]) => {
              const on = zone === k
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setZone(k)}
                  className={cn(
                    "gm-press flex min-h-11 min-w-0 flex-1 shrink-0 items-center justify-center rounded-[10px] px-1.5 text-[13px] whitespace-nowrap",
                    on
                      ? "bg-surface-1 font-semibold text-tx-strong shadow-[var(--shadow-xs)]"
                      : "font-medium text-tx-2 hover:text-tx-1",
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {draft ? null : <StatusLegend tables={m.model.tables} states={m.model.states} />}
        </div>
      ) : null}
      {/* Idle "Ghép bàn" button is off the receptionist's screen: merging starts from the
          table sheet. The active merge panel still shows so nobody gets stuck in pick mode. */}
      {!pick && !layoutPick && !receptionist ? (
        <div className="shrink-0 px-4 pb-1.5">
          <LayoutMergeControls model={m.model} />
        </div>
      ) : null}
      {pick ? (
        <div className="z-[6] mx-auto mt-1.5 mb-2 flex w-[calc(100%-1.5rem)] max-w-[var(--gm-max-w)] shrink-0 items-start gap-2 rounded-2xl border border-primary/50 bg-surface-1 py-2.5 pr-1.5 pl-3.5 shadow-[var(--shadow-soft)]">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-tx-strong">{pick.title}</span>
            <span className="text-[13px] text-pretty text-[var(--text-muted)]">{pick.hint}</span>
            {pick.targetDate ? (
              <span className="tnum mt-0.5 text-[12px] font-semibold text-primary-ink">
                Lịch đặt: {pick.targetTime} · {fmtBusinessDate(pick.targetDate, "short")} ({pick.targetParty} khách)
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onPickCancel}
            aria-label="Hủy chọn bàn"
            className="gm-press grid size-11 shrink-0 place-items-center rounded-xl text-[var(--text-muted)] hover:bg-surface-2 hover:text-tx-1"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        className="relative min-h-0 flex-1 bg-[var(--floor)]"
        onPointerDown={(e) => {
          void prewarmMotionController()
          if (!e.isPrimary) {
            if (floorPointerRef.current) floorPointerRef.current.dragged = true
            return
          }
          floorPointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false }
        }}
        onPointerMove={(e) => {
          const p = floorPointerRef.current
          if (!p || p.id !== e.pointerId) return
          if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) {
            p.dragged = true
          }
        }}
        onClick={(e) => {
          const dragged = floorPointerRef.current?.dragged
          floorPointerRef.current = null
          if (!quickForm.isOpen || pick || layoutPick || confirmLeave || dragged) return
          const target = e.target
          if (target instanceof Element && target.closest("[role='button'], button, a, input, select, textarea")) {
            return
          }
          requestQuickFormClose()
        }}
      >
        {/* Search results float OVER the plan so document flow doesn't jump the camera. */}
        {planChrome && search.active ? (
          <div className="pointer-events-none absolute inset-x-0 top-1.5 z-[11] px-2.5">
            <div className="gm-glass-chrome pointer-events-auto mx-auto w-full max-w-[var(--gm-max-w)] rounded-2xl border border-border bg-popover/95 px-3 py-2.5 shadow-[var(--shadow-float)] backdrop-blur-md">
              <ReceptionSearchResults search={search} onOpenBooking={m.openDetail} />
            </div>
          </div>
        ) : null}
        {m.model.catalog ? (
          <FloorCanvas
            className="absolute inset-0"
            mobileShell={receptionist}
            tables={m.model.tables}
            zones={m.model.catalog.zones}
            mode={isAssignPick || d.bookingDraft ? "availability" : "live"}
            states={m.model.states}
            availability={d.bookingDraft ? d.availabilityMap : isAssignPick ? pickAvailMap : undefined}
            groups={independentLayoutEnabled || (!isAssignPick && !d.bookingDraft) ? m.model.floor?.groups : []}
            selectedIds={draft ? draft.tableIds : layoutPick ? layoutIds : pick ? pickSel : selected ? [selected] : []}
            searchHighlightedIds={!pick && !draft ? search.tableIds : []}
            pickable={layoutPick ? null : d.bookingDraft ? d.pickable : draft ? null : pickable}
            zoneFocus={receptionist ? (draftZone ?? "ALL") : zone}
            preserveWidthFit={!!draft}
            now={m.now}
            planOverlay={
              planChrome
                ? () => (
                    <div className="reception-plan-overlay pointer-events-none absolute inset-0">
                      <GuestCountCard
                        businessDate={m.businessDate}
                        onOpen={m.openCount}
                        onEdit={m.openCountEdit}
                        className="pointer-events-auto absolute top-1.5 left-1.5 z-10"
                      />
                      <div className="pointer-events-auto absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
                        <StatusLegend
                          variant="badge"
                          tables={m.model.tables}
                          states={m.model.states}
                          className="size-11"
                        />
                        <ReceptionDatePicker
                          onDateChange={() => onSelect(null)}
                          className="[&>button]:h-11 [&>button]:min-h-[44px] [&>button]:gap-1.5 [&>button]:rounded-xl [&>button]:border-border/80 [&>button]:bg-surface-1/92 [&>button]:px-2 [&>button]:text-[13px] [&>button]:font-semibold [&>button]:shadow-[var(--shadow-soft)] [&>button]:backdrop-blur-md dark:[&>button]:border-slate-700/80 dark:[&>button]:bg-[#1e232d]/92"
                        />
                        <button
                          type="button"
                          onClick={() => m.go("wait")}
                          onPointerEnter={() => void prewarmMotionController()}
                          onPointerDown={() => void prewarmMotionController()}
                          aria-label={`Bàn chờ, ${waitingCount} nhóm đang đợi`}
                          className="gm-press inline-flex h-11 min-h-[44px] min-w-[44px] items-center gap-1 rounded-xl border border-border/80 bg-surface-1/92 px-2 text-xs font-semibold text-tx-strong shadow-[var(--shadow-soft)] backdrop-blur-md dark:border-slate-700/80 dark:bg-[#1e232d]/92"
                        >
                          <ListOrdered className="size-3.5 shrink-0" aria-hidden />
                          <span>Chờ</span>
                          {waitingCount > 0 ? <span className="tnum">+{waitingCount}</span> : null}
                        </button>
                      </div>
                    </div>
                  )
                : undefined
            }
            waitingCount={receptionist || draft || pick ? undefined : waitingCount}
            onOpenWaitlist={receptionist || draft || pick ? undefined : () => m.go("wait")}
            onTableClick={(id) =>
              layoutPick
                ? toggleLayoutTable(m.model, id)
                : draft
                  ? d.onTableClick(id)
                  : pick
                    ? onPickToggle(id)
                    : onSelect(id)
            }
            onBlockedTableClick={draft ? d.onTableClick : undefined}
            onBackgroundClick={() => (pick || draft || layoutPick ? undefined : onSelect(null))}
            ariaLabel={
              d.bookingDraft
                ? `Sơ đồ khả dụng lúc ${d.bookingDraft.time} để chọn bàn`
                : isAssignPick
                  ? `Sơ đồ khả dụng lúc ${pick.targetTime} ngày ${fmtBusinessDate(pick.targetDate!, "short")}`
                  : receptionist
                    ? "Sơ đồ bàn, trạng thái hiện tại"
                    : "Sơ đồ bàn. Kéo để di chuyển, chụm hai ngón để phóng to"
            }
          />
        ) : null}
      </div>
      {/* Bottom strip: merge controls when active, or Undo/Redo for receptionist.
          Notification bell is intentionally omitted for RECEPTIONIST. */}
      {!pick && layoutPick ? (
        <div className="z-[11] shrink-0 px-2.5 pb-[max(6px,var(--bottom-safe))]">
          <LayoutMergeControls model={m.model} overlay />
        </div>
      ) : planChrome ? (
        <div className="gm-glass-chrome z-[5] flex h-[52px] shrink-0 items-center gap-2 border-t border-border/70 bg-[var(--glass-chrome)] px-2.5 pb-[var(--bottom-safe)] backdrop-blur-md">
          <UndoRedoButtons square />
        </div>
      ) : null}
      {pick
        ? (() => {
            const pickCap = selectedTablesCapacity(pickSel, m.model.byId)
            const pickCapWarn = capacityWarningText(pickSel.length, pickCap, pick.targetParty)
            return (
              <div className="z-[12] mx-auto flex w-full max-w-[var(--gm-max-w)] shrink-0 flex-col gap-2.5 rounded-t-[20px] border-t border-border bg-surface-1 px-4 pt-3.5 pb-[calc(14px+var(--bottom-safe))] shadow-[var(--shadow-float)] md:border-x">
                {pick.question && pickSel.length ? (
                  <span className="text-[15px] font-semibold text-tx-strong">
                    {pick.question(codesOf(pickSel, m.model))}
                  </span>
                ) : null}
                <span className="tnum text-[13px] font-medium text-[var(--text-muted)]">
                  {pickSel.length ? (
                    <>
                      Đã chọn {codesOf(pickSel, m.model)} · {pickCap} chỗ
                    </>
                  ) : (
                    "Chưa chọn bàn"
                  )}
                </span>
                {pickCapWarn ? (
                  <p
                    role="status"
                    data-testid="capacity-warning"
                    className="tnum m-0 flex items-start gap-2 rounded-xl border border-st-late/30 bg-st-late-tint px-3 py-2 text-[13px] font-medium text-st-late-ink"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{pickCapWarn}</span>
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  disabled={!pickSel.length || pickBusy}
                  onClick={onPickConfirm}
                  className="h-12 w-full rounded-xl text-[15px] font-semibold"
                >
                  {pickBusy ? "Đang gửi..." : pick.confirmLabel}
                </Button>
              </div>
            )
          })()
        : null}
      {draft && draftZone ? (
        <p
          onClick={() => {
            if (quickForm.isOpen && !confirmLeave) requestQuickFormClose()
          }}
          className="z-[11] m-0 shrink-0 bg-background px-4 pb-1 text-center text-[11px] font-medium tracking-wide text-[var(--text-muted)]"
        >
          KHU {draftZone} · chạm để chọn thêm
        </p>
      ) : null}
      {quickForm.present && quickForm.storeDraft ? (
        <>
          <div ref={draftOverlayRef} aria-hidden className="pointer-events-none fixed inset-0 z-[-1] opacity-0" />
          <section
            ref={draftContentRef}
            tabIndex={-1}
            data-gm-overlay-id={quickFormFocus.overlayId}
            role={quickForm.isOpen ? "dialog" : undefined}
            aria-label="Đặt bàn trên sơ đồ"
            aria-hidden={!quickForm.isOpen || undefined}
            inert={!quickForm.isOpen || undefined}
            data-motion-state={quickForm.isOpen ? "open" : "closing"}
            onKeyDownCapture={(e) => {
              if (e.key !== "Escape" || e.defaultPrevented) return
              e.preventDefault()
              e.stopPropagation()
              requestQuickFormClose()
            }}
            style={{
              ...(draftAwaiting ? { opacity: 0 } : {}),
              ...(keyboardSafeHeight
                ? { maxHeight: Math.max(200, keyboardSafeHeight - (draft && draftZone ? 76 : 56)) }
                : {}),
            }}
            className={cn(
              "z-[12] mx-auto flex max-h-[62dvh] min-h-0 w-full max-w-[var(--gm-max-w)] flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-popover shadow-[var(--shadow-float)] outline-none md:border-x",
              !keyboardSafeHeight && "pb-[var(--bottom-safe)]",
              !quickForm.isOpen && "pointer-events-none",
            )}
          >
            <div
              className="flex min-h-0 flex-1 flex-col pt-1"
              onClickCapture={(e) => {
                const target = e.target
                if (!(target instanceof Element)) return
                if (target.closest('button[aria-label="Đóng form"]') && isQuickFormDirty(draftContentEl)) {
                  e.preventDefault()
                  e.stopPropagation()
                  setConfirmLeave(true)
                }
              }}
            >
              <QuickForm
                key={quickForm.sessionKey}
                compact
                model={m.model}
                availability={d.status === "ready" ? d.availability.data : undefined}
                availabilityStatus={d.status}
                onRetryAvailability={() => void d.availability.refetch()}
              />
            </div>
          </section>
          {draftOverlayEl && draftContentEl ? (
            <OverlayMotionMount
              kind="sheet"
              side="bottom"
              open={quickForm.isOpen}
              skipInitialEnter={draftFallback}
              overlay={draftOverlayEl}
              content={draftContentEl}
              onExitComplete={quickForm.onExitComplete}
            />
          ) : null}
        </>
      ) : null}
      <AlertDialog
        open={confirmLeave}
        onOpenChange={(next) => {
          if (!next) setConfirmLeave(false)
        }}
      >
        <AlertDialogContent
          data-gm
          data-gm-overlay-id={leaveFocus.overlayId}
          data-receptionist-frame={receptionist ? "true" : undefined}
          size="sm"
          onCloseAutoFocus={(event) => {
            if (!quickForm.isOpen) {
              event.preventDefault()
              leaveFocus.onCloseAutoFocus(event)
              if (!quickFormPresentRef.current) {
                quickFormFocus.restoreNonModal()
              }
              return
            }
            leaveFocus.onCloseAutoFocus(event)
            if (draftContentEl && (!document.activeElement || !draftContentEl.contains(document.activeElement))) {
              event.preventDefault()
              const closeBtn = draftContentEl.querySelector<HTMLElement>('button[aria-label="Đóng form"]')
              ;(closeBtn ?? draftContentEl).focus({ preventScroll: true })
            }
          }}
          aria-label="Bỏ đơn đang nhập"
          className="max-w-[min(calc(100%-2rem),380px)] gap-4 rounded-2xl border-border bg-surface-1 p-5 shadow-[var(--shadow-float)]"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="size-11 rounded-xl bg-st-late-tint text-st-late-ink">
              <AlertTriangle className="size-5" aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
              Bỏ đơn đang nhập?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] leading-relaxed text-[var(--text-muted)]">
              Thông tin vừa nhập sẽ không được lưu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 gap-2.5 pt-1">
            <AlertDialogCancel className="h-12 rounded-xl border-border-strong text-[15px] font-medium">
              Tiếp tục nhập
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmLeave(false)
                closeQuickFormNow()
              }}
              className="h-12 rounded-xl text-[15px] font-semibold"
            >
              Bỏ đơn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

const STATE_TEXT = (st: TableLiveState, late: number, noshow: number): [string, Tone] =>
  ({
    free: ["Trống", null],
    reserved: ["Đã đặt", "reserved"],
    upcoming: ["Sắp tới", "upcoming"],
    late: [`Tới muộn · ${late} phút`, "noshow"],
    late_confirmed: [`Tới muộn · đã báo muộn · ${late} phút`, "noshow"],
    noshow: [`Tới muộn · ${noshow} phút`, "noshow"],
    seated: ["Đã tới", "seated"],
    hold: ["Đang giữ", "reserved"],
    hold_overdue: ["Quá hạn giữ", "late"],
    oos: ["Ngưng phục vụ", null],
    spare: ["Sơ cua", null],
  })[st] as [string, Tone]

function actionRows(cells: ReactNode[]): ReactNode[][] {
  if (cells.length <= 1) return cells.length ? [cells] : []
  const paired = cells.length % 2 === 0 ? cells : cells.slice(0, cells.length - 3)
  const rows: ReactNode[][] = []
  for (let index = 0; index < paired.length; index += 2) rows.push(paired.slice(index, index + 2))
  if (cells.length % 2 !== 0) rows.push(cells.slice(cells.length - 3))
  return rows
}

interface Action {
  label: string
  go?: () => void
  primary?: boolean
  danger?: boolean
  wide?: boolean
  disabled?: boolean
  title?: string
}

/** Non-modal bottom sheet over the lower half; the map stays visible and other tables stay tappable. */
export function TableSheet({
  id,
  superseded = false,
  onClose,
}: {
  id: number | null
  superseded?: boolean
  onClose: () => void
}) {
  const m = useM()
  const a = useMobileActions()
  const pending = a.pending

  const isOpen = Boolean(id && !superseded && m.model.byId.has(id))
  const { present, markExited } = usePresenceController({ open: isOpen })
  const [cachedId, setCachedId] = useState<number | null>(id)
  if (id && m.model.byId.has(id) && id !== cachedId) {
    setCachedId(id)
  }

  const [overlayEl, overlayCallbackRef] = useStableNodeRef<HTMLDivElement>()
  const [contentEl, contentCallbackRef] = useStableNodeRef<HTMLDivElement>()
  const { awaitingMotion, fallbackShown } = useAwaitingMotionController(present, isOpen)
  const tableFocus = useRestoreTriggerFocus(isOpen, { modal: false, sourceKey: isOpen ? (id ?? cachedId) : null })
  const wasPresentRef = useRef(false)

  useEffect(() => {
    const wasPresent = wasPresentRef.current
    wasPresentRef.current = present
    if (wasPresent && !present) {
      tableFocus.restoreNonModal()
    }
  }, [present, tableFocus])

  if (!present) return null

  const activeId = id ?? cachedId
  const t = activeId ? m.model.byId.get(activeId) : undefined
  if (!t || activeId === null) return null

  const fs = m.model.states.get(activeId)
  const st = fs?.state ?? "free"
  const c = fs?.claim ?? null
  const callTarget = c ? claimCallTarget(c) : null
  const members = clusterMembersForDisplay(m.model, activeId, c?.tableIds)
  const isGroup = members.length > 1
  const memberTables = members.map((mid) => m.model.byId.get(mid)).filter((x): x is TableView => !!x)
  const group = m.model.floor?.groups.find((g) => g.tableIds.includes(activeId))
  const groupName = isGroup ? groupDisplayName(memberTables, group) : ""
  const isBar = t.kind === "BAR_SEAT"
  const groupTitle = isGroup ? `Bàn ${groupName}` : isBar ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`
  const totalCapacity = memberTables.reduce((sum, x) => sum + x.capacity, 0)
  const zone = m.model.catalog?.zones.find((z) => z.id === t.zoneId)
  const [chip, tone] = STATE_TEXT(st, m.th.late, m.th.noshow)
  const r = c?.reservationId ? m.reservations?.find((x) => x.id === c.reservationId) : undefined
  const linkedEntry = c?.waitlistEntryId
    ? m.waitlist?.find((x) => x.id === c.waitlistEntryId)
    : r
      ? m.waitlist?.find((x) => x.reservationId === r.id && x.status === "HOLD_ACTIVE")
      : undefined

  let who = ""
  let when = ""
  let info = ""
  const bookingDetailAction = (resId: number, resBd: BusinessDate, target?: ReservationView): Action => {
    const canEdit = Boolean(target) && m.can("reservation.update")
    return {
      label: canEdit ? "Sửa booking" : "Xem booking",
      go: () => (canEdit ? m.openBookingEdit(resId, resBd) : m.openDetail(resId, resBd)),
    }
  }

  let actions: Action[] = []
  if (c?.kind === "visit") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Đang ngồi từ ${fmtTime(c.startsAt)}, ${duration(m.now.getTime() - c.startsAt.getTime())}`
    actions = [
      { label: "Đổi bàn", go: () => a.moveVisit(c, activeId) },
      ...(c.reservationId ? [bookingDetailAction(c.reservationId, r?.businessDate ?? m.today, r)] : []),
      { label: "Nhả bàn", danger: true, wide: true, go: () => a.endVisit(c) },
    ]
  } else if (c?.kind === "waitlist_hold" || (c?.kind === "reservation" && linkedEntry)) {
    const entry = linkedEntry ?? (c?.waitlistEntryId ? m.waitlist?.find((x) => x.id === c.waitlistEntryId) : undefined)
    who = `${c.displayName}, ${c.partySize} khách`
    when = c.deadlineAt ? `Giữ từ danh sách chờ đến ${fmtTime(c.deadlineAt)}` : "Đang giữ bàn từ danh sách chờ"

    const hold = a.heldPolicy(entry, r)
    actions = [
      {
        label: "Khách đã đến",
        primary: true,
        wide: true,
        disabled: !hold.canArrival,
        title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () =>
          a.arrival({ entry, reservation: r, partySize: c.partySize, tableCodes: codesOf(c.tableIds, m.model) }),
      },
      {
        label: "Quản lý đơn",
        go: () =>
          r ? m.openDetail(r.id, r.businessDate) : m.openEntryDetail(entry?.id ?? c.waitlistEntryId!, m.businessDate),
      },
      {
        label: "Đổi / Ghép bàn",
        disabled: !hold.canReassign,
        title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () => a.reassignHold(entry, r),
      },
      ...(r ? [bookingDetailAction(r.id, r.businessDate, r)] : []),
      {
        label: "Xem đơn chờ",
        disabled: !entry,
        go: () => entry && m.openEntryDetail(entry.id, entry.businessDate),
      },
      ...(r
        ? [
            {
              label: "Hủy booking",
              danger: true,
              wide: true,
              disabled: !m.can("reservation.cancel") || !hold.canBookingStatus,
              go: () => a.cancel(r),
            },
          ]
        : [
            {
              label: "Hủy đơn chờ",
              danger: true,
              wide: true,
              disabled: !entry || !m.can("waitlist.cancel"),
              go: () => entry && a.cancelEntry(entry),
            },
          ]),
    ]
  } else if (c?.kind === "reservation") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Booking ${fmtTime(c.startsAt)}${st === "late" || st === "late_confirmed" || st === "noshow" ? `, trễ ${c.minutesLate} phút` : st === "upcoming" ? ", sắp đến" : ", đã đặt"}`
    actions = r
      ? [
          { label: "Khách đã đến", primary: true, go: () => void a.checkIn(r) },
          ...(!r.lateConfirmedAt &&
          r.businessDate === m.today &&
          m.now.getTime() >= r.expectedAt.getTime() &&
          r.minutesLate < m.th.noshow
            ? [{ label: "Tới muộn", go: () => a.confirmLate(r) }]
            : []),
          bookingDetailAction(r.id, r.businessDate, r),
          { label: "Đổi bàn", go: () => a.assign(r) },
          {
            label: "Hủy booking",
            danger: true,
            wide: true,
            disabled: !m.can("reservation.cancel"),
            go: () => a.cancel(r),
          },
        ]
      : []
  } else if (st === "spare") {
    info = m.isOwner
      ? "Bàn sơ cua chỉ mở khi quản lý chấp nhận vượt quy tắc."
      : "Bàn sơ cua. Cần Chủ quán/Admin mở vượt quy tắc."
    actions = m.isOwner
      ? [{ label: "Mở bàn vượt quy tắc", wide: true, go: () => m.openForm({ mode: "walkin", tableIds: members }) }]
      : []
  } else if (st === "oos") {
    info = "Bàn đang ngưng phục vụ."
  } else {
    info = zone?.isWaitingArea ? `${zone.name} là khu chờ, không nhận đặt trước.` : "Bàn đang trống lúc này."
    actions = [
      { label: "Mở bàn Walk-in", primary: true, go: () => m.openForm({ mode: "walkin", tableIds: members }) },
      {
        label: "Đặt bàn",
        go: () => m.openForm({ mode: "booking", tableIds: zone?.isBookable ? members : [] }),
      },
    ]
  }

  const leadActions = actions.filter((x) => x.wide && !x.danger)
  const tailActions = actions.filter((x) => x.wide && x.danger)
  const pairActions = actions.filter((x) => !x.wide)

  const actionButton = (x: Action) => (
    <button
      key={x.label}
      type="button"
      onClick={x.go}
      disabled={x.disabled || a.pending || pending}
      title={x.title}
      className={cn(
        "gm-press min-h-12 rounded-xl border px-2.5 text-[14.5px] leading-tight font-semibold disabled:pointer-events-none disabled:opacity-45",
        x.primary
          ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)]"
          : x.danger
            ? "border-destructive/40 bg-[var(--destructive-tint)] text-destructive hover:border-destructive/60"
            : "border-border-strong bg-surface-1 text-tx-1 shadow-[var(--shadow-xs)] hover:bg-surface-2",
      )}
    >
      {x.label}
    </button>
  )

  const cells: ReactNode[] = []
  if (callTarget) {
    cells.push(
      <CallCustomerControl key="call" target={callTarget} canCall={c?.canCall === true || c?.phoneLast3 != null} />,
    )
  }
  for (const x of pairActions) cells.push(actionButton(x))
  if (t) {
    cells.push(<SpareButton key="spare" table={t} state={st} hasClaim={Boolean(c)} inGroup={isGroup} />)
  }

  return (
    <>
      <div ref={overlayCallbackRef} aria-hidden className="pointer-events-none fixed inset-0 z-[-1] opacity-0" />
      <div
        ref={contentCallbackRef}
        data-gm-overlay-id={tableFocus.overlayId}
        data-mobile-table-sheet="true"
        role={superseded ? undefined : "dialog"}
        aria-label={`Chi tiết ${isGroup ? groupTitle : t.code}`}
        aria-hidden={superseded || !isOpen || undefined}
        inert={superseded || !isOpen}
        data-motion-state={isOpen ? "open" : "closing"}
        style={awaitingMotion ? { opacity: 0 } : undefined}
        className={cn(
          "absolute inset-x-0 bottom-[var(--nav-h)] z-[12] mx-auto flex max-h-[82dvh] w-full max-w-[var(--gm-max-w)] flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-border bg-surface-1 px-4 pt-4 pb-[calc(16px+var(--bottom-safe))] shadow-[var(--shadow-float)] md:border-x",
          !isOpen && "pointer-events-none",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-[22px] leading-tight font-bold tracking-[-0.02em] text-tx-strong">
                {groupTitle}
              </h2>
              <span className="rounded-full px-2.5 py-0.5 text-xs leading-5 font-semibold" style={toneStyle(tone)}>
                {isGroup ? `${chip} - ghép ${members.length} bàn` : chip}
              </span>
            </div>
            <span className="text-[13px] font-medium text-[var(--text-muted)]">
              {zone?.name}, {isBar && !isGroup ? "1 ghế" : `${totalCapacity} chỗ`}
              {t.isSpare ? ", bàn sơ cua" : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="gm-press -mt-1 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-xl text-[var(--text-muted)] hover:bg-surface-2 hover:text-tx-1"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {who ? (
          <div className="flex flex-col gap-1 rounded-2xl border border-border/75 bg-surface-2/80 px-3.5 py-3">
            <span className="text-[15px] font-semibold text-tx-strong">{who}</span>
            <span className="text-[13px] font-medium text-tx-2">{when}</span>
            {c?.phoneLast3 ? (
              <span className="tnum text-[13px] text-[var(--text-muted)]">SĐT: ••• {c.phoneLast3}</span>
            ) : null}
            {c?.flags?.length ? (
              <span className="text-[13px] text-[var(--text-muted)]">
                {c.flags.includes("RETURNING") ? "🔥 Đã từng đặt bàn" : ""}
                {c.flags.includes("RETURNING") && c.flags.includes("NEW") ? " · " : ""}
                {c.flags.includes("NEW") ? "🆕 Chưa từng đặt bàn" : ""}
              </span>
            ) : null}
            {c && c.tableIds.length > 1 ? (
              <span className="text-[13px] text-[var(--text-muted)]">
                Nhóm {c.groupDisplayCode ?? groupCode(c.symbolNo) ?? "ghép"}: {codesOf(c.tableIds, m.model)}
              </span>
            ) : null}
            {st === "noshow" ? (
              <span className="mt-0.5 text-[13px] font-semibold text-st-noshow-ink">
                Chờ lễ tân xử lý; bàn vẫn được giữ.
              </span>
            ) : null}
          </div>
        ) : null}
        {info ? <span className="text-[13px] leading-relaxed text-pretty text-[var(--text-muted)]">{info}</span> : null}
        <LayoutActions model={m.model} tableId={activeId} />
        {actions.length || t ? (
          <div className="flex flex-col gap-2">
            {leadActions.map((x) => actionButton(x))}
            {actionRows(cells).map((row, index) => (
              <div
                key={index}
                className={cn(
                  // items-start, KHÔNG stretch: ô "Sơ cua" mang thêm một dòng
                  // giải thích khi nút bị khóa, nên nó cao hơn hẳn hai ô kia.
                  // Với stretch, nút bên cạnh bị kéo cao bằng cả ô đó — một
                  // nút "Đổi bàn" cao gấp ba lần nút thường. h-12 cố định giữ
                  // mọi nút trong hàng bằng nhau, còn dòng giải thích rơi
                  // xuống dưới nút của chính nó.
                  "grid items-start gap-2 [&_button]:h-12",
                  row.length === 3
                    ? "grid-cols-3 [&_button]:px-1.5 [&_button]:text-[12.5px] [&_button]:leading-[1.2]"
                    : "grid-cols-2",
                )}
              >
                {row}
              </div>
            ))}
            {tailActions.map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={x.go}
                disabled={x.disabled || a.pending || pending}
                title={x.title}
                className="gm-press h-12 rounded-xl border border-destructive/40 bg-[var(--destructive-tint)] text-[14.5px] font-semibold text-destructive hover:border-destructive/60 disabled:pointer-events-none disabled:opacity-45"
              >
                {x.label}
              </button>
            ))}
          </div>
        ) : null}
        {callTarget ? <CallHistory target={callTarget} /> : null}
      </div>
      {present && overlayEl && contentEl ? (
        <OverlayMotionMount
          kind="sheet"
          side="bottom"
          open={isOpen}
          skipInitialEnter={fallbackShown}
          overlay={overlayEl}
          content={contentEl}
          onExitComplete={markExited}
        />
      ) : null}
    </>
  )
}
