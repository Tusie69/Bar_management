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
  if (status === "PAID") return { label: "Đã thanh toán", cls: "bg-[var(--st-free-tint)] text-[var(--text-muted)]" }
  if (status === "CLOSED_UNPAID") {
    return { label: "Đã trả bàn · chưa thu", cls: "bg-[var(--destructive-tint)] text-[var(--destructive-ink)]" }
  }
  if (status === "AWAITING_PAYMENT") {
    return { label: "Chờ thanh toán", cls: "bg-[var(--st-pending-tint)] text-[var(--st-pending-ink)]" }
  }
  return { label: "Đang phục vụ", cls: "bg-[var(--st-seated-tint)] text-[var(--st-seated-ink)]" }
}

export function DemoQrBox({ size = "md", label }: { size?: "sm" | "md" | "xs"; label: string }) {
  const cells = useMemo(() => buildDemoQrGrid(), [])
  const boxCls = size === "sm" ? "w-[132px] p-2 rounded-[10px]" : size === "xs" ? "w-[120px] p-1.5 rounded-none" : "pay-qr-box w-[min(280px,100%)] p-3.5 rounded-[10px]"
  const bandCls = size === "xs" ? "text-[8px] py-[3px] border" : size === "sm" ? "text-[9px] py-1 border" : "text-[11px] py-1 border"

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative overflow-hidden border border-border bg-white", boxCls)}
    >
      <div
        aria-hidden
        className="grid aspect-square"
        style={{ gridTemplateColumns: "repeat(29, minmax(0, 1fr))" }}
      >
        {cells.map((on, i) => (
          <span key={i} className={cn("block", on ? "bg-[#111]" : "bg-transparent")} />
        ))}
      </div>
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 -right-[20%] -left-[20%] -translate-y-1/2 -rotate-14 border-[#111] bg-[#ffd23f] text-center font-extrabold tracking-[0.06em] text-[#111]",
          bandCls,
        )}
      >
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
    <section
      aria-label="Chi tiết bill"
      className="pay-pane-bill min-w-0 rounded-2xl border border-border bg-surface-1 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border p-4">
        <div className="grid min-w-[200px] flex-1 gap-0.5">
          <b className="text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink-strong)]">{bill.code}</b>
          <span className="text-[13px] text-[var(--text-muted)]">
            {`${bill.sessionCode} · mở ${bill.openedAt} · ${rounds.length} đơn · ${bill.guests} khách · Khách lẻ`}
          </span>
        </div>
        {isCluster ? (
          <span className="inline-flex h-[22px] items-center rounded-full bg-[var(--cluster)] px-2 text-[11px] font-bold text-white dark:text-[oklch(0.2_0.02_245)]">
            {`Cụm ${bill.tables.length} bàn · 1 bill`}
          </span>
        ) : null}
        <span className={cn("inline-flex h-6 items-center rounded-[6px] px-2 text-xs font-semibold whitespace-nowrap", pill.cls)}>
          {pill.label}
        </span>
        {collapsible && onToggleExpanded ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary-ink cursor-pointer hover:bg-primary-tint lg:hidden"
          >
            {expanded ? "Ẩn món" : `Xem ${lineCounts.itemCount} món`}
          </button>
        ) : null}
      </div>

      <div className="pay-rounds grid">
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
          <div key={r.orderRound} className="border-b border-border px-4 pt-1 pb-2">
            <div className="flex justify-between gap-2 pt-2.5 pb-1 text-xs font-semibold tracking-[0.02em] text-[var(--text-subtle)] uppercase">
              <span>{r.label}</span>
              <span className="font-normal tracking-normal normal-case">{r.meta}</span>
            </div>
            <ul>
              {r.items.map((it, idx) => (
                <li
                  key={`${r.orderRound}-${it.name}-${idx}`}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-border-subtle py-2.5 first:border-t-0"
                >
                  <span className="row-span-2 tnum font-semibold">{`${it.qty}×`}</span>
                  <span className="min-w-0 font-medium">{it.name}</span>
                  <span className="tnum text-right font-semibold">{formatVnd(it.lineTotalVnd)}</span>
                  <span className="col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)]">
                    <span>{`${it.unit} · ${formatVnd(it.unitPriceVnd)}`}</span>
                    <span
                      className={cn(
                        "inline-flex h-5 items-center rounded-[6px] px-1.5 text-[11px] font-semibold",
                        it.state === "MAKING"
                          ? "bg-[var(--st-pending-tint)] text-[var(--st-pending-ink)]"
                          : "bg-[var(--st-seated-tint)] text-[var(--st-seated-ink)]",
                      )}
                    >
                      {it.state === "MAKING" ? "Đang làm" : "Đã ra"}
                    </span>
                    {it.note ? <span className="italic">{`Ghi chú: ${it.note}`}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          ))
        )}
      </div>

      <dl className="grid gap-2 rounded-b-2xl bg-surface-2 px-4 pt-3.5 pb-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--text-muted)]">{`Tổng tiền món (${lineCounts.itemCount} món)`}</dt>
          <dd className="tnum text-right font-medium">{formatVnd(bill.subtotalVnd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--text-muted)]">
            {vatLabel}{" "}
            <span className="ml-1 inline-flex h-5 items-center rounded-[6px] bg-[var(--st-pending-tint)] px-1.5 text-[11px] font-semibold text-[var(--st-pending-ink)]">
              {vatNote}
            </span>
          </dt>
          <dd className="tnum text-right font-medium">{formatVnd(bill.vatVnd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--text-muted)]">Phí phục vụ · phụ thu · giảm giá</dt>
          <dd className="text-right text-[13px] font-normal text-[var(--text-subtle)]">Chưa áp dụng · chờ BA chốt</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--text-muted)]">Tổng trước làm tròn</dt>
          <dd className="tnum text-right font-medium">{formatVnd(bill.preRoundVnd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--text-muted)]">Làm tròn lên nghìn (bước cuối)</dt>
          <dd className="tnum text-right font-medium">
            {`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}
          </dd>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border-strong pt-2.5">
          <dt className="font-semibold text-foreground">Số tiền phải trả</dt>
          <dd className="tnum text-right text-lg font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
            {formatVnd(bill.dueVnd)}
          </dd>
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
    <section
      aria-label="Thanh toán"
      className="pay-pane-act min-w-0 rounded-2xl border border-border bg-surface-1 p-5 shadow-xs"
    >
      <div className="grid gap-5">
        <div className="grid gap-1">
          <span className="text-xs font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
            Khách cần trả
          </span>
          <b className="tnum text-[clamp(36px,4.4cqi,52px)] leading-none font-extrabold tracking-[-0.04em] text-[var(--ink-strong)]">
            {formatVnd(bill.dueVnd)}
          </b>
          <span className="text-[13px] text-[var(--text-muted)]">{dueSub}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <span>{statusNote}</span>
        </div>

        {makingCount > 0 ? (
          <p className="-mt-2 flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{`${makingCount} món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.`}</span>
          </p>
        ) : null}

        <div className="grid gap-2.5">
          <button
            type="button"
            disabled={busy || !hasLines || isClosedUnpaid}
            onClick={onPreview}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-5 text-[15px] font-medium cursor-pointer transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ReceiptText className="size-5" aria-hidden />
            Xem tạm tính
          </button>

          {canCollect ? (
            <button
              type="button"
              disabled={isClosed || busy || !hasLines}
              onClick={onCollect}
              className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[17px] font-bold text-primary-foreground cursor-pointer transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)]"
            >
              Chốt bill &amp; thu tiền
              <ChevronRight className="size-5" aria-hidden />
            </button>
          ) : null}

          {!canCollect && isWaiter ? (
            <button
              type="button"
              disabled={requested || isClosed || busy || !hasLines}
              onClick={onRequestPayment}
              className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[17px] font-bold text-primary-foreground cursor-pointer transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)]"
            >
              <Send className="size-5" aria-hidden />
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
  onCollect,
  onRequestPayment,
  onSimulatedPrint,
}: {
  bill: PayBill
  canCollect: boolean
  isWaiter: boolean
  busy: boolean
  onCollect: () => void
  onRequestPayment: () => void
  onSimulatedPrint: (count: number) => void
}) {
  const [viewMode, setViewMode] = useState<"screen" | "print">("screen")
  const [prints, setPrints] = useState(0)

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
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div role="group" aria-label="Cách xem" className="inline-flex rounded-[10px] bg-surface-3 p-1">
          <button
            type="button"
            aria-pressed={viewMode === "screen"}
            onClick={() => setViewMode("screen")}
            className={cn(
              "min-h-9 rounded-[7px] px-3 text-[13px] font-medium cursor-pointer",
              viewMode === "screen" ? "bg-surface-1 font-semibold text-foreground shadow-xs" : "text-[var(--text-muted)]",
            )}
          >
            Trên màn hình
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "print"}
            onClick={() => setViewMode("print")}
            className={cn(
              "min-h-9 rounded-[7px] px-3 text-[13px] font-medium cursor-pointer",
              viewMode === "print" ? "bg-surface-1 font-semibold text-foreground shadow-xs" : "text-[var(--text-muted)]",
            )}
          >
            Bản in 80mm
          </button>
        </div>
      </div>

      <div className="pay-pv">
        {viewMode === "screen" ? (
          <article
            aria-label="Bill tạm tính"
            className="grid w-full max-w-[560px] gap-4 justify-self-center rounded-[4px] border border-border bg-surface-1 p-7 pb-6 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[30px] leading-none font-bold tracking-[-0.03em]">21GAM</div>
                <span className="text-xs font-medium text-[var(--text-subtle)] italic">
                  [Địa chỉ, số điện thoại quán · chờ cung cấp]
                </span>
              </div>
              <span className="rounded-[6px] bg-[var(--st-pending-tint)] px-2.5 py-1 text-[13px] font-bold tracking-[0.08em] text-[var(--st-pending-ink)]">
                BILL TẠM TÍNH
              </span>
            </div>

            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-x-4 gap-y-2 text-[13px]">
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Mã bill</dt>
                <dd className="font-semibold">{bill.billCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Phiên</dt>
                <dd className="font-semibold">{bill.sessionCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Bàn</dt>
                <dd className="font-semibold">{place}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Giờ vào</dt>
                <dd className="font-semibold">{bill.openedAt}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Tạm tính lúc</dt>
                <dd className="font-semibold">{pendingAt}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Phục vụ</dt>
                <dd className="font-semibold">{bill.waiterName}</dd>
              </div>
            </dl>

            <div className="grid border-t border-dashed border-border-strong">
              {activeLines.map((l, idx) => (
                <div
                  key={`${l.name}-${idx}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-border py-2.5 text-[15px]"
                >
                  <span>
                    {l.name}
                    <small className="block text-xs text-[var(--text-muted)]">
                      {`${l.qty} × ${formatVnd(l.unitPriceVnd)} · ${l.unit}`}
                    </small>
                  </span>
                  <b className="tnum">{formatVnd(l.lineTotalVnd)}</b>
                </div>
              ))}
            </div>

            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Tổng tiền món</dt>
                <dd className="tnum font-medium">{formatVnd(bill.subtotalVnd)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">{vatLabel}</dt>
                <dd className="tnum font-medium">{formatVnd(bill.vatVnd)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Làm tròn</dt>
                <dd className="tnum font-medium">
                  {`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-[var(--ink-strong)] pt-3.5 pb-1">
              <span className="text-[13px] font-bold tracking-[0.06em]">KHÁCH CẦN TRẢ</span>
              <b className="tnum text-4xl font-extrabold tracking-[-0.04em] text-[var(--ink-strong)]">
                {formatVnd(bill.dueVnd)}
              </b>
            </div>

            <div className="grid grid-cols-1 items-center justify-items-center gap-4 border-t border-dashed border-border-strong pt-3 text-center sm:grid-cols-[132px_minmax(0,1fr)] sm:justify-items-start sm:text-left">
              <DemoQrBox size="sm" label="Mã QR minh họa trên bill, không chuyển tiền được" />
              <div className="grid gap-1">
                <b>{`Quét để chuyển khoản đúng ${formatVnd(bill.dueVnd)}`}</b>
                <span className="text-[13px] text-[var(--text-muted)]">
                  {`Nội dung: ${qrRef}. Nhân viên chỉ xác nhận khi đã thấy tiền về.`}
                </span>
              </div>
            </div>

            <p className="text-center text-xs text-[var(--text-muted)]">
              Bill tạm tính, chưa phải hóa đơn. Món đã hủy không tính.
            </p>
          </article>
        ) : (
          <article
            aria-label="Bản in tạm tính khổ 80mm"
            className="grid w-[302px] max-w-full gap-2 justify-self-center border border-[#ddd8c4] bg-[#fffef8] px-4 py-4.5 font-mono text-xs leading-[1.45] text-[#111] shadow-sm"
          >
            <div className="text-center text-lg font-bold">21GAM</div>
            <div className="text-center">BILL TẠM TÍNH</div>
            <div className="border-t border-dashed border-[#111]" />
            <div className="flex justify-between gap-2">
              <span>{`Bill ${bill.billCode}`}</span>
              <span>{bill.sessionCode}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{`Bàn ${place}`}</span>
              <span>{pendingAt}</span>
            </div>
            <div className="border-t border-dashed border-[#111]" />
            {activeLines.map((l, idx) => (
              <div key={`${l.name}-${idx}`}>
                <div>{l.name}</div>
                <div className="flex justify-between gap-2">
                  <span>{`${l.qty} × ${formatVnd(l.unitPriceVnd)}`}</span>
                  <span>{formatVnd(l.lineTotalVnd)}</span>
                </div>
              </div>
            ))}
            <div className="border-t border-dashed border-[#111]" />
            <div className="flex justify-between gap-2">
              <span>Tổng tiền món</span>
              <span>{formatVnd(bill.subtotalVnd)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{vatLabel}</span>
              <span>{formatVnd(bill.vatVnd)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Làm tròn</span>
              <span>{`${bill.roundingVnd > 0 ? "+" : ""}${formatVnd(bill.roundingVnd)}`}</span>
            </div>
            <div className="flex justify-between gap-2 text-lg font-bold">
              <span>CẦN TRẢ</span>
              <span>{formatVnd(bill.dueVnd)}</span>
            </div>
            <div className="border-t border-dashed border-[#111]" />
            <div className="justify-self-center">
              <DemoQrBox size="xs" label="Mã QR bản in 80mm, không chuyển tiền được" />
            </div>
            <div className="text-center">{`ND: ${qrRef}`}</div>
            <div className="text-center">Bill tạm tính, chưa phải hóa đơn</div>
          </article>
        )}

        <aside className="grid content-start gap-3">
          <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-xs">
            <div className="grid gap-5">
              <div className="grid gap-1">
                <span className="text-xs font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
                  Khách cần trả
                </span>
                <b className="tnum text-4xl leading-none font-extrabold tracking-[-0.04em] text-[var(--ink-strong)]">
                  {formatVnd(bill.dueVnd)}
                </b>
                <span className="text-[13px] text-[var(--text-muted)]">
                  {prints
                    ? `Đã in ${prints} lần (mô phỏng) · in đúng 1 bản đưa khách`
                    : "Chưa in · in đúng 1 bản đưa khách (TN-02)"}
                </span>
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-5 text-[15px] font-medium cursor-pointer hover:border-foreground"
              >
                <Printer className="size-5" aria-hidden />
                In tạm tính
                <span className="inline-flex h-5 items-center rounded-[6px] bg-surface-3 px-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                  mô phỏng
                </span>
              </button>

              {canCollect ? (
                <button
                  type="button"
                  disabled={isClosed || busy}
                  onClick={onCollect}
                  className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[17px] font-bold text-primary-foreground cursor-pointer hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)]"
                >
                  Chốt bill &amp; thu tiền
                  <ChevronRight className="size-5" aria-hidden />
                </button>
              ) : null}

              {!canCollect && isWaiter ? (
                <button
                  type="button"
                  disabled={requested || isClosed || busy}
                  onClick={onRequestPayment}
                  className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[17px] font-bold text-primary-foreground cursor-pointer hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)]"
                >
                  {requested ? "Đã gửi · chờ Thu ngân chốt" : "Gửi yêu cầu thanh toán"}
                </button>
              ) : null}

              <p className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Chưa nối máy in thật. Đang chốt tạm phiếu điện tử.</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
