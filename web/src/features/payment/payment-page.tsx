import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronLeft, Clock, Info, Link2, Lock, Send } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Navigate, useLocation, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ApiError } from "@/services"
import {
  formatVnd,
  isPaymentAvailable,
  paymentApi,
  type PayBillSummary,
  type PaymentMethod,
  type Receipt,
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

export function PaymentFlowWorkspace({
  visitIdParam,
  stepParam,
  homePath = "/payment",
  backHomeLabel = "Phiên đang mở",
}: {
  visitIdParam?: string
  stepParam?: string
  homePath?: string
  backHomeLabel?: string
}) {
  const navigate = useNavigate()
  const location = useLocation()
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
  const prebillNotice =
    (location.state as { prebillNotice?: string } | null)?.prebillNotice ?? null

  // Synchronous in-flight guard: React state updates on next render, so double-clicks
  // or fast taps within the same frame must be blocked synchronously here.
  const inFlightRef = useRef(false)
  const idempotencyKeyRef = useRef<IdempotencySlot | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const openQuery = useQuery({
    queryKey: ["payment-open"],
    queryFn: () => paymentApi.listOpen(),
    enabled: isPaymentAvailable && canViewAny && step === "list",
  })

  const billQuery = useQuery({
    queryKey: ["payment-bill", visitIdParam],
    queryFn: () => paymentApi.getBill(visitIdParam!),
    enabled: isPaymentAvailable && canViewAny && Boolean(visitIdParam) && step !== "list",
  })

  const navKey = `${visitIdParam ?? ""}:${step}`
  const [prevNavKey, setPrevNavKey] = useState(navKey)
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey)
    setPayError(null)
    setBillExpanded(false)
    if (step === "preview") setPreviewViewMode("screen")
  }

  useLayoutEffect(() => {
    if (payShell) {
      payShell.scrollToTop()
      return
    }
    const el = rootRef.current
    if (!el) return
    el.scrollTop = 0
    if (el.parentElement && el.parentElement.scrollTop > 0) {
      el.parentElement.scrollTop = 0
    }
  }, [payShell, visitIdParam, step])

  const openList = openQuery.data ?? []

  const invalidatePaymentQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment-open"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-notifications"] }),
      ...(visitIdParam ? [queryClient.invalidateQueries({ queryKey: ["payment-bill", visitIdParam] })] : []),
      queryClient.invalidateQueries({ queryKey: ["floor"] }),
    ])
  }, [queryClient, visitIdParam])

  const goToStep = useCallback(
    (nextVisitId: string, nextStep: PaymentStep, options?: { prebillNotice?: string; replace?: boolean }) => {
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
      if (homePath === "/phucvu") {
        navigate(`/phucvu/phien/${nextVisitId}/thanh-toan${nextStep === "preview" ? "?view=preview" : ""}`, navOpts)
        return
      }
      if (nextStep === "detail") navigate(`${homePath}/${nextVisitId}`, navOpts)
      else navigate(`${homePath}/${nextVisitId}/${nextStep}`, navOpts)
    },
    [homePath, navigate],
  )

  const handleSessionPick = (session: PayBillSummary | string) => {
    const id = typeof session === "string" ? session : session.visitId
    if (selectedId === id) {
      goToStep(id, "detail")
      return
    }
    setSelectedId(id)
    try {
      const mapEl = document.getElementById("floor-map")
      if (mapEl) {
        const r = mapEl.getBoundingClientRect()
        const scrollParent = mapEl.closest(".pay-root")
        const viewRect = scrollParent ? scrollParent.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
        const headerH = scrollParent?.querySelector(".pay-hdr")?.getBoundingClientRect().height ?? 0
        const visibleTop = Math.max(0, viewRect.top + headerH)
        const visibleBottom = Math.min(window.innerHeight, viewRect.bottom)
        if (r.top >= visibleBottom - 24 || r.bottom <= visibleTop + 24) {
          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          mapEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
        }
      }
    } catch {
      /* scrollIntoView optional in non-DOM envs */
    }
  }

  const ensurePrebillIfNeeded = async () => {
    const bill = billQuery.data
    if (!bill || bill.status !== "SERVING") return false
    await paymentApi.createPrebill(bill.visitId, bill.version)
    await invalidatePaymentQueries()
    return true
  }

  const handlePreview = async () => {
    const bill = billQuery.data
    if (!bill || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    try {
      const moved = await ensurePrebillIfNeeded()
      if (moved) {
        toast.success("Đã tạo tạm tính. Phiên chuyển sang Chờ thanh toán, chưa nhận tiền.")
      }
      goToStep(bill.visitId, "preview")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không tạo được tạm tính.")
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const handleCloseToMethod = async () => {
    const bill = billQuery.data
    if (!bill || bill.status === "PAID" || bill.status === "CLOSED_UNPAID" || !canCollect || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    try {
      await ensurePrebillIfNeeded()
      goToStep(bill.visitId, "method")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể chuyển sang thu tiền.")
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const handleRequestPayment = async () => {
    const bill = billQuery.data
    if (!bill || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    try {
      await paymentApi.requestPayment(bill.visitId)
      await invalidatePaymentQueries()
      toast.success(`Đã gửi yêu cầu thanh toán ${bill.code} cho Thu ngân.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không gửi được yêu cầu thanh toán.")
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const handleConfirm = async (method: PaymentMethod, givenVnd = 0) => {
    await submitPaymentConfirm({
      api: paymentApi,
      bill: billQuery.data,
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
        toast.success(`Đã ghi nhận thanh toán. ${rc.tables.join(", ")} về Trống.`)
        goToStep(rc.visitId, "success")
      },
    })
  }

  const handleBack = () => {
    if (busy || !visitIdParam) return
    if (step === "detail" || step === "success") {
      navigate(homePath)
    } else if (step === "preview" || step === "method") {
      goToStep(visitIdParam, "detail")
    } else if (step === "cash" || step === "qr") {
      goToStep(visitIdParam, "method")
    }
  }

  const bill = billQuery.data
  const requiresPrebillStep = step === "preview" || step === "method" || step === "cash" || step === "qr"
  const needsPrebillRedirect = Boolean(bill && bill.status === "SERVING" && requiresPrebillStep)

  useEffect(() => {
    if (!needsPrebillRedirect || !bill) return
    goToStep(bill.visitId, "detail", {
      prebillNotice: "Phiên đang phục vụ, chưa tạo tạm tính. Hãy bấm Xem tạm tính hoặc Chốt bill & thu tiền trước.",
      replace: true,
    })
  }, [bill, goToStep, needsPrebillRedirect])

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

  const workspaceBody = (
    <>
      {/* S1: Home (session list + floor map) */}
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
            <section aria-label="Danh sách phiên" className="pay-sess-list">
              {openList.length === 0 ? (
                <div className="pay-empty">
                  <b>Không còn phiên nào đang mở</b>
                  Bàn đã thanh toán tự về Trống trên sơ đồ.
                </div>
              ) : (
                openList.map((s) => {
                  const isSel = selectedId === s.visitId
                  const isPend = s.status === "AWAITING_PAYMENT"
                  const isCluster = Boolean(s.clusterCode && s.tables.length > 1)
                  const hasLines = s.hasOrderLines !== false
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
                          {s.requestedAt ? (
                            <span className="pay-pill pay-p-req">
                              <Send className="pay-i sm" aria-hidden />
                              {`Gọi thanh toán · ${s.requestedAt}`}
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
                })
              )}
            </section>

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

          {step === "detail" && prebillNotice && bill?.status === "SERVING" ? (
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
                  Phục vụ xem tạm tính (kèm mã QR để đưa khách xem) và gửi yêu cầu thanh toán. Thu ngân là người chốt bill và nhận tiền.
                </span>
              </span>
            </div>
          ) : null}

          {step !== "success" && billQuery.isPending ? (
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
          ) : step !== "success" && billQuery.isError ? (
            <div role="alert" className="pay-bn pay-bn-err">
              <span>
                <b>
                  {billQuery.error instanceof ApiError
                    ? billQuery.error.message
                    : "Không tải được dữ liệu bill."}
                </b>
                <span className="pay-bn-act">
                  <button type="button" onClick={() => void billQuery.refetch()} className="pay-btn pay-btn-s">
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
                onToList={() => navigate(homePath)}
                onPrintReceipt={() => toast.info("Mô phỏng: chưa nối máy in thật.")}
              />
            ) : (
              <div className="pay-card p-6 text-center">
                <p className="font-semibold">
                  {bill?.status === "PAID"
                    ? "Bill này đã được thanh toán."
                    : bill?.status === "CLOSED_UNPAID"
                      ? "Phiên đã trả bàn nhưng chưa ghi nhận thu tiền."
                      : "Không có biên nhận trong phiên này."}
                </p>
                <button type="button" onClick={() => navigate(homePath)} className="pay-btn pay-btn-p mt-4">
                  {backHomeLabel}
                </button>
              </div>
            )
          ) : needsPrebillRedirect ? null : step === "preview" && bill ? (
            <ProvisionalPreviewView
              bill={bill}
              canCollect={canCollect}
              isWaiter={isWaiter}
              busy={busy}
              viewMode={previewViewMode}
              onChangeViewMode={setPreviewViewMode}
              onCollect={() => void handleCloseToMethod()}
              onRequestPayment={() => void handleRequestPayment()}
              onSimulatedPrint={(n) => toast.info(`Mô phỏng: chưa nối máy in thật. Ghi nhận lần in #${n}.`)}
            />
          ) : bill ? (
            <div
              className={cn(
                "pay-split",
                step === "detail" && "detail",
                step !== "detail" && "pay-first",
                step !== "detail" && !billExpanded && "pay-collapsed",
              )}
            >
              <BillRoundsCard
                bill={bill}
                collapsible={step !== "detail"}
                expanded={billExpanded}
                onToggleExpanded={() => setBillExpanded((v) => !v)}
              />

              {step === "detail" ? (
                <DetailActionPane
                  bill={bill}
                  canCollect={canCollect}
                  isWaiter={isWaiter}
                  busy={busy}
                  onPreview={() => void handlePreview()}
                  onCollect={() => void handleCloseToMethod()}
                  onRequestPayment={() => void handleRequestPayment()}
                />
              ) : step === "method" ? (
                <MethodActionPane
                  bill={bill}
                  lastMethod={lastMethod}
                  onSelectMethod={(m) => {
                    setLastMethod(m)
                    goToStep(bill.visitId, m === "CASH" ? "cash" : "qr")
                  }}
                  onToList={() => navigate(homePath)}
                />
              ) : step === "cash" ? (
                <CashActionPane
                  bill={bill}
                  busy={busy}
                  error={payError}
                  onClearError={() => setPayError(null)}
                  onConfirm={(givenVnd) => void handleConfirm("CASH", givenVnd)}
                  onToList={() => navigate(homePath)}
                />
              ) : step === "qr" ? (
                <QrActionPane
                  bill={bill}
                  busy={busy}
                  error={payError}
                  onCheckTransfer={() => paymentApi.checkTransfer(bill.visitId)}
                  onConfirmManual={() => void handleConfirm("TRANSFER")}
                  onToList={() => navigate(homePath)}
                  onCopied={(refText) => toast.success(`Đã chép nội dung: ${refText}`)}
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
