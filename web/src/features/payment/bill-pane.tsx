import { ChevronRight, Info, Printer, ReceiptText, Send } from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  PAYMENT_VAT_CONFIG,
  buildDemoQrGrid,
  countActiveLines,
  formatVnd,
  groupActiveRounds,
  type PayBill,
} from "@/services/payment"

function statusPillMeta(status: PayBill["status"]): { label: string; cls: string } {
  if (status === "PAID") return { label: "Đã thanh toán", cls: "pay-pill pay-p-free" }
  if (status === "CLOSED_UNPAID") {
    return { label: "Đã trả bàn · chưa thu", cls: "pay-pill pay-p-unpaid" }
  }
  if (status === "AWAITING_PAYMENT") {
    return { label: "Chờ thanh toán", cls: "pay-pill pay-p-pend" }
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
  const pill = statusPillMeta(bill.status)
  const isCluster = Boolean(bill.clusterCode && bill.tables.length > 1)
  const vatLabel = bill.vatLabel ?? PAYMENT_VAT_CONFIG.label
  const vatNote = bill.vatNote ?? PAYMENT_VAT_CONFIG.pendingNote

  return (
    <section aria-label="Chi tiết bill" className="pay-pane-bill pay-card">
      <div className="pay-bill-h">
        <div className="pay-bill-h-t">
          <b>{bill.code}</b>
          <span>{`${bill.sessionCode} · mở ${bill.openedAt} · ${rounds.length} đơn · ${bill.guests} khách · Khách lẻ`}</span>
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
            {vatLabel} <span className="pay-tag pay-tag-wait">{vatNote}</span>
          </dt>
          <dd>{formatVnd(bill.vatVnd)}</dd>
        </div>
        <div className="pay-na">
          <dt>Phí phục vụ · phụ thu · giảm giá</dt>
          <dd>Chưa áp dụng · chờ BA chốt</dd>
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
  canCollect,
  isWaiter,
  busy,
  onPreview,
  onCollect,
  onRequestPayment,
}: {
  bill: PayBill
  canCollect: boolean
  isWaiter: boolean
  busy: boolean
  onPreview: () => void
  onCollect: () => void
  onRequestPayment: () => void
}) {
  const { makingCount } = useMemo(() => countActiveLines(bill.lines), [bill.lines])
  const isPaid = bill.status === "PAID"
  const isClosedUnpaid = bill.status === "CLOSED_UNPAID"
  const isClosed = isPaid || isClosedUnpaid
  const isPending = bill.status === "AWAITING_PAYMENT"
  const hasLines = bill.lines.length > 0
  const dueSub =
    bill.roundingVnd > 0
      ? `Đã làm tròn lên từ ${formatVnd(bill.preRoundVnd)} · Bill ${bill.billCode}`
      : `Không cần làm tròn · Bill ${bill.billCode}`
  const statusNote = isPaid
    ? "Bill đã đóng"
    : isClosedUnpaid
      ? "Phiên đã trả bàn nhưng chưa ghi nhận thu tiền"
      : !hasLines
        ? "Chưa có dữ liệu món (mô phỏng)"
        : isPending
          ? `Tạm tính lúc ${bill.pendingAt ?? "21:42"} · chưa nhận tiền`
          : "Chưa tạo tạm tính"
  const requested = Boolean(bill.requestedAt)

  return (
    <section aria-label="Thanh toán" className="pay-pane-act pay-card">
      <div className="pay-act">
        <div className="pay-due-b">
          <span className="pay-due-l">Khách cần trả</span>
          <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
          <span className="pay-due-s">{dueSub}</span>
        </div>

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

          {canCollect ? (
            <button
              type="button"
              disabled={isClosed || busy || !hasLines}
              onClick={onCollect}
              className="pay-btn pay-btn-p pay-btn-xl"
            >
              Chốt bill &amp; thu tiền
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
      </div>
    </section>
  )
}

export function ProvisionalPreviewView({
  bill,
  canCollect,
  isWaiter,
  busy,
  viewMode: controlledViewMode,
  onChangeViewMode,
  onCollect,
  onRequestPayment,
  onSimulatedPrint,
}: {
  bill: PayBill
  canCollect: boolean
  isWaiter: boolean
  busy: boolean
  viewMode?: "screen" | "print"
  onChangeViewMode?: (mode: "screen" | "print") => void
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
  const pendingAt = bill.pendingAt ?? "21:42"
  const isClosed = bill.status === "PAID" || bill.status === "CLOSED_UNPAID"
  const requested = Boolean(bill.requestedAt)
  const vatLabel = bill.vatLabel ?? PAYMENT_VAT_CONFIG.label

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
          <article aria-label="Bill tạm tính" className="pay-rcpt">
            <div className="pay-r-top">
              <div>
                <div className="pay-r-logo">21GAM</div>
                <span className="pay-val-ph text-xs">[Địa chỉ, số điện thoại quán · chờ cung cấp]</span>
              </div>
              <span className="pay-r-kind">BILL TẠM TÍNH</span>
            </div>

            <dl className="pay-r-meta">
              <div>
                <dt>Mã bill</dt>
                <dd>{bill.billCode}</dd>
              </div>
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
              <div>
                <dt>Tạm tính lúc</dt>
                <dd>{pendingAt}</dd>
              </div>
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
              <div>
                <dt>Làm tròn</dt>
                <dd>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</dd>
              </div>
            </dl>

            <div className="pay-r-due">
              <span>KHÁCH CẦN TRẢ</span>
              <b>{formatVnd(bill.dueVnd)}</b>
            </div>

            <div className="pay-r-qr">
              <DemoQrBox size="sm" label="Mã QR minh họa trên bill, không chuyển tiền được" />
              <div style={{ display: "grid", gap: 4 }}>
                <b>{`Quét để chuyển khoản đúng ${formatVnd(bill.dueVnd)}`}</b>
                <span className="pay-r-qr-n">
                  {`Nội dung: ${qrRef}. Nhân viên chỉ xác nhận khi đã thấy tiền về.`}
                </span>
              </div>
            </div>

            <p className="pay-r-foot">Bill tạm tính, chưa phải hóa đơn. Món đã hủy không tính.</p>
          </article>
        ) : (
          <article aria-label="Bản in tạm tính khổ 80mm" className="pay-r80">
            <div className="c big">21GAM</div>
            <div className="c">BILL TẠM TÍNH</div>
            <div className="hr" />
            <div className="row">
              <span>{`Bill ${bill.billCode}`}</span>
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
            <div className="hr" />
            <DemoQrBox size="xs" label="Mã QR bản in 80mm, không chuyển tiền được" />
            <div className="c">{`ND: ${qrRef}`}</div>
            <div className="c">Bill tạm tính, chưa phải hóa đơn</div>
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
                    : "Chưa in · in đúng 1 bản đưa khách (TN-02)"}
                </span>
              </div>

              <button type="button" onClick={handlePrint} className="pay-btn pay-btn-s pay-btn-lg pay-btn-w">
                <Printer className="pay-i" aria-hidden />
                In tạm tính
                <span className="pay-tag">mô phỏng</span>
              </button>

              {canCollect ? (
                <button
                  type="button"
                  disabled={isClosed || busy}
                  onClick={onCollect}
                  className="pay-btn pay-btn-p pay-btn-xl pay-btn-w"
                >
                  Chốt bill &amp; thu tiền
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
