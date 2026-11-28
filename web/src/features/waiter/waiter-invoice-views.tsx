import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Copy,
  FileCheck2,
  Info,
  Printer,
  QrCode,
  ReceiptText,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  buildDemoQrGrid,
  countActiveLines,
  formatVnd,
  groupActiveRounds,
  paymentApi,
  type PayBill,
  type PayBillQr,
  type PayLine,
  type PaymentApi,
  type PreviewBill,
  type SessionBills,
} from "@/services/payment"
import "@/features/payment/css/waiter.css"
import { useWaiterCatalogQuery } from "./use-waiter-floor"
import {
  BANK_RECEIVING_NAME,
  PREVIEW_HAS_QR,
  PROVISIONAL_LABEL,
  canIssueNewInvoice,
  isBarGuestSession,
  previewToBillDisplay,
  selectInvoiceBill,
  submitIssueInvoice,
  toWaiterErrorMessage,
  type IssueIdempotencySlot,
  type WaiterBillView,
} from "./waiter-invoice-model"

function notifyViaSonner(kind: "success" | "info" | "error", text: string) {
  if (kind === "success") toast.success(text)
  else if (kind === "error") toast.error(text)
  else toast.info(text)
}

/**
 * Mã QR trên tờ hoá đơn Phục vụ đưa khách.
 *
 * HU-44 v1.1 đặt mã ở ĐÂY, không phải ở quầy: khách cầm tờ hoá đơn, quét tại
 * bàn. Nên nó phải là chuỗi máy chủ đã sinh và lưu cùng hoá đơn, không phải
 * một ô minh hoạ — ô minh hoạ chỉ còn dùng ở chế độ mô phỏng.
 */
function W2DemoQrBox({ qr, label, size = 128 }: { qr?: PayBillQr | null; label: string; size?: number }) {
  const cells = useMemo(() => (qr ? [] : buildDemoQrGrid()), [qr])
  if (qr) {
    return (
      <div role="img" aria-label={label} className="pay-qr-box">
        <QRCodeSVG value={qr.payload} size={size} level="M" marginSize={2} />
        {qr.isDemo ? (
          <span aria-hidden className="pay-demo-band">
            DEMO – KHÔNG CHUYỂN TIỀN
          </span>
        ) : null}
      </div>
    )
  }
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

function sessionStatusMeta(status: SessionBills["status"]): { label: string; cls: string } {
  if (status === "PAID") return { label: "Đã thanh toán", cls: "pay-pill pay-p-free" }
  if (status === "CLOSED_UNPAID") return { label: "Đã trả bàn · chưa thu", cls: "pay-pill pay-p-unpaid" }
  if (status === "AWAITING_PAYMENT") return { label: "Chờ thanh toán", cls: "pay-pill pay-p-pend" }
  return { label: "Đang phục vụ", cls: "pay-pill pay-p-open" }
}

function billStatusMeta(bill: PayBill): { label: string; cls: string; isPaid: boolean } {
  const isPaid = bill.billStatus === "PAID" || bill.status === "PAID"
  return isPaid
    ? { label: "Đã thu", cls: "pay-pill pay-p-open", isPaid: true }
    : { label: "Chưa thu", cls: "pay-pill pay-p-pend", isPaid: false }
}

export function WaiterBillLinesCard({
  title,
  subtitle,
  statusPill,
  isCluster,
  tableCount,
  lines,
  subtotalVnd,
  vatVnd,
  preRoundVnd,
  roundingVnd,
  dueVnd,
  emptyTitle = "Chưa có món mới nào chưa xuất hóa đơn",
  emptySubtitle = "Khách gọi thêm món sẽ hiển thị tại đây.",
}: {
  title: string
  subtitle: string
  statusPill: { label: string; cls: string }
  isCluster: boolean
  tableCount: number
  lines: readonly PayLine[]
  subtotalVnd: number
  vatVnd: number
  preRoundVnd: number
  roundingVnd: number
  dueVnd: number
  emptyTitle?: string
  emptySubtitle?: string
}) {
  const lineCounts = useMemo(() => countActiveLines(lines), [lines])
  const rounds = useMemo(() => groupActiveRounds(lines), [lines])

  return (
    <section aria-label="Chi tiết bill" className="pay-pane-bill pay-card">
      <div className="pay-bill-h">
        <div className="pay-bill-h-t">
          <b>{title}</b>
          <span>{subtitle}</span>
        </div>
        {isCluster ? <span className="pay-chip-cl">{`Cụm ${tableCount} bàn · 1 phiên`}</span> : null}
        <span className={statusPill.cls}>{statusPill.label}</span>
      </div>

      <div className="pay-rounds">
        {rounds.length === 0 ? (
          <div className="border-b border-border px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            <b className="mb-1 block text-foreground">{emptyTitle}</b>
            <span>{emptySubtitle}</span>
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
          <dd>{formatVnd(subtotalVnd)}</dd>
        </div>
        <div>
          <dt>VAT 10%</dt>
          <dd>{formatVnd(vatVnd)}</dd>
        </div>
        <div className="pay-na">
          <dt>
            Phí phục vụ · phụ thu <span className="pay-tag">Đang phát triển</span>
          </dt>
          <dd>0đ</dd>
        </div>
        <div>
          <dt>Tổng trước làm tròn</dt>
          <dd>{formatVnd(preRoundVnd)}</dd>
        </div>
        <div>
          <dt>Làm tròn lên nghìn (bước cuối)</dt>
          <dd>{`${roundingVnd > 0 ? "+" : ""}${formatVnd(roundingVnd)}`}</dd>
        </div>
        <div className="pay-tot">
          <dt>Số tiền phải trả</dt>
          <dd>{formatVnd(dueVnd)}</dd>
        </div>
      </dl>
    </section>
  )
}

function InvoiceQrSection({
  bill,
  compact = false,
  onCopyRef,
}: {
  bill: PayBill
  compact?: boolean
  onCopyRef: (refText: string) => void
}) {
  const qrRef = bill.qr?.transferNote ?? `21GAM ${bill.billCode}`
  if (compact) {
    return (
      <>
        <W2DemoQrBox qr={bill.qr} size={72} label="Mã QR thanh toán hóa đơn, bản in 80mm" />
        <div className="c">{`Ngân hàng: ${BANK_RECEIVING_NAME}`}</div>
        <div className="c">{`ND: ${qrRef}`}</div>
      </>
    )
  }

  return (
    <div className="pay-w2-inv-qr">
      <W2DemoQrBox qr={bill.qr} label="Mã QR thanh toán hóa đơn" />
      <div className="grid gap-2">
        <b>{`Quét để chuyển khoản đúng ${formatVnd(bill.dueVnd)}`}</b>
        <dl className="pay-w2-inv-bank" aria-label="Thông tin chuyển khoản">
          <div>
            <dt>Ngân hàng</dt>
            <dd>{BANK_RECEIVING_NAME}</dd>
          </div>
          <div>
            <dt>Mã bill</dt>
            <dd className="tnum">{bill.billCode}</dd>
          </div>
          <div>
            <dt>Số tiền</dt>
            <dd className="tnum">{formatVnd(bill.dueVnd)}</dd>
          </div>
          <div>
            <dt>Nội dung</dt>
            <dd>
              <span>{qrRef}</span>
              <button
                type="button"
                className="pay-copy"
                aria-label="Chép nội dung chuyển khoản"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(qrRef)
                  } catch {
                    /* clipboard optional */
                  }
                  onCopyRef(qrRef)
                }}
              >
                <Copy className="pay-i sm" aria-hidden />
                Chép
              </button>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export function WaiterPreviewView({
  preview,
  sessionStatus,
  canIssue,
  busy,
  viewMode,
  onIssueInvoice,
  onSimulatedPrint,
  onCopyRef,
}: {
  preview: PreviewBill
  sessionStatus: SessionBills["status"]
  canIssue: boolean
  busy: boolean
  viewMode: "screen" | "print"
  onIssueInvoice: () => void
  onSimulatedPrint: (count: number) => void
  onCopyRef?: (refText: string) => void
}) {
  const [prints, setPrints] = useState(0)
  const rounds = useMemo(() => groupActiveRounds(preview.lines), [preview.lines])
  const activeLines = useMemo(() => rounds.flatMap((r) => r.items), [rounds])
  const place = preview.clusterCode ? `${preview.code} (${preview.tables.join(", ")})` : preview.code
  const previewAsBill = useMemo(() => previewToBillDisplay(preview, sessionStatus), [preview, sessionStatus])

  const handlePrint = () => {
    const next = prints + 1
    setPrints(next)
    onSimulatedPrint(next)
  }

  return (
    <div className="pay-waiter">
      <div role="note" className="pay-w2-prov-banner">
        <span>
          <b>{PROVISIONAL_LABEL}</b>
          {" · Phiên vẫn đang phục vụ, khách vẫn gọi thêm món được."}
        </span>
      </div>

      <div className="pay-pv">
        {viewMode === "screen" ? (
          <article aria-label={PROVISIONAL_LABEL} className="pay-rcpt">
            <div className="pay-r-top">
              <div>
                <div className="pay-r-logo">21GAM</div>
                <span className="pay-val-ph text-xs">[Địa chỉ, số điện thoại quán · chờ cung cấp]</span>
              </div>
              <span className="pay-w2-badge-prov">{PROVISIONAL_LABEL}</span>
            </div>

            <dl className="pay-r-meta">
              <div>
                <dt>Phiên</dt>
                <dd>{preview.sessionCode}</dd>
              </div>
              <div>
                <dt>Bàn</dt>
                <dd>{place}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>Đang phục vụ · gọi thêm được</dd>
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
                <dd>{formatVnd(preview.subtotalVnd)}</dd>
              </div>
              <div>
                <dt>VAT 10%</dt>
                <dd>{formatVnd(preview.vatVnd)}</dd>
              </div>
              <div className="pay-na">
                <dt>
                  Phí phục vụ · phụ thu <span className="pay-tag">Đang phát triển</span>
                </dt>
                <dd>0đ</dd>
              </div>
              <div>
                <dt>Làm tròn</dt>
                <dd>{`${preview.roundingVnd > 0 ? "+" : ""}${formatVnd(preview.roundingVnd)}`}</dd>
              </div>
            </dl>

            <div className="pay-r-due">
              <span>TẠM TÍNH</span>
              <b>{formatVnd(preview.dueVnd)}</b>
            </div>

            {PREVIEW_HAS_QR ? (
              <InvoiceQrSection bill={previewAsBill} onCopyRef={onCopyRef ?? (() => undefined)} />
            ) : null}

            <p className="pay-r-foot">
              {`${PROVISIONAL_LABEL}. Không đổi trạng thái bàn; món mới gọi thêm sẽ cộng tiếp.`}
            </p>
          </article>
        ) : (
          <article aria-label="Bản in tạm tính khổ 80mm" className="pay-r80">
            <div className="c big">21GAM</div>
            <div className="c">{PROVISIONAL_LABEL.toUpperCase()}</div>
            <div className="hr" />
            <div className="row">
              <span>{`Phiên ${preview.sessionCode}`}</span>
              <span>{`Bàn ${place}`}</span>
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
              <span>{formatVnd(preview.subtotalVnd)}</span>
            </div>
            <div className="row">
              <span>VAT 10%</span>
              <span>{formatVnd(preview.vatVnd)}</span>
            </div>
            <div className="row">
              <span>Phí PV · phụ thu</span>
              <span>0đ</span>
            </div>
            <div className="row">
              <span>Làm tròn</span>
              <span>{`${preview.roundingVnd > 0 ? "+" : ""}${formatVnd(preview.roundingVnd)}`}</span>
            </div>
            <div className="row big">
              <span>TẠM TÍNH</span>
              <span>{formatVnd(preview.dueVnd)}</span>
            </div>
            {PREVIEW_HAS_QR ? (
              <>
                <div className="hr" />
                <InvoiceQrSection bill={previewAsBill} compact onCopyRef={onCopyRef ?? (() => undefined)} />
              </>
            ) : null}
            <div className="hr" />
            <div className="c">{PROVISIONAL_LABEL}</div>
          </article>
        )}

        <aside className="pay-pv-side">
          <div className="pay-card">
            <div className="pay-act">
              <div className="pay-due-b">
                <span className="pay-due-l">Tạm tính hiện tại</span>
                <b className="pay-due">{formatVnd(preview.dueVnd)}</b>
                <span className="pay-due-s">
                  {prints ? `Đã in tạm ${prints} lần (mô phỏng)` : "Chưa xuất hóa đơn · bàn vẫn gọi thêm được"}
                </span>
              </div>

              <button type="button" onClick={handlePrint} className="pay-btn pay-btn-s pay-btn-lg pay-btn-w">
                <Printer className="pay-i" aria-hidden />
                In tạm tính
                <span className="pay-tag">mô phỏng</span>
              </button>

              <button
                type="button"
                disabled={!canIssue || busy || activeLines.length === 0}
                onClick={onIssueInvoice}
                className="pay-btn pay-btn-p pay-btn-xl pay-btn-w"
              >
                <FileCheck2 className="pay-i" aria-hidden />
                {busy ? "Đang xuất hóa đơn…" : "Xuất hóa đơn"}
              </button>

              <p className="pay-hint">
                <Info className="pay-i sm" aria-hidden />
                <span>Xuất hóa đơn sẽ chốt danh sách món hiện tại và tạo mã QR chuyển khoản đưa khách.</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export function WaiterInvoiceView({
  bill,
  viewMode,
  onSimulatedPrint,
  onCopyRef,
  onBackToDetail,
}: {
  bill: PayBill
  viewMode: "screen" | "print"
  onSimulatedPrint: (count: number) => void
  onCopyRef: (refText: string) => void
  onBackToDetail: () => void
}) {
  const [prints, setPrints] = useState(0)
  const rounds = useMemo(() => groupActiveRounds(bill.lines), [bill.lines])
  const activeLines = useMemo(() => rounds.flatMap((r) => r.items), [rounds])
  const place = bill.clusterCode ? `${bill.code} (${bill.tables.join(", ")})` : bill.code
  const issuedTime = bill.issuedAt ?? bill.pendingAt ?? "—"
  const issuer = bill.issuedBy ?? bill.waiterName
  const bStatus = billStatusMeta(bill)

  const handlePrint = () => {
    const next = prints + 1
    setPrints(next)
    onSimulatedPrint(next)
  }

  return (
    <div className="pay-waiter">
      <div className="pay-pv">
        {viewMode === "screen" ? (
          <article aria-label={`Hóa đơn ${bill.billCode}`} className="pay-rcpt">
            <div className="pay-r-top">
              <div>
                <div className="pay-r-logo">21GAM</div>
                <span className="pay-val-ph text-xs">[Địa chỉ, số điện thoại quán · chờ cung cấp]</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="pay-w2-badge-inv">HÓA ĐƠN</span>
                <span className={bStatus.cls}>{bStatus.label}</span>
              </div>
            </div>

            <dl className="pay-r-meta">
              <div>
                <dt>Mã hóa đơn</dt>
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
                <dt>Xuất hóa đơn lúc</dt>
                <dd>{issuedTime}</dd>
              </div>
              <div>
                <dt>Người xuất</dt>
                <dd>{issuer}</dd>
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
                <dt>{bill.vatLabel ?? "VAT 10%"}</dt>
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
              <span>{bStatus.isPaid ? "ĐÃ THANH TOÁN" : "KHÁCH CẦN TRẢ"}</span>
              <b>{formatVnd(bill.dueVnd)}</b>
            </div>

            {bStatus.isPaid ? (
              <div role="status" className="pay-bn pay-bn-closed">
                <Check className="pay-i" aria-hidden />
                <span>
                  <b>Hóa đơn đã thu tiền</b>
                  {`Thu ngân xác nhận${bill.paidBy ? ` · ${bill.paidBy}` : ""}${bill.paidAt ? ` lúc ${bill.paidAt}` : ""}.`}
                </span>
              </div>
            ) : (
              <InvoiceQrSection bill={bill} onCopyRef={onCopyRef} />
            )}

            <p className="pay-r-foot">
              {bStatus.isPaid
                ? "Hóa đơn đã hoàn tất thanh toán. Món đã hủy không tính."
                : "Đưa hóa đơn này cho khách thanh toán. Thu ngân sẽ xác nhận tiền về."}
            </p>
          </article>
        ) : (
          <article aria-label="Bản in hóa đơn khổ 80mm" className="pay-r80">
            <div className="c big">21GAM</div>
            <div className="c">HÓA ĐƠN THANH TOÁN</div>
            <div className="hr" />
            <div className="row">
              <span>{`HĐ ${bill.billCode}`}</span>
              <span>{bill.sessionCode}</span>
            </div>
            <div className="row">
              <span>{`Bàn ${place}`}</span>
              <span>{issuedTime}</span>
            </div>
            <div className="row">
              <span>{`Xuất: ${issuer}`}</span>
              <span>{bStatus.label}</span>
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
              <span>{bill.vatLabel ?? "VAT 10%"}</span>
              <span>{formatVnd(bill.vatVnd)}</span>
            </div>
            <div className="row">
              <span>Phí PV · phụ thu</span>
              <span>0đ</span>
            </div>
            <div className="row">
              <span>Làm tròn</span>
              <span>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</span>
            </div>
            <div className="row big">
              <span>{bStatus.isPaid ? "ĐÃ THU" : "CẦN TRẢ"}</span>
              <span>{formatVnd(bill.dueVnd)}</span>
            </div>
            {!bStatus.isPaid ? (
              <>
                <div className="hr" />
                <InvoiceQrSection bill={bill} compact onCopyRef={onCopyRef} />
              </>
            ) : null}
            <div className="hr" />
            <div className="c">{bStatus.isPaid ? "Hóa đơn đã thu tiền" : "Hóa đơn thanh toán"}</div>
          </article>
        )}

        <aside className="pay-pv-side">
          <div className="pay-card">
            <div className="pay-act">
              <div className="pay-due-b">
                <span className="pay-due-l">{bStatus.isPaid ? "Đã thu hóa đơn" : "Số tiền hóa đơn"}</span>
                <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
                <span className="pay-due-s">
                  {prints
                    ? `Đã in hóa đơn ${prints} lần (mô phỏng)`
                    : `Hóa đơn ${bill.billCode} · ${bStatus.label}`}
                </span>
              </div>

              <button type="button" onClick={handlePrint} className="pay-btn pay-btn-p pay-btn-lg pay-btn-w">
                <Printer className="pay-i" aria-hidden />
                In hóa đơn
                <span className="pay-tag">mô phỏng</span>
              </button>

              <button type="button" onClick={onBackToDetail} className="pay-btn pay-btn-s pay-btn-lg pay-btn-w">
                <ChevronLeft className="pay-i" aria-hidden />
                Quay lại chi tiết phiên
              </button>

              <p className="pay-hint">
                <Info className="pay-i sm" aria-hidden />
                <span>Thu ngân là người xác nhận thu tiền. Phục vụ và Bartender không ghi nhận tiền mặt/chuyển khoản.</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export function WaiterSessionDetailView({
  sessionBills,
  preview,
  busy,
  onPreview,
  onIssueInvoice,
  onOpenInvoice,
}: {
  sessionBills: SessionBills
  preview: PreviewBill | undefined
  busy: boolean
  onPreview: () => void
  onIssueInvoice: () => void
  onOpenInvoice: (billCode: string) => void
}) {
  const isCluster = Boolean(sessionBills.clusterCode && sessionBills.tables.length > 1)
  const canIssue = canIssueNewInvoice(sessionBills)
  const hasBills = sessionBills.bills.length > 0
  const hasUnbilled = sessionBills.unbilledLineCount > 0 && Boolean(preview && preview.lines.length > 0)
  const latestBill = sessionBills.bills[sessionBills.bills.length - 1]
  const displaySource = hasUnbilled && preview ? preview : latestBill
  const dueVnd = displaySource?.dueVnd ?? 0
  const preRoundVnd = displaySource?.preRoundVnd ?? 0
  const roundingVnd = displaySource?.roundingVnd ?? 0
  const statusMeta = sessionStatusMeta(sessionBills.status)

  const dueLabel = hasUnbilled
    ? hasBills
      ? "Món mới chưa xuất hóa đơn"
      : "Tạm tính hiện tại"
    : latestBill
      ? `Hóa đơn gần nhất · ${latestBill.billCode}`
      : "Khách cần trả"

  const dueSub =
    displaySource && roundingVnd > 0
      ? `Đã làm tròn lên từ ${formatVnd(preRoundVnd)}`
      : displaySource
        ? "Không cần làm tròn"
        : "Chưa có dữ liệu món"

  const cardTitle = hasUnbilled
    ? hasBills
      ? `${sessionBills.code} · Món mới (${sessionBills.unbilledLineCount} món)`
      : sessionBills.code
    : latestBill
      ? `${sessionBills.code} · ${latestBill.billCode}`
      : sessionBills.code

  const cardSubtitle = hasUnbilled
    ? `${sessionBills.sessionCode} · chưa xuất hóa đơn · gọi thêm vẫn được`
    : latestBill
      ? `${sessionBills.sessionCode} · đã xuất lúc ${latestBill.issuedAt ?? latestBill.pendingAt ?? "—"}`
      : `${sessionBills.sessionCode} · chưa có món`

  return (
    <div className="pay-waiter">
      <div className="pay-split detail">
        <WaiterBillLinesCard
          title={cardTitle}
          subtitle={cardSubtitle}
          statusPill={statusMeta}
          isCluster={isCluster}
          tableCount={sessionBills.tables.length}
          lines={displaySource?.lines ?? []}
          subtotalVnd={displaySource?.subtotalVnd ?? 0}
          vatVnd={displaySource?.vatVnd ?? 0}
          preRoundVnd={preRoundVnd}
          roundingVnd={roundingVnd}
          dueVnd={dueVnd}
          emptyTitle={hasBills ? "Chưa có món mới kể từ hóa đơn gần nhất" : "Chưa có món nào trong phiên này"}
          emptySubtitle={
            hasBills
              ? "Khách gọi thêm món mới sẽ tạo hóa đơn tiếp theo mà không sửa hóa đơn cũ."
              : "Lên đơn cho bàn trước khi xem tạm tính hoặc xuất hóa đơn."
          }
        />

        <section aria-label="Thao tác hóa đơn" className="pay-pane-act pay-card">
          <div className="pay-act">
            <div className="pay-due-b">
              <span className="pay-due-l">{dueLabel}</span>
              <b className="pay-due">{formatVnd(dueVnd)}</b>
              <span className="pay-due-s">{dueSub}</span>
            </div>

            {hasBills ? (
              <div className="pay-w2-bills" aria-label="Danh sách hóa đơn đã xuất trong phiên">
                <p className="text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  {`Hóa đơn đã xuất (${sessionBills.bills.length})`}
                </p>
                {sessionBills.bills.map((bill) => {
                  const meta = billStatusMeta(bill)
                  const issuedInfo = [
                    bill.issuedBy ? `Đã đưa hóa đơn · ${bill.issuedBy}` : "Đã xuất hóa đơn",
                    bill.issuedAt ?? bill.pendingAt,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                  return (
                    <div key={bill.billCode} className={cn("pay-w2-bill-row", !meta.isPaid && "unpaid")}>
                      <div className="pay-w2-bill-meta">
                        <div className="pay-w2-bill-title">
                          <b>{bill.billCode}</b>
                          <span className={meta.cls}>{meta.label}</span>
                        </div>
                        <span className="pay-w2-bill-sub">{issuedInfo}</span>
                      </div>
                      <div className="pay-w2-bill-right">
                        <span className="pay-w2-bill-due">{formatVnd(bill.dueVnd)}</span>
                        <button
                          type="button"
                          onClick={() => onOpenInvoice(bill.billCode)}
                          className="pay-btn pay-btn-s"
                        >
                          <QrCode className="pay-i sm" aria-hidden />
                          {meta.isPaid ? "Xem hóa đơn" : "Xem hóa đơn & QR"}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className="pay-act-btns">
              <button
                type="button"
                disabled={busy || !hasUnbilled || sessionBills.status === "CLOSED_UNPAID"}
                onClick={onPreview}
                className="pay-btn pay-btn-s pay-btn-lg"
              >
                <ReceiptText className="pay-i" aria-hidden />
                Xem tạm tính
              </button>

              <button
                type="button"
                disabled={busy || !canIssue || !hasUnbilled}
                onClick={onIssueInvoice}
                className="pay-btn pay-btn-p pay-btn-xl"
              >
                <FileCheck2 className="pay-i" aria-hidden />
                {busy
                  ? "Đang xuất hóa đơn…"
                  : hasBills
                    ? "Xuất hóa đơn cho món mới"
                    : "Xuất hóa đơn"}
              </button>
            </div>

            {hasBills && !hasUnbilled ? (
              <p className="pay-hint">
                <Info className="pay-i sm" aria-hidden />
                <span>Chưa có món mới để xuất thêm hóa đơn. Mở hóa đơn ở trên để đưa mã QR cho khách.</span>
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

export interface WaiterInvoiceWorkspaceProps {
  visitId: string
  view: WaiterBillView
  billCode?: string | null
  backLabel: string
  onBack: () => void
  onNavigateView: (view: WaiterBillView, billCode?: string) => void
  api?: PaymentApi
  embedded?: boolean
  barOnly?: boolean
  onNotify?: (kind: "success" | "info" | "error", text: string) => void
}

export function WaiterInvoiceWorkspace({
  visitId,
  view,
  billCode,
  backLabel,
  onBack,
  onNavigateView,
  api = paymentApi,
  embedded = false,
  barOnly = false,
  onNotify = notifyViaSonner,
}: WaiterInvoiceWorkspaceProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<"screen" | "print">("screen")
  const [issuedOverride, setIssuedOverride] = useState<PayBill | null>(null)
  const inFlightRef = useRef(false)
  const idempotencyKeyRef = useRef<IssueIdempotencySlot | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [prevKey, setPrevKey] = useState(`${visitId}:${view}:${billCode ?? ""}`)
  const currentKey = `${visitId}:${view}:${billCode ?? ""}`
  if (prevKey !== currentKey) {
    setPrevKey(currentKey)
    if (view === "preview" || view === "invoice") setViewMode("screen")
    if (view !== "invoice") setIssuedOverride(null)
  }

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.scrollTop = 0
  }, [visitId, view])

  const sessionBillsQuery = useQuery({
    queryKey: ["payment-session-bills", visitId],
    queryFn: () => api.getSessionBills(visitId),
    enabled: Boolean(visitId),
  })
  const catalogQuery = useWaiterCatalogQuery(barOnly)

  const sessionBills = sessionBillsQuery.data
  const waitingBarCatalog = barOnly && catalogQuery.isLoading
  const outOfBarScope = Boolean(
    barOnly && !waitingBarCatalog && sessionBills && !isBarGuestSession(sessionBills, catalogQuery.data?.tables),
  )
  const shouldFetchPreview =
    Boolean(visitId) &&
    !waitingBarCatalog &&
    !outOfBarScope &&
    (view === "preview" || (sessionBills ? sessionBills.unbilledLineCount > 0 : false))

  const previewQuery = useQuery({
    queryKey: ["payment-preview-bill", visitId],
    queryFn: () => api.previewBill(visitId),
    enabled: shouldFetchPreview,
  })

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment-session-bills", visitId] }),
      queryClient.invalidateQueries({ queryKey: ["payment-preview-bill", visitId] }),
      queryClient.invalidateQueries({ queryKey: ["payment-open"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-bill", visitId] }),
      queryClient.invalidateQueries({ queryKey: ["payment-notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["floor"] }),
      queryClient.invalidateQueries({ queryKey: ["waiter-floor"] }),
    ])
  }, [queryClient, visitId])

  const handleOpenPreview = () => {
    if (busy) return
    onNavigateView("preview")
  }

  const handleIssueInvoice = async () => {
    if (!sessionBills) return
    await submitIssueInvoice({
      api,
      visitId: sessionBills.visitId,
      version: sessionBills.version,
      busy,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      invalidate: invalidateAll,
      onNotify,
      onIssued: (issued) => {
        setIssuedOverride(issued)
        onNavigateView("invoice", issued.billCode)
      },
    })
  }

  const activeInvoice = useMemo(() => {
    if (issuedOverride && (!billCode || issuedOverride.billCode === billCode)) {
      return issuedOverride
    }
    return selectInvoiceBill(sessionBills, billCode)
  }, [billCode, issuedOverride, sessionBills])

  const handleHeaderBack = () => {
    if (busy) return
    if (view === "preview" || view === "invoice") {
      onNavigateView("detail")
    } else {
      onBack()
    }
  }

  const headerBackLabel = view === "detail" ? backLabel : "Chi tiết Phiên"
  const pageHeading =
    view === "detail" ? "Chi tiết Phiên" : view === "preview" ? "Xem tạm tính" : "Hóa đơn"

  const body = (
    <>
      <div className="pay-ph">
        <button type="button" disabled={busy} onClick={handleHeaderBack} className="pay-back">
          <ChevronLeft className="pay-i" aria-hidden />
          {headerBackLabel}
        </button>
        <div className="pay-ph-grow">
          <h1>{pageHeading}</h1>
        </div>
        {view === "preview" || view === "invoice" ? (
          <div role="group" aria-label="Cách xem" className="pay-seg ml-auto">
            <button type="button" aria-pressed={viewMode === "screen"} onClick={() => setViewMode("screen")}>
              Trên màn hình
            </button>
            <button type="button" aria-pressed={viewMode === "print"} onClick={() => setViewMode("print")}>
              Bản in 80mm
            </button>
          </div>
        ) : null}
      </div>

      {sessionBillsQuery.isPending || waitingBarCatalog ? (
        <div className="pay-split" aria-busy="true">
          <div className="pay-card pay-sk-stack">
            <div className="pay-sk" style={{ height: 28, width: "45%" }} />
            <div className="pay-sk" style={{ height: 56 }} />
            <div className="pay-sk" style={{ height: 56 }} />
          </div>
          <div className="pay-card pay-sk-stack">
            <div className="pay-sk" style={{ height: 48, width: "65%" }} />
            <div className="pay-sk" style={{ height: 52 }} />
            <span className="pay-hint">
              <span className="pay-spin" aria-hidden />
              Đang tải thông tin hóa đơn phiên…
            </span>
          </div>
        </div>
      ) : sessionBillsQuery.isError ? (
        <div role="alert" className="pay-bn pay-bn-err">
          <AlertTriangle className="pay-i" aria-hidden />
          <span>
            <b>Không tải được thông tin hóa đơn</b>
            {toWaiterErrorMessage(sessionBillsQuery.error, "Vui lòng thử lại.")}
            <span className="pay-bn-act">
              <button type="button" onClick={() => void sessionBillsQuery.refetch()} className="pay-btn pay-btn-s">
                Thử lại
              </button>
              <button type="button" onClick={onBack} className="pay-btn pay-btn-s">
                {backLabel}
              </button>
            </span>
          </span>
        </div>
      ) : outOfBarScope ? (
        <div role="alert" className="pay-bn pay-bn-err">
          <AlertTriangle className="pay-i" aria-hidden />
          <span>
            <b>Bàn ngoài quầy bar - Bartender không xuất hóa đơn</b>
            Vui lòng chuyển cho Phục vụ hoặc Thu ngân xử lý hóa đơn của bàn này.
            <span className="pay-bn-act">
              <button type="button" onClick={onBack} className="pay-btn pay-btn-s">
                {backLabel}
              </button>
            </span>
          </span>
        </div>
      ) : view === "preview" ? (
        previewQuery.isPending ? (
          <div className="pay-card pay-sk-stack" aria-busy="true">
            <div className="pay-sk" style={{ height: 32, width: "50%" }} />
            <div className="pay-sk" style={{ height: 180 }} />
          </div>
        ) : previewQuery.isError || !previewQuery.data ? (
          <div role="alert" className="pay-bn pay-bn-err">
            <AlertTriangle className="pay-i" aria-hidden />
            <span>
              <b>Không tải được bản tạm tính</b>
              {toWaiterErrorMessage(previewQuery.error, "Không có dữ liệu tạm tính.")}
              <span className="pay-bn-act">
                <button type="button" onClick={() => onNavigateView("detail")} className="pay-btn pay-btn-s">
                  Quay lại
                </button>
              </span>
            </span>
          </div>
        ) : (
          <WaiterPreviewView
            preview={previewQuery.data}
            sessionStatus={sessionBills?.status ?? "SERVING"}
            canIssue={canIssueNewInvoice(sessionBills)}
            busy={busy}
            viewMode={viewMode}
            onIssueInvoice={() => void handleIssueInvoice()}
            onSimulatedPrint={(n) => onNotify("info", `Mô phỏng: chưa nối máy in thật. Tạm tính lần #${n}.`)}
            onCopyRef={(refText) => onNotify("success", `Đã chép nội dung: ${refText}`)}
          />
        )
      ) : view === "invoice" ? (
        activeInvoice ? (
          <WaiterInvoiceView
            bill={activeInvoice}
            viewMode={viewMode}
            onSimulatedPrint={(n) => onNotify("info", `Mô phỏng: chưa nối máy in thật. Đã in hóa đơn lần #${n}.`)}
            onCopyRef={(refText) => onNotify("success", `Đã chép nội dung: ${refText}`)}
            onBackToDetail={() => onNavigateView("detail")}
          />
        ) : (
          <div role="status" className="pay-bn pay-bn-closed">
            <Info className="pay-i" aria-hidden />
            <span>
              <b>Phiên chưa có hóa đơn nào được xuất</b>
              Hãy xem tạm tính hoặc bấm Xuất hóa đơn để tạo hóa đơn kèm mã QR.
              <span className="pay-bn-act">
                <button type="button" onClick={() => onNavigateView("detail")} className="pay-btn pay-btn-s">
                  Quay lại chi tiết phiên
                </button>
              </span>
            </span>
          </div>
        )
      ) : sessionBills ? (
        <WaiterSessionDetailView
          sessionBills={sessionBills}
          preview={previewQuery.data}
          busy={busy}
          onPreview={handleOpenPreview}
          onIssueInvoice={() => void handleIssueInvoice()}
          onOpenInvoice={(code) => onNavigateView("invoice", code)}
        />
      ) : null}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={cn("pay-root", !embedded && "h-full overflow-y-auto")}
      data-testid="waiter-invoice-workspace"
    >
      <div className={embedded ? "grid gap-4" : "pay-pg"}>{body}</div>
    </div>
  )
}
