import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Info, Lock, Printer, ReceiptText, Send, XCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  PAYMENT_VAT_CONFIG,
  buildDemoQrGrid,
  countActiveLines,
  formatVnd,
  groupActiveRounds,
  type CancelRequest,
  type PayBill,
} from "@/services/payment"

function statusPillMeta(bill: Pick<PayBill, "status" | "billStatus">): { label: string; cls: string } {
  if (bill.billStatus === "PAID" || bill.status === "PAID") {
    return { label: "Đã thu", cls: "pay-pill pay-p-free" }
  }
  if (bill.status === "CLOSED_UNPAID") {
    return { label: "Đã trả bàn · chưa thu", cls: "pay-pill pay-p-unpaid" }
  }
  if (bill.billStatus === "UNPAID" || bill.status === "AWAITING_PAYMENT") {
    return { label: "Chưa thu", cls: "pay-pill pay-p-pend" }
  }
  return { label: "Đang phục vụ", cls: "pay-pill pay-p-open" }
}

export function DemoQrBox({ label }: { size?: "sm" | "md" | "xs"; label: string }) {
  const cells = useMemo(() => buildDemoQrGrid(), [])

  return (
    <div role="img" aria-label={label} className="pay-qr-box">
      <div aria-hidden className="pay-qr">
        {cells.map((on, i) => (
          <span key={i} className={on ? "q1" : undefined} />
        ))}
      </div>
      <span aria-hidden className="pay-demo-band">
        DEMO – KHÔNG CHUYỂN TIỀN
      </span>
    </div>
  )
}

export function BillRoundsCard({
  bill,
  collapsible = false,
  expanded = true,
  onToggleExpanded,
}: {
  bill: PayBill
  collapsible?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const lineCounts = useMemo(() => countActiveLines(bill.lines), [bill.lines])
  const rounds = useMemo(() => groupActiveRounds(bill.lines), [bill.lines])
  const pill = statusPillMeta(bill)
  const isCluster = Boolean(bill.clusterCode && bill.tables.length > 1)
  const vatLabel = bill.vatLabel ?? PAYMENT_VAT_CONFIG.label
  const vatNote = bill.vatNote && bill.vatNote !== PAYMENT_VAT_CONFIG.pendingNote ? bill.vatNote : null

  return (
    <section aria-label="Chi tiết bill" className="pay-pane-bill pay-card">
      <div className="pay-bill-h">
        <div className="pay-bill-h-t">
          <b>{bill.code}</b>
          <span>
            {[
              bill.sessionCode,
              bill.openedAt && bill.openedAt !== "—" ? `mở ${bill.openedAt}` : "",
              `${rounds.length} đơn`,
              bill.guests > 0 ? `${bill.guests} khách` : "",
              "Khách lẻ",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {isCluster ? <span className="pay-chip-cl">{`Cụm ${bill.tables.length} bàn · 1 bill`}</span> : null}
        <span className={pill.cls}>{pill.label}</span>
        {collapsible && onToggleExpanded ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="pay-btn pay-btn-g pay-bill-toggle"
          >
            {expanded ? "Ẩn món" : `Xem ${lineCounts.itemCount} món`}
          </button>
        ) : null}
      </div>

      <div className="pay-rounds">
        {rounds.length === 0 ? (
          <div className="border-b border-border px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            <b className="mb-1 block text-foreground">
              {bill.lines.length === 0 ? "Chưa có dữ liệu món cho phiên này" : "Không còn món tính tiền"}
            </b>
            <span>
              {bill.lines.length === 0
                ? "Chế độ mô phỏng chưa nối gọi món thật cho phiên này."
                : "Các món trong phiên đều đã hủy."}
            </span>
          </div>
        ) : (
          rounds.map((r) => (
            <div key={r.orderRound} className="pay-round">
              <div className="pay-round-h">
                <span>{r.label}</span>
                <span>{r.meta}</span>
              </div>
              <ul>
                {r.items.map((it, idx) => (
                  <li key={`${r.orderRound}-${it.name}-${idx}`} className="pay-it">
                    <span className="pay-it-q">{`${it.qty}×`}</span>
                    <span className="pay-it-n">{it.name}</span>
                    <span className="pay-it-a">{formatVnd(it.lineTotalVnd)}</span>
                    <span className="pay-it-s">
                      <span>{`${it.unit} · ${formatVnd(it.unitPriceVnd)}`}</span>
                      <span className={cn("pay-it-st", it.state === "MAKING" ? "pay-st-making" : "pay-st-served")}>
                        {it.state === "MAKING" ? "Đang làm" : "Đã ra"}
                      </span>
                      {it.note ? <span className="pay-note">{`Ghi chú: ${it.note}`}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <dl className="pay-sum">
        <div>
          <dt>{`Tổng tiền món (${lineCounts.itemCount} món)`}</dt>
          <dd>{formatVnd(bill.subtotalVnd)}</dd>
        </div>
        <div>
          <dt>
            {vatLabel}
            {vatNote ? (
              <>
                {" "}
                <span className="pay-tag pay-tag-wait">{vatNote}</span>
              </>
            ) : null}
          </dt>
          <dd>{formatVnd(bill.vatVnd)}</dd>
        </div>
        <div className="pay-na">
          <dt>
            Phí phục vụ · phụ thu <span className="pay-tag">Đang phát triển</span>
          </dt>
          <dd>0đ</dd>
        </div>
        <div>
          <dt>Tổng trước làm tròn</dt>
          <dd>{formatVnd(bill.preRoundVnd)}</dd>
        </div>
        <div>
          <dt>Làm tròn lên nghìn (bước cuối)</dt>
          <dd>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</dd>
        </div>
        <div className="pay-tot">
          <dt>Số tiền phải trả</dt>
          <dd>{formatVnd(bill.dueVnd)}</dd>
        </div>
      </dl>
    </section>
  )
}

export function DetailActionPane({
  bill,
  bills,
  selectedBillCode,
  onSelectBill,
  unbilledLineCount,
  cancelRequests,
  canCollect,
  isWaiter,
  busy,
  onPreview,
  onViewInvoice,
  onIssueInvoice,
  onCollect,
  onRequestPayment,
  onRequestCancel,
}: {
  bill: PayBill
  bills?: readonly PayBill[]
  selectedBillCode?: string | null
  onSelectBill?: (billCode: string) => void
  unbilledLineCount?: number
  cancelRequests?: readonly CancelRequest[]
  canCollect: boolean
  isWaiter: boolean
  busy: boolean
  onPreview: () => void
  onViewInvoice?: () => void
  onIssueInvoice?: () => void
  onCollect: () => void
  onRequestPayment: () => void
  onRequestCancel?: (billCode: string, reason: string) => Promise<void> | void
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)

  const { makingCount } = useMemo(() => countActiveLines(bill.lines), [bill.lines])
  const isBillPaid = bill.billStatus ? bill.billStatus === "PAID" : bill.status === "PAID"
  const isClosedUnpaid = bill.status === "CLOSED_UNPAID"
  const isClosed = isBillPaid || isClosedUnpaid
  const isUnpaidBill = Boolean(bill.billCode) && (bill.billStatus === "UNPAID" || bill.status === "AWAITING_PAYMENT")
  const hasLines = bill.lines.length > 0
  const unbilledCount = unbilledLineCount ?? (bills && bills.length > 0 ? 0 : !bill.billCode && hasLines ? 1 : 0)
  const canIssue = Boolean(canCollect && onIssueInvoice && !isClosedUnpaid && unbilledCount > 0 && hasLines)
  const canCollectSelected = Boolean(canCollect && !isClosed && hasLines && (isUnpaidBill || !onIssueInvoice))

  const activeCancelRequest = useMemo(() => {
    if (!cancelRequests?.length || !bill.billCode) return null
    const matches = cancelRequests.filter((r) => r.billCode === bill.billCode)
    return matches[0] ?? null
  }, [bill.billCode, cancelRequests])

  const hasPendingCancel = activeCancelRequest?.status === "PENDING" || Boolean(bill.cancelPending)
  const canSubmitCancelRequest = Boolean(
    isBillPaid && canCollect && onRequestCancel && bill.billCode && !hasPendingCancel && activeCancelRequest?.status !== "APPROVED",
  )

  const dueSub =
    !bill.billCode
      ? "Chưa xuất hóa đơn"
      : bill.roundingVnd > 0
        ? `Đã làm tròn lên từ ${formatVnd(bill.preRoundVnd)} · Bill ${bill.billCode}`
        : `Không cần làm tròn · Bill ${bill.billCode}`

  const statusNote = isBillPaid
    ? `Bill ${bill.billCode} đã thu${bill.paidAt ? ` lúc ${bill.paidAt}` : ""}`
    : isClosedUnpaid
      ? "Phiên đã trả bàn nhưng chưa ghi nhận thu tiền"
      : !hasLines
        ? "Chưa có dữ liệu món (mô phỏng)"
        : isUnpaidBill
          ? bill.issuedBy || bill.issuedAt
            ? `Đã đưa hóa đơn · ${bill.issuedBy ?? bill.waiterName}${bill.issuedAt ? ` · ${bill.issuedAt}` : ""}`
            : `Tạm tính lúc ${bill.pendingAt ?? "21:42"} · chưa nhận tiền`
          : "Chưa xuất hóa đơn"
  const requested = Boolean(bill.requestedAt)

  const handleCancelSubmit = async () => {
    const trimmed = cancelReason.trim()
    if (!trimmed) {
      setCancelError("Vui lòng nhập lý do gửi yêu cầu huỷ.")
      return
    }
    if (!onRequestCancel || !bill.billCode || cancelSubmitting) return
    setCancelSubmitting(true)
    setCancelError(null)
    try {
      await onRequestCancel(bill.billCode, trimmed)
      setCancelReason("")
      setCancelOpen(false)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Không gửi được yêu cầu huỷ.")
    } finally {
      setCancelSubmitting(false)
    }
  }

  return (
    <section aria-label="Thanh toán" className="pay-pane-act pay-card">
      <div className="pay-act">
        <div className="pay-due-b">
          <span className="pay-due-l">{isBillPaid ? "Đã thu" : "Khách cần trả"}</span>
          <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
          <span className="pay-due-s">{dueSub}</span>
        </div>

        {bills && bills.length > 0 ? (
          <div className="pay-bills-sec" aria-label="Danh sách hóa đơn của phiên">
            <div className="pay-bills-h">
              <span>{`Hóa đơn trong phiên (${bills.length})`}</span>
            </div>
            <div className="pay-bills-list">
              {bills.map((b) => {
                const bPaid = b.billStatus ? b.billStatus === "PAID" : b.status === "PAID"
                const isSelected = (selectedBillCode ?? bill.billCode) === b.billCode
                return (
                  <button
                    key={b.billCode}
                    type="button"
                    onClick={() => onSelectBill?.(b.billCode)}
                    aria-pressed={isSelected}
                    className={cn("pay-bill-item", isSelected && "sel")}
                  >
                    <span className="pay-bill-item-l">
                      <b>{b.billCode}</b>
                      <small>
                        {b.issuedBy || b.issuedAt
                          ? `${b.issuedBy ?? b.waiterName}${b.issuedAt ? ` · ${b.issuedAt}` : ""}`
                          : b.openedAt}
                      </small>
                    </span>
                    <span className="pay-bill-item-r">
                      <span className={cn("pay-pill", bPaid ? "pay-p-free" : "pay-p-pend")}>
                        {bPaid ? "Đã thu" : "Chưa thu"}
                      </span>
                      <b>{formatVnd(b.dueVnd)}</b>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {unbilledCount > 0 && !isClosedUnpaid ? (
          <div role="note" className="pay-unbilled">
            <span>
              <b>{`Còn ${unbilledCount} dòng món chưa xuất hóa đơn`}</b>
            </span>
            {canIssue && isUnpaidBill ? (
              <button
                type="button"
                disabled={busy}
                onClick={onIssueInvoice}
                className="pay-btn pay-btn-p"
              >
                Xuất hóa đơn
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="pay-st-line">
          <span>{statusNote}</span>
        </div>

        {makingCount > 0 ? (
          <p role="note" className="pay-hint pay-making-warn">
            <Info className="pay-i sm" aria-hidden />
            <span>{`${makingCount} món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.`}</span>
          </p>
        ) : null}

        <div className="pay-act-btns">
          <button
            type="button"
            disabled={busy || !hasLines || isClosedUnpaid}
            onClick={onPreview}
            className="pay-btn pay-btn-s pay-btn-lg"
          >
            <ReceiptText className="pay-i" aria-hidden />
            Xem tạm tính
          </button>

          {onViewInvoice && bill.billCode && (isUnpaidBill || isBillPaid) ? (
            <button
              type="button"
              disabled={busy || !hasLines || isClosedUnpaid}
              onClick={onViewInvoice}
              className="pay-btn pay-btn-s pay-btn-lg"
            >
              <Printer className="pay-i" aria-hidden />
              Xem hóa đơn
            </button>
          ) : null}

          {canCollect && isUnpaidBill ? (
            <button
              type="button"
              disabled={!canCollectSelected || busy}
              onClick={onCollect}
              className="pay-btn pay-btn-p pay-btn-xl"
            >
              {bills && bills.length > 1 ? `Thu tiền · ${bill.billCode}` : "Thu tiền"}
              <ChevronRight className="pay-i" aria-hidden />
            </button>
          ) : canCollect && canIssue ? (
            <button
              type="button"
              disabled={busy}
              onClick={onIssueInvoice}
              className="pay-btn pay-btn-p pay-btn-xl"
            >
              Xuất hóa đơn
              <ChevronRight className="pay-i" aria-hidden />
            </button>
          ) : canCollect && !isBillPaid ? (
            <button
              type="button"
              disabled={isClosed || busy || !hasLines}
              onClick={onCollect}
              className="pay-btn pay-btn-p pay-btn-xl"
            >
              Thu tiền
              <ChevronRight className="pay-i" aria-hidden />
            </button>
          ) : null}

          {!canCollect && isWaiter ? (
            <button
              type="button"
              disabled={requested || isClosed || busy || !hasLines}
              onClick={onRequestPayment}
              className="pay-btn pay-btn-p pay-btn-xl"
            >
              <Send className="pay-i" aria-hidden />
              {requested ? "Đã gửi · chờ Thu ngân chốt" : "Gửi yêu cầu thanh toán"}
            </button>
          ) : null}
        </div>

        {isBillPaid && canCollect ? (
          <div className="pay-cancel-box" aria-label="Yêu cầu huỷ thanh toán">
            {activeCancelRequest ? (
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Trạng thái yêu cầu huỷ</span>
                  <span
                    className={cn(
                      "pay-pill",
                      activeCancelRequest.status === "APPROVED"
                        ? "pay-p-open"
                        : activeCancelRequest.status === "REJECTED"
                          ? "pay-p-unpaid"
                          : "pay-p-pend",
                    )}
                  >
                    {activeCancelRequest.status === "PENDING" ? (
                      <>
                        <Clock className="pay-i sm" aria-hidden />
                        Đang chờ duyệt (PENDING)
                      </>
                    ) : activeCancelRequest.status === "APPROVED" ? (
                      <>
                        <CheckCircle2 className="pay-i sm" aria-hidden />
                        Đã duyệt huỷ (APPROVED)
                      </>
                    ) : (
                      <>
                        <XCircle className="pay-i sm" aria-hidden />
                        Bị từ chối (REJECTED)
                      </>
                    )}
                  </span>
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {`Lý do: ${activeCancelRequest.reason} · ${activeCancelRequest.requestedBy} (${activeCancelRequest.requestedAt})`}
                </span>
                {activeCancelRequest.decidedBy || activeCancelRequest.decisionNote ? (
                  <span className="text-xs text-[var(--text-muted)]">
                    {[
                      activeCancelRequest.decidedBy ? `Người duyệt: ${activeCancelRequest.decidedBy}` : "",
                      activeCancelRequest.decidedAt ?? "",
                      activeCancelRequest.decisionNote ? `Ghi chú: ${activeCancelRequest.decisionNote}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
            ) : bill.cancelPending ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold">Trạng thái yêu cầu huỷ</span>
                <span className="pay-pill pay-p-pend">Đang chờ duyệt (PENDING)</span>
              </div>
            ) : null}

            {canSubmitCancelRequest && !cancelOpen ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCancelError(null)
                  setCancelOpen(true)
                }}
                className="pay-btn pay-btn-s"
              >
                <Lock className="pay-i sm" aria-hidden />
                Gửi yêu cầu huỷ
              </button>
            ) : null}

            {canSubmitCancelRequest && cancelOpen ? (
              <div className="pay-cancel-form">
                <label htmlFor="pay-cancel-reason" className="text-xs font-semibold">
                  Lý do gửi yêu cầu huỷ (bắt buộc)
                </label>
                <textarea
                  id="pay-cancel-reason"
                  placeholder="Nhập lý do cần huỷ thanh toán bill này…"
                  value={cancelReason}
                  disabled={cancelSubmitting}
                  onChange={(e) => {
                    setCancelReason(e.target.value)
                    if (cancelError) setCancelError(null)
                  }}
                />
                {cancelError ? (
                  <p role="alert" className="flex items-center gap-1.5 text-xs text-[var(--destructive-ink)]">
                    <AlertTriangle className="pay-i sm" aria-hidden />
                    <span>{cancelError}</span>
                  </p>
                ) : null}
                <div className="pay-cancel-form-act">
                  <button
                    type="button"
                    disabled={cancelSubmitting}
                    onClick={() => {
                      setCancelOpen(false)
                      setCancelError(null)
                    }}
                    className="pay-btn pay-btn-s"
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    disabled={cancelSubmitting}
                    onClick={() => void handleCancelSubmit()}
                    className="pay-btn pay-btn-p"
                  >
                    {cancelSubmitting ? "Đang gửi…" : "Xác nhận gửi yêu cầu huỷ"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function ProvisionalPreviewView({
  bill,
  isProvisional = true,
  canCollect,
  isWaiter,
  busy,
  viewMode: controlledViewMode,
  onChangeViewMode,
  onIssueInvoice,
  onCollect,
  onRequestPayment,
  onSimulatedPrint,
}: {
  bill: PayBill
  isProvisional?: boolean
  canCollect: boolean
  isWaiter: boolean
  busy: boolean
  viewMode?: "screen" | "print"
  onChangeViewMode?: (mode: "screen" | "print") => void
  onIssueInvoice?: () => void
  onCollect: () => void
  onRequestPayment: () => void
  onSimulatedPrint: (count: number) => void
}) {
  const [internalViewMode, setInternalViewMode] = useState<"screen" | "print">("screen")
  const [prints, setPrints] = useState(0)
  const viewMode = controlledViewMode ?? internalViewMode
  const setViewMode = onChangeViewMode ?? setInternalViewMode

  const rounds = useMemo(() => groupActiveRounds(bill.lines), [bill.lines])
  const activeLines = useMemo(() => rounds.flatMap((r) => r.items), [rounds])
  const qrRef = `21GAM ${bill.billCode}`
  const place = bill.clusterCode ? `${bill.code} (${bill.tables.join(", ")})` : bill.code
  const pendingAt = bill.issuedAt ?? bill.pendingAt ?? "21:42"
  const isClosed = bill.status === "PAID" || bill.status === "CLOSED_UNPAID"
  const requested = Boolean(bill.requestedAt)
  const vatLabel = bill.vatLabel ?? PAYMENT_VAT_CONFIG.label
  const docTitle = isProvisional ? "TẠM TÍNH" : "HÓA ĐƠN"
  const docNotice = isProvisional
    ? "Tạm tính – chưa phải hóa đơn. Món đã hủy không tính."
    : "Hóa đơn thanh toán. Món đã hủy không tính."
  const printBtnLabel = isProvisional ? "In tạm tính" : "In hóa đơn"

  const handlePrint = () => {
    const next = prints + 1
    setPrints(next)
    onSimulatedPrint(next)
  }

  return (
    <div className="grid gap-4">
      {controlledViewMode === undefined ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div role="group" aria-label="Cách xem" className="pay-seg">
            <button type="button" aria-pressed={viewMode === "screen"} onClick={() => setViewMode("screen")}>
              Trên màn hình
            </button>
            <button type="button" aria-pressed={viewMode === "print"} onClick={() => setViewMode("print")}>
              Bản in 80mm
            </button>
          </div>
        </div>
      ) : null}

      <div className="pay-pv">
        {viewMode === "screen" ? (
          <article aria-label={isProvisional ? "Tạm tính – chưa phải hóa đơn" : "Hóa đơn"} className="pay-rcpt">
            <div className="pay-r-top">
              <div>
                <div className="pay-r-logo">21GAM</div>
                <span className="pay-val-ph text-xs">[Địa chỉ, số điện thoại quán · chờ cung cấp]</span>
              </div>
              <span className="pay-r-kind">{docTitle}</span>
            </div>

            <dl className="pay-r-meta">
              {!isProvisional ? (
                <div>
                  <dt>Mã bill</dt>
                  <dd>{bill.billCode}</dd>
                </div>
              ) : null}
              <div>
                <dt>Phiên</dt>
                <dd>{bill.sessionCode}</dd>
              </div>
              <div>
                <dt>Bàn</dt>
                <dd>{place}</dd>
              </div>
              <div>
                <dt>Giờ vào</dt>
                <dd>{bill.openedAt}</dd>
              </div>
              {!isProvisional ? (
                <div>
                  <dt>Xuất hóa đơn lúc</dt>
                  <dd>{pendingAt}</dd>
                </div>
              ) : null}
              <div>
                <dt>Phục vụ</dt>
                <dd>{bill.waiterName}</dd>
              </div>
            </dl>

            <div className="pay-r-lines">
              {activeLines.map((l, idx) => (
                <div key={`${l.name}-${idx}`} className="pay-r-line">
                  <span>
                    {l.name}
                    <small>{`${l.qty} × ${formatVnd(l.unitPriceVnd)} · ${l.unit}`}</small>
                  </span>
                  <b>{formatVnd(l.lineTotalVnd)}</b>
                </div>
              ))}
            </div>

            <dl className="pay-sum" style={{ borderRadius: 12 }}>
              <div>
                <dt>Tổng tiền món</dt>
                <dd>{formatVnd(bill.subtotalVnd)}</dd>
              </div>
              <div>
                <dt>{vatLabel}</dt>
                <dd>{formatVnd(bill.vatVnd)}</dd>
              </div>
              <div className="pay-na">
                <dt>
                  Phí phục vụ · phụ thu <span className="pay-tag">Đang phát triển</span>
                </dt>
                <dd>0đ</dd>
              </div>
              <div>
                <dt>Làm tròn</dt>
                <dd>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</dd>
              </div>
            </dl>

            <div className="pay-r-due">
              <span>KHÁCH CẦN TRẢ</span>
              <b>{formatVnd(bill.dueVnd)}</b>
            </div>

            {!isProvisional ? (
              <div className="pay-r-qr">
                <DemoQrBox size="sm" label="Mã QR minh họa trên hóa đơn, không chuyển tiền được" />
                <div style={{ display: "grid", gap: 4 }}>
                  <b>{`Quét để chuyển khoản đúng ${formatVnd(bill.dueVnd)}`}</b>
                  <span className="pay-r-qr-n">
                    {`Nội dung: ${qrRef}. Nhân viên chỉ xác nhận khi đã thấy tiền về.`}
                  </span>
                </div>
              </div>
            ) : null}

            <p className="pay-r-foot">{docNotice}</p>
          </article>
        ) : (
          <article aria-label={isProvisional ? "Bản in tạm tính khổ 80mm" : "Bản in hóa đơn khổ 80mm"} className="pay-r80">
            <div className="c big">21GAM</div>
            <div className="c">{docTitle}</div>
            <div className="hr" />
            <div className="row">
              <span>{isProvisional ? "Tạm tính" : `Bill ${bill.billCode}`}</span>
              <span>{bill.sessionCode}</span>
            </div>
            <div className="row">
              <span>{`Bàn ${place}`}</span>
              <span>{pendingAt}</span>
            </div>
            <div className="hr" />
            {activeLines.map((l, idx) => (
              <div key={`${l.name}-${idx}`}>
                <div>{l.name}</div>
                <div className="row">
                  <span>{`${l.qty} × ${formatVnd(l.unitPriceVnd)}`}</span>
                  <span>{formatVnd(l.lineTotalVnd)}</span>
                </div>
              </div>
            ))}
            <div className="hr" />
            <div className="row">
              <span>Tổng tiền món</span>
              <span>{formatVnd(bill.subtotalVnd)}</span>
            </div>
            <div className="row">
              <span>{vatLabel}</span>
              <span>{formatVnd(bill.vatVnd)}</span>
            </div>
            <div className="row">
              <span>Làm tròn</span>
              <span>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</span>
            </div>
            <div className="row big">
              <span>CẦN TRẢ</span>
              <span>{formatVnd(bill.dueVnd)}</span>
            </div>
            {!isProvisional ? (
              <>
                <div className="hr" />
                <DemoQrBox size="xs" label="Mã QR bản in 80mm, không chuyển tiền được" />
                <div className="c">{`ND: ${qrRef}`}</div>
              </>
            ) : null}
            <div className="c">{isProvisional ? "Tạm tính – chưa phải hóa đơn" : "Hóa đơn thanh toán"}</div>
          </article>
        )}

        <aside className="pay-pv-side">
          <div className="pay-card">
            <div className="pay-act">
              <div className="pay-due-b">
                <span className="pay-due-l">Khách cần trả</span>
                <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
                <span className="pay-due-s">
                  {prints
                    ? `Đã in ${prints} lần (mô phỏng) · in đúng 1 bản đưa khách`
                    : isProvisional
                      ? "Tạm tính – chưa phải hóa đơn (không đổi trạng thái phiên)"
                      : "Chưa in · in đúng 1 bản đưa khách"}
                </span>
              </div>

              <button type="button" onClick={handlePrint} className="pay-btn pay-btn-s btn-lg pay-btn-lg pay-btn-w">
                <Printer className="pay-i" aria-hidden />
                {printBtnLabel}
                <span className="pay-tag">mô phỏng</span>
              </button>

              {canCollect && isProvisional && onIssueInvoice ? (
                <button
                  type="button"
                  disabled={isClosed || busy}
                  onClick={onIssueInvoice}
                  className="pay-btn pay-btn-p pay-btn-xl pay-btn-w"
                >
                  Xuất hóa đơn
                  <ChevronRight className="pay-i" aria-hidden />
                </button>
              ) : canCollect ? (
                <button
                  type="button"
                  disabled={isClosed || busy}
                  onClick={onCollect}
                  className="pay-btn pay-btn-p pay-btn-xl pay-btn-w"
                >
                  Thu tiền
                  <ChevronRight className="pay-i" aria-hidden />
                </button>
              ) : null}

              {!canCollect && isWaiter ? (
                <button
                  type="button"
                  disabled={requested || isClosed || busy}
                  onClick={onRequestPayment}
                  className="pay-btn pay-btn-p pay-btn-xl pay-btn-w"
                >
                  {requested ? "Đã gửi · chờ Thu ngân chốt" : "Gửi yêu cầu thanh toán"}
                </button>
              ) : null}

              <p className="pay-hint">
                <Info className="pay-i sm" aria-hidden />
                <span>Chưa nối máy in thật. Đang chốt tạm phiếu điện tử.</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
