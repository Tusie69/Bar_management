import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ChevronRight, Clock, Link2, ReceiptText } from "lucide-react"
import { useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { sortBarSessionsFirst, toWaiterErrorMessage, type WaiterBillView } from "@/features/waiter/waiter-invoice-model"
import { WaiterInvoiceWorkspace } from "@/features/waiter/waiter-invoice-views"
import { formatVnd, paymentApi, type PayBillSummary, type PaymentApi } from "@/services/payment"

function SessionPickerRow({
  session,
  onSelect,
}: {
  session: PayBillSummary
  onSelect: (visitId: string) => void
}) {
  const isCluster = Boolean(session.clusterCode && session.tables.length > 1)
  const isPend = session.status === "AWAITING_PAYMENT"
  const hasLines = session.hasOrderLines !== false

  return (
    <button
      type="button"
      onClick={() => onSelect(session.visitId)}
      className="pay-w2-sess-btn"
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-base font-bold text-[var(--ink-strong)]">{session.code}</b>
          {isCluster ? (
            <span className="pay-chip-cl">
              <Link2 className="size-3" aria-hidden />
              {`Cụm ${session.tables.length} bàn`}
            </span>
          ) : null}
          {isPend ? (
            <span className="pay-pill pay-p-pend">
              <Clock className="size-3" aria-hidden />
              Chờ thanh toán
            </span>
          ) : null}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {`mở ${session.openedAt} · ${session.tables.join(", ")}`}
          {session.issuedAt ? ` · Đã đưa hóa đơn · ${session.issuedBy ?? session.waiterName} · ${session.issuedAt}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tnum text-sm font-bold text-[var(--ink-strong)]">
          {hasLines ? formatVnd(session.dueVnd) : "Chưa có món"}
        </span>
        <ChevronRight className="size-4 text-[var(--text-subtle)]" aria-hidden />
      </span>
    </button>
  )
}

export function BarBillDrawerBody({
  open,
  selectedVisitId,
  view,
  billCode,
  onSelectVisit,
  onNavigateView,
  onBackToList,
  api = paymentApi,
}: {
  open: boolean
  selectedVisitId: string | null
  view: WaiterBillView
  billCode?: string | null
  onSelectVisit: (visitId: string) => void
  onNavigateView: (nextView: WaiterBillView, nextBillCode?: string) => void
  onBackToList: () => void
  api?: PaymentApi
}) {
  const openQuery = useQuery({
    queryKey: ["payment-open"],
    queryFn: () => api.listOpen(),
    enabled: open && selectedVisitId === null,
  })

  if (selectedVisitId !== null) {
    return (
      <WaiterInvoiceWorkspace
        visitId={selectedVisitId}
        view={view}
        billCode={billCode}
        backLabel="Khách quầy Bar"
        onBack={onBackToList}
        onNavigateView={onNavigateView}
        api={api}
        embedded
      />
    )
  }

  const sessions = openQuery.data ?? []
  const { barSessions, otherSessions } = sortBarSessionsFirst(sessions)

  return (
    <div className="pay-root">
      {openQuery.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : openQuery.isError ? (
        <div role="alert" className="pay-bn pay-bn-err">
          <AlertTriangle className="pay-i" aria-hidden />
          <span>
            <b>Không tải được danh sách phiên quầy Bar</b>
            {toWaiterErrorMessage(openQuery.error, "Vui lòng thử lại.")}
            <span className="pay-bn-act">
              <button type="button" onClick={() => void openQuery.refetch()} className="pay-btn pay-btn-s">
                Thử lại
              </button>
            </span>
          </span>
        </div>
      ) : barSessions.length === 0 && otherSessions.length === 0 ? (
        <div className="pay-empty">
          <b>Chưa có khách đang mở ở quầy Bar</b>
          Khách ngồi ghế Bar hoặc bàn khác sẽ xuất hiện tại đây để xem tạm tính và xuất hóa đơn.
        </div>
      ) : (
        <div className="grid gap-4">
          <section className="grid gap-2" aria-label="Phiên khách quầy Bar">
            <h3 className="text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
              {`Khách quầy Bar (${barSessions.length})`}
            </h3>
            {barSessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-[var(--text-muted)]">
                Hiện chưa có khách ngồi ghế Bar.
              </p>
            ) : (
              barSessions.map((s) => <SessionPickerRow key={s.visitId} session={s} onSelect={onSelectVisit} />)
            )}
          </section>

          {otherSessions.length > 0 ? (
            <details className="grid gap-2">
              <summary className="cursor-pointer text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                {`Bàn khác đang phục vụ (${otherSessions.length})`}
              </summary>
              <div className="mt-2 grid gap-2">
                {otherSessions.map((s) => (
                  <SessionPickerRow key={s.visitId} session={s} onSelect={onSelectVisit} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function BarBillDrawer({
  open,
  initialVisitId,
  onClose,
  api = paymentApi,
}: {
  open: boolean
  initialVisitId: string | null
  onClose: () => void
  api?: PaymentApi
}) {
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(initialVisitId)
  const [view, setView] = useState<WaiterBillView>("detail")
  const [billCode, setBillCode] = useState<string | null>(null)

  const [prevInit, setPrevInit] = useState<{ open: boolean; initialVisitId: string | null }>({
    open,
    initialVisitId,
  })
  if (prevInit.open !== open || prevInit.initialVisitId !== initialVisitId) {
    setPrevInit({ open, initialVisitId })
    if (open) {
      setSelectedVisitId(initialVisitId)
      setView("detail")
      setBillCode(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ReceiptText className="size-5" aria-hidden />
            Hóa đơn quầy Bar
          </SheetTitle>
          <SheetDescription>
            Xem tạm tính và xuất hóa đơn kèm mã QR cho khách quầy Bar. Không ghi nhận thu tiền.
          </SheetDescription>
        </SheetHeader>
        <div className="pay-w2-drawer-body">
          <BarBillDrawerBody
            open={open}
            selectedVisitId={selectedVisitId}
            view={view}
            billCode={billCode}
            onSelectVisit={(visitId) => {
              setSelectedVisitId(visitId)
              setView("detail")
              setBillCode(null)
            }}
            onNavigateView={(nextView, nextCode) => {
              setView(nextView)
              setBillCode(nextCode ?? null)
            }}
            onBackToList={() => {
              setSelectedVisitId(null)
              setView("detail")
              setBillCode(null)
            }}
            api={api}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
