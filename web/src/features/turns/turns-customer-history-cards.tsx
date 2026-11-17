import { AlertTriangle, CheckCircle2, ChevronRight, Lock, RotateCcw, Undo2 } from "lucide-react"
import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { AssignmentUndo, DuplicateCustomerPair, TableTurnView } from "@/domain/models"
import {
  useAnonymousVisits,
  useAssignAnonymousVisit,
  useDismissDuplicateCustomers,
  useDuplicateCustomers,
  useMergeDuplicateCustomers,
  useUndoAnonymousAssignment,
} from "@/hooks/use-customer-history"
import type { BusinessDate } from "@/lib/time"
import { isApiError } from "@/services/contracts"
import {
  formatAnonymousGuestLabel,
  formatAnonymousVisitTimestamp,
  formatDuplicateCustomerLine,
  formatRemainingAnonymousCount,
  formatTurnCode,
  mapCustomerHistoryError,
  maskPhoneNumbersInText,
  resolveAnonymousPageAction,
  resolveDuplicatePageRecovery,
  validateAnonymousAssignPhone,
  validateNewCustomerName,
} from "./turns-helpers"

const ANONYMOUS_PAGE_SIZE = 50
const DUPLICATES_PAGE_SIZE = 50

interface AnonymousVisitsCardProps {
  from: BusinessDate
  to: BusinessDate
  currentBusinessDate: BusinessDate
  turns?: readonly TableTurnView[]
  isReadOnly: boolean
}

interface AssignFormState {
  visitId: number | null
  phone: string
  displayName: string
  createNameMode: boolean
  hint: string | null
  error: string | null
}

interface LastAssignmentBanner {
  visitId: number
  displayCode: string
  customerName: string
  maskedPhone: string
  customerCreated: boolean
  undo: AssignmentUndo
}

const INITIAL_FORM_STATE: AssignFormState = {
  visitId: null,
  phone: "",
  displayName: "",
  createNameMode: false,
  hint: null,
  error: null,
}

function isForbiddenApiError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.status === 403 || error.code === "PERMISSION_DENIED" || error.code === "CUSTOMER_ORG_WRITE_REQUIRED")
  )
}

/**
 * Right-column Card 1: "Gán lượt khuyết danh vào khách".
 * Queries anonymous visits for the active ledger date range and lets authorized managers
 * link a visit to an existing customer by phone (or create a new profile), skip locally, or undo.
 */
export function AnonymousVisitsCard({ from, to, currentBusinessDate, turns, isReadOnly }: AnonymousVisitsCardProps) {
  const phoneInputId = useId()
  const nameInputId = useId()
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const [rangeKey, setRangeKey] = useState(`${from}:${to}`)
  const [page, setPage] = useState(1)
  const [skippedIds, setSkippedIds] = useState<Set<number>>(() => new Set())
  const [formState, setFormState] = useState<AssignFormState>(INITIAL_FORM_STATE)
  const [lastAssignment, setLastAssignment] = useState<LastAssignmentBanner | null>(null)
  const [statusMessage, setStatusMessage] = useState<{
    tone: "success" | "error"
    message: string
  } | null>(null)
  const [runtimeReadOnly, setRuntimeReadOnly] = useState(false)
  const conflictRefetchRef = useRef(false)

  const nextRangeKey = `${from}:${to}`
  if (rangeKey !== nextRangeKey) {
    setRangeKey(nextRangeKey)
    setPage(1)
    setSkippedIds(new Set())
    setFormState(INITIAL_FORM_STATE)
    setLastAssignment(null)
    setStatusMessage(null)
  }

  const anonymousQuery = useAnonymousVisits({ from, to, page, pageSize: ANONYMOUS_PAGE_SIZE })
  const assignMutation = useAssignAnonymousVisit()
  const undoMutation = useUndoAnonymousAssignment()
  const anonRefetch = anonymousQuery.refetch

  const effectiveReadOnly = isReadOnly || runtimeReadOnly
  const allVisits = anonymousQuery.data?.visits ?? []
  const visibleVisits = allVisits.filter((visit) => !skippedIds.has(visit.visitId))
  const currentVisit = visibleVisits[0] ?? null
  const remainingLabel = formatRemainingAnonymousCount(visibleVisits.length, Boolean(anonymousQuery.data?.hasMore))

  useEffect(() => {
    conflictRefetchRef.current = false
  }, [rangeKey])

  useEffect(() => {
    if (conflictRefetchRef.current && page === 1) {
      conflictRefetchRef.current = false
      void anonRefetch()
    }
  }, [page, anonRefetch])

  useEffect(() => {
    const pageAction = resolveAnonymousPageAction({
      page,
      dataPage: anonymousQuery.data?.page,
      visitsCount: allVisits.length,
      visibleCount: visibleVisits.length,
      hasMore: Boolean(anonymousQuery.data?.hasMore),
      isPending: anonymousQuery.isPending,
      isFetching: anonymousQuery.isFetching,
    })
    if (pageAction === "stay") return
    const timer = setTimeout(() => {
      if (pageAction === "advance") {
        setPage((prev) => prev + 1)
      } else if (pageAction === "recover") {
        setPage(1)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [
    page,
    anonymousQuery.data?.page,
    anonymousQuery.data?.hasMore,
    anonymousQuery.isPending,
    anonymousQuery.isFetching,
    allVisits.length,
    visibleVisits.length,
  ])

  const isActiveFormForCurrent = currentVisit !== null && formState.visitId === currentVisit.visitId
  const phoneValue = isActiveFormForCurrent ? formState.phone : ""
  const nameValue = isActiveFormForCurrent ? formState.displayName : ""
  const createNameMode = isActiveFormForCurrent && formState.createNameMode
  const formHint = isActiveFormForCurrent ? formState.hint : null
  const formError = isActiveFormForCurrent ? formState.error : null

  const ledgerTurn = currentVisit ? turns?.find((turn) => turn.visitId === currentVisit.visitId) : undefined
  const guestLabel = currentVisit ? formatAnonymousGuestLabel(currentVisit.visitId, ledgerTurn?.guestName) : ""

  const isSubmitting = assignMutation.isPending || undoMutation.isPending

  const updateCurrentForm = (updater: (prev: AssignFormState) => AssignFormState) => {
    if (!currentVisit) return
    setFormState((prev) => {
      const base =
        prev.visitId === currentVisit.visitId ? prev : { ...INITIAL_FORM_STATE, visitId: currentVisit.visitId }
      return updater(base)
    })
  }

  const handlePhoneChange = (nextPhone: string) => {
    setStatusMessage(null)
    updateCurrentForm((prev) => ({
      ...prev,
      phone: nextPhone,
      displayName: prev.createNameMode ? prev.displayName : "",
      createNameMode: false,
      hint: null,
      error: null,
    }))
  }

  const handleNameChange = (nextName: string) => {
    setStatusMessage(null)
    updateCurrentForm((prev) => ({
      ...prev,
      displayName: nextName,
      error: null,
    }))
  }

  const handleSkip = () => {
    if (!currentVisit || isSubmitting) return
    setStatusMessage(null)
    setFormState(INITIAL_FORM_STATE)
    const isLastVisibleOnPage = visibleVisits.length <= 1
    const hasMore = Boolean(anonymousQuery.data?.hasMore)
    setSkippedIds((prev) => {
      const next = new Set(prev)
      next.add(currentVisit.visitId)
      return next
    })
    if (isLastVisibleOnPage && hasMore) {
      setPage((prev) => prev + 1)
    }
  }

  const handleResetSkips = () => {
    setSkippedIds(new Set())
    setPage(1)
    setFormState(INITIAL_FORM_STATE)
    setStatusMessage(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentVisit || effectiveReadOnly || isSubmitting) return

    setStatusMessage(null)
    const phoneError = validateAnonymousAssignPhone(phoneValue)
    if (phoneError) {
      updateCurrentForm((prev) => ({ ...prev, error: phoneError, hint: null }))
      return
    }

    if (createNameMode) {
      const nameError = validateNewCustomerName(nameValue)
      if (nameError) {
        updateCurrentForm((prev) => ({ ...prev, error: nameError }))
        return
      }
    }

    try {
      const result = await assignMutation.mutateAsync({
        visitId: currentVisit.visitId,
        version: currentVisit.version,
        phone: phoneValue.trim(),
        ...(createNameMode ? { displayName: nameValue.trim() } : {}),
      })

      const safeCustomerName = maskPhoneNumbersInText(result.customer.displayName?.trim() || "Khách")
      const safeMaskedPhone = result.customer.maskedPhone
        ? maskPhoneNumbersInText(result.customer.maskedPhone)
        : "chưa có SĐT"

      setFormState(INITIAL_FORM_STATE)
      setPage(1)
      setLastAssignment({
        visitId: result.visitId,
        displayCode: currentVisit.displayCode || formatTurnCode(result.visitId),
        customerName: safeCustomerName,
        maskedPhone: safeMaskedPhone,
        customerCreated: result.customerCreated,
        undo: result.undo,
      })
    } catch (error) {
      const mapped = mapCustomerHistoryError(error, "assign")
      if (mapped.requiresName && !createNameMode) {
        updateCurrentForm((prev) => ({
          ...prev,
          createNameMode: true,
          hint: mapped.message,
          error: null,
        }))
        queueMicrotask(() => nameInputRef.current?.focus())
        return
      }
      if (mapped.isForbidden) {
        setRuntimeReadOnly(true)
        updateCurrentForm((prev) => ({ ...prev, error: mapped.message, hint: null }))
        return
      }
      if (mapped.isConflict) {
        setFormState(INITIAL_FORM_STATE)
        setStatusMessage({ tone: "error", message: mapped.message })
        if (page !== 1) {
          conflictRefetchRef.current = true
          setPage(1)
        } else {
          void anonymousQuery.refetch()
        }
        return
      }
      updateCurrentForm((prev) => ({ ...prev, error: mapped.message }))
    }
  }

  const handleUndo = async () => {
    if (!lastAssignment || effectiveReadOnly || undoMutation.isPending) return
    setStatusMessage(null)
    const target = lastAssignment

    try {
      await undoMutation.mutateAsync(target.undo)
      setSkippedIds((prev) => {
        if (!prev.has(target.visitId)) return prev
        const next = new Set(prev)
        next.delete(target.visitId)
        return next
      })
      setLastAssignment(null)
      setFormState(INITIAL_FORM_STATE)
      setPage(1)
      setStatusMessage({
        tone: "success",
        message: `Đã hoàn tác gán lượt ${target.displayCode}.`,
      })
    } catch (error) {
      const mapped = mapCustomerHistoryError(error, "undo")
      if (mapped.isForbidden) {
        setRuntimeReadOnly(true)
        setStatusMessage({ tone: "error", message: mapped.message })
        return
      }
      if (mapped.isConflict) {
        setLastAssignment(null)
        setStatusMessage({ tone: "error", message: mapped.message })
        if (page !== 1) {
          conflictRefetchRef.current = true
          setPage(1)
        } else {
          void anonymousQuery.refetch()
        }
        return
      }
      setStatusMessage({ tone: "error", message: mapped.message })
    }
  }

  const shouldAdvancePage =
    !anonymousQuery.isPending &&
    !anonymousQuery.isFetching &&
    anonymousQuery.data?.page === page &&
    allVisits.length > 0 &&
    visibleVisits.length === 0 &&
    Boolean(anonymousQuery.data?.hasMore)
  const shouldRecoverEmptyPage = page > 1 && Boolean(anonymousQuery.data) && allVisits.length === 0
  const isLoading = (anonymousQuery.isPending && !anonymousQuery.data) || shouldAdvancePage || shouldRecoverEmptyPage
  const fatalError = anonymousQuery.isError && !anonymousQuery.data ? anonymousQuery.error : null
  const skippedCount = skippedIds.size > 0 ? skippedIds.size : allVisits.length

  return (
    <section className="turns-card" aria-labelledby="turns-anon-heading" data-testid="turns-anon-card">
      <div className="turns-card-header turns-side-card-header">
        <div>
          <h2 id="turns-anon-heading" className="turns-card-title">
            Gán lượt khuyết danh vào khách
          </h2>
          <p className="turns-card-subtitle">Thao tác sửa lịch sử - hoàn tác được</p>
        </div>
      </div>

      <div className="turns-side-card-body">
        {lastAssignment ? (
          <div className="turns-undo-banner" role="status" aria-live="polite" data-testid="turns-anon-success-banner">
            <div className="turns-undo-banner-text">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>
                Đã gán <strong>{lastAssignment.displayCode}</strong> cho <strong>{lastAssignment.customerName}</strong>{" "}
                · <span className="whitespace-nowrap">{lastAssignment.maskedPhone}</span>
                {lastAssignment.customerCreated ? " (khách mới)" : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={effectiveReadOnly || undoMutation.isPending}
              className="turns-undo-btn"
              data-testid="turns-anon-undo-btn"
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              {undoMutation.isPending ? "Đang hoàn tác…" : "Hoàn tác"}
            </button>
          </div>
        ) : null}

        {statusMessage ? (
          <div
            className={`turns-inline-alert ${
              statusMessage.tone === "success" ? "turns-inline-alert-success" : "turns-inline-alert-error"
            }`}
            role={statusMessage.tone === "error" ? "alert" : "status"}
            data-testid="turns-anon-status"
          >
            {statusMessage.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="turns-anon-panel grid gap-2.5" data-testid="turns-anon-loading">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-20" />
            </div>
          </div>
        ) : fatalError ? (
          isForbiddenApiError(fatalError) ? (
            <div
              className="turns-inline-alert turns-inline-alert-muted"
              role="status"
              data-testid="turns-anon-forbidden"
            >
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              <span>Tài khoản hiện tại chỉ có quyền xem lượt khuyết danh.</span>
            </div>
          ) : (
            <div
              className="turns-inline-alert turns-inline-alert-error flex-col items-start gap-2.5"
              role="alert"
              data-testid="turns-anon-error"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {fatalError instanceof Error
                    ? maskPhoneNumbersInText(fatalError.message)
                    : "Không thể tải danh sách lượt khuyết danh."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void anonymousQuery.refetch()}
                className="turns-btn-secondary turns-btn-sm"
                data-testid="turns-anon-retry-btn"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Thử lại
              </button>
            </div>
          )
        ) : allVisits.length === 0 ? (
          <p className="turns-side-empty" data-testid="turns-anon-empty">
            Không còn lượt khuyết danh trong khoảng này
          </p>
        ) : !currentVisit ? (
          <div className="turns-anon-panel grid gap-2.5" data-testid="turns-anon-all-skipped">
            <p className="turns-panel-meta m-0">Đã bỏ qua {skippedCount} lượt khuyết danh trong danh sách hiện tại.</p>
            <div>
              <button
                type="button"
                onClick={handleResetSkips}
                className="turns-btn-secondary"
                data-testid="turns-anon-reset-skip-btn"
              >
                Xem lại lượt đã bỏ qua
              </button>
            </div>
          </div>
        ) : (
          <div className="turns-anon-panel" data-testid="turns-anon-panel">
            <p className="turns-panel-title" data-testid="turns-anon-visit-title">
              {`${currentVisit.displayCode || formatTurnCode(currentVisit.visitId)} · ${guestLabel}`}
            </p>
            <p className="turns-panel-meta" data-testid="turns-anon-visit-meta">
              {`${currentVisit.tableLabel || "—"} · ${currentVisit.guestCount} khách · ${formatAnonymousVisitTimestamp(
                currentVisit.seatedAt,
                currentVisit.businessDate,
                currentBusinessDate,
              )}`}
            </p>

            <form className="turns-panel-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div>
                <label htmlFor={phoneInputId} className="sr-only">
                  Nhập SĐT để tìm khách
                </label>
                <input
                  id={phoneInputId}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Nhập SĐT để tìm khách"
                  value={phoneValue}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  disabled={effectiveReadOnly || isSubmitting}
                  aria-invalid={Boolean(formError && !createNameMode)}
                  className="turns-panel-input"
                  data-testid="turns-anon-phone-input"
                />
              </div>

              {createNameMode ? (
                <div className="grid gap-1.5">
                  <label htmlFor={nameInputId} className="sr-only">
                    Tên khách
                  </label>
                  <input
                    ref={nameInputRef}
                    id={nameInputId}
                    type="text"
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Tên khách (bắt buộc)"
                    value={nameValue}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={effectiveReadOnly || isSubmitting}
                    aria-invalid={Boolean(formError)}
                    className="turns-panel-input"
                    data-testid="turns-anon-name-input"
                  />
                </div>
              ) : null}

              {formHint && !formError ? (
                <p className="turns-panel-hint" role="status" data-testid="turns-anon-hint">
                  {formHint}
                </p>
              ) : null}

              {formError ? (
                <p className="turns-panel-error" role="alert" data-testid="turns-anon-form-error">
                  {formError}
                </p>
              ) : null}

              <div className="turns-panel-actions">
                <button
                  type="submit"
                  disabled={effectiveReadOnly || isSubmitting}
                  className="turns-btn-primary"
                  data-testid="turns-anon-submit-btn"
                >
                  {assignMutation.isPending ? "Đang lưu…" : createNameMode ? "Tạo khách và gán" : "Gán vào khách"}
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isSubmitting}
                  className="turns-btn-secondary"
                  data-testid="turns-anon-skip-btn"
                >
                  Bỏ qua
                </button>
              </div>
            </form>

            {effectiveReadOnly ? (
              <p className="turns-readonly-note" data-testid="turns-anon-readonly-note">
                Tài khoản chỉ xem: không thể gán lượt hoặc tạo hồ sơ khách.
              </p>
            ) : null}
          </div>
        )}

        {remainingLabel && !isLoading && !fatalError ? (
          <p className="turns-side-meta" data-testid="turns-anon-remaining">
            {remainingLabel}
          </p>
        ) : null}
      </div>
    </section>
  )
}

interface DuplicateCustomersCardProps {
  isReadOnly: boolean
}

/**
 * Confirmation body copy inside the merge AlertDialog, kept explicit about
 * which phone-bearing target survives and which no-phone source is merged into it.
 */
export function DuplicateMergeSummary({
  pair,
  className,
  style,
  ...props
}: ComponentProps<"div"> & { pair: DuplicateCustomerPair }) {
  return (
    <div
      {...props}
      className={className ? `grid gap-2 text-sm ${className}` : "grid gap-2 text-sm"}
      style={{ color: "var(--admin-text-muted)", ...style }}
    >
      <p className="m-0">
        Hồ sơ được giữ lại:{" "}
        <strong style={{ color: "var(--admin-text-primary)" }}>{formatDuplicateCustomerLine(pair.target)}</strong> (
        {pair.target.visitCount} lượt · {pair.target.bookingCount} đặt bàn).
      </p>
      <p className="m-0">
        Hồ sơ sẽ được gộp vào hồ sơ trên:{" "}
        <strong style={{ color: "var(--admin-text-primary)" }}>{formatDuplicateCustomerLine(pair.source)}</strong> (
        {pair.source.visitCount} lượt · {pair.source.bookingCount} đặt bàn).
      </p>
      <p className="m-0 font-medium" style={{ color: "var(--admin-state-late-ink)" }}>
        Toàn bộ lịch sử của hồ sơ chưa có SĐT sẽ được chuyển sang hồ sơ được giữ lại. Thao tác này không thể hoàn tác.
      </p>
    </div>
  )
}

/**
 * Right-column Card 2: "Gợi ý trùng hồ sơ".
 * Shows one suggested duplicate pair (no-phone profile matching a phone-bearing profile by name)
 * at a time, with merge confirmation dialog and permanent dismiss governed by server flags.
 */
export function DuplicateCustomersCard({ isReadOnly }: DuplicateCustomersCardProps) {
  const cardRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const mergeTriggerRef = useRef<HTMLButtonElement | null>(null)

  const [page, setPage] = useState(1)
  const [pairIndex, setPairIndex] = useState(0)
  const [confirmPair, setConfirmPair] = useState<DuplicateCustomerPair | null>(null)
  const [statusMessage, setStatusMessage] = useState<{
    tone: "success" | "error"
    message: string
  } | null>(null)
  const [runtimeForbiddenMessage, setRuntimeForbiddenMessage] = useState<string | null>(null)
  const conflictRefetchRef = useRef(false)

  const duplicatesQuery = useDuplicateCustomers({ page, pageSize: DUPLICATES_PAGE_SIZE })
  const mergeMutation = useMergeDuplicateCustomers()
  const dismissMutation = useDismissDuplicateCustomers()
  const dupRefetch = duplicatesQuery.refetch

  const data = duplicatesQuery.data
  const pairs = data?.pairs ?? []
  const totalCount = data ? Math.max(data.total, pairs.length) : 0
  const safeIndex = pairs.length > 0 ? pairIndex % pairs.length : 0
  const currentPair = pairs[safeIndex] ?? null
  const displayIndex = (page - 1) * DUPLICATES_PAGE_SIZE + safeIndex + 1

  const canMerge = Boolean(data?.canMerge) && !isReadOnly && runtimeForbiddenMessage === null
  const canDismiss = Boolean(data?.canDismiss) && !isReadOnly && runtimeForbiddenMessage === null
  const isMutating = mergeMutation.isPending || dismissMutation.isPending

  useEffect(() => {
    if (conflictRefetchRef.current && page === 1) {
      conflictRefetchRef.current = false
      void dupRefetch()
    }
  }, [page, dupRefetch])

  useEffect(() => {
    const recoveryPage = resolveDuplicatePageRecovery({
      page,
      dataPage: data?.page,
      pairsCount: pairs.length,
      total: data?.total ?? 0,
      pageSize: DUPLICATES_PAGE_SIZE,
      isPending: duplicatesQuery.isPending,
      isFetching: duplicatesQuery.isFetching,
    })
    if (recoveryPage === null || recoveryPage === page) return
    const timer = setTimeout(() => {
      setPage(recoveryPage)
      setPairIndex(0)
    }, 0)
    return () => clearTimeout(timer)
  }, [page, data?.page, data?.total, pairs.length, duplicatesQuery.isPending, duplicatesQuery.isFetching])

  const handleNextPair = () => {
    if (pairs.length === 0) return
    setStatusMessage(null)
    if (safeIndex + 1 < pairs.length) {
      setPairIndex(safeIndex + 1)
      return
    }
    if (page * DUPLICATES_PAGE_SIZE < totalCount) {
      setPage((prev) => prev + 1)
      setPairIndex(0)
      return
    }
    setPage(1)
    setPairIndex(0)
  }

  const handleConfirmMerge = async () => {
    if (!confirmPair || !canMerge || isMutating) return
    setStatusMessage(null)
    try {
      const res = await mergeMutation.mutateAsync({
        sourceCustomerId: confirmPair.source.id,
        targetCustomerId: confirmPair.target.id,
        sourceVersion: confirmPair.source.version,
        targetVersion: confirmPair.target.version,
      })
      const movedTotal = (res.moved.visits ?? 0) + (res.moved.reservations ?? 0) + (res.moved.waitlist_entries ?? 0)
      setConfirmPair(null)
      setPage(1)
      setPairIndex(0)
      setStatusMessage({
        tone: "success",
        message:
          movedTotal > 0
            ? `Đã gộp hồ sơ và chuyển ${movedTotal} bản ghi sang hồ sơ có SĐT.`
            : "Đã gộp hồ sơ thành công.",
      })
    } catch (error) {
      setConfirmPair(null)
      const mapped = mapCustomerHistoryError(error, "merge")
      if (mapped.isForbidden) {
        setRuntimeForbiddenMessage(mapped.message)
      }
      setStatusMessage({ tone: "error", message: mapped.message })
      if (mapped.isConflict) {
        setPairIndex(0)
        if (page !== 1) {
          conflictRefetchRef.current = true
          setPage(1)
        } else {
          void duplicatesQuery.refetch()
        }
      }
    }
  }

  const handleDismiss = async () => {
    if (!currentPair || !canDismiss || isMutating) return
    setStatusMessage(null)
    try {
      await dismissMutation.mutateAsync({
        sourceCustomerId: currentPair.source.id,
        targetCustomerId: currentPair.target.id,
        sourceVersion: currentPair.source.version,
        targetVersion: currentPair.target.version,
      })
      setPage(1)
      setPairIndex(0)
      setStatusMessage({
        tone: "success",
        message: "Đã đánh dấu hai hồ sơ khác nhau.",
      })
    } catch (error) {
      const mapped = mapCustomerHistoryError(error, "dismiss")
      if (mapped.isForbidden) {
        setRuntimeForbiddenMessage(mapped.message)
      }
      setStatusMessage({ tone: "error", message: mapped.message })
      if (mapped.isConflict) {
        setPairIndex(0)
        if (page !== 1) {
          conflictRefetchRef.current = true
          setPage(1)
        } else {
          void duplicatesQuery.refetch()
        }
      }
    }
  }

  const isRecoveringOutOfRange = page > 1 && data !== undefined && pairs.length === 0 && data.total > 0
  const isLoading = (duplicatesQuery.isPending && !data) || isRecoveringOutOfRange
  const fatalError = duplicatesQuery.isError && !data ? duplicatesQuery.error : null

  const permissionNote =
    runtimeForbiddenMessage ??
    (isReadOnly
      ? "Tài khoản chỉ xem: không thể gộp hoặc bỏ qua gợi ý trùng hồ sơ."
      : data && (!data.canMerge || !data.canDismiss)
        ? "Admin phạm vi cơ sở chỉ được xem; cần quyền toàn tổ chức để gộp hoặc bỏ qua."
        : null)

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      className="turns-card focus:outline-none"
      aria-labelledby="turns-dup-heading"
      data-testid="turns-dup-card"
    >
      <AlertDialog
        open={confirmPair !== null}
        onOpenChange={(open) => {
          if (open) {
            if (currentPair && canMerge && !isMutating) {
              setConfirmPair(currentPair)
            }
            return
          }
          if (!mergeMutation.isPending) {
            setConfirmPair(null)
          }
        }}
      >
        <div className="turns-card-header turns-side-card-header">
          <div>
            <h2 id="turns-dup-heading" className="turns-card-title">
              Gợi ý trùng hồ sơ
            </h2>
            <p className="turns-card-subtitle">hệ thống đề xuất, Quản lý quyết định</p>
          </div>

          {totalCount > 1 && currentPair ? (
            <div className="turns-dup-pager">
              <span className="turns-dup-counter" data-testid="turns-dup-counter">
                {`${displayIndex}/${totalCount}`}
              </span>
              <button
                type="button"
                onClick={handleNextPair}
                className="turns-dup-next-btn"
                aria-label="Xem cặp trùng tiếp theo"
                data-testid="turns-dup-next-btn"
              >
                Tiếp
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

        <div className="turns-side-card-body">
          {statusMessage ? (
            <div
              ref={statusRef}
              tabIndex={-1}
              className={`turns-inline-alert focus:outline-none ${
                statusMessage.tone === "success" ? "turns-inline-alert-success" : "turns-inline-alert-error"
              }`}
              role={statusMessage.tone === "error" ? "alert" : "status"}
              data-testid="turns-dup-status"
            >
              {statusMessage.message}
            </div>
          ) : null}

          {isLoading ? (
            <div className="turns-dup-panel grid gap-2.5" data-testid="turns-dup-loading">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-52" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-20" />
                <Skeleton className="h-10 w-28" />
              </div>
            </div>
          ) : fatalError ? (
            isForbiddenApiError(fatalError) ? (
              <div
                className="turns-inline-alert turns-inline-alert-muted"
                role="status"
                data-testid="turns-dup-forbidden"
              >
                <Lock className="size-4 shrink-0" aria-hidden="true" />
                <span>Tài khoản hiện tại không có quyền xem gợi ý trùng hồ sơ.</span>
              </div>
            ) : (
              <div
                className="turns-inline-alert turns-inline-alert-error flex-col items-start gap-2.5"
                role="alert"
                data-testid="turns-dup-error"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {fatalError instanceof Error
                      ? maskPhoneNumbersInText(fatalError.message)
                      : "Không thể tải gợi ý trùng hồ sơ."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void duplicatesQuery.refetch()}
                  className="turns-btn-secondary turns-btn-sm"
                  data-testid="turns-dup-retry-btn"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Thử lại
                </button>
              </div>
            )
          ) : !currentPair ? (
            <p className="turns-side-empty" data-testid="turns-dup-empty">
              Không có gợi ý trùng hồ sơ nào
            </p>
          ) : (
            <div className="turns-dup-panel" data-testid="turns-dup-panel">
              <div className="turns-dup-profiles">
                <div className="turns-dup-profile" data-testid="turns-dup-target">
                  <p className="turns-panel-title">{formatDuplicateCustomerLine(currentPair.target)}</p>
                  <p className="turns-dup-counts">
                    {`${currentPair.target.visitCount} lượt · ${currentPair.target.bookingCount} đặt bàn`}
                  </p>
                </div>

                <div className="turns-dup-profile" data-testid="turns-dup-source">
                  <p className="turns-panel-title">{formatDuplicateCustomerLine(currentPair.source)}</p>
                  <p className="turns-dup-counts">
                    {`${currentPair.source.visitCount} lượt · ${currentPair.source.bookingCount} đặt bàn`}
                  </p>
                </div>
              </div>

              <p className="turns-panel-meta m-0" data-testid="turns-dup-reason">
                cùng tên, một hồ sơ chưa có SĐT
              </p>

              <div className="turns-panel-actions">
                <AlertDialogTrigger asChild>
                  <button
                    ref={mergeTriggerRef}
                    type="button"
                    disabled={!canMerge || isMutating}
                    className="turns-btn-primary"
                    data-testid="turns-dup-merge-btn"
                  >
                    {mergeMutation.isPending ? "Đang gộp…" : "Gộp"}
                  </button>
                </AlertDialogTrigger>
                <button
                  type="button"
                  disabled={!canDismiss || isMutating}
                  onClick={() => void handleDismiss()}
                  className="turns-btn-secondary"
                  data-testid="turns-dup-dismiss-btn"
                >
                  {dismissMutation.isPending ? "Đang lưu…" : "Khác nhau"}
                </button>
              </div>

              {permissionNote ? (
                <p className="turns-readonly-note" data-testid="turns-dup-permission-note">
                  {permissionNote}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <AlertDialogContent
          className="admin-root"
          style={{
            backgroundColor: "var(--admin-surface, #ffffff)",
            color: "var(--admin-text-primary, #1a1a1a)",
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (mergeTriggerRef.current && !mergeTriggerRef.current.disabled) {
              mergeTriggerRef.current.focus()
              return
            }
            if (statusRef.current) {
              statusRef.current.focus()
              return
            }
            cardRef.current?.focus()
          }}
          data-testid="turns-dup-merge-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận gộp hồ sơ khách?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {confirmPair ? <DuplicateMergeSummary pair={confirmPair} /> : <div />}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeMutation.isPending} data-testid="turns-dup-merge-cancel">
              Hủy
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mergeMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmMerge()
              }}
              data-testid="turns-dup-merge-confirm"
            >
              {mergeMutation.isPending ? "Đang gộp…" : "Xác nhận gộp"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
