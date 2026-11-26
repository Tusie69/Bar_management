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
  kind: "net" | "dup" | "conflict" | "other"
  message: string
  confirmedBy?: string
  confirmedAt?: string
}

function ClosedBillBanner({ status, onToList }: { status: PayBill["status"]; onToList: () => void }) {
  const unpaid = status === "CLOSED_UNPAID"
  return (
    <div role="status" className="pay-bn pay-bn-closed">
      <Info className="pay-i" aria-hidden />
      <span>
        <b>{unpaid ? "Phiên đã trả bàn nhưng chưa thu tiền" : "Bill này đã thanh toán"}</b>
        {unpaid
          ? "Lượt khách đã kết thúc mà chưa có biên nhận thu tiền. Mọi thao tác thu tiền đã được khóa."
          : "Phiên đã đóng. Mọi thao tác chọn phương thức, kiểm tra và xác nhận thu tiền đã được khóa."}
        <span className="pay-bn-act">
          <button type="button" onClick={onToList} className="pay-btn pay-btn-s">
            Về danh sách Phiên
          </button>
        </span>
      </span>
    </div>
  )
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
      <div role="alert" className="pay-bn pay-bn-err">
        <WifiOff className="pay-i" aria-hidden />
        <span>
          <b>{context === "cash" ? "Không gửi được tới máy chủ" : "Không gửi được xác nhận"}</b>
          {context === "cash"
            ? "Thanh toán CHƯA được ghi nhận. Giữ tiền khách, không thu lại, bấm Thử lại khi có mạng."
            : "Thanh toán CHƯA được ghi nhận, bill chưa đóng. Thử lại khi có mạng."}
        </span>
      </div>
    )
  }
  if (error.kind === "conflict") {
    return (
      <div role="alert" className="pay-bn pay-bn-warn">
        <AlertTriangle className="pay-i" aria-hidden />
        <span>
          <b>Bill vừa được cập nhật</b>
          Phiên bản bill đã thay đổi (chưa thu tiền). Đã tải lại số liệu mới nhất, vui lòng kiểm tra lại tổng tiền trước
          khi xác nhận lại.
        </span>
      </div>
    )
  }
  if (error.kind === "dup") {
    const who = error.confirmedBy ?? "Thu ngân khác"
    const when = error.confirmedAt ? ` lúc ${error.confirmedAt}` : ""
    return (
      <div role="alert" className="pay-bn pay-bn-err">
        <AlertTriangle className="pay-i" aria-hidden />
        <span>
          <b>Bill này đã được thanh toán trên thiết bị khác</b>
          {`${who} xác nhận${when}. ${context === "cash" ? "Không thu lại tiền khách." : "Không xác nhận lại."}`}
          <span className="pay-bn-act">
            <button type="button" onClick={onToList} className="pay-btn pay-btn-s">
              Về danh sách Phiên
            </button>
          </span>
        </span>
      </div>
    )
  }
  return (
    <div role="alert" className="pay-bn pay-bn-err">
      <AlertTriangle className="pay-i" aria-hidden />
      <span>
        <b>Không thể hoàn tất thanh toán</b>
        {error.message}
      </span>
    </div>
  )
}

export function MethodActionPane({
  bill,
  lastMethod,
  onSelectMethod,
  onToList,
}: {
  bill: PayBill
  lastMethod: PaymentMethod | null
  onSelectMethod: (method: PaymentMethod) => void
  onToList?: () => void
}) {
  const isClosed = bill.status === "PAID" || bill.status === "CLOSED_UNPAID"
  const dueSub =
    bill.roundingVnd > 0
      ? `Đã làm tròn lên từ ${formatVnd(bill.preRoundVnd)} · Bill ${bill.billCode}`
      : `Không cần làm tròn · Bill ${bill.billCode}`

  return (
    <section aria-label="Thanh toán" className="pay-pane-act pay-card">
      <div className="pay-act">
        <div className="pay-due-b">
          <span className="pay-due-l">Khách cần trả</span>
          <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
          <span className="pay-due-s">{dueSub}</span>
        </div>

        {isClosed ? <ClosedBillBanner status={bill.status} onToList={onToList ?? (() => undefined)} /> : null}

        <div className="pay-mlist" role="group" aria-label="Chọn một phương thức thanh toán">
          <button
            type="button"
            disabled={isClosed}
            className={cn("pay-mrow", lastMethod === "CASH" && "sel")}
            onClick={() => onSelectMethod("CASH")}
          >
            <Banknote className="pay-i lg pay-mrow-ic" aria-hidden />
            <span className="pay-mrow-t">
              <b>Tiền mặt</b>
              <span className="pay-d">Nhập tiền khách đưa, hệ thống tính tiền thừa.</span>
            </span>
            {lastMethod === "CASH" ? <span className="pay-mrow-sel">Đang chọn</span> : <span />}
            <ChevronRight className="pay-i pay-chev" aria-hidden />
          </button>

          <button
            type="button"
            disabled={isClosed}
            className={cn("pay-mrow", lastMethod === "TRANSFER" && "sel")}
            onClick={() => onSelectMethod("TRANSFER")}
          >
            <QrCode className="pay-i lg pay-mrow-ic" aria-hidden />
            <span className="pay-mrow-t">
              <b>Chuyển khoản QR</b>
              <span className="pay-d">Khách quét mã, nhân viên xác nhận khi thấy tiền về.</span>
            </span>
            {lastMethod === "TRANSFER" ? <span className="pay-mrow-sel">Đang chọn</span> : <span />}
            <ChevronRight className="pay-i pay-chev" aria-hidden />
          </button>
        </div>

        <p className="pay-hint">
          <Info className="pay-i sm" aria-hidden />
          <span>Mỗi bill chỉ dùng một phương thức. Không chia tiền mặt và chuyển khoản trên cùng bill.</span>
        </p>

        <div className="pay-later" aria-label="Giai đoạn sau">
          <span>Giai đoạn sau:</span>
          {["Ghi nợ", "Thẻ", "Tách bill", "Giảm giá · voucher", "Hóa đơn điện tử"].map((tag) => (
            <span key={tag} className="pay-tag">
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
  const chips = useMemo(() => quickCashAmounts(bill.dueVnd), [bill.dueVnd])
  const res = useMemo(() => evaluateCashInput(bill.dueVnd, givenVnd), [givenVnd, bill.dueVnd])
  const isClosed = bill.status === "PAID" || bill.status === "CLOSED_UNPAID"

  const isShort = res.state === "short"
  const canSubmit = givenVnd !== null && !isShort && !busy && !isClosed

  const resMeta = (() => {
    if (res.state === "short") {
      return {
        cls: "pay-res pay-res-short",
        label: "Còn thiếu",
        value: formatVnd(res.shortVnd),
        note: "Chưa đủ tiền, không thể hoàn tất",
      }
    }
    if (res.state === "exact") {
      return {
        cls: "pay-res pay-res-ok",
        label: "Vừa đủ",
        value: "0đ",
        note: "Không có tiền thừa",
      }
    }
    if (res.state === "change") {
      return {
        cls: "pay-res pay-res-ok",
        label: "Tiền thừa trả khách",
        value: formatVnd(res.changeVnd),
        note: `Khách đưa ${formatVnd(res.givenVnd)}`,
      }
    }
    return {
      cls: "pay-res pay-res-idle",
      label: "Tiền thừa trả khách",
      value: "—",
      note: "Nhập hoặc chọn số tiền khách đưa",
    }
  })()

  return (
    <section aria-label="Thanh toán" className="pay-pane-act pay-card">
      <div className="pay-act">
        <div className="pay-due-b">
          <span className="pay-due-l">Khách cần trả</span>
          <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
          <span className="pay-due-s">
            {bill.roundingVnd > 0
              ? `Đã làm tròn lên từ ${formatVnd(bill.preRoundVnd)} · Bill ${bill.billCode}`
              : `Không cần làm tròn · Bill ${bill.billCode}`}
          </span>
        </div>

        <div className="pay-cash-in">
          <div className="pay-fld">
            <label htmlFor="pay-cash-in">Khách đưa</label>
            <div className="pay-money-in">
              <input
                id="pay-cash-in"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                disabled={busy || isClosed}
                aria-describedby="pay-cash-res"
                aria-invalid={isShort}
                value={givenVnd !== null ? formatNumberVnd(givenVnd) : ""}
                onChange={(e) => {
                  setGivenVnd(parseCashInputDigits(e.target.value))
                  onClearError()
                }}
              />
              <span aria-hidden className="pay-cur">
                đ
              </span>
            </div>
          </div>

          <div role="group" aria-label="Chọn nhanh mệnh giá" className="pay-chips">
            {chips.map((v) => {
              const pressed = givenVnd === v
              return (
                <button
                  key={v}
                  type="button"
                  disabled={busy || isClosed}
                  aria-pressed={pressed}
                  onClick={() => {
                    setGivenVnd(v)
                    onClearError()
                  }}
                  className="pay-chip"
                >
                  {formatNumberVnd(v)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="pay-act-foot">
          {isClosed && error?.kind !== "dup" ? <ClosedBillBanner status={bill.status} onToList={onToList} /> : null}
          <PaymentErrorBanner error={error} context="cash" onToList={onToList} />

          <div id="pay-cash-res" role="status" aria-live="polite" className={resMeta.cls}>
            {res.state === "short" ? (
              <AlertTriangle className="pay-i lg" aria-hidden />
            ) : res.state === "exact" || res.state === "change" ? (
              <Check className="pay-i lg" aria-hidden />
            ) : (
              <Banknote className="pay-i lg" aria-hidden />
            )}
            <span className="pay-res-t">
              <span>{resMeta.label}</span>
              <b>{resMeta.value}</b>
              <small>{resMeta.note}</small>
            </span>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (givenVnd !== null && !isShort) onConfirm(givenVnd)
            }}
            className="pay-btn pay-btn-ok pay-btn-xl pay-btn-w"
          >
            {busy ? <span className="pay-spin" aria-hidden /> : <Check className="pay-i" aria-hidden />}
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

  const qrRef = `21GAM ${bill.billCode}`
  const isClosed = bill.status === "PAID" || bill.status === "CLOSED_UNPAID"

  useEffect(() => {
    if (qrStatus === "found" || isClosed) return
    const timer = window.setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isClosed, qrStatus])

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0")
  const ss = String(elapsedSec % 60).padStart(2, "0")

  const waitMeta = {
    waiting: {
      cls: "pay-wait pay-w-wait",
      title: "Chờ nhận tiền",
      sub: `Đã chờ ${mm}:${ss} · chưa nhận tiền, bill chưa đóng`,
    },
    checking: {
      cls: "pay-wait pay-w-wait",
      title: "Đang kiểm tra giao dịch…",
      sub: "Mô phỏng truy vấn, chưa nối cổng thanh toán",
    },
    none: {
      cls: "pay-wait pay-w-none",
      title: "Chưa thấy giao dịch khớp",
      sub: "Xem SMS hoặc app ngân hàng của quán, hỏi khách ảnh chuyển khoản",
    },
    found: {
      cls: "pay-wait pay-w-found",
      title: "Đã thấy giao dịch khớp (mô phỏng)",
      sub: `${formatVnd(bill.dueVnd)} · nội dung ${qrRef} · vẫn cần nhân viên xác nhận`,
    },
  }[qrStatus]

  const handleCheck = async () => {
    if (qrStatus === "checking" || busy || isClosed) return
    setQrStatus("checking")
    try {
      const res = await onCheckTransfer()
      setQrStatus(res.found ? "found" : "none")
    } catch {
      setQrStatus("none")
    }
  }

  return (
    <section aria-label="Thanh toán" className="pay-pane-act pay-card">
      <div className="pay-act">
        <div className="pay-due-b">
          <span className="pay-due-l">Khách cần trả</span>
          <b className="pay-due">{formatVnd(bill.dueVnd)}</b>
          <span className="pay-due-s">
            {bill.roundingVnd > 0
              ? `Đã làm tròn lên từ ${formatVnd(bill.preRoundVnd)} · Bill ${bill.billCode}`
              : `Không cần làm tròn · Bill ${bill.billCode}`}
          </span>
        </div>

        <div className="pay-qr-wrap">
          <div className="pay-qr-area">
            <DemoQrBox size="md" label="Mã QR minh họa, không chuyển tiền được" />
            <span className="pay-qr-cap">
              QR giả lập. Bản thật: QR động đúng số tiền và mã bill; giai đoạn sau tự xác nhận qua cổng thanh toán.
            </span>
          </div>

          <dl aria-label="Thông tin nhận tiền" className="pay-bank">
            <div>
              <dt>Ngân hàng</dt>
              <dd>
                <span className="pay-val-ph">[Chờ quán cung cấp]</span>
              </dd>
            </div>
            <div>
              <dt>Số tài khoản</dt>
              <dd>
                <span className="pay-val-ph">[Chờ quán cung cấp]</span>
              </dd>
            </div>
            <div>
              <dt>Chủ tài khoản</dt>
              <dd>
                <span className="pay-val-ph">[Chờ quán cung cấp]</span>
              </dd>
            </div>
            <div className="pay-key">
              <dt>Số tiền</dt>
              <dd className="tnum">{formatVnd(bill.dueVnd)}</dd>
            </div>
            <div className="pay-key">
              <dt>Nội dung</dt>
              <dd>
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
                  className="pay-copy"
                >
                  <Copy className="pay-i sm" aria-hidden />
                  Chép
                </button>
              </dd>
            </div>
          </dl>
        </div>

        <div className="pay-act-foot">
          {isClosed && error?.kind !== "dup" ? <ClosedBillBanner status={bill.status} onToList={onToList} /> : null}
          <PaymentErrorBanner error={error} context="qr" onToList={onToList} />

          {!isClosed && error?.kind !== "dup" ? (
            <div role="status" aria-live="polite" className={waitMeta.cls}>
              {qrStatus === "waiting" ? (
                <span className="pay-pulse" aria-hidden />
              ) : qrStatus === "checking" ? (
                <span className="pay-spin" aria-hidden />
              ) : qrStatus === "found" ? (
                <Check className="pay-i" aria-hidden />
              ) : (
                <Info className="pay-i" aria-hidden />
              )}
              <span className="pay-wait-t">
                <b>{waitMeta.title}</b>
                <span>{waitMeta.sub}</span>
              </span>
              <button
                type="button"
                disabled={qrStatus === "checking" || busy || isClosed}
                onClick={() => void handleCheck()}
                aria-label="Kiểm tra giao dịch (mô phỏng)"
                className="pay-btn pay-btn-s"
              >
                <RefreshCw className="pay-i sm" aria-hidden />
                Kiểm tra
              </button>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy || isClosed}
            onClick={() => {
              setAck(false)
              setConfirmOpen(true)
            }}
            className="pay-btn pay-btn-ok pay-btn-xl pay-btn-w"
          >
            {busy ? <span className="pay-spin" aria-hidden /> : <Check className="pay-i" aria-hidden />}
            {busy ? "Đang ghi nhận…" : "Xác nhận đã nhận tiền"}
          </button>
        </div>
      </div>

      {confirmOpen ? (
        <div className="pay-ov">
          <div role="dialog" aria-modal="true" aria-labelledby="pay-qr-cf-title" className="pay-sheet">
            <h2 id="pay-qr-cf-title">Xác nhận đã nhận chuyển khoản</h2>
            <p className="pay-due tnum">{formatVnd(bill.dueVnd)}</p>
            <label htmlFor="pay-qr-ack" className="pay-ack">
              <input id="pay-qr-ack" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{`Tôi đã thấy ${formatVnd(bill.dueVnd)} về tài khoản quán, đúng nội dung "${qrRef}".`}</span>
            </label>
            <p className="pay-hint">
              <Info className="pay-i sm" aria-hidden />
              <span>Giao dịch được gắn cờ "xác nhận tay" kèm tên người xác nhận để Kế toán đối soát (TN-09).</span>
            </p>
            <div className="pay-sheet-act">
              <button type="button" disabled={busy} onClick={() => setConfirmOpen(false)} className="pay-btn pay-btn-s pay-btn-lg">
                Hủy
              </button>
              <button
                type="button"
                disabled={!ack || busy || isClosed}
                onClick={() => {
                  if (!ack || isClosed) return
                  setConfirmOpen(false)
                  onConfirmManual()
                }}
                className="pay-btn pay-btn-ok pay-btn-lg"
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
    <section className="pay-ok">
      <div className="pay-ok-card pay-card">
        <div role="status" className="pay-ok-hd">
          <span aria-hidden className="pay-ok-ic">
            <Check className="pay-i" strokeWidth={3} />
          </span>
          <span className="pay-ok-hd-t">
            <h1>Đã thanh toán</h1>
            <span className="pay-ok-sub">
              {`${receipt.method === "CASH" ? "Tiền mặt" : "Chuyển khoản QR"} · ${receipt.clusterCode ? "Cụm " : "Bàn "}${receipt.code} · ${receipt.confirmedAt}`}
            </span>
          </span>
        </div>

        <div className="pay-ok-amt-b">
          <span className="pay-due-l">Đã thu</span>
          <p className="pay-ok-amt">{formatVnd(receipt.dueVnd)}</p>
        </div>

        <dl className="pay-ok-dl">
          {rows.map((r) => (
            <div key={r.k}>
              <dt>{r.k}</dt>
              <dd className="tnum">{r.v}</dd>
            </div>
          ))}
        </dl>

        <div className="pay-ok-close">
          <div className={cn("pay-grp", isCluster && "cl")}>
            {isCluster ? <span className="pay-grp-tag">{receipt.clusterCode}</span> : null}
            {receipt.tables.map((t) => (
              <span key={t} className="pay-tile pay-t-free">
                <b>{t}</b>
                <small>Trống</small>
              </span>
            ))}
          </div>
          <p>
            {`Phiên ${receipt.sessionCode} đã đóng. ${receipt.tables.join(" và ")} về Trống.`}
            {isCluster ? (
              <>
                <br />
                <b>{`Cụm ${receipt.clusterCode} vẫn giữ quan hệ ghép tới khi Lễ tân bấm Tách.`}</b>
              </>
            ) : null}
          </p>
        </div>

        <div className="pay-ok-act">
          <button type="button" onClick={onToList} className="pay-btn pay-btn-p pay-btn-xl">
            Về danh sách Phiên
          </button>
          <button type="button" onClick={onPrintReceipt} className="pay-btn pay-btn-s pay-btn-xl">
            <Printer className="pay-i" aria-hidden />
            In biên nhận
            <span className="pay-tag">mô phỏng</span>
          </button>
        </div>

        <p className="pay-hint">
          <Info className="pay-i sm" aria-hidden />
          <span>Bấm nhầm? Chỉ Lễ tân, Admin Edit, SuperAdmin hủy được thao tác Đã thanh toán (TN-14).</span>
        </p>
      </div>
    </section>
  )
}
