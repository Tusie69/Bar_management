/**
 * TU-46 — Màn 4, 5, 6, 7 của mockup NA-44: chọn phương thức, tiền mặt, QR,
 * thành công.
 *
 * Bốn màn trong một component vì chúng là MỘT phiên thu tiền: đổi qua lại giữa
 * Tiền mặt và QR phải giữ nguyên số khách đưa, và một lỗi kết nối phải giữ
 * nguyên cả hai. Tách thành bốn route nghĩa là trạng thái đó phải sống ở đâu đó
 * bên ngoài, và "đâu đó" sẽ là một store mà mỗi lần điều hướng lại xoá nhầm.
 *
 * Ba điều màn này KHÔNG làm, và cả ba đều là quyết định:
 *
 * 1. Không tự chuyển trạng thái khi khách quét QR. Chưa có cổng thanh toán
 *    (CH-02), nên không có nguồn nào ngoài con mắt nhân viên nói rằng tiền đã
 *    về. Nút "Kiểm tra" đọc lại giao dịch và vẫn không đóng bill.
 * 2. Không optimistic update. Màn hình chỉ nói "đã thanh toán" khi máy chủ đã
 *    trả `CAPTURED`.
 * 3. Không xoá ô "Khách đưa" khi gặp lỗi. Mockup yêu cầu đúng điều này: lỗi
 *    kết nối thì giữ nguyên số và báo "CHƯA được ghi nhận".
 */
import { useState } from "react"
import { useNavigate } from "react-router"
import { AlertTriangle, ArrowLeft, Banknote, Check, Copy, Loader2, Lock, QrCode, RefreshCw } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { isApiError } from "@/services"
import { evaluateCash, formatCashInput, parseCashInput, quickTenderOptions } from "./cash-model"
import { IN_DEVELOPMENT_LABEL, seatingLabel } from "./bill-display"
import { BILLING_BASE_PATH } from "./billing-access"
import { useCapturePayment, useCheckPayment, useConfirmPayment } from "./use-bills"
import type { Bill, Payment, PaymentMethod, PaymentResult, Settlement } from "./billing-api"

type Screen = "METHOD" | "CASH" | "QR" | "SUCCESS"

/** Lỗi đã xảy ra, cùng việc người dùng còn làm được gì sau nó. */
interface PaymentFailure {
  message: string
  /** Máy khác đã thu: chỉ còn một lối ra là về danh sách. */
  settledElsewhere: boolean
}

const METHOD_ICON: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  BANK_TRANSFER: QrCode,
  CREDIT: Lock,
}

function failureFrom(error: unknown): PaymentFailure {
  if (!isApiError(error)) {
    // Mockup: tiêu đề phải nói rõ HẬU QUẢ, không chỉ "có lỗi".
    return { message: "Mất kết nối. Khoản tiền này CHƯA được ghi nhận.", settledElsewhere: false }
  }
  if (error.code === "BILL_ALREADY_PAID") {
    const details = (error.details ?? {}) as { paidBy?: string; paidAt?: string }
    const when = details.paidAt
      ? new Date(details.paidAt).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null
    return {
      message: details.paidBy
        ? `Thiết bị khác đã thu bill này${when ? ` lúc ${when}` : ""} · ${details.paidBy}. Không thu lại.`
        : "Thiết bị khác đã thu bill này. Không thu lại.",
      settledElsewhere: true,
    }
  }
  return { message: error.message, settledElsewhere: false }
}

function ErrorBanner({ failure }: { failure: PaymentFailure }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{failure.message}</span>
    </p>
  )
}

export interface PaymentPanelProps {
  bill: Bill
  /** Giao dịch chuyển khoản đang chờ, nếu màn này được mở lại giữa chừng. */
  onSettled?: (result: PaymentResult) => void
}

export function PaymentPanel({ bill, onSettled }: PaymentPanelProps) {
  const navigate = useNavigate()
  const [screen, setScreen] = useState<Screen>("METHOD")
  const [cashInput, setCashInput] = useState("")
  const [pending, setPending] = useState<Payment | null>(null)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [captured, setCaptured] = useState<Payment | null>(null)
  const [failure, setFailure] = useState<PaymentFailure | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [observed, setObserved] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const capture = useCapturePayment()
  const confirm = useConfirmPayment()
  const check = useCheckPayment()

  /**
   * BA mã chống trùng, không phải một.
   *
   * Mã được máy chủ gắn vào (người dùng, ĐƯỜNG DẪN, nội dung). Dùng chung một
   * mã cho "tạo giao dịch" và "xác nhận giao dịch" là hai đường dẫn khác nhau
   * mang cùng một mã, và máy chủ trả 422 IDEMPOTENCY_KEY_REUSED — đúng như nó
   * phải làm, vì nó không có cách nào biết hai yêu cầu đó là cùng một ý định.
   *
   * Mỗi mã sống qua các lần THỬ LẠI của chính thao tác đó (bấm lại sau lỗi mạng
   * không được thu thành hai lần) và chỉ được đổi sau khi thao tác đó thành
   * công. Tiền mặt và chuyển khoản tách riêng vì đổi phương thức giữa chừng
   * cũng là đổi nội dung yêu cầu.
   */
  const [cashKey, renewCashKey] = useIdempotencyKey()
  const [transferKey, renewTransferKey] = useIdempotencyKey()
  const [confirmKey, renewConfirmKey] = useIdempotencyKey()

  const cash = evaluateCash(bill.totalVnd, cashInput)
  // "Đang ghi nhận": mọi nút thu tiền và Quay lại đều khoá, đúng bảng Hành vi.
  const recording = capture.isPending || confirm.isPending
  const locked = recording || failure?.settledElsewhere === true

  function settle(result: PaymentResult) {
    setCaptured(result.payment)
    setSettlement(result.settlement)
    setFailure(null)
    setScreen("SUCCESS")
    renewCashKey()
    renewTransferKey()
    renewConfirmKey()
    onSettled?.(result)
  }

  async function payCash() {
    if (!cash.canConfirm || cash.tenderedVnd === null) return
    setFailure(null)
    try {
      settle(
        await capture.mutateAsync({
          billId: bill.id,
          method: "CASH",
          tenderedAmountVnd: cash.tenderedVnd,
          idempotencyKey: cashKey,
        }),
      )
    } catch (error) {
      // Giữ nguyên số khách đưa: nhân viên đang cầm tiền và sẽ bấm Thử lại.
      setFailure(failureFrom(error))
    }
  }

  async function openQr() {
    setFailure(null)
    setScreen("QR")
    // Mã QR đã nằm sẵn trên hoá đơn (v1.1), nên màn hình hiện được ngay mà
    // không phải chờ máy chủ. Việc tạo một giao dịch "đang chờ" là lớp ghi nhận
    // để bước 2 (webhook, CH-02) chỉ thay người bấm bằng thông báo tự động —
    // người dùng không cần biết nó đã tạo xong hay chưa.
    if (pending || !bill.qr) return
    try {
      const result = await capture.mutateAsync({
        billId: bill.id,
        method: "BANK_TRANSFER",
        idempotencyKey: transferKey,
      })
      setPending(result.payment)
    } catch (error) {
      // Máy này vừa tải lại trang, hoặc máy khác đã mở màn QR: giao dịch chờ đã
      // có rồi. Không phải lỗi — QR trên hoá đơn vẫn đúng và vẫn xác nhận được.
      if (isApiError(error) && error.code === "PAYMENT_ALREADY_PENDING") return
      setFailure(failureFrom(error))
    }
  }

  async function confirmTransfer() {
    if (!observed) return
    // Chưa có dòng giao dịch (tải lại trang giữa chừng) thì tạo nó ngay trước
    // khi xác nhận: hoá đơn đã có QR, nên người dùng không phải quay lại bước
    // trước chỉ để máy chủ bắt kịp.
    const target =
      pending ??
      (await capture
        .mutateAsync({ billId: bill.id, method: "BANK_TRANSFER", idempotencyKey: transferKey })
        .then((result) => result.payment)
        .catch(() => null))
    if (!target) {
      setFailure({ message: "Không mở được giao dịch chuyển khoản. Thử lại.", settledElsewhere: false })
      return
    }
    setFailure(null)
    try {
      settle(
        await confirm.mutateAsync({
          billId: bill.id,
          paymentId: target.id,
          observedTransfer: true,
          idempotencyKey: confirmKey,
        }),
      )
      setConfirmOpen(false)
    } catch (error) {
      setConfirmOpen(false)
      setFailure(failureFrom(error))
    }
  }

  async function recheck() {
    if (!pending) return
    try {
      const fresh = await check.mutateAsync({ billId: bill.id, paymentId: pending.id })
      setPending(fresh)
      setCheckedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }))
      // Dù đọc thấy gì, bill KHÔNG tự đóng: chưa có cổng thanh toán.
      toast.info("Đã kiểm tra. Chưa có cổng thanh toán nên vẫn cần xác nhận tay.")
    } catch (error) {
      setFailure(failureFrom(error))
    }
  }

  /* ------------------------------- Màn 7 -------------------------------- */

  if (screen === "SUCCESS" && captured) {
    return (
      <div className="grid gap-4" data-testid="payment-success">
        <div className="grid justify-items-center gap-2 rounded-xl border border-border bg-surface-2 p-6 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-emerald-600 text-white">
            <Check aria-hidden className="size-8" />
          </span>
          <h2 className="text-lg font-semibold">Đã thanh toán</h2>
          <strong className="tnum text-3xl font-bold">{formatVnd(captured.amountVnd)}</strong>
          <p className="text-sm text-muted-foreground">
            {`${bill.billCode} · ${captured.method === "CASH" ? "Tiền mặt" : "Chuyển khoản QR"}`}
          </p>
          {captured.changeAmountVnd !== null && captured.changeAmountVnd > 0 ? (
            <p className="tnum rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm font-medium">
              {`Trả lại khách ${formatVnd(captured.changeAmountVnd)}`}
            </p>
          ) : null}
          {settlement ? (
            <p className="text-xs text-muted-foreground">
              {`Bàn ${settlement.releasedTables.join(" + ")} đã về Trống`}
              {settlement.turn ? ` · lượt khách thứ ${settlement.turn.turnNo}` : ""}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => toast.info("Chưa nối máy in thật — lần in này chỉ mô phỏng.")}>
            In biên nhận (mô phỏng)
          </Button>
          <Button onClick={() => void navigate(BILLING_BASE_PATH)}>Về danh sách Phiên</Button>
        </div>
      </div>
    )
  }

  /* ------------------------------- Màn 4 -------------------------------- */

  if (screen === "METHOD") {
    return (
      <div className="grid gap-3" data-testid="payment-methods">
        <h2 className="text-base font-semibold">{`Chọn phương thức · ${formatVnd(bill.totalVnd)}`}</h2>
        {failure ? <ErrorBanner failure={failure} /> : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {bill.paymentMethods.map((option) => {
            const Icon = METHOD_ICON[option.method]
            return (
              <li key={option.method}>
                <button
                  type="button"
                  disabled={!option.available || locked}
                  aria-describedby={option.available ? undefined : `method-${option.method}-reason`}
                  onClick={() => {
                    if (option.method === "CASH") setScreen("CASH")
                    if (option.method === "BANK_TRANSFER") void openQr()
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-1 p-4 text-left transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-medium">{option.label}</span>
                    {option.available ? null : (
                      <span id={`method-${option.method}-reason`} className="block text-xs">
                        {option.reason ?? IN_DEVELOPMENT_LABEL}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {/* Những thứ có trên thiết kế mà chưa xây: hiện ra ở trạng thái khoá. */}
        <div className="flex flex-wrap gap-1.5">
          {bill.notAvailable
            .filter(
              (flag) => flag.feature === "SPLIT_BILL" || flag.feature === "DISCOUNT" || flag.feature === "E_INVOICE",
            )
            .map((flag) => (
              <Badge key={flag.feature} variant="outline" className="gap-1 text-muted-foreground" aria-disabled="true">
                <Lock aria-hidden className="size-3" />
                {`${flag.label} · ${IN_DEVELOPMENT_LABEL}`}
              </Badge>
            ))}
        </div>
      </div>
    )
  }

  /* --------------------------- Màn 5 và Màn 6 ---------------------------- */

  const methodSwitch = (
    <div className="flex gap-2" role="group" aria-label="Phương thức thanh toán">
      {(["CASH", "BANK_TRANSFER"] as const).map((method) => {
        const option = bill.paymentMethods.find((entry) => entry.method === method)
        const active = (method === "CASH" && screen === "CASH") || (method === "BANK_TRANSFER" && screen === "QR")
        return (
          <Button
            key={method}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            disabled={locked || option?.available === false}
            onClick={() => {
              if (method === "CASH") {
                setFailure(null)
                setScreen("CASH")
              } else void openQr()
            }}
          >
            {active ? "Đang chọn · " : ""}
            {option?.label ?? method}
          </Button>
        )
      })}
    </div>
  )

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Về chọn phương thức"
          disabled={locked}
          onClick={() => {
            setFailure(null)
            setScreen("METHOD")
          }}
        >
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
        <strong className="tnum text-lg">{formatVnd(bill.totalVnd)}</strong>
        <span className="ml-auto text-xs text-muted-foreground">{seatingLabel(bill.tableCodes, bill.groupSymbol)}</span>
      </div>

      {methodSwitch}
      {failure ? <ErrorBanner failure={failure} /> : null}

      {screen === "CASH" ? (
        <div className="grid gap-3" data-testid="payment-cash">
          <div className="grid gap-1.5">
            <Label htmlFor="cash-tendered">Khách đưa</Label>
            <Input
              id="cash-tendered"
              // 16px trở lên, nếu không Safari iOS tự phóng to trang khi focus.
              className="text-base"
              inputMode="numeric"
              autoComplete="off"
              disabled={locked}
              value={formatCashInput(cashInput)}
              onChange={(event) => setCashInput(String(parseCashInput(event.target.value) ?? ""))}
            />
          </div>

          <ul className="flex flex-wrap gap-2">
            {quickTenderOptions(bill.totalVnd).map((amount) => (
              <li key={amount}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => setCashInput(String(amount))}
                >
                  {amount === bill.totalVnd ? `Vừa đủ · ${formatVnd(amount)}` : formatVnd(amount)}
                </Button>
              </li>
            ))}
          </ul>

          {/* Khối kết quả: ba trạng thái, mỗi trạng thái có icon và chữ riêng. */}
          <div
            className={
              cash.state === "SHORT"
                ? "flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
                : cash.state === "ENOUGH"
                  ? "flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm"
                  : "rounded-lg border border-dashed border-border bg-surface-1 p-3 text-sm text-muted-foreground"
            }
          >
            {cash.state === "SHORT" ? <AlertTriangle aria-hidden className="size-4 text-destructive" /> : null}
            {cash.state === "ENOUGH" ? <Check aria-hidden className="size-4 text-emerald-700" /> : null}
            <span className="tnum">
              {cash.state === "EMPTY" ? "Nhập số tiền khách đưa hoặc chọn một mệnh giá." : null}
              {cash.state === "SHORT" ? `Còn thiếu ${formatVnd(cash.shortfallVnd)}` : null}
              {cash.state === "ENOUGH"
                ? cash.changeVnd > 0
                  ? `Tiền thừa ${formatVnd(cash.changeVnd)}`
                  : "Khách đưa vừa đủ"
                : null}
            </span>
          </div>

          <Button
            disabled={!cash.canConfirm || locked}
            aria-describedby={cash.disabledReason ? "cash-disabled-reason" : undefined}
            onClick={() => void payCash()}
          >
            {recording ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {recording
              ? "Đang ghi nhận…"
              : `Xác nhận đã nhận${cash.tenderedVnd === null ? "" : ` ${formatVnd(cash.tenderedVnd)}`}`}
          </Button>
          {cash.disabledReason ? (
            <p id="cash-disabled-reason" className="text-xs text-muted-foreground">
              {cash.disabledReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {screen === "QR" ? (
        <div className="grid gap-3" data-testid="payment-qr">
          {bill.qr ? (
            <>
              <div className="grid justify-items-center gap-2 rounded-xl border border-border bg-white p-4">
                <div className="relative">
                  <QRCodeSVG value={bill.qr.payload} size={192} level="M" marginSize={1} />
                  {bill.qr.isDemo ? (
                    <span className="absolute inset-x-0 bottom-1 bg-destructive/90 py-0.5 text-center text-[10px] font-bold text-white">
                      DEMO – KHÔNG CHUYỂN TIỀN
                    </span>
                  ) : null}
                </div>
                <p className="tnum text-lg font-bold text-black">{formatVnd(bill.qr.amountVnd)}</p>
                <dl className="grid w-full gap-0.5 text-xs text-black">
                  <div className="flex justify-between gap-2">
                    <dt>Chủ tài khoản</dt>
                    <dd className="font-medium">{bill.qr.beneficiary.accountName}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Số tài khoản</dt>
                    <dd className="tnum">{bill.qr.beneficiary.accountNumber}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Nội dung chuyển khoản</span>
                  <strong className="block truncate">{bill.qr.transferNote}</strong>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(bill.qr?.transferNote ?? "")
                    toast.success("Đã chép nội dung chuyển khoản.")
                  }}
                >
                  <Copy aria-hidden className="size-4" />
                  Chép
                </Button>
              </div>

              {/* Khối "Chờ nhận tiền": không tự đổi trạng thái. */}
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <span className="size-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  Chờ nhận tiền — <strong>chưa nhận tiền</strong>
                  {checkedAt ? (
                    <span className="block text-xs text-muted-foreground">{`Kiểm tra lúc ${checkedAt}: chưa thấy tiền về`}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={check.isPending || locked}
                  onClick={() => void recheck()}
                >
                  <RefreshCw aria-hidden className={check.isPending ? "size-4 animate-spin" : "size-4"} />
                  Kiểm tra
                </Button>
              </div>

              <Button disabled={locked} onClick={() => setConfirmOpen(true)}>
                {recording ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                {recording ? "Đang ghi nhận…" : "Xác nhận đã nhận tiền"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {pending?.gatewayConfirmation.reason ?? "Chưa có cổng thanh toán. Thu ngân xác nhận tay."}
              </p>
            </>
          ) : (
            <div className="grid gap-2">
              {capture.isPending ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Đang tạo mã QR…
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Chưa tạo được mã QR. Thu tiền mặt vẫn dùng được.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" onClick={() => void openQr()}>
                      Thử lại
                    </Button>
                    <Button
                      onClick={() => {
                        setFailure(null)
                        setScreen("CASH")
                      }}
                    >
                      Chuyển sang Tiền mặt
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Xác nhận đã nhận tiền</DialogTitle>
                <DialogDescription>
                  Chưa có cổng thanh toán, nên tên của bạn sẽ được ghi vào giao dịch này.
                </DialogDescription>
              </DialogHeader>
              <Label className="flex items-start gap-2 text-sm font-normal">
                <Checkbox checked={observed} onCheckedChange={(value) => setObserved(value === true)} />
                Tôi đã thấy tiền về trong tài khoản hoặc tin nhắn ngân hàng.
              </Label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Hủy
                </Button>
                <Button disabled={!observed || recording} onClick={() => void confirmTransfer()}>
                  {recording ? "Đang ghi nhận…" : "Xác nhận"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {failure?.settledElsewhere ? (
        <Button variant="outline" onClick={() => void navigate(BILLING_BASE_PATH)}>
          Về danh sách Phiên
        </Button>
      ) : null}
    </div>
  )
}
