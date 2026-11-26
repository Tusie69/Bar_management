import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, ChevronLeft, Clock, Info, Link2, Lock, Send, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { cn } from "@/lib/utils"
import { ApiError, isApiError, newIdempotencyKey } from "@/services"
import {
  formatVnd,
  isPaymentAvailable,
  paymentApi,
  type PayBill,
  type PayBillSummary,
  type PaymentApi,
  type PaymentMethod,
  type PreviewBill,
  type Receipt,
  type SessionBills,
} from "@/services/payment"
import { useCan, useSession } from "@/state/session"
import { usePaymentShell } from "@/features/cashier/payment-shell-context"
import { BillRoundsCard, DetailActionPane, ProvisionalPreviewView } from "./bill-pane"
import { CashActionPane, MethodActionPane, QrActionPane, SuccessView, type PaymentErrorState } from "./pay-actions"
import { PaymentFloorMap } from "./payment-floor-map"
import { submitPaymentConfirm, type IdempotencySlot } from "./payment-submit"

export type PaymentStep = "list" | "detail" | "preview" | "method" | "cash" | "qr" | "success"

const STEPS_META = ["Chi tiết", "Phương thức", "Thu tiền", "Hoàn tất"]

function parseStep(raw: string | undefined, hasVisit: boolean, canCollect: boolean): PaymentStep {
  if (!hasVisit) return "list"
  if (!raw || raw === "detail") return "detail"
  if (raw === "preview") return "preview"
  if (!canCollect) return "detail"
  if (raw === "method" || raw === "cash" || raw === "qr" || raw === "success") return raw
  return "detail"
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true))
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])
  return online
}

function isUnimplemented501(err: unknown): boolean {
  return isApiError(err) && (err.status === 501 || err.code === "NOT_IMPLEMENTED_YET")
}

function isBillPaid(bill: Pick<PayBill, "status" | "billStatus">): boolean {
  return bill.billStatus ? bill.billStatus === "PAID" : bill.status === "PAID"
}

function previewToPayBill(preview: PreviewBill, status: PayBill["status"]): PayBill {
  return {
    billCode: "",
    visitId: preview.visitId,
    sessionCode: preview.sessionCode,
    code: preview.code,
    tables: preview.tables,
    clusterCode: preview.clusterCode,
    status,
    lines: preview.lines,
    subtotalVnd: preview.subtotalVnd,
    vatVnd: preview.vatVnd,
    preRoundVnd: preview.preRoundVnd,
    roundingVnd: preview.roundingVnd,
    dueVnd: preview.dueVnd,
    version: preview.version,
    openedAt: "—",
    waiterName: "—",
    guests: 0,
    roundCount: 0,
  }
}

export function partitionOpenSessions<T extends Pick<PayBillSummary, "status" | "unpaidBillCount">>(
  sessions: readonly T[],
): { pending: T[]; serving: T[] } {
  const pending: T[] = []
  const serving: T[] = []
  for (const s of sessions) {
    if (s.status === "AWAITING_PAYMENT" || (s.unpaidBillCount ?? 0) > 0) {
      pending.push(s)
    } else {
      serving.push(s)
    }
  }
  return { pending, serving }
}

export function PaymentFlowWorkspace({
  visitIdParam,
  stepParam,
  homePath = "/payment",
  backHomeLabel = "Phiên đang mở",
  api,
  isOfflineOverride,
}: {
  visitIdParam?: string
  stepParam?: string
  homePath?: string
  backHomeLabel?: string
  api?: PaymentApi
  isOfflineOverride?: boolean
}) {
  const activeApi = api ?? paymentApi
  const online = useOnlineStatus()
  const isOffline = isOfflineOverride ?? !online

  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const payShell = usePaymentShell()
  const user = useSession((s) => s.user)
  const canCollect = useCan("payment.collect")
  const canReadOrders = useCan("order.read")
  const isWaiter = user.role === "WAITER" && canReadOrders
  const canViewAny = canCollect || isWaiter
  const moneyStepRequested =
    stepParam === "method" || stepParam === "cash" || stepParam === "qr" || stepParam === "success"

  const step = parseStep(stepParam, Boolean(visitIdParam), canCollect)

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = payShell ? payShell.selectedId : localSelectedId
  const setSelectedId = payShell ? payShell.setSelectedId : setLocalSelectedId

  const [billExpanded, setBillExpanded] = useState(false)
  const [previewViewMode, setPreviewViewMode] = useState<"screen" | "print">("screen")
  const [lastMethod, setLastMethod] = useState<PaymentMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [payError, setPayError] = useState<PaymentErrorState | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [feedback, setFeedback] = useState<{
    navKey: string
    kind: "success" | "info" | "error"
    text: string
  } | null>(null)
  const prebillNotice =
    (location.state as { prebillNotice?: string } | null)?.prebillNotice ?? null

  const requestedBillCode = searchParams.get("bill")
  const previewKind = searchParams.get("kind") === "invoice" ? "invoice" : "provisional"

  // Synchronous in-flight guard: React state updates on next render, so double-clicks
  // or fast taps within the same frame must be blocked synchronously here.
  const inFlightRef = useRef(false)
  const idempotencyKeyRef = useRef<IdempotencySlot | null>(null)
  const pendingMapScrollRef = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const setShellPendingPayment = payShell?.setPendingPayment
  const scrollToTop = payShell?.scrollToTop

  const navKey = `${visitIdParam ?? ""}:${step}`
  const visibleFeedback = feedback && feedback.navKey === navKey ? feedback : null

  const showFeedback = useCallback(
    (kind: "success" | "info" | "error", text: string, targetKey = navKey) => {
      setFeedback({ navKey: targetKey, kind, text })
    },
    [navKey],
  )

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 3000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    if (!setShellPendingPayment) return
    setShellPendingPayment(busy)
    return () => setShellPendingPayment(false)
  }, [busy, setShellPendingPayment])

  const openQuery = useQuery({
    queryKey: ["payment-open"],
    queryFn: () => activeApi.listOpen(),
    enabled: isPaymentAvailable && canViewAny && step === "list",
  })

  const sessionBillsQuery = useQuery({
    queryKey: ["payment-session-bills", visitIdParam],
    queryFn: async (): Promise<SessionBills> => {
      try {
        return await activeApi.getSessionBills(visitIdParam!)
      } catch (err) {
        if (isUnimplemented501(err)) {
          const b = await activeApi.getBill(visitIdParam!)
          return {
            visitId: b.visitId,
            sessionCode: b.sessionCode,
            code: b.code,
            tables: b.tables,
            clusterCode: b.clusterCode,
            status: b.status,
            unbilledLineCount: b.status === "SERVING" && b.lines.length > 0 ? b.lines.length : 0,
            bills: b.status === "SERVING" ? [] : [b],
            version: b.version,
          }
        }
        throw err
      }
    },
    enabled: isPaymentAvailable && canViewAny && Boolean(visitIdParam) && step !== "list",
  })

  const sessionBills = sessionBillsQuery.data
  const needsPreviewFetch =
    step === "preview" || Boolean(sessionBills && sessionBills.bills.length === 0 && sessionBills.status !== "CLOSED_UNPAID")

  const previewQuery = useQuery({
    queryKey: ["payment-preview", visitIdParam],
    queryFn: async (): Promise<PreviewBill> => {
      try {
        return await activeApi.previewBill(visitIdParam!)
      } catch (err) {
        if (isUnimplemented501(err)) {
          const b = await activeApi.getBill(visitIdParam!)
          return {
            visitId: b.visitId,
            sessionCode: b.sessionCode,
            code: b.code,
            tables: b.tables,
            clusterCode: b.clusterCode,
            lines: b.lines,
            subtotalVnd: b.subtotalVnd,
            vatVnd: b.vatVnd,
            preRoundVnd: b.preRoundVnd,
            roundingVnd: b.roundingVnd,
            dueVnd: b.dueVnd,
            version: b.version,
          }
        }
        throw err
      }
    },
    enabled: isPaymentAvailable && canViewAny && Boolean(visitIdParam) && needsPreviewFetch,
  })

  const cancelRequestsQuery = useQuery({
    queryKey: ["payment-cancel-requests"],
    queryFn: async () => {
      try {
        return await activeApi.listCancelRequests()
      } catch (err) {
        if (isUnimplemented501(err)) return []
        throw err
      }
    },
    enabled: isPaymentAvailable && canCollect && step === "detail",
  })

  const [prevNavKey, setPrevNavKey] = useState(navKey)
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey)
    setPayError(null)
    setBillExpanded(false)
    if (step === "preview") setPreviewViewMode("screen")
  }

  useLayoutEffect(() => {
    if (scrollToTop) {
      scrollToTop()
      return
    }
    const el = rootRef.current
    if (!el) return
    el.scrollTop = 0
    if (el.parentElement && el.parentElement.scrollTop > 0) {
      el.parentElement.scrollTop = 0
    }
  }, [scrollToTop, visitIdParam, step])

  useEffect(() => {
    if (step !== "list" || !selectedId || pendingMapScrollRef.current !== selectedId) return
    pendingMapScrollRef.current = null
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        try {
          const mapEl = document.getElementById("floor-map")
          if (!mapEl) return
          const r = mapEl.getBoundingClientRect()
          const scrollParent = mapEl.closest(".pay-root") as HTMLElement | null
          const viewRect = scrollParent
            ? scrollParent.getBoundingClientRect()
            : { top: 0, bottom: window.innerHeight }
          const headerH = scrollParent?.querySelector(".pay-hdr")?.getBoundingClientRect().height ?? 0
          const visibleTop = Math.max(0, viewRect.top) + headerH
          const visibleBottom = Math.min(window.innerHeight, viewRect.bottom)
          if (r.top >= visibleTop + 4 && r.bottom <= visibleBottom - 4) return
          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          if (scrollParent) {
            const targetTop = Math.max(0, scrollParent.scrollTop + (r.top - viewRect.top) - headerH - 12)
            scrollParent.scrollTo({ top: targetTop, behavior: reduced ? "auto" : "smooth" })
          } else {
            mapEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
          }
        } catch {
          /* scrollTo optional in non-DOM envs */
        }
      })
    })
    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
  }, [selectedId, step])

  const openList = openQuery.data ?? []
  const { pending: pendingSessions, serving: servingSessions } = useMemo(
    () => partitionOpenSessions(openList),
    [openList],
  )

  const selectedBill: PayBill | undefined = useMemo(() => {
    if (!sessionBills) return undefined
    const bills = sessionBills.bills
    if (bills.length > 0) {
      if (requestedBillCode) {
        const match = bills.find((b) => b.billCode === requestedBillCode)
        if (match) return match
      }
      return bills.find((b) => !isBillPaid(b)) ?? bills[0]
    }
    if (previewQuery.data) {
      return previewToPayBill(previewQuery.data, sessionBills.status)
    }
    return undefined
  }, [previewQuery.data, requestedBillCode, sessionBills])

  const previewBillModel: PayBill | undefined = useMemo(() => {
    if (previewQuery.data) {
      return previewToPayBill(previewQuery.data, sessionBills?.status ?? "SERVING")
    }
    return selectedBill
  }, [previewQuery.data, selectedBill, sessionBills?.status])

  const invalidatePaymentQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment-open"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-notifications"] }),
      ...(visitIdParam
        ? [
            queryClient.invalidateQueries({ queryKey: ["payment-session-bills", visitIdParam] }),
            queryClient.invalidateQueries({ queryKey: ["payment-preview", visitIdParam] }),
            queryClient.invalidateQueries({ queryKey: ["payment-bill", visitIdParam] }),
          ]
        : []),
      queryClient.invalidateQueries({ queryKey: ["payment-cancel-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["floor"] }),
    ])
  }, [queryClient, visitIdParam])

  const goToStep = useCallback(
    (
      nextVisitId: string,
      nextStep: PaymentStep,
      options?: { prebillNotice?: string; replace?: boolean; billCode?: string | null; kind?: "invoice" | "provisional" },
    ) => {
      idempotencyKeyRef.current = null
      const navOpts =
        options?.prebillNotice || options?.replace
          ? {
              ...(options.prebillNotice ? { state: { prebillNotice: options.prebillNotice } } : {}),
              ...(options.replace ? { replace: true } : {}),
            }
          : undefined
      if (nextStep === "list") {
        navigate(homePath)
        return
      }
      const qp = new URLSearchParams()
      if (options?.billCode) qp.set("bill", options.billCode)
      if (options?.kind === "invoice") qp.set("kind", "invoice")
      const billSuffix = qp.toString() ? `?${qp.toString()}` : ""
      if (homePath === "/phucvu") {
        navigate(`/phucvu/phien/${nextVisitId}/thanh-toan${nextStep === "preview" ? "?view=preview" : ""}`, navOpts)
        return
      }
      if (nextStep === "detail") navigate(`${homePath}/${nextVisitId}${billSuffix}`, navOpts)
      else navigate(`${homePath}/${nextVisitId}/${nextStep}${billSuffix}`, navOpts)
    },
    [homePath, navigate],
  )

  const handleSessionPick = (session: PayBillSummary | string) => {
    const id = typeof session === "string" ? session : session.visitId
    if (selectedId === id) {
      pendingMapScrollRef.current = null
      goToStep(id, "detail")
      return
    }
    pendingMapScrollRef.current = id
    setSelectedId(id)
  }

  const handleSelectBill = (billCode: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("bill", billCode)
    setSearchParams(next, { replace: true })
  }

  // VM-04 / TN-02-K3: Xem tạm tính stays strictly state-free via previewBill.
  const handlePreview = () => {
    if (!visitIdParam) return
    goToStep(visitIdParam, "preview")
  }

  const handleIssueInvoice = async (): Promise<PayBill | null> => {
    if (!sessionBills || inFlightRef.current || !canCollect) return null
    inFlightRef.current = true
    setBusy(true)
    try {
      let issued: PayBill
      try {
        issued = await activeApi.issueInvoice(sessionBills.visitId, sessionBills.version, newIdempotencyKey())
      } catch (err) {
        if (isUnimplemented501(err)) {
          issued = await activeApi.createPrebill(sessionBills.visitId, sessionBills.version)
        } else {
          throw err
        }
      }
      await invalidatePaymentQueries()
      handleSelectBill(issued.billCode)
      showFeedback("success", `Đã xuất hóa đơn ${issued.billCode}. Phiên chuyển sang Chờ thanh toán.`)
      return issued
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Không xuất được hóa đơn.")
      return null
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const handleCollect = async () => {
    if (!sessionBills || !selectedBill || !canCollect || inFlightRef.current) return
    if (selectedBill.status === "CLOSED_UNPAID" || isBillPaid(selectedBill)) return
    if (selectedBill.billCode) {
      goToStep(sessionBills.visitId, "method", { billCode: selectedBill.billCode })
      return
    }
    const issued = await handleIssueInvoice()
    if (issued) {
      goToStep(sessionBills.visitId, "method", { billCode: issued.billCode })
    }
  }

  const handleRequestPayment = async () => {
    const targetBill = selectedBill
    if (!targetBill || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    try {
      await activeApi.requestPayment(targetBill.visitId)
      await invalidatePaymentQueries()
      showFeedback("success", `Đã gửi yêu cầu thanh toán ${targetBill.code} cho Thu ngân.`)
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Không gửi được yêu cầu thanh toán.")
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const handleRequestCancel = async (billCode: string, reason: string) => {
    await activeApi.requestCancel(billCode, reason)
    await invalidatePaymentQueries()
    showFeedback("success", `Đã gửi yêu cầu huỷ thanh toán cho bill ${billCode}.`)
  }

  const handleConfirm = async (method: PaymentMethod, givenVnd = 0) => {
    await submitPaymentConfirm({
      api: activeApi,
      bill: selectedBill,
      canCollect,
      method,
      givenVnd,
      busy,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      setPayError,
      setReceipt,
      invalidate: invalidatePaymentQueries,
      onSuccess: (rc) => {
        showFeedback("success", `Đã ghi nhận thanh toán. ${rc.tables.join(", ")} về Trống.`, `${rc.visitId}:success`)
        goToStep(rc.visitId, "success", { billCode: rc.billCode })
      },
    })
  }

  const handleBack = () => {
    if (busy || !visitIdParam) return
    if (step === "detail" || step === "success") {
      navigate(homePath)
    } else if (step === "preview" || step === "method") {
      goToStep(visitIdParam, "detail", { billCode: selectedBill?.billCode || null })
    } else if (step === "cash" || step === "qr") {
      goToStep(visitIdParam, "method", { billCode: selectedBill?.billCode || null })
    }
  }

  const requiresIssuedBillStep = step === "method" || step === "cash" || step === "qr"
  const needsPrebillRedirect = Boolean(
    sessionBills &&
      requiresIssuedBillStep &&
      (!selectedBill || !selectedBill.billCode || (sessionBills.status === "SERVING" && sessionBills.bills.length === 0)),
  )

  useEffect(() => {
    if (!needsPrebillRedirect || !sessionBills) return
    goToStep(sessionBills.visitId, "detail", {
      prebillNotice: "Phiên đang phục vụ, chưa xuất hóa đơn. Hãy bấm Xuất hóa đơn trước khi thu tiền.",
      replace: true,
    })
  }, [goToStep, needsPrebillRedirect, sessionBills])

  if (!isPaymentAvailable) {
    return <Navigate to={homePath === "/phucvu" ? "/phucvu" : "/floor"} replace />
  }

  if (!canViewAny || (moneyStepRequested && !canCollect)) {
    const deniedContent = (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-xs">
        <Lock className="mx-auto mb-3 size-8 text-[var(--text-muted)]" aria-hidden />
        <h1 className="text-lg font-bold">
          {moneyStepRequested && !canCollect ? "Chỉ Thu ngân mới thu tiền" : "Không có quyền truy cập thanh toán"}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {moneyStepRequested && !canCollect
            ? "Mọi thao tác thu tiền (chọn phương thức, tiền mặt, chuyển khoản QR) chỉ dành cho Thu ngân, Chủ sở hữu hoặc Quản trị."
            : "Chỉ Thu ngân, Chủ sở hữu, Quản trị hoặc Phục vụ (từ chi tiết phiên) mới xem được màn hình này."}
        </p>
      </div>
    )
    return payShell ? deniedContent : <div className="pay-root p-6">{deniedContent}</div>
  }

  const stepIdx = step === "method" ? 2 : step === "cash" || step === "qr" ? 3 : step === "success" ? 4 : 1
  const pageTitleMap: Record<PaymentStep, string> = {
    list: "Phiên đang mở",
    detail: "Chi tiết Phiên",
    preview: "",
    method: "Chọn phương thức thanh toán",
    cash: "Thanh toán tiền mặt",
    qr: "Chuyển khoản QR",
    success: "Hoàn tất",
  }
  const backLabelMap: Record<PaymentStep, string> = {
    list: "",
    detail: backHomeLabel,
    preview: "Chi tiết Phiên",
    method: "Chi tiết Phiên",
    cash: "Chọn phương thức",
    qr: "Chọn phương thức",
    success: backHomeLabel,
  }

  const renderSessionRow = (s: PayBillSummary) => {
    const isSel = selectedId === s.visitId
    const isPend = s.status === "AWAITING_PAYMENT" || (s.unpaidBillCount ?? 0) > 0
    const isCluster = Boolean(s.clusterCode && s.tables.length > 1)
    const hasLines = s.hasOrderLines !== false
    const hasIssuedInfo = Boolean(s.issuedAt || s.issuedBy || s.requestedAt)
    const issuer = s.issuedBy ?? s.waiterName
    const issuedTime = s.issuedAt ?? s.requestedAt ?? s.pendingAt
    return (
      <button
        key={s.visitId}
        type="button"
        onClick={() => handleSessionPick(s)}
        className={cn("pay-sess", isSel && "sel")}
      >
        <span className="pay-sess-main">
          <span className="pay-sess-code">
            <b>{s.code}</b>
            {isCluster ? (
              <span className="pay-chip-cl">
                <Link2 className="pay-i sm" aria-hidden />
                {`Cụm ${s.tables.length} bàn · 1 phiên`}
              </span>
            ) : null}
            {isPend ? (
              <span className="pay-pill pay-p-pend">
                <Clock className="pay-i sm" aria-hidden />
                Chờ thanh toán
              </span>
            ) : null}
            {hasIssuedInfo ? (
              <span className="pay-pill pay-p-req">
                <Send className="pay-i sm" aria-hidden />
                {`Đã đưa hóa đơn · ${issuer}${issuedTime ? ` · ${issuedTime}` : ""}`}
              </span>
            ) : null}
          </span>
          <span className="pay-sess-meta">{`mở ${s.openedAt} · PV ${s.waiterName}`}</span>
          {isSel ? <span className="pay-sess-hint">Chạm lần nữa để mở chi tiết</span> : null}
        </span>
        <span className="pay-sess-amt">
          <small>{!hasLines ? "Dữ liệu món" : isPend ? "Phải trả" : "Tạm tính"}</small>
          <b className={cn(!hasLines && "!text-sm !font-semibold !text-[var(--text-muted)]")}>
            {hasLines ? formatVnd(s.dueVnd) : "Chưa có dữ liệu"}
          </b>
        </span>
      </button>
    )
  }

  const sessionRemainingOpen = Boolean(
    sessionBills &&
      (sessionBills.unbilledLineCount > 0 || sessionBills.bills.some((b) => !isBillPaid(b))),
  )

  const workspaceBody = (
    <>
      {/* S1: Home (Cần thu + Đang phục vụ + floor map) */}
      {step === "list" ? (
        openQuery.isPending ? (
          <div className="pay-lg" aria-busy="true">
            <div className="pay-card pay-sk-stack">
              <div className="pay-sk" style={{ height: 64 }} />
              <div className="pay-sk" style={{ height: 64 }} />
              <div className="pay-sk" style={{ height: 64 }} />
            </div>
            <div className="pay-card pay-sk-stack">
              <div className="pay-sk" style={{ height: 420 }} />
            </div>
          </div>
        ) : openQuery.isError ? (
          <div role="alert" className="pay-bn pay-bn-err">
            <span>
              <b>Không tải được danh sách phiên đang mở</b>
              <span className="pay-bn-act">
                <button type="button" onClick={() => void openQuery.refetch()} className="pay-btn pay-btn-s">
                  Thử lại
                </button>
              </span>
            </span>
          </div>
        ) : (
          <div className="pay-lg pay-lg-m">
            <div className="pay-sess-col">
              {openList.length === 0 ? (
                <section aria-label="Danh sách phiên" className="pay-sess-list">
                  <div className="pay-empty">
                    <b>Không còn phiên nào đang mở</b>
                    Bàn đã thanh toán tự về Trống trên sơ đồ.
                  </div>
                </section>
              ) : (
                <>
                  <h2 className="pay-grp-title hot">
                    Cần thu <span className="pay-grp-n">{pendingSessions.length}</span>
                  </h2>
                  {pendingSessions.length > 0 ? (
                    <section aria-label="Cần thu" className="pay-sess-list">
                      {pendingSessions.map(renderSessionRow)}
                    </section>
                  ) : (
                    <p className="pay-grp-empty">Chưa có phiên nào chờ thu tiền.</p>
                  )}

                  {servingSessions.length > 0 ? (
                    <>
                      <h2 className="pay-grp-title">
                        Đang phục vụ <span className="pay-grp-n">{servingSessions.length}</span>
                      </h2>
                      <section aria-label="Danh sách phiên" className="pay-sess-list">
                        {servingSessions.map(renderSessionRow)}
                      </section>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <PaymentFloorMap
              sessions={openList}
              selectedId={selectedId}
              onSelectSession={handleSessionPick}
              onClearSelection={() => setSelectedId(null)}
            />
          </div>
        )
      ) : null}

      {/* S2, S3, S4, S5, S6, S7 */}
      {step !== "list" ? (
        <>
          {step !== "success" ? (
            <div className="pay-ph">
              <button type="button" disabled={busy} onClick={handleBack} className="pay-back">
                <ChevronLeft className="pay-i" aria-hidden />
                {backLabelMap[step]}
              </button>
              {step !== "preview" && pageTitleMap[step] ? (
                <div className="pay-ph-grow">
                  <h1>{pageTitleMap[step]}</h1>
                </div>
              ) : null}
              {step === "preview" ? (
                <div role="group" aria-label="Cách xem" className="pay-seg ml-auto">
                  <button
                    type="button"
                    aria-pressed={previewViewMode === "screen"}
                    onClick={() => setPreviewViewMode("screen")}
                  >
                    Trên màn hình
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewViewMode === "print"}
                    onClick={() => setPreviewViewMode("print")}
                  >
                    Bản in 80mm
                  </button>
                </div>
              ) : null}
              {step !== "preview" && canCollect ? (
                <ol aria-label="Các bước thanh toán" className="pay-steps">
                  {STEPS_META.map((label, idx) => {
                    const n = idx + 1
                    const isDone = n < stepIdx
                    const isCur = n === stepIdx
                    return (
                      <li key={label} className={cn(isCur && "cur", isDone && "done")}>
                        <b>{n}</b>
                        {label}
                      </li>
                    )
                  })}
                </ol>
              ) : null}
            </div>
          ) : null}

          {visibleFeedback ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="pay-feedback"
              className={cn(
                "pay-fb",
                visibleFeedback.kind === "error"
                  ? "pay-fb-err"
                  : visibleFeedback.kind === "success"
                    ? "pay-fb-ok"
                    : "pay-fb-info",
                step === "success" && "pay-fb-narrow",
              )}
            >
              {visibleFeedback.kind === "error" ? (
                <AlertTriangle className="pay-i sm" aria-hidden />
              ) : visibleFeedback.kind === "success" ? (
                <Check className="pay-i sm" aria-hidden />
              ) : (
                <Info className="pay-i sm" aria-hidden />
              )}
              <span>{visibleFeedback.text}</span>
              <button
                type="button"
                aria-label="Đóng thông báo"
                data-testid="pay-feedback-dismiss"
                onClick={() => setFeedback(null)}
                className="pay-fb-x"
              >
                <X className="pay-i sm" aria-hidden />
              </button>
            </div>
          ) : null}

          {step === "detail" && prebillNotice && sessionBills?.status === "SERVING" ? (
            <div role="status" className="pay-bn pay-bn-warn mb-4">
              <Info className="pay-i" aria-hidden />
              <span>{prebillNotice}</span>
            </div>
          ) : null}

          {isWaiter && step !== "success" ? (
            <div role="note" className="pay-rb">
              <AlertTriangle className="pay-i" aria-hidden />
              <span className="pay-rb-t">
                <b>PHƯƠNG ÁN A · QUYỀN PHỤC VỤ</b>
                <span>
                  Phục vụ xem tạm tính và xuất hóa đơn. Thu ngân là người thu tiền.
                </span>
              </span>
            </div>
          ) : null}

          {step !== "success" &&
          (sessionBillsQuery.isPending || (step === "preview" && previewQuery.isPending)) ? (
            <div className="pay-split" aria-busy="true">
              <div className="pay-card">
                <div className="pay-sk-stack">
                  <div className="pay-sk" style={{ height: 28, width: "40%" }} />
                  <div className="pay-sk" style={{ height: 16, width: "60%" }} />
                  <div className="pay-sk" style={{ height: 56 }} />
                  <div className="pay-sk" style={{ height: 56 }} />
                  <div className="pay-sk" style={{ height: 96 }} />
                </div>
              </div>
              <div className="pay-card">
                <div className="pay-sk-stack">
                  <div className="pay-sk" style={{ height: 16, width: "35%" }} />
                  <div className="pay-sk" style={{ height: 48, width: "70%" }} />
                  <div className="pay-sk" style={{ height: 52 }} />
                  <div className="pay-sk" style={{ height: 60 }} />
                  <span className="pay-hint">
                    <span className="pay-spin" aria-hidden />
                    Đang tải dữ liệu bill… Nút thanh toán khóa tới khi tải xong.
                  </span>
                </div>
              </div>
            </div>
          ) : step !== "success" && sessionBillsQuery.isError ? (
            <div role="alert" className="pay-bn pay-bn-err">
              <span>
                <b>
                  {sessionBillsQuery.error instanceof ApiError
                    ? sessionBillsQuery.error.message
                    : "Không tải được dữ liệu bill."}
                </b>
                <span className="pay-bn-act">
                  <button type="button" onClick={() => void sessionBillsQuery.refetch()} className="pay-btn pay-btn-s">
                    Thử lại
                  </button>
                  <button type="button" onClick={() => navigate(homePath)} className="pay-btn pay-btn-s">
                    {backHomeLabel}
                  </button>
                </span>
              </span>
            </div>
          ) : step === "success" ? (
            receipt ? (
              <SuccessView
                receipt={receipt}
                sessionRemainingOpen={sessionRemainingOpen}
                onToList={() => navigate(homePath)}
                onBackToSession={() => goToStep(visitIdParam!, "detail")}
              />
            ) : (
              <div className="pay-card p-6 text-center">
                <p className="font-semibold">
                  {selectedBill && isBillPaid(selectedBill)
                    ? "Bill này đã được thanh toán."
                    : selectedBill?.status === "CLOSED_UNPAID"
                      ? "Phiên đã trả bàn nhưng chưa ghi nhận thu tiền."
                      : "Không có biên nhận trong phiên này."}
                </p>
                <button type="button" onClick={() => navigate(homePath)} className="pay-btn pay-btn-p mt-4">
                  {backHomeLabel}
                </button>
              </div>
            )
          ) : needsPrebillRedirect ? null : step === "preview" &&
            (previewKind === "invoice" ? selectedBill : previewBillModel) ? (
            <ProvisionalPreviewView
              bill={(previewKind === "invoice" ? selectedBill : previewBillModel)!}
              isProvisional={previewKind !== "invoice"}
              canCollect={canCollect}
              isWaiter={isWaiter}
              busy={busy}
              viewMode={previewViewMode}
              onChangeViewMode={setPreviewViewMode}
              onIssueInvoice={async () => {
                const issued = await handleIssueInvoice()
                if (issued) goToStep(issued.visitId, "detail", { billCode: issued.billCode })
              }}
              onCollect={() => void handleCollect()}
              onRequestPayment={() => void handleRequestPayment()}
              onSimulatedPrint={(n) => showFeedback("info", `Mô phỏng: chưa nối máy in thật. Ghi nhận lần in #${n}.`)}
            />
          ) : selectedBill ? (
            <div
              className={cn(
                "pay-split",
                step === "detail" && "detail",
                step !== "detail" && "pay-first",
                step !== "detail" && !billExpanded && "pay-collapsed",
              )}
            >
              <BillRoundsCard
                bill={selectedBill}
                collapsible={step !== "detail"}
                expanded={billExpanded}
                onToggleExpanded={() => setBillExpanded((v) => !v)}
              />

              {step === "detail" ? (
                <DetailActionPane
                  bill={selectedBill}
                  bills={sessionBills?.bills}
                  selectedBillCode={selectedBill.billCode}
                  onSelectBill={handleSelectBill}
                  unbilledLineCount={sessionBills?.unbilledLineCount}
                  cancelRequests={cancelRequestsQuery.data}
                  canCollect={canCollect}
                  isWaiter={isWaiter}
                  busy={busy}
                  onPreview={handlePreview}
                  onViewInvoice={
                    selectedBill.billCode
                      ? () =>
                          goToStep(selectedBill.visitId, "preview", {
                            billCode: selectedBill.billCode,
                            kind: "invoice",
                          })
                      : undefined
                  }
                  onIssueInvoice={() => void handleIssueInvoice()}
                  onCollect={() => void handleCollect()}
                  onRequestPayment={() => void handleRequestPayment()}
                  onRequestCancel={handleRequestCancel}
                />
              ) : step === "method" ? (
                <MethodActionPane
                  bill={selectedBill}
                  lastMethod={lastMethod}
                  isOffline={isOffline}
                  onSelectMethod={(m) => {
                    setLastMethod(m)
                    goToStep(selectedBill.visitId, m === "CASH" ? "cash" : "qr", { billCode: selectedBill.billCode })
                  }}
                  onToList={() => navigate(homePath)}
                />
              ) : step === "cash" ? (
                <CashActionPane
                  bill={selectedBill}
                  busy={busy}
                  error={payError}
                  onClearError={() => setPayError(null)}
                  onConfirm={(givenVnd) => void handleConfirm("CASH", givenVnd)}
                  onToList={() => navigate(homePath)}
                />
              ) : step === "qr" ? (
                <QrActionPane
                  bill={selectedBill}
                  busy={busy}
                  error={payError}
                  isOffline={isOffline}
                  onCheckTransfer={() => activeApi.checkTransfer(selectedBill.visitId)}
                  onConfirmManual={() => void handleConfirm("TRANSFER")}
                  onSwitchToCash={() =>
                    goToStep(selectedBill.visitId, "cash", { billCode: selectedBill.billCode })
                  }
                  onToList={() => navigate(homePath)}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )

  if (payShell) return workspaceBody

  return (
    <div ref={rootRef} className="pay-root h-full overflow-y-auto">
      <div className="pay-pg">{workspaceBody}</div>
    </div>
  )
}

export default function PaymentPage() {
  const { visitId, step } = useParams<{ visitId?: string; step?: string }>()
  return <PaymentFlowWorkspace visitIdParam={visitId} stepParam={step} homePath="/payment" backHomeLabel="Phiên đang mở" />
}
