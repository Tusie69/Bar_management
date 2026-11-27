import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Lock, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import type { RoleCode } from "@/domain/enums"
import { api, clock } from "@/services"
import {
  isPaymentAvailable,
  paymentApi,
  type PaymentApi,
} from "@/services/payment"
import { useCan, useSession } from "@/state/session"
import { AuditPanel } from "./audit-panel"
import {
  canAccessPaymentCancel,
  canApproveCancelRequests,
  canDirectCancelPaid,
  canReadPaymentAudit,
  collectAuditBillCodes,
  isVisitOpenAfterCancelCheck,
  type PaidBillCandidate,
} from "./cancel-model"
import { CancelQueuePanel } from "./cancel-queue-panel"
import { DirectCancelPanel } from "./direct-cancel-panel"
import { PaidBillsPanel } from "./paid-bills-panel"
import "./payment-cancel.css"

const REFRESH_INTERVAL_MS = 5_000

export function PaymentCancelWorkspace({
  payApi = paymentApi,
  initialBillCode = "",
  embedded = false,
  onBackToFloor,
  accessOverride,
}: {
  payApi?: PaymentApi
  initialBillCode?: string
  embedded?: boolean
  onBackToFloor?: () => void
  accessOverride?: {
    role: RoleCode
    canAuditRead?: boolean
    canCollect?: boolean
    isReadOnlyAdmin?: boolean
  }
}) {
  const queryClient = useQueryClient()
  const sessionUser = useSession((s) => s.user)
  const principal = useSession((s) => s.principal)
  const sessionCanAuditRead = useCan("audit.read")
  const sessionCanCollect = useCan("payment.collect")

  const role = accessOverride?.role ?? sessionUser.role
  const canAuditRead = accessOverride?.canAuditRead ?? sessionCanAuditRead
  const canCollect = accessOverride?.canCollect ?? sessionCanCollect

  const allowed = canAccessPaymentCancel(role, canAuditRead, canCollect)
  const showQueue = canApproveCancelRequests(role, canAuditRead)
  const showDirectCancel = canDirectCancelPaid(role)
  const showAudit = canReadPaymentAudit(role, canCollect)
  const isReadOnlyAdmin =
    accessOverride?.isReadOnlyAdmin ??
    (role === "ADMIN" &&
      (principal as { accessLevel?: string } | null)?.accessLevel === "READ_ONLY")

  const [selectedBillCode, setSelectedBillCode] = useState(initialBillCode)
  const [auditBillFilter, setAuditBillFilter] = useState(initialBillCode)
  const [cancelledBillCode, setCancelledBillCode] = useState("")

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment-cancel-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-cancel-paid-bills"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-audit"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-open"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-session-bills"] }),
      queryClient.invalidateQueries({ queryKey: ["floor"] }),
      queryClient.invalidateQueries({ queryKey: ["visits"] }),
      queryClient.invalidateQueries({ queryKey: ["table-turns"] }),
    ])
  }, [queryClient])

  // Real-time refresh in place: subscribe read-only to existing mock/realtime stream + clock ticks.
  useEffect(() => {
    if (!allowed || !isPaymentAvailable) return
    const offApi = api.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ["payment-cancel-requests"] })
      void queryClient.invalidateQueries({ queryKey: ["payment-cancel-paid-bills"] })
      void queryClient.invalidateQueries({ queryKey: ["payment-audit"] })
    })
    const offClock = clock.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ["payment-cancel-requests"] })
      void queryClient.invalidateQueries({ queryKey: ["payment-cancel-paid-bills"] })
      void queryClient.invalidateQueries({ queryKey: ["payment-audit"] })
    })
    return () => {
      offApi()
      offClock()
    }
  }, [allowed, queryClient])

  const requestsQuery = useQuery({
    queryKey: ["payment-cancel-requests", role],
    queryFn: () => payApi.listCancelRequests(),
    enabled: isPaymentAvailable && allowed && showQueue,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const paidBillsQuery = useQuery({
    queryKey: ["payment-cancel-paid-bills", role],
    queryFn: async (): Promise<PaidBillCandidate[]> => {
      if (!payApi.listPaidBills) return []
      return payApi.listPaidBills()
    },
    enabled: isPaymentAvailable && allowed && showDirectCancel,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const paidBills = useMemo(() => paidBillsQuery.data ?? [], [paidBillsQuery.data])
  const selectedPaidBill = useMemo(
    () => paidBills.find((b) => b.billCode === selectedBillCode) ?? null,
    [paidBills, selectedBillCode],
  )

  const hasSelectionOrOutcome = Boolean(selectedBillCode || selectedPaidBill || cancelledBillCode)
  const shouldShowDirectPanel = showDirectCancel && hasSelectionOrOutcome
  const shouldShowAuditPanel = showAudit && (showQueue || hasSelectionOrOutcome || Boolean(auditBillFilter))

  const auditQuery = useQuery({
    queryKey: ["payment-audit", role, auditBillFilter.trim() || "ALL"],
    queryFn: () => payApi.listAudit(auditBillFilter.trim() || undefined),
    enabled: isPaymentAvailable && allowed && shouldShowAuditPanel,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const allAuditQuery = useQuery({
    queryKey: ["payment-audit", role, "ALL"],
    queryFn: () => payApi.listAudit(),
    enabled: isPaymentAvailable && allowed && showAudit && showQueue,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const knownBillCodes = useMemo(
    () =>
      collectAuditBillCodes(
        requestsQuery.data ?? [],
        paidBills,
        allAuditQuery.data ?? auditQuery.data ?? [],
      ),
    [allAuditQuery.data, auditQuery.data, paidBills, requestsQuery.data],
  )

  const checkVisitOpen = useCallback(
    (visitId: string) => isVisitOpenAfterCancelCheck(visitId, payApi, canCollect),
    [canCollect, payApi],
  )

  if (!isPaymentAvailable) {
    return (
      <div className="pc-root p-6">
        <div className="pc-card mx-auto max-w-md p-6 text-center">
          <h1 className="text-lg font-bold">Chức năng huỷ thanh toán chưa kết nối máy chủ</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            API thanh toán chưa sẵn sàng ở chế độ hiện tại.
          </p>
        </div>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="pc-root p-6">
        <div role="alert" className="pc-card mx-auto max-w-md p-6 text-center">
          <Lock className="mx-auto mb-3 size-8 text-[var(--text-muted)]" aria-hidden />
          <h1 className="text-lg font-bold">Không có quyền truy cập</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {role === "CASHIER"
              ? "Thu ngân chỉ được gửi yêu cầu huỷ từ chi tiết bill trên màn Thu tiền, không xem hoặc duyệt ở màn này."
              : "Chỉ Chủ sở hữu, Quản trị viên và Lễ tân mới sử dụng được chức năng huỷ thanh toán."}
          </p>
        </div>
      </div>
    )
  }

  const refreshAll = () => {
    void invalidateAll()
  }

  const handleSelectPaidBill = (billCode: string) => {
    setSelectedBillCode(billCode)
    setAuditBillFilter(billCode)
    setCancelledBillCode("")
  }

  const handleCloseDirect = () => {
    setSelectedBillCode("")
    setCancelledBillCode("")
    if (!showQueue) setAuditBillFilter("")
  }

  return (
    <div className={embedded ? "pc-root" : "pc-root h-full overflow-y-auto"}>
      <div className="pc-pg">
        {!embedded ? (
          <header className="pc-ph">
            <div className="pc-ph-grow">
              <h1>{showQueue ? "Duyệt huỷ thanh toán" : "Huỷ thanh toán đã thu"}</h1>
              <p className="pc-ph-sub">
                {showQueue
                  ? "Duyệt yêu cầu huỷ từ Thu ngân theo thời gian thực, huỷ trực tiếp bill đã thu và tra cứu nhật ký theo bill."
                  : "Chọn bill đã thu trong ca để huỷ thanh toán trực tiếp (bắt buộc nhập lý do) và xem nhật ký bill."}
              </p>
            </div>
            <div className="pc-ph-actions">
              {role === "RECEPTIONIST" && onBackToFloor ? (
                <button type="button" onClick={onBackToFloor} className="pc-btn pc-btn-s pc-btn-sm">
                  <ArrowLeft className="size-4" aria-hidden />
                  Về sơ đồ
                </button>
              ) : null}
              <span className="pc-live-tag" aria-live="polite">
                <span className="pc-live-dot" aria-hidden />
                Tự làm mới 5s
              </span>
              <button type="button" onClick={refreshAll} className="pc-btn pc-btn-s pc-btn-sm">
                <RefreshCw className="size-4" aria-hidden />
                Làm mới tất cả
              </button>
            </div>
          </header>
        ) : null}

        <div className={shouldShowAuditPanel ? "pc-grid pc-grid-2" : "pc-grid"}>
          <div className="pc-col">
            {showQueue ? (
              <CancelQueuePanel
                requests={requestsQuery.data ?? []}
                loading={requestsQuery.isPending}
                error={requestsQuery.error}
                readOnly={isReadOnlyAdmin}
                api={payApi}
                checkVisitOpen={checkVisitOpen}
                onRefresh={() => void requestsQuery.refetch()}
                onDecided={async (updated) => {
                  setAuditBillFilter(updated.billCode)
                  await invalidateAll()
                }}
                onInspectAudit={(billCode) => setAuditBillFilter(billCode)}
              />
            ) : null}

            {showDirectCancel ? (
              <PaidBillsPanel
                paidBills={paidBills}
                selectedBillCode={selectedBillCode}
                loading={paidBillsQuery.isPending}
                error={paidBillsQuery.error}
                onSelect={handleSelectPaidBill}
                onRefresh={() => void paidBillsQuery.refetch()}
              />
            ) : null}

            {shouldShowDirectPanel ? (
              <DirectCancelPanel
                selectedBill={selectedPaidBill}
                paidBills={paidBills}
                initialBillCode={selectedBillCode}
                api={payApi}
                canViewAudit={showAudit}
                checkVisitOpen={checkVisitOpen}
                onCancelled={async (billCode) => {
                  setSelectedBillCode("")
                  setCancelledBillCode(billCode)
                  if (showAudit) setAuditBillFilter(billCode)
                  await invalidateAll()
                }}
                onInspectAudit={showAudit ? (billCode) => setAuditBillFilter(billCode) : undefined}
                onClose={handleCloseDirect}
              />
            ) : null}
          </div>

          {shouldShowAuditPanel ? (
            <div className="pc-col pc-sticky-side">
              <AuditPanel
                entries={auditQuery.data ?? []}
                selectedBillCode={auditBillFilter}
                knownBillCodes={knownBillCodes}
                loading={auditQuery.isPending}
                error={auditQuery.error}
                onSelectBillCode={setAuditBillFilter}
                onRefresh={() => void auditQuery.refetch()}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function PaymentCancelPage() {
  const navigate = useNavigate()
  return <PaymentCancelWorkspace onBackToFloor={() => navigate("/floor")} />
}
