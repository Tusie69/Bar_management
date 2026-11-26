import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { RoleCode } from "@/domain/enums"
import { useBusinessDate } from "@/hooks/use-data"
import { api, clock } from "@/services"
import {
  isPaymentAvailable,
  paymentApi,
  type PaymentApi,
  type PaymentAuditEntry,
  type SessionBills,
} from "@/services/payment"
import { useCan, useSession } from "@/state/session"
import { AuditPanel } from "./audit-panel"
import {
  canAccessPaymentCancel,
  canApproveCancelRequests,
  canDirectCancelPaid,
  canReadPaymentAudit,
  collectAuditBillCodes,
  extractPaidBillsFromSessions,
  paidCandidatesFromVisits,
} from "./cancel-model"
import { CancelQueuePanel } from "./cancel-queue-panel"
import { DirectCancelPanel } from "./direct-cancel-panel"
import "./payment-cancel.css"

const REFRESH_INTERVAL_MS = 5_000

export function PaymentCancelWorkspace({
  payApi = paymentApi,
  initialBillCode = "",
  embedded = false,
  accessOverride,
}: {
  payApi?: PaymentApi
  initialBillCode?: string
  embedded?: boolean
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
  const today = useBusinessDate()

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

  const [auditBillFilter, setAuditBillFilter] = useState(initialBillCode)

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

  const auditQuery = useQuery({
    queryKey: ["payment-audit", role, auditBillFilter.trim() || "ALL"],
    queryFn: () => payApi.listAudit(auditBillFilter.trim() || undefined),
    enabled: isPaymentAvailable && allowed && showAudit,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const allAuditQuery = useQuery({
    queryKey: ["payment-audit", role, "ALL"],
    queryFn: () => payApi.listAudit(),
    enabled: isPaymentAvailable && allowed && showAudit,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const paidBillsQuery = useQuery({
    queryKey: ["payment-cancel-paid-bills", today, role, showAudit],
    queryFn: async () => {
      const [catalog, visits] = await Promise.all([api.getCatalog(), api.listVisits(today)])
      const tableCodeById = new Map(catalog.tables.map((t) => [t.id, t.code]))

      if (!showAudit) {
        return paidCandidatesFromVisits(visits, tableCodeById)
      }

      const candidateVisitIds = new Set<string>()
      for (const v of visits) {
        if (v.paidMarkedAt !== null) candidateVisitIds.add(String(v.id))
      }
      const auditEntries: PaymentAuditEntry[] = allAuditQuery.data ?? (await payApi.listAudit())
      for (const entry of auditEntries) {
        if (entry.visitId) candidateVisitIds.add(entry.visitId)
      }

      const sessionResults = await Promise.allSettled(
        [...candidateVisitIds].map((vid) => payApi.getSessionBills(vid)),
      )
      const sessions: SessionBills[] = []
      for (const res of sessionResults) {
        if (res.status === "fulfilled") sessions.push(res.value)
      }
      return extractPaidBillsFromSessions(sessions)
    },
    enabled: isPaymentAvailable && allowed && showDirectCancel,
    refetchInterval: REFRESH_INTERVAL_MS,
  })

  const knownBillCodes = useMemo(
    () =>
      collectAuditBillCodes(
        requestsQuery.data ?? [],
        paidBillsQuery.data ?? [],
        allAuditQuery.data ?? auditQuery.data ?? [],
      ),
    [allAuditQuery.data, auditQuery.data, paidBillsQuery.data, requestsQuery.data],
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
                  : "Huỷ trực tiếp bill đã thanh toán (bắt buộc nhập lý do)."}
              </p>
            </div>
            <div className="pc-ph-actions">
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

        <div className={showAudit ? "pc-grid pc-grid-2" : "pc-grid"}>
          <div className="pc-col">
            {showQueue ? (
              <CancelQueuePanel
                requests={requestsQuery.data ?? []}
                loading={requestsQuery.isPending}
                error={requestsQuery.error}
                readOnly={isReadOnlyAdmin}
                api={payApi}
                onRefresh={() => void requestsQuery.refetch()}
                onDecided={async (updated) => {
                  setAuditBillFilter(updated.billCode)
                  await invalidateAll()
                }}
                onInspectAudit={(billCode) => setAuditBillFilter(billCode)}
              />
            ) : null}

            {showDirectCancel ? (
              <DirectCancelPanel
                paidBills={paidBillsQuery.data ?? []}
                loading={paidBillsQuery.isPending}
                initialBillCode={initialBillCode}
                api={payApi}
                canViewAudit={showAudit}
                onCancelled={async (billCode) => {
                  if (showAudit) setAuditBillFilter(billCode)
                  await invalidateAll()
                }}
                onInspectAudit={showAudit ? (billCode) => setAuditBillFilter(billCode) : undefined}
              />
            ) : null}
          </div>

          {showAudit ? (
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
  return <PaymentCancelWorkspace />
}
