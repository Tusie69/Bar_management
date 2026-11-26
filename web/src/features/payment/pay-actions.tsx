import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronRight,
  Copy,
  Info,
  Printer,
  QrCode,
  RefreshCw,
  WifiOff,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  calcBillTotals,
  evaluateCashInput,
  formatNumberVnd,
  formatVnd,
  parseCashInputDigits,
  quickCashAmounts,
  type PayBill,
  type PaymentMethod,
  type Receipt,
} from "@/services/payment"
import { DemoQrBox } from "./bill-pane"

export interface PaymentErrorState {
  kind: "net" | "dup" | "other"
  message: string
  confirmedBy?: string
  confirmedAt?: string
}

function PaymentErrorBanner({
  error,
  context,
  onToList,
}: {
  error: PaymentErrorState | null
  context: "cash" | "qr"
  onToList: () => void
}) {
  if (!error) return null
  if (error.kind === "net") {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-[10px] border border-destructive/45 bg-[var(--destructive-tint)] px-3 py-2.5 text-[13px]"
      >
        <WifiOff className="mt-0.5 size-5 shrink-0 text-[var(--destructive-ink)]" aria-hidden />
        <span>
          <b className="block text-sm text-[var(--destructive-ink)]">
            {context === "cash" ? "Không gửi được tới máy chủ" : "Không gửi được xác nhận"}
          </b>
          {context === "cash"
            ? "Thanh toán CHƯA được ghi nhận. Giữ tiền khách, không thu lại, bấm Thử lại khi có mạng."
            : "Thanh toán CHƯA được ghi nhận, bill chưa đóng. Thử lại khi có mạng."}
        </span>
      </div>
    )
  }
  if (error.kind === "dup") {
    const who = error.confirmedBy ?? "Thu ngân khác"
    const when = error.confirmedAt ? ` lúc ${error.confirmedAt}` : ""
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-[10px] border border-destructive/45 bg-[var(--destructive-tint)] px-3 py-2.5 text-[13px]"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--destructive-ink)]" aria-hidden />
        <span>
          <b className="block text-sm text-[var(--destructive-ink)]">
            Bill này đã được thanh toán trên thiết bị khác
          </b>
          {`${who} xác nhận${when}. ${context === "cash" ? "Không thu lại tiền khách." : "Không xác nhận lại."}`}
          <span className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onToList}
              className="inline-flex min-h-10 items-center rounded-lg border border-border-strong bg-surface-1 px-3.5 text-sm font-medium cursor-pointer hover:border-foreground"
            >
              Về danh sách Phiên
            </button>
          </span>
        </span>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] border border-destructive/45 bg-[var(--destructive-tint)] px-3 py-2.5 text-[13px]"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--destructive-ink)]" aria-hidden />
      <span>
        <b className="block text-sm text-[var(--destructive-ink)]">Không thể hoàn tất thanh toán</b>
        {error.message}
      </span>
    </div>
  )
}

export function MethodActionPane({
  bill,
  lastMethod,
  onSelectMethod,
}: {
  bill: PayBill
  lastMethod: PaymentMethod | null
  onSelectMethod: (method: PaymentMethod) => void
}) {
  const totals = useMemo(() => calcBillTotals(bill.lines), [bill.lines])
  const dueSub =
    totals.roundingVnd > 0
      ? `Đã làm tròn lên từ ${formatVnd(totals.preRoundVnd)} · Bill ${bill.billCode}`
      : `Không cần làm tròn · Bill ${bill.billCode}`

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
            {formatVnd(totals.dueVnd)}
          </b>
          <span className="text-[13px] text-[var(--text-muted)]">{dueSub}</span>
        </div>

        <div className="pay-mlist" role="group" aria-label="Chọn một phương thức thanh toán">
          <button
            type="button"
            className={cn("pay-mrow", lastMethod === "CASH" && "sel")}
            onClick={() => onSelectMethod("CASH")}
          >
            <Banknote className="size-7 text-foreground" aria-hidden />
            <span className="grid min-w-0 gap-0.5">
              <b className="text-[17px] font-bold tracking-[-0.015em] text-[var(--ink-strong)]">Tiền mặt</b>
              <span className="text-[13px] text-[var(--text-muted)]">
                Nhập tiền khách đưa, hệ thống tính tiền thừa.
              </span>
            </span>
            {lastMethod === "CASH" ? (
              <span className="inline-flex h-6 items-center rounded-[6px] bg-primary px-2 text-xs font-semibold text-primary-foreground">
                Đang chọn
              </span>
            ) : (
              <span />
            )}
            <ChevronRight className="size-5 text-[var(--text-subtle)]" aria-hidden />
          </button>

          <button
            type="button"
            className={cn("pay-mrow", lastMethod === "TRANSFER" && "sel")}
            onClick={() => onSelectMethod("TRANSFER")}
          >
            <QrCode className="size-7 text-foreground" aria-hidden />
            <span className="grid min-w-0 gap-0.5">
              <b className="text-[17px] font-bold tracking-[-0.015em] text-[var(--ink-strong)]">Chuyển khoản QR</b>
              <span className="text-[13px] text-[var(--text-muted)]">
                Khách quét mã, nhân viên xác nhận khi thấy tiền về.
              </span>
            </span>
            {lastMethod === "TRANSFER" ? (
              <span className="inline-flex h-6 items-center rounded-[6px] bg-primary px-2 text-xs font-semibold text-primary-foreground">
                Đang chọn
              </span>
            ) : (
              <span />
            )}
            <ChevronRight className="size-5 text-[var(--text-subtle)]" aria-hidden />
          </button>
        </div>

        <p className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Mỗi bill chỉ dùng một phương thức. Không chia tiền mặt và chuyển khoản trên cùng bill.</span>
        </p>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]" aria-label="Giai đoạn sau">
          <span>Giai đoạn sau:</span>
          {["Ghi nợ", "Thẻ", "Tách bill", "Giảm giá · voucher", "Hóa đơn điện tử"].map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 items-center rounded-[6px] bg-surface-3 px-2 text-[11px] font-semibold text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CashActionPane({
  bill,
  busy,
  error,
  onClearError,
  onConfirm,
  onToList,
}: {
  bill: PayBill
  busy: boolean
  error: PaymentErrorState | null
  onClearError: () => void
  onConfirm: (givenVnd: number) => void
  onToList: () => void
}) {
  const [givenVnd, setGivenVnd] = useState<number | null>(null)
  const totals = useMemo(() => calcBillTotals(bill.lines), [bill.lines])
  const chips = useMemo(() => quickCashAmounts(totals.dueVnd), [totals.dueVnd])
  const res = useMemo(() => evaluateCashInput(totals.dueVnd, givenVnd), [givenVnd, totals.dueVnd])
  const isPaid = bill.status === "PAID"

  const isShort = res.state === "short"
  const canSubmit = givenVnd !== null && !isShort && !busy && !isPaid

  const resMeta = (() => {
    if (res.state === "short") {
      return {
        cls: "border-[var(--destructive)] bg-[var(--destructive-tint)] text-[var(--destructive-ink)]",
        label: "Còn thiếu",
        value: formatVnd(res.shortVnd),
        note: "Chưa đủ tiền, không thể hoàn tất",
      }
    }
    if (res.state === "exact") {
      return {
        cls: "border-[var(--st-seated)] bg-[var(--st-seated-tint)] text-[var(--st-seated-ink)]",
        label: "Vừa đủ",
        value: "0đ",
        note: "Không có tiền thừa",
      }
    }
    if (res.state === "change") {
      return {
        cls: "border-[var(--st-seated)] bg-[var(--st-seated-tint)] text-[var(--st-seated-ink)]",
        label: "Tiền thừa trả khách",
        value: formatVnd(res.changeVnd),
        note: `Khách đưa ${formatVnd(res.givenVnd)}`,
      }
    }
    return {
      cls: "border-dashed border-border-strong bg-surface-2 text-[var(--text-muted)]",
      label: "Tiền thừa trả khách",
      value: "—",
      note: "Nhập hoặc chọn số tiền khách đưa",
    }
  })()

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
            {formatVnd(totals.dueVnd)}
          </b>
          <span className="text-[13px] text-[var(--text-muted)]">
            {totals.roundingVnd > 0
              ? `Đã làm tròn lên từ ${formatVnd(totals.preRoundVnd)} · Bill ${bill.billCode}`
              : `Không cần làm tròn · Bill ${bill.billCode}`}
          </span>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-2">
            <label
              htmlFor="pay-cash-in"
              className="text-xs font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase"
            >
              Khách đưa
            </label>
            <div className="relative">
              <input
                id="pay-cash-in"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                disabled={busy || isPaid}
                aria-describedby="pay-cash-res"
                aria-invalid={isShort}
                value={givenVnd !== null ? formatNumberVnd(givenVnd) : ""}
                onChange={(e) => {
                  setGivenVnd(parseCashInputDigits(e.target.value))
                  onClearError()
                }}
                className={cn(
                  "tnum h-[72px] w-full rounded-[10px] border-2 bg-surface-1 pr-12 pl-4 text-right text-[34px] font-extrabold tracking-[-0.03em] text-[var(--ink-strong)] focus:border-primary focus:ring-4 focus:ring-primary-tint focus:outline-none disabled:bg-surface-2 disabled:text-[var(--text-subtle)]",
                  isShort ? "border-destructive" : "border-border-strong",
                )}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-[18px] -translate-y-1/2 text-[22px] font-semibold text-[var(--text-muted)]"
              >
                đ
              </span>
            </div>
          </div>

          <div role="group" aria-label="Chọn nhanh mệnh giá" className="grid grid-cols-3 gap-2">
            {chips.map((v) => {
              const pressed = givenVnd === v
              return (
                <button
                  key={v}
                  type="button"
                  disabled={busy || isPaid}
                  aria-pressed={pressed}
                  onClick={() => {
                    setGivenVnd(v)
                    onClearError()
                  }}
                  className={cn(
                    "tnum grid min-h-[52px] place-content-center rounded-lg border px-1.5 py-1 text-[15px] leading-[1.15] font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-[var(--text-subtle)]",
                    pressed
                      ? "border-primary bg-primary-tint text-primary-ink shadow-[inset_0_0_0_1px_var(--primary)]"
                      : "border-border-strong bg-surface-1 hover:border-foreground",
                  )}
                >
                  {formatNumberVnd(v)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <PaymentErrorBanner error={error} context="cash" onToList={onToList} />

          <div
            id="pay-cash-res"
            role="status"
            aria-live="polite"
            className={cn("grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[10px] border px-3.5 py-2.5", resMeta.cls)}
          >
            {res.state === "short" ? (
              <AlertTriangle className="size-7" aria-hidden />
            ) : res.state === "exact" || res.state === "change" ? (
              <Check className="size-7" aria-hidden />
            ) : (
              <Banknote className="size-7" aria-hidden />
            )}
            <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[13px] font-semibold">{resMeta.label}</span>
              <b className={cn("tnum font-extrabold tracking-[-0.03em]", res.state === "idle" ? "text-xl" : "text-[28px] leading-[1.15]")}>
                {resMeta.value}
              </b>
              <small className="basis-full text-xs">{resMeta.note}</small>
            </span>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (givenVnd !== null && !isShort) onConfirm(givenVnd)
            }}
            className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--ok-bg)] px-5 text-[17px] font-bold text-white cursor-pointer transition-colors hover:bg-[var(--ok-bg-hover)] active:bg-[var(--ok-bg-active)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)] dark:text-[oklch(0.2_0.02_158)]"
          >
            {busy ? <span className="pay-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            {busy
              ? "Đang ghi nhận…"
              : canSubmit && givenVnd !== null
                ? `Xác nhận đã nhận ${formatVnd(givenVnd)}`
                : "Xác nhận đã nhận tiền"}
          </button>
        </div>
      </div>
    </section>
  )
}

export function QrActionPane({
  bill,
  busy,
  error,
  onCheckTransfer,
  onConfirmManual,
  onToList,
  onCopied,
}: {
  bill: PayBill
  busy: boolean
  error: PaymentErrorState | null
  onCheckTransfer: () => Promise<{ found: boolean }>
  onConfirmManual: () => void
  onToList: () => void
  onCopied: (refText: string) => void
}) {
  const [qrStatus, setQrStatus] = useState<"waiting" | "checking" | "none" | "found">("waiting")
  const [elapsedSec, setElapsedSec] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [ack, setAck] = useState(false)

  const totals = useMemo(() => calcBillTotals(bill.lines), [bill.lines])
  const qrRef = `21GAM ${bill.billCode}`
  const isPaid = bill.status === "PAID"

  useEffect(() => {
    if (qrStatus === "found") return
    const timer = window.setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [qrStatus])

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0")
  const ss = String(elapsedSec % 60).padStart(2, "0")

  const waitMeta = {
    waiting: {
      cls: "border-[var(--st-pending)] bg-[var(--st-pending-tint)] text-[var(--st-pending-ink)]",
      title: "Chờ nhận tiền",
      sub: `Đã chờ ${mm}:${ss} · chưa nhận tiền, bill chưa đóng`,
    },
    checking: {
      cls: "border-[var(--st-pending)] bg-[var(--st-pending-tint)] text-[var(--st-pending-ink)]",
      title: "Đang kiểm tra giao dịch…",
      sub: "Mô phỏng truy vấn, chưa nối cổng thanh toán",
    },
    none: {
      cls: "border-dashed border-border-strong bg-surface-2 text-foreground",
      title: "Chưa thấy giao dịch khớp",
      sub: "Xem SMS hoặc app ngân hàng của quán, hỏi khách ảnh chuyển khoản",
    },
    found: {
      cls: "border-[var(--st-seated)] bg-[var(--st-seated-tint)] text-[var(--st-seated-ink)]",
      title: "Đã thấy giao dịch khớp (mô phỏng)",
      sub: `${formatVnd(totals.dueVnd)} · nội dung ${qrRef} · vẫn cần nhân viên xác nhận`,
    },
  }[qrStatus]

  const handleCheck = async () => {
    if (qrStatus === "checking" || busy || isPaid) return
    setQrStatus("checking")
    try {
      const res = await onCheckTransfer()
      setQrStatus(res.found ? "found" : "none")
    } catch {
      setQrStatus("none")
    }
  }

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
            {formatVnd(totals.dueVnd)}
          </b>
          <span className="text-[13px] text-[var(--text-muted)]">
            {totals.roundingVnd > 0
              ? `Đã làm tròn lên từ ${formatVnd(totals.preRoundVnd)} · Bill ${bill.billCode}`
              : `Không cần làm tròn · Bill ${bill.billCode}`}
          </span>
        </div>

        <div className="pay-qr-wrap grid gap-4">
          <div className="grid justify-items-center gap-2">
            <DemoQrBox size="md" label="Mã QR minh họa, không chuyển tiền được" />
            <span className="text-center text-[11px] text-[var(--text-muted)]">
              QR giả lập. Bản thật: QR động đúng số tiền và mã bill.
            </span>
          </div>

          <dl aria-label="Thông tin nhận tiền" className="pay-bank grid text-sm">
            <div className="flex min-h-10 items-center justify-between gap-3 py-1">
              <dt className="text-[13px] text-[var(--text-muted)]">Ngân hàng</dt>
              <dd className="font-medium text-[var(--text-subtle)] italic">[Chờ quán cung cấp]</dd>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border py-1">
              <dt className="text-[13px] text-[var(--text-muted)]">Số tài khoản</dt>
              <dd className="font-medium text-[var(--text-subtle)] italic">[Chờ quán cung cấp]</dd>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border py-1">
              <dt className="text-[13px] text-[var(--text-muted)]">Chủ tài khoản</dt>
              <dd className="font-medium text-[var(--text-subtle)] italic">[Chờ quán cung cấp]</dd>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border py-1">
              <dt className="text-[13px] text-[var(--text-muted)]">Số tiền</dt>
              <dd className="tnum text-[15px] font-semibold text-[var(--ink-strong)]">{formatVnd(totals.dueVnd)}</dd>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border py-1">
              <dt className="text-[13px] text-[var(--text-muted)]">Nội dung</dt>
              <dd className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink-strong)]">
                <span>{qrRef}</span>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      void navigator.clipboard?.writeText(qrRef)
                    } catch {
                      /* clipboard optional */
                    }
                    onCopied(qrRef)
                  }}
                  aria-label="Chép nội dung chuyển khoản"
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border-strong bg-surface-1 px-2.5 text-xs font-medium cursor-pointer hover:border-foreground"
                >
                  <Copy className="size-3.5" aria-hidden />
                  Chép
                </button>
              </dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-2">
          <PaymentErrorBanner error={error} context="qr" onToList={onToList} />

          <div
            role="status"
            aria-live="polite"
            className={cn(
              "grid min-h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border py-2 pr-2 pl-3.5",
              waitMeta.cls,
            )}
          >
            {qrStatus === "waiting" ? (
              <span className="pay-pulse" aria-hidden />
            ) : qrStatus === "checking" ? (
              <span className="pay-spin" aria-hidden />
            ) : qrStatus === "found" ? (
              <Check className="size-5" aria-hidden />
            ) : (
              <Info className="size-5" aria-hidden />
            )}
            <span className="grid min-w-0">
              <b className="text-[15px] font-bold">{waitMeta.title}</b>
              <span className="text-xs">{waitMeta.sub}</span>
            </span>
            <button
              type="button"
              disabled={qrStatus === "checking" || busy || isPaid}
              onClick={() => void handleCheck()}
              aria-label="Kiểm tra giao dịch (mô phỏng)"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-foreground cursor-pointer hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden />
              Kiểm tra
            </button>
          </div>

          <button
            type="button"
            disabled={busy || isPaid}
            onClick={() => {
              setAck(false)
              setConfirmOpen(true)
            }}
            className="inline-flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--ok-bg)] px-5 text-[17px] font-bold text-white cursor-pointer transition-colors hover:bg-[var(--ok-bg-hover)] active:bg-[var(--ok-bg-active)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)] dark:text-[oklch(0.2_0.02_158)]"
          >
            {busy ? <span className="pay-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            {busy ? "Đang ghi nhận…" : "Xác nhận đã nhận tiền"}
          </button>
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-qr-cf-title"
            className="grid max-h-[calc(100vh-32px)] w-[min(460px,100%)] gap-3 overflow-auto rounded-[20px] bg-surface-1 p-6 shadow-float"
          >
            <h2 id="pay-qr-cf-title" className="text-lg font-bold tracking-[-0.015em]">
              Xác nhận đã nhận chuyển khoản
            </h2>
            <p className="tnum text-4xl leading-none font-extrabold tracking-[-0.04em] text-[var(--ink-strong)]">
              {formatVnd(totals.dueVnd)}
            </p>
            <label
              htmlFor="pay-qr-ack"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3",
                ack ? "border-[var(--st-seated)] bg-[var(--st-seated-tint)]" : "border-border-strong",
              )}
            >
              <input
                id="pay-qr-ack"
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 size-[22px] shrink-0 accent-primary"
              />
              <span>{`Tôi đã thấy ${formatVnd(totals.dueVnd)} về tài khoản quán, đúng nội dung "${qrRef}".`}</span>
            </label>
            <p className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Giao dịch được gắn cờ "xác nhận tay" kèm tên người xác nhận để đối soát.</span>
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-border-strong bg-surface-1 px-4 text-[15px] font-medium cursor-pointer hover:border-foreground"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!ack || busy}
                onClick={() => {
                  if (!ack) return
                  setConfirmOpen(false)
                  onConfirmManual()
                }}
                className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-[var(--ok-bg)] px-4 text-[15px] font-semibold text-white cursor-pointer hover:bg-[var(--ok-bg-hover)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-[var(--text-subtle)] dark:text-[oklch(0.2_0.02_158)]"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function SuccessView({
  receipt,
  onToList,
  onPrintReceipt,
}: {
  receipt: Receipt
  onToList: () => void
  onPrintReceipt: () => void
}) {
  const isCluster = Boolean(receipt.clusterCode && receipt.tables.length > 1)
  const methodText =
    receipt.method === "CASH"
      ? "Tiền mặt"
      : `Chuyển khoản QR${receipt.manual ? " · xác nhận tay" : ""}`
  const placeText = receipt.clusterCode ? `${receipt.code} (${receipt.tables.join(", ")})` : receipt.code

  const rows: { k: string; v: string }[] = [
    { k: "Mã bill", v: receipt.billCode },
    { k: "Phiên", v: receipt.sessionCode },
    { k: "Bàn", v: placeText },
    { k: "Phương thức", v: methodText },
    ...(receipt.method === "CASH"
      ? [
          { k: "Khách đưa", v: formatVnd(receipt.givenVnd) },
          { k: "Tiền thừa trả khách", v: formatVnd(receipt.changeVnd) },
        ]
      : []),
    { k: "Trước làm tròn", v: formatVnd(receipt.preRoundVnd) },
    { k: "Thời điểm", v: receipt.confirmedAt },
    { k: "Nhân viên xác nhận", v: receipt.confirmedBy },
  ]

  return (
    <section className="grid justify-items-center">
      <div className="grid w-[min(640px,100%)] gap-6 rounded-2xl border border-border bg-surface-1 p-7 shadow-xs">
        <div role="status" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-lg bg-[var(--ok-bg)] text-white dark:text-[oklch(0.2_0.02_158)]"
          >
            <Check className="size-5" strokeWidth={3} />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-[var(--st-seated-ink)]">Đã thanh toán</h1>
            <span className="text-[13px] text-[var(--text-muted)]">
              {`${receipt.method === "CASH" ? "Tiền mặt" : "Chuyển khoản QR"} · ${receipt.clusterCode ? "Cụm " : "Bàn "}${receipt.code} · ${receipt.confirmedAt}`}
            </span>
          </span>
        </div>

        <div className="grid gap-1">
          <span className="text-xs font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">Đã thu</span>
          <p className="tnum text-[clamp(40px,7cqi,56px)] leading-none font-extrabold tracking-[-0.04em] text-[var(--ink-strong)]">
            {formatVnd(receipt.dueVnd)}
          </p>
        </div>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-x-6 border-t border-border">
          {rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-3 border-b border-border py-2.5">
              <dt className="text-[var(--text-muted)]">{r.k}</dt>
              <dd className="tnum text-right font-semibold">{r.v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-3.5 rounded-[10px] bg-surface-2 p-3.5">
          <div
            className={cn(
              "flex flex-none gap-2",
              isCluster && "relative rounded-[14px] border-2 border-[var(--cluster)] bg-[color-mix(in_oklab,var(--cluster)_8%,transparent)] p-1.5",
            )}
          >
            {isCluster ? (
              <span className="absolute -top-2.5 right-2.5 h-5 rounded-full bg-[var(--cluster)] px-2 text-[11px] leading-5 font-bold text-white dark:text-[oklch(0.2_0.02_245)]">
                {receipt.clusterCode}
              </span>
            ) : null}
            {receipt.tables.map((t) => (
              <span
                key={t}
                className="grid h-[60px] w-[72px] place-content-center justify-items-center rounded-[10px] border-2 border-dashed border-[var(--st-free)] bg-surface-2 px-1 text-xs leading-tight text-[var(--text-muted)]"
              >
                <b className="text-[15px] font-bold">{t}</b>
                <small className="text-[11px]">Trống</small>
              </span>
            ))}
          </div>
          <p className="min-w-[200px] flex-1 text-[13px]">
            {`Phiên ${receipt.sessionCode} đã đóng. ${receipt.tables.join(" và ")} về Trống.`}
            {isCluster ? (
              <>
                <br />
                <b>{`Cụm ${receipt.clusterCode} vẫn giữ quan hệ ghép tới khi Lễ tân bấm Tách.`}</b>
              </>
            ) : null}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-2.5">
          <button
            type="button"
            onClick={onToList}
            className="inline-flex min-h-[60px] items-center justify-center rounded-lg bg-primary px-5 text-[17px] font-bold text-primary-foreground cursor-pointer hover:bg-[var(--primary-hover)]"
          >
            Về danh sách Phiên
          </button>
          <button
            type="button"
            onClick={onPrintReceipt}
            className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-5 text-[17px] font-semibold cursor-pointer hover:border-foreground"
          >
            <Printer className="size-5" aria-hidden />
            In biên nhận
            <span className="inline-flex h-5 items-center rounded-[6px] bg-surface-3 px-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
              mô phỏng
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
