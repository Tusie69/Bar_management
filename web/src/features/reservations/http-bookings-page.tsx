import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, RefreshCw, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { BookingSourceCode } from "@/domain/enums"
import { useCatalog, useNow } from "@/hooks/use-data"
import { reportError } from "@/hooks/use-action"
import { addDays, atBusinessTime, businessDateOf, fmtBusinessDate, fmtTime, type BusinessDate } from "@/lib/time"
import { bookingApi, type BookingWriteFields, type HttpBooking } from "@/services"
import { useCan } from "@/state/session"

const bookingKeys = {
  all: ["http-bookings"] as const,
  list: (date: string, search: string) => ["http-bookings", "list", date, search] as const,
  detail: (id: number) => ["http-bookings", "detail", id] as const,
}

const STATUS_LABEL: Record<HttpBooking["displayStatus"], string> = {
  UPCOMING: "Sắp đến",
  WAITING: "Đang chờ",
  LATE: "Đến muộn",
  NO_SHOW: "Không đến",
  CHECKED_IN: "Đã check-in",
  CANCELLED: "Đã hủy",
}

function cutoffHour(value?: string): number {
  const parsed = Number(value?.split(":")[0])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 5
}

export function HttpBookingsPage() {
  const catalog = useCatalog()
  const now = useNow(30_000)
  const configuredToday = businessDateOf(now, cutoffHour(catalog.data?.venue.businessDayCutoffLocal))
  const [date, setDate] = useState<BusinessDate>(() => businessDateOf(now))
  const dateTouched = useRef(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [status, setStatus] = useState<"ALL" | HttpBooking["status"]>("ALL")
  const [source, setSource] = useState<"ALL" | BookingSourceCode>("ALL")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; booking?: HttpBooking } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<HttpBooking | null>(null)
  const canCreate = useCan("reservation.create")

  useEffect(() => {
    if (!dateTouched.current) setDate(configuredToday)
  }, [configuredToday])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const list = useQuery({
    queryKey: bookingKeys.list(date, debouncedSearch),
    queryFn: () => bookingApi!.list(date, debouncedSearch),
    enabled: bookingApi !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const detail = useQuery({
    queryKey: bookingKeys.detail(selectedId ?? 0),
    queryFn: () => bookingApi!.detail(selectedId!),
    enabled: bookingApi !== null && selectedId !== null,
    retry: false,
  })
  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (booking) =>
          (status === "ALL" || booking.status === status) && (source === "ALL" || booking.sourceCode === source),
      ),
    [list.data, source, status],
  )

  const changeDate = (next: BusinessDate) => {
    dateTouched.current = true
    setDate(next)
    setSelectedId(null)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Ngày trước" onClick={() => changeDate(addDays(date, -1))}>
            <ChevronLeft />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value as BusinessDate)}
            className="w-[158px]"
            aria-label="Ngày nghiệp vụ"
          />
          <Button variant="ghost" size="icon" aria-label="Ngày sau" onClick={() => changeDate(addDays(date, 1))}>
            <ChevronRight />
          </Button>
          {date !== configuredToday ? (
            <Button variant="ghost" size="sm" onClick={() => changeDate(configuredToday)}>
              Ca hiện tại
            </Button>
          ) : null}
          <div className="relative min-w-[230px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Tên khách hoặc đúng 3 số cuối SĐT"
              aria-label="Tìm booking"
            />
            {search ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setSearch("")}
                aria-label="Xóa tìm kiếm"
              >
                <X />
              </Button>
            ) : null}
          </div>
          <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>
            <RefreshCw className={list.isFetching ? "animate-spin" : ""} /> Làm mới
          </Button>
          <Button onClick={() => setEditor({ mode: "create" })} disabled={!canCreate}>
            <CalendarPlus /> Tạo booking
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="h-9 rounded-md border bg-background px-3"
            aria-label="Lọc trạng thái"
          >
            <option value="ALL">Mọi trạng thái</option>
            <option value="BOOKED">Đang đặt</option>
            <option value="CHECKED_IN">Đã check-in</option>
            <option value="CANCELLED">Đã hủy</option>
            <option value="NO_SHOW">Không đến</option>
          </select>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
            className="h-9 rounded-md border bg-background px-3"
            aria-label="Lọc nguồn"
          >
            <option value="ALL">Mọi nguồn</option>
            {(catalog.data?.sources ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">
            Ngày nghiệp vụ {fmtBusinessDate(date)} · {rows.length} booking
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {list.isLoading ? (
          <div className="grid gap-2 p-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.error ? (
          <Message
            title="Không tải được danh sách"
            body={errorMessage(list.error)}
            action={() => void list.refetch()}
          />
        ) : rows.length === 0 ? (
          <Message
            title={debouncedSearch ? "Không tìm thấy booking" : "Chưa có booking"}
            body={
              debouncedSearch
                ? "Backend không trả về kết quả phù hợp trong ngày nghiệp vụ này."
                : "Không có dữ liệu giả được thêm vào danh sách."
            }
          />
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="pl-6">Giờ</TableHead>
                <TableHead>Khách</TableHead>
                <TableHead>Số khách</TableHead>
                <TableHead>Nguồn</TableHead>
                <TableHead>Bàn</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((booking) => (
                <TableRow key={booking.id} className="cursor-pointer" onClick={() => setSelectedId(booking.id)}>
                  <TableCell className="pl-6 font-semibold">{fmtTime(booking.expectedAt)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{booking.guestName}</span>
                    {booking.phoneLast3 ? (
                      <span className="block text-xs text-muted-foreground">••• {booking.phoneLast3}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{booking.partySize}</TableCell>
                  <TableCell>{booking.source}</TableCell>
                  <TableCell>{booking.tableCodes.join(" + ") || "—"}</TableCell>
                  <TableCell>{STATUS_LABEL[booking.displayStatus]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <BookingDetail
        booking={detail.data ?? null}
        loading={detail.isLoading}
        error={detail.error}
        open={selectedId !== null}
        close={() => setSelectedId(null)}
        edit={(booking) => setEditor({ mode: "edit", booking })}
        cancel={setCancelTarget}
      />
      <BookingEditor
        editor={editor}
        sources={catalog.data?.sources ?? []}
        defaultBusinessDate={configuredToday}
        close={() => setEditor(null)}
        select={setSelectedId}
      />
      {cancelTarget ? (
        <CancelBooking
          key={`${cancelTarget.id}-${cancelTarget.version}`}
          booking={cancelTarget}
          close={() => setCancelTarget(null)}
        />
      ) : null}
    </section>
  )
}

function Message({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return (
    <div className="grid min-h-64 place-items-center p-6 text-center">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {action ? (
          <Button className="mt-4" onClick={action}>
            Thử lại
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Backend không phản hồi."
}

function BookingDetail({
  booking,
  loading,
  error,
  open,
  close,
  edit,
  cancel,
}: {
  booking: HttpBooking | null
  loading: boolean
  error: unknown
  open: boolean
  close: () => void
  edit: (booking: HttpBooking) => void
  cancel: (booking: HttpBooking) => void
}) {
  const canEdit = useCan("reservation.update")
  const canCancel = useCan("reservation.cancel")
  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chi tiết booking</DialogTitle>
          <DialogDescription>
            Dữ liệu trực tiếp từ backend; các trường backend không cung cấp sẽ không được suy diễn.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-48" />
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(error)}
          </p>
        ) : booking ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Mã" value={`#${booking.id}`} />
              <Fact label="Phiên bản" value={String(booking.version)} />
              <Fact label="Khách" value={booking.guestName} />
              <Fact label="Số khách" value={String(booking.partySize)} />
              <Fact label="Thời gian" value={`${fmtTime(booking.expectedAt)} · ${booking.businessDate}`} />
              <Fact label="Nguồn" value={booking.source} />
              <Fact label="SĐT che" value={booking.phoneLast3 ? `••• ${booking.phoneLast3}` : "Không có"} />
              <Fact label="Bàn" value={booking.tableCodes.join(" + ") || "Chưa phân"} />
              <Fact label="Trạng thái" value={STATUS_LABEL[booking.displayStatus]} />
              <Fact label="Ghi chú" value={booking.note || "Không có"} />
            </dl>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => edit(booking)}
                disabled={!canEdit || booking.status !== "BOOKED"}
              >
                <Pencil /> Chỉnh sửa
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancel(booking)}
                disabled={!canCancel || booking.status !== "BOOKED"}
              >
                Hủy booking
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}

function BookingEditor({
  editor,
  sources,
  defaultBusinessDate,
  close,
  select,
}: {
  editor: { mode: "create" | "edit"; booking?: HttpBooking } | null
  sources: { code: BookingSourceCode; name: string }[]
  defaultBusinessDate: BusinessDate
  close: () => void
  select: (id: number) => void
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={(value) => !value && close()}>
      <DialogContent>
        {editor ? (
          <BookingEditorBody
            key={`${editor.mode}-${editor.booking?.id ?? "new"}`}
            editor={editor}
            sources={sources}
            defaultBusinessDate={defaultBusinessDate}
            close={close}
            select={select}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BookingEditorBody({
  editor,
  sources,
  defaultBusinessDate,
  close,
  select,
}: {
  editor: { mode: "create" | "edit"; booking?: HttpBooking }
  sources: { code: BookingSourceCode; name: string }[]
  defaultBusinessDate: BusinessDate
  close: () => void
  select: (id: number) => void
}) {
  const booking = editor.booking
  const [name, setName] = useState(booking?.guestName ?? "")
  const [party, setParty] = useState(booking?.partySize ?? 2)
  const [date, setDate] = useState<BusinessDate>(booking?.businessDate ?? defaultBusinessDate)
  const [time, setTime] = useState(booking ? fmtTime(booking.expectedAt) : "19:00")
  const [source, setSource] = useState<BookingSourceCode>(booking?.sourceCode ?? sources[0]?.code ?? "HOTLINE")
  const [note, setNote] = useState(booking?.note ?? "")
  const [pending, setPending] = useState(false)
  const qc = useQueryClient()
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 120 &&
    Number.isSafeInteger(party) &&
    party > 0 &&
    note.length <= 500
  const submit = async () => {
    if (!bookingApi || !valid || pending) return
    setPending(true)
    try {
      const fields: BookingWriteFields = {
        guestName: name,
        partySize: party,
        expectedAt: atBusinessTime(date, time),
        businessDate: date,
        sourceCode: source,
        note,
      }
      const saved = booking ? await bookingApi.update(booking, fields) : await bookingApi.create(fields)
      await invalidateBookingData(qc, saved.id)
      toast.success(booking ? "Đã cập nhật booking từ backend." : "Backend đã tạo booking.")
      select(saved.id)
      close()
    } catch (cause) {
      reportError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{booking ? "Chỉnh sửa booking" : "Tạo booking"}</DialogTitle>
        <DialogDescription>
          {booking
            ? "Frontend gửi full payload và version hiện tại; 409 sẽ không tự retry."
            : "Endpoint hiện tại yêu cầu tên khách và không hỗ trợ phone hoặc gán bàn atomic."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <Field label="Tên khách">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Số khách">
            <Input type="number" min={1} value={party} onChange={(e) => setParty(Number(e.target.value))} />
          </Field>
          <Field label="Nguồn">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as BookingSourceCode)}
              className="h-10 rounded-md border bg-background px-3"
            >
              {sources.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày nghiệp vụ">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value as BusinessDate)} />
          </Field>
          <Field label="Giờ đến">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Đóng
        </Button>
        <Button disabled={!valid || pending || sources.length === 0} onClick={() => void submit()}>
          {pending ? "Đang lưu…" : "Lưu qua backend"}
        </Button>
      </DialogFooter>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  )
}

function CancelBooking({ booking, close }: { booking: HttpBooking; close: () => void }) {
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const qc = useQueryClient()
  const submit = async () => {
    if (!bookingApi || pending) return
    setPending(true)
    try {
      await bookingApi.cancel(booking, note)
      await invalidateBookingData(qc, booking.id)
      toast.success("Backend đã hủy booking.")
      close()
    } catch (cause) {
      reportError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open onOpenChange={(value) => !value && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hủy booking?</DialogTitle>
          <DialogDescription>
            Backend hiện cố định reason code là CUSTOMER_REQUEST; frontend chỉ gửi reasonNote tùy chọn, không tự tạo
            reason code.
          </DialogDescription>
        </DialogHeader>
        <Field label="Ghi chú lý do (tối đa 300 ký tự)">
          <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Không hủy
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void submit()}>
            {pending ? "Đang hủy…" : "Xác nhận hủy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function invalidateBookingData(qc: ReturnType<typeof useQueryClient>, id: number) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: bookingKeys.all }),
    qc.invalidateQueries({ queryKey: bookingKeys.detail(id) }),
    qc.invalidateQueries({ queryKey: ["floor"] }),
  ])
}
