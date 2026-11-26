import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronLeft, Clock, Link2, Lock, Send } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { ROLE_LABEL } from "@/domain/enums"
import { useBusinessShift, useNow } from "@/hooks/use-data"
import { initials } from "@/lib/text"
import { fmtBusinessDate, fmtBusinessShift, fmtTime, businessDateOf, shiftHour } from "@/lib/time"
import { cn } from "@/lib/utils"
import { ApiError, api, isApiError, newIdempotencyKey } from "@/services"
import {
  formatVnd,
  paymentApi,
  type PayBillSummary,
  type PaymentMethod,
  type Receipt,
} from "@/services/payment"
import { useCan, useSession } from "@/state/session"
import { BillRoundsCard, DetailActionPane, ProvisionalPreviewView } from "./bill-pane"
import { CashActionPane, MethodActionPane, QrActionPane, SuccessView, type PaymentErrorState } from "./pay-actions"
import { PaymentFloorMap } from "./payment-floor-map"
import { PaymentNotificationBell } from "./payment-notifications"

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

function toPaymentError(err: unknown): PaymentErrorState {
  if (isApiError(err)) {
    if (err.code === "NETWORK_ERROR" || err.status === 0) {
      return { kind: "net", message: err.message }
    }
    if (err.code === "DUPLICATE_PAYMENT" || err.status === 409) {
      return {
        kind: "dup",
        message: err.message,
        confirmedBy: typeof err.details.confirmedBy === "string" ? err.details.confirmedBy : undefined,
        confirmedAt: typeof err.details.confirmedAt === "string" ? err.details.confirmedAt : undefined,
      }
    }
    return { kind: "other", message: err.message }
  }
  return { kind: "other", message: err instanceof Error ? err.message : "Đã có lỗi xảy ra." }
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
  const queryClient = useQueryClient()
  const user = useSession((s) => s.user)
  const principal = useSession((s) => s.principal)
  const canCollect = useCan("payment.collect")
  const canReadOrders = useCan("order.read")
  const isWaiter = user.role === "WAITER" && canReadOrders
  const canViewAny = canCollect || isWaiter
  const moneyStepRequested =
    stepParam === "method" || stepParam === "cash" || stepParam === "qr" || stepParam === "success"

  const displayName = api.mode === "http" ? (principal?.displayName ?? user.displayName) : user.displayName
  const roleLabel = ROLE_LABEL[user.role]
  const now = useNow(30_000)
  const shift = useBusinessShift()
  const bd = businessDateOf(now, shiftHour(shift.cutoffLocal))

  const step = parseStep(stepParam, Boolean(visitIdParam), canCollect)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ntfSeenCount, setNtfSeenCount] = useState<number>(0)
  const [billExpanded, setBillExpanded] = useState(false)
  const [lastMethod, setLastMethod] = useState<PaymentMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [payError, setPayError] = useState<PaymentErrorState | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  // Synchronous in-flight guard: React state updates on next render, so double-clicks
  // or fast taps within the same frame must be blocked synchronously here.
  const inFlightRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)

  const openQuery = useQuery({
    queryKey: ["payment-open"],
    queryFn: () => paymentApi.listOpen(),
    enabled: canViewAny && step === "list",
  })

  const ntfQuery = useQuery({
    queryKey: ["payment-notifications"],
    queryFn: () => paymentApi.listNotifications(),
    enabled: canViewAny && step === "list",
  })

  const billQuery = useQuery({
    queryKey: ["payment-bill", visitIdParam],
    queryFn: () => paymentApi.getBill(visitIdParam!),
    enabled: canViewAny && Boolean(visitIdParam) && step !== "list",
  })

  const navKey = `${visitIdParam ?? ""}:${step}`
  const [prevNavKey, setPrevNavKey] = useState(navKey)
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey)
    setPayError(null)
    setBillExpanded(false)
  }

  const openList = openQuery.data ?? []
  const notifications = ntfQuery.data ?? []
  const hasUnreadNtf = notifications.length > ntfSeenCount

  const invalidatePaymentQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment-open"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-notifications"] }),
      ...(visitIdParam ? [queryClient.invalidateQueries({ queryKey: ["payment-bill", visitIdParam] })] : []),
      queryClient.invalidateQueries({ queryKey: ["floor"] }),
    ])
  }, [queryClient, visitIdParam])

  const goToStep = (nextVisitId: string, nextStep: PaymentStep) => {
    idempotencyKeyRef.current = null
    if (nextStep === "list") {
      navigate(homePath)
      return
    }
    if (homePath === "/phucvu") {
      navigate(`/phucvu/phien/${nextVisitId}/thanh-toan${nextStep === "preview" ? "?view=preview" : ""}`)
      return
    }
    if (nextStep === "detail") navigate(`${homePath}/${nextVisitId}`)
    else navigate(`${homePath}/${nextVisitId}/${nextStep}`)
  }

  const handleSessionPick = (session: PayBillSummary | string) => {
    const id = typeof session === "string" ? session : session.visitId
    if (selectedId === id) {
      goToStep(id, "detail")
      return
    }
    setSelectedId(id)
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
    if (!bill || bill.status === "PAID" || !canCollect || inFlightRef.current) return
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
    // Synchronous in-flight guard prevents duplicate submissions on fast double clicks.
    if (inFlightRef.current || busy) return
    const bill = billQuery.data
    if (!bill || bill.status === "PAID" || !canCollect) return

    inFlightRef.current = true
    setBusy(true)
    setPayError(null)
    const key = idempotencyKeyRef.current ?? newIdempotencyKey()
    idempotencyKeyRef.current = key

    try {
      const rc =
        method === "CASH"
          ? await paymentApi.confirmCash(bill.visitId, givenVnd, bill.version, key)
          : await paymentApi.confirmTransfer(bill.visitId, true, bill.version, key)
      idempotencyKeyRef.current = null
      setReceipt(rc)
      await invalidatePaymentQueries()
      toast.success(`Đã ghi nhận thanh toán. ${rc.tables.join(", ")} về Trống.`)
      goToStep(bill.visitId, "success")
    } catch (err) {
      const parsed = toPaymentError(err)
      setPayError(parsed)
      if (parsed.kind === "dup") {
        idempotencyKeyRef.current = null
        await invalidatePaymentQueries()
      }
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
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

  if (!canViewAny || (moneyStepRequested && !canCollect)) {
    return (
      <div className="pay-root p-6">
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
      </div>
    )
  }

  const bill = billQuery.data
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

  return (
    <div className="pay-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1360px] px-3 pt-3 pb-8 md:px-6 md:pt-5 lg:px-8">
        {/* S1: Home (session list + floor map) */}
        {step === "list" ? (
          <div className="grid gap-4">
            {/* Mobile greeting header + payment notifications bell on all widths */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-1 px-4 py-2.5 shadow-xs">
              <div className="flex items-center gap-2.5 md:hidden">
                <span
                  aria-hidden
                  className="grid size-10 place-items-center rounded-full bg-primary-tint font-bold text-primary-ink"
                >
                  {initials(displayName)}
                </span>
                <span className="grid leading-tight">
                  <small className="text-xs text-[var(--text-muted)]">Xin chào,</small>
                  <b className="text-[15px] font-bold text-[var(--ink-strong)]">{`${displayName} · ${roleLabel}`}</b>
                </span>
              </div>

              <div className="hidden items-center gap-2.5 md:flex">
                <h1 className="text-base font-bold tracking-[-0.015em] text-[var(--ink-strong)]">
                  Thu tiền · Phiên đang mở
                </h1>
                <span className="inline-flex h-7 items-center rounded-full bg-surface-2 px-3 text-xs font-medium text-[var(--text-muted)]">
                  {`${fmtBusinessDate(bd, "short")} · ${fmtBusinessShift(shift)}`}
                </span>
                <span className="tnum inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                  <Clock className="size-3.5 text-[var(--text-muted)]" aria-hidden />
                  {fmtTime(now)}
                </span>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <PaymentNotificationBell
                  notifications={notifications}
                  unread={hasUnreadNtf}
                  onOpen={() => setNtfSeenCount(notifications.length)}
                  onSelectVisit={(id) => {
                    setSelectedId(id)
                  }}
                />
              </div>
            </div>

            {openQuery.isPending ? (
              <div className="pay-lg" aria-busy="true">
                <div className="grid gap-3 rounded-2xl border border-border bg-surface-1 p-4">
                  <div className="gam-skeleton h-16 rounded-xl bg-surface-3" />
                  <div className="gam-skeleton h-16 rounded-xl bg-surface-3" />
                  <div className="gam-skeleton h-16 rounded-xl bg-surface-3" />
                </div>
                <div className="gam-skeleton h-[420px] rounded-2xl bg-surface-3" />
              </div>
            ) : openQuery.isError ? (
              <div role="alert" className="rounded-2xl border border-destructive/45 bg-[var(--destructive-tint)] p-5">
                <p className="font-semibold text-[var(--destructive-ink)]">Không tải được danh sách phiên đang mở</p>
                <button
                  type="button"
                  onClick={() => void openQuery.refetch()}
                  className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-surface-1 px-4 text-sm font-medium cursor-pointer"
                >
                  Thử lại
                </button>
              </div>
            ) : (
              <div className="pay-lg pay-lg-m">
                <section aria-label="Danh sách phiên" className="pay-sess-list">
                  {openList.length === 0 ? (
                    <div className="m-3 rounded-[14px] border border-dashed border-border-strong px-4 py-8 text-center text-[var(--text-muted)]">
                      <b className="mb-1 block text-foreground">Không còn phiên nào đang mở</b>
                      Bàn đã thanh toán tự về Trống trên sơ đồ.
                    </div>
                  ) : (
                    openList.map((s) => {
                      const isSel = selectedId === s.visitId
                      const isPend = s.status === "AWAITING_PAYMENT"
                      const isCluster = Boolean(s.clusterCode && s.tables.length > 1)
                      return (
                        <button
                          key={s.visitId}
                          type="button"
                          onClick={() => handleSessionPick(s)}
                          className={cn("pay-sess", isSel && "sel")}
                        >
                          <span className="grid min-w-0 gap-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <b className="text-xl font-extrabold tracking-[-0.03em] text-[var(--ink-strong)]">
                                {s.code}
                              </b>
                              {isCluster ? (
                                <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-[var(--cluster)] px-2 text-[11px] font-bold text-white dark:text-[oklch(0.2_0.02_245)]">
                                  <Link2 className="size-3.5" aria-hidden />
                                  {`Cụm ${s.tables.length} bàn · 1 phiên`}
                                </span>
                              ) : null}
                              {isPend ? (
                                <span className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-[var(--st-pending-tint)] px-2 text-xs font-semibold text-[var(--st-pending-ink)]">
                                  <Clock className="size-3.5" aria-hidden />
                                  Chờ thanh toán
                                </span>
                              ) : null}
                              {s.requestedAt ? (
                                <span className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-primary-tint px-2 text-xs font-semibold text-primary-ink">
                                  <Send className="size-3.5" aria-hidden />
                                  {`Gọi thanh toán · ${s.requestedAt}`}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[13px] text-[var(--text-muted)]">
                              {`mở ${s.openedAt} · PV ${s.waiterName}`}
                            </span>
                            {isSel ? (
                              <span className="text-xs font-semibold text-primary-ink">
                                Chạm lần nữa để mở chi tiết
                              </span>
                            ) : null}
                          </span>
                          <span className="grid justify-items-end">
                            <small className="text-xs text-[var(--text-muted)]">
                              {isPend ? "Phải trả" : "Tạm tính"}
                            </small>
                            <b className="tnum text-lg font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
                              {formatVnd(s.dueVnd)}
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
            )}
          </div>
        ) : null}

        {/* S2, S3, S4, S5, S6, S7 */}
        {step !== "list" ? (
          <div className="grid gap-4">
            {/* Top bar for flow screens: S3 preview intentionally has no page title or subtitle */}
            {step !== "success" ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBack}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-1 pr-3.5 pl-2 font-medium cursor-pointer hover:border-border-strong active:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                  {backLabelMap[step]}
                </button>
                <div className="min-w-0 flex-1">
                  {step !== "preview" && pageTitleMap[step] ? (
                    <h1 className="text-[19px] leading-[1.2] font-extrabold tracking-[-0.03em] whitespace-nowrap text-[var(--ink-strong)] sm:text-2xl">
                      {pageTitleMap[step]}
                    </h1>
                  ) : null}
                </div>
                {step !== "preview" && canCollect ? (
                  <ol aria-label="Các bước thanh toán" className="hidden items-center text-xs text-[var(--text-subtle)] lg:flex">
                    {STEPS_META.map((label, idx) => {
                      const n = idx + 1
                      const isDone = n < stepIdx
                      const isCur = n === stepIdx
                      return (
                        <li
                          key={label}
                          className={cn(
                            "inline-flex h-7 items-center gap-1.5 px-2",
                            idx > 0 && "before:mr-2 before:h-px before:w-3 before:bg-border-strong before:content-['']",
                            isCur && "font-bold text-[var(--ink-strong)]",
                            isDone && "text-[var(--st-seated-ink)]",
                          )}
                        >
                          <b
                            className={cn(
                              "grid size-[18px] place-items-center rounded-[5px] border text-[11px] font-semibold",
                              isCur
                                ? "border-[var(--ink-strong)] bg-[var(--ink-strong)] text-background"
                                : isDone
                                  ? "border-[var(--st-seated)]"
                                  : "border-border-strong",
                            )}
                          >
                            {n}
                          </b>
                          {label}
                        </li>
                      )
                    })}
                  </ol>
                ) : null}
              </div>
            ) : null}

            {/* Role banner for Waiter PA-A or Bartender */}
            {isWaiter && step !== "success" ? (
              <div
                role="note"
                className="flex items-start gap-3 rounded-xl border border-dashed border-[var(--st-pending)] bg-[var(--st-pending-tint)] px-3.5 py-3 text-foreground"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--st-pending-ink)]" aria-hidden />
                <span className="grid gap-0.5 text-sm">
                  <b className="text-[var(--st-pending-ink)]">PHƯƠNG ÁN A · QUYỀN PHỤC VỤ</b>
                  <span>
                    Phục vụ xem tạm tính (kèm mã QR để đưa khách xem) và gửi yêu cầu thanh toán. Thu ngân là người chốt bill và nhận tiền.
                  </span>
                </span>
              </div>
            ) : null}

            {/* Loading skeleton while bill fetches */}
            {step !== "success" && billQuery.isPending ? (
              <div className="pay-split" aria-busy="true">
                <div className="grid gap-3 rounded-2xl border border-border bg-surface-1 p-4">
                  <div className="gam-skeleton h-7 w-2/5 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-4 w-3/5 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-14 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-14 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-24 rounded-[10px] bg-surface-3" />
                </div>
                <div className="grid gap-3 rounded-2xl border border-border bg-surface-1 p-4">
                  <div className="gam-skeleton h-4 w-1/3 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-12 w-2/3 rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-[52px] rounded-[10px] bg-surface-3" />
                  <div className="gam-skeleton h-[60px] rounded-[10px] bg-surface-3" />
                  <span className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
                    <span className="pay-spin" aria-hidden />
                    Đang tải dữ liệu bill… Nút thanh toán khóa tới khi tải xong.
                  </span>
                </div>
              </div>
            ) : step !== "success" && billQuery.isError ? (
              <div role="alert" className="rounded-2xl border border-destructive/45 bg-[var(--destructive-tint)] p-5">
                <p className="font-semibold text-[var(--destructive-ink)]">
                  {billQuery.error instanceof ApiError
                    ? billQuery.error.message
                    : "Không tải được dữ liệu bill."}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void billQuery.refetch()}
                    className="inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-surface-1 px-4 text-sm font-medium cursor-pointer"
                  >
                    Thử lại
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(homePath)}
                    className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium cursor-pointer"
                  >
                    {backHomeLabel}
                  </button>
                </div>
              </div>
            ) : step === "success" ? (
              receipt ? (
                <SuccessView
                  receipt={receipt}
                  onToList={() => navigate(homePath)}
                  onPrintReceipt={() => toast.info("Mô phỏng: chưa nối máy in thật.")}
                />
              ) : (
                <div className="rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-xs">
                  <p className="font-semibold">
                    {bill?.status === "PAID" ? "Bill này đã được thanh toán." : "Không có biên nhận trong phiên này."}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(homePath)}
                    className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground cursor-pointer"
                  >
                    {backHomeLabel}
                  </button>
                </div>
              )
            ) : step === "preview" && bill ? (
              <ProvisionalPreviewView
                bill={bill}
                canCollect={canCollect}
                isWaiter={isWaiter}
                busy={busy}
                onCollect={() => void handleCloseToMethod()}
                onRequestPayment={() => void handleRequestPayment()}
                onSimulatedPrint={(n) => toast.info(`Mô phỏng: chưa nối máy in thật. Ghi nhận lần in #${n}.`)}
              />
            ) : bill ? (
              <div
                className={cn(
                  "pay-split",
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
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function PaymentPage() {
  const { visitId, step } = useParams<{ visitId?: string; step?: string }>()
  return <PaymentFlowWorkspace visitIdParam={visitId} stepParam={step} homePath="/payment" backHomeLabel="Phiên đang mở" />
}
