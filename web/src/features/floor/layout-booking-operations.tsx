import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Combine, LogIn, Pencil, Phone, XCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { BookingSourceCode } from "@/domain/enums"
import type { TableView } from "@/domain/models"
import { reportError } from "@/hooks/use-action"
import { fmtTime, type BusinessDate } from "@/lib/time"
import { bookingApi, type HttpBooking } from "@/services"
import { useCan } from "@/state/session"
import {
  AssignmentDialog,
  BookingEditor,
  CancelBooking,
} from "@/features/reservations/http-bookings-page"
import type { LayoutTableIntent, MoveContext } from "./use-layout-table-controller"
import { customerCallCapability } from "./customer-call"

type Mode = "create" | "menu" | "edit" | "assign" | "cancel" | "checkin"

interface Props {
  table: TableView
  intent: LayoutTableIntent
  catalogTables: TableView[]
  sources: { code: BookingSourceCode; name: string }[]
  businessDate: BusinessDate
  onClose: () => void
  onStartMove: (context: MoveContext) => void
  onStartMerge: (context: MoveContext) => void
}

export function LayoutBookingOperations({ table, intent, catalogTables, sources, businessDate, onClose, onStartMove, onStartMerge }: Props) {
  const [mode, setMode] = useState<Mode>(intent.kind === "create" ? "create" : "menu")
  const [recoveryBooking, setRecoveryBooking] = useState<HttpBooking | null>(null)
  const reservationId = intent.kind === "booking" ? intent.reservationId : recoveryBooking?.id ?? null
  const detail = useQuery({
    queryKey: ["http-bookings", "detail", reservationId ?? 0],
    queryFn: () => bookingApi!.detail(reservationId!),
    enabled: bookingApi !== null && reservationId !== null,
    retry: false,
    refetchOnMount: "always",
  })
  const booking = recoveryBooking ?? detail.data ?? null

  if (intent.kind === "blocked") {
    return <InformationDialog table={table} title="Không thể thao tác trực tiếp" body={intent.reason} onClose={onClose} />
  }

  if (intent.kind === "visit") {
    return (
      <VisitActionMenu
        table={table}
        intent={intent}
        onClose={onClose}
        onStartMove={onStartMove}
        onStartMerge={onStartMerge}
      />
    )
  }

  if (mode === "create") {
    return (
      <BookingEditor
        editor={{ mode: "create" }}
        sources={sources}
        defaultBusinessDate={businessDate}
        directTable={table}
        close={onClose}
        select={() => onClose()}
        onPartial={(created) => {
          setRecoveryBooking(created)
          setMode("menu")
        }}
      />
    )
  }

  if (mode === "edit" && booking) {
    return (
      <BookingEditor
        editor={{ mode: "edit", booking }}
        sources={sources}
        defaultBusinessDate={businessDate}
        close={() => setMode("menu")}
        select={() => setMode("menu")}
      />
    )
  }

  if (mode === "assign" && booking) {
    return (
      <AssignmentDialog
        booking={booking}
        catalogTables={catalogTables}
        close={() => setMode("menu")}
      />
    )
  }

  if (mode === "cancel" && booking) {
    return <CancelBooking booking={booking} close={() => setMode("menu")} />
  }

  if (mode === "checkin" && booking) {
    return <CheckInDialog booking={booking} table={table} onBack={() => setMode("menu")} onDone={onClose} />
  }

  return (
    <BookingActionMenu
      table={table}
      booking={booking}
      loading={detail.isFetching}
      error={detail.error}
      partial={recoveryBooking !== null}
      onClose={onClose}
      setMode={setMode}
      intent={intent.kind === "booking" ? intent : null}
      onStartMove={onStartMove}
      onStartMerge={onStartMerge}
    />
  )
}

function BookingActionMenu({
  table,
  booking,
  loading,
  error,
  partial,
  onClose,
  setMode,
  intent,
  onStartMove,
  onStartMerge,
}: {
  table: TableView
  booking: HttpBooking | null
  loading: boolean
  error: unknown
  partial: boolean
  onClose: () => void
  setMode: (mode: Mode) => void
  intent: Extract<LayoutTableIntent, { kind: "booking" }> | null
  onStartMove: (context: MoveContext) => void
  onStartMerge: (context: MoveContext) => void
}) {
  const canEdit = useCan("reservation.update")
  const canAssign = useCan("table.assign")
  const canCancel = useCan("reservation.cancel")
  const canCheckIn = useCan("visit.checkin")
  const canCombine = useCan("visit.combine")
  const canRevealPhone = useCan("booking.phone.reveal")
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null)
  const [revealPending, setRevealPending] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const mutable = booking?.status === "BOOKED"
  const call = customerCallCapability({
    canRevealPhone,
    phoneLast3: booking?.phoneLast3 ?? null,
    revealedPhoneE164: revealedPhone,
  })
  const requestReveal = async () => {
    if (!bookingApi || !booking || !canRevealPhone || !booking.phoneLast3 || revealPending) return
    setRevealPending(true)
    setRevealError(null)
    try {
      const phoneNumber = await bookingApi.revealPhone(booking.id)
      const capability = customerCallCapability({ canRevealPhone: true, phoneLast3: booking.phoneLast3, revealedPhoneE164: phoneNumber })
      if (!capability.enabled) throw new Error(capability.reason)
      setRevealedPhone(phoneNumber)
    } catch (cause) {
      setRevealedPhone(null)
      setRevealError(cause instanceof Error ? cause.message : "Không thể mở số điện thoại.")
    } finally {
      setRevealPending(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thao tác {table.displayName}</DialogTitle>
          <DialogDescription>
            {partial
              ? "Booking đã được tạo nhưng bước gán bàn thất bại. Hãy phân bàn lại hoặc chỉnh sửa booking."
              : "Booking được xác định từ liên kết reservation-table trong Floor State."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-40" />
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            {error instanceof Error ? error.message : "Không tải được booking từ backend."}
          </p>
        ) : booking ? (
          <>
            <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-surface-1 p-3 text-sm">
              <Info label="Booking" value={`#${booking.id}`} />
              <Info label="Khách" value={booking.guestName} />
              <Info label="Giờ đến" value={fmtTime(booking.expectedAt)} />
              <Info label="Số khách" value={String(booking.partySize)} />
              <Info label="Bàn" value={booking.tableCodes.join(" + ") || "Chưa phân"} />
              <Info label="Phiên bản" value={String(booking.version)} />
            </dl>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!canEdit || !mutable} onClick={() => setMode("edit")}>
                <Pencil /> Sửa booking
              </Button>
              <Button
                variant="outline"
                disabled={!canAssign || !mutable || !intent}
                onClick={() => intent && onStartMove({
                  entityKind: "booking",
                  entityId: intent.reservationId,
                  version: booking.version,
                  sourceTableIds: intent.sourceTableIds,
                  partySize: booking.partySize,
                  displayName: booking.guestName,
                })}
              >
                <ArrowRightLeft /> Chuyển bàn
              </Button>
              <Button
                variant="outline"
                disabled={!canCombine || !mutable || !intent}
                onClick={() => intent && onStartMerge({
                  entityKind: "booking",
                  entityId: intent.reservationId,
                  version: booking.version,
                  sourceTableIds: intent.sourceTableIds,
                  partySize: booking.partySize,
                  displayName: booking.guestName,
                })}
              >
                <Combine /> Ghép bàn
              </Button>
              <Button
                variant="outline"
                disabled={!canCheckIn || !mutable || booking.tableCodes.length === 0}
                onClick={() => setMode("checkin")}
              >
                <LogIn /> Đón khách
              </Button>
              {call.enabled ? (
                <Button variant="outline" asChild>
                  <a href={call.href} aria-label={`Gọi ${booking.guestName}`}>
                    <Phone /> Mở trình gọi điện
                  </a>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={!canRevealPhone || !booking.phoneLast3 || revealPending}
                  title={!canRevealPhone || !booking.phoneLast3 ? call.reason : undefined}
                  onClick={() => void requestReveal()}
                >
                  <Phone /> {revealPending ? "Đang xác minh…" : "Gọi khách"}
                </Button>
              )}
              <Button variant="destructive" disabled={!canCancel || !mutable} onClick={() => setMode("cancel")}>
                <XCircle /> Hủy booking
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {revealError ?? (call.enabled
                ? "Nhấn Mở trình gọi điện để bàn giao liên kết tel: cho thiết bị; website không xác nhận cuộc gọi thành công."
                : canRevealPhone && booking.phoneLast3
                  ? "Số chỉ được mở sau thao tác rõ ràng và không được lưu vào cache hoặc storage."
                  : call.reason)} Ghép
              bàn dùng contract assignment nhiều table IDs hiện có.
            </p>
          </>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VisitActionMenu({
  table,
  intent,
  onClose,
  onStartMove,
  onStartMerge,
}: {
  table: TableView
  intent: Extract<LayoutTableIntent, { kind: "visit" }>
  onClose: () => void
  onStartMove: (context: MoveContext) => void
  onStartMerge: (context: MoveContext) => void
}) {
  const canMove = useCan("visit.move")
  const canCombine = useCan("visit.combine")
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thao tác {table.displayName}</DialogTitle>
          <DialogDescription>
            Visit #{intent.visitId} đang phục vụ. Di chuyển sử dụng transaction visit move, không dùng booking reassignment.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-surface-1 p-3 text-sm">
          <Info label="Khách" value={intent.displayName} />
          <Info label="Số khách" value={String(intent.partySize)} />
          <Info label="Số bàn" value={String(intent.sourceTableIds.length)} />
          <Info label="Phiên bản" value={String(intent.version)} />
        </dl>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={!canMove}
            onClick={() => onStartMove({
              entityKind: "visit",
              entityId: intent.visitId,
              version: intent.version,
              sourceTableIds: intent.sourceTableIds,
              partySize: intent.partySize,
              displayName: intent.displayName,
            })}
          >
            <ArrowRightLeft /> Chuyển bàn
          </Button>
          <Button
            variant="outline"
            disabled={!canCombine}
            onClick={() => onStartMerge({
              entityKind: "visit",
              entityId: intent.visitId,
              version: intent.version,
              sourceTableIds: intent.sourceTableIds,
              partySize: intent.partySize,
              displayName: intent.displayName,
            })}
          >
            <Combine /> Ghép bàn
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Có thể chọn nhiều bàn trống cùng khu và cùng loại; bàn khác khu sẽ bị khóa.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CheckInDialog({
  booking,
  table,
  onBack,
  onDone,
}: {
  booking: HttpBooking
  table: TableView
  onBack: () => void
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  const qc = useQueryClient()
  const submit = async () => {
    if (!bookingApi || pending) return
    setPending(true)
    try {
      const saved = await bookingApi.checkIn(booking)
      await invalidateLayoutBookingData(qc, saved.id)
      toast.success(`Đã check-in booking #${saved.id}; Floor State được tải lại từ backend.`)
      onDone()
    } catch (cause) {
      reportError(cause)
      await invalidateLayoutBookingData(qc, booking.id)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onBack()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đón khách tại {table.displayName}?</DialogTitle>
          <DialogDescription>
            Backend sẽ chuyển HOLD sang USAGE trong transaction và tạo visit. Frontend không tự đổi màu hoặc trạng thái
            bàn.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Booking #{booking.id} · <b>{booking.guestName}</b> · {booking.partySize} khách · bàn{" "}
          {booking.tableCodes.join(" + ")}
        </p>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onBack}>
            Quay lại
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            {pending ? "Đang check-in…" : "Xác nhận khách đã tới"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InformationDialog({
  table,
  title,
  body,
  onClose,
}: {
  table: TableView
  title: string
  body: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{table.displayName}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{body}</p>
        <DialogFooter>
          <Button onClick={onClose}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

async function invalidateLayoutBookingData(qc: ReturnType<typeof useQueryClient>, id: number) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["http-bookings"] }),
    qc.invalidateQueries({ queryKey: ["http-bookings", "detail", id] }),
    qc.invalidateQueries({ queryKey: ["floor"] }),
  ])
}
