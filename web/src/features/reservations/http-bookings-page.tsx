import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Link2,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { BookingTimePicker } from "@/components/booking-pickers"
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
import type { TableView } from "@/domain/models"
import { defaultBookingSlot, isBookingSlot, validateBookingTime } from "@/domain/booking-rules"
import { useCatalog, useNow } from "@/hooks/use-data"
import { reportError } from "@/hooks/use-action"
import { addDays, atBusinessTime, businessDateOf, fmtBusinessDate, fmtTime, type BusinessDate } from "@/lib/time"
import {
  bookingApi,
  createAndAssignDirectBooking,
  type AssignmentTable,
  type BookingWriteFields,
  type BookingClassification,
  type HttpBooking,
} from "@/services"
import { useCan } from "@/state/session"
import { ZaloBookingExport } from "./zalo-booking-export"

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
  const [assignmentTarget, setAssignmentTarget] = useState<HttpBooking | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const canCreate = useCan("reservation.create")
  const canExport = useCan("customer.view_masked")

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
          <Button variant="outline" onClick={() => setExportOpen(true)} disabled={!canExport}>
            <MessageSquareText /> Xuất text Zalo
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
        assign={setAssignmentTarget}
      />
      <BookingEditor
        editor={editor}
        sources={catalog.data?.sources ?? []}
        defaultBusinessDate={date}
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
      {assignmentTarget ? (
        <AssignmentDialog
          key={`${assignmentTarget.id}-${assignmentTarget.version}`}
          booking={assignmentTarget}
          catalogTables={catalog.data?.tables ?? []}
          close={() => setAssignmentTarget(null)}
        />
      ) : null}
      <ZaloBookingExport businessDate={date} open={exportOpen} onOpenChange={setExportOpen} />
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
  assign,
}: {
  booking: HttpBooking | null
  loading: boolean
  error: unknown
  open: boolean
  close: () => void
  edit: (booking: HttpBooking) => void
  cancel: (booking: HttpBooking) => void
  assign: (booking: HttpBooking) => void
}) {
  const canEdit = useCan("reservation.update")
  const canCancel = useCan("reservation.cancel")
  const canAssign = useCan("table.assign")
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
                onClick={() => assign(booking)}
                disabled={!canAssign || booking.status !== "BOOKED"}
              >
                <Link2 /> {booking.tableCodes.length ? "Đổi bàn" : "Phân bàn"}
              </Button>
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

const ASSIGNMENT_STATE_LABEL: Record<AssignmentTable["state"], string> = {
  AVAILABLE: "Đang trống",
  RESERVED: "Đã giữ",
  IN_USE: "Đang dùng",
  OUT_OF_SERVICE: "Ngưng phục vụ",
}

export function AssignmentDialog({
  booking,
  catalogTables,
  close,
}: {
  booking: HttpBooking
  catalogTables: TableView[]
  close: () => void
}) {
  const qc = useQueryClient()
  const tableByCode = useMemo(() => new Map(catalogTables.map((table) => [table.code, table])), [catalogTables])
  const originalIds = useMemo(
    () => booking.tableCodes.map((code) => tableByCode.get(code)?.id).filter((id): id is number => id !== undefined),
    [booking.tableCodes, tableByCode],
  )
  const unresolvedCodes = booking.tableCodes.filter((code) => !tableByCode.has(code))
  const [selected, setSelected] = useState<number[]>(originalIds)
  const [pending, setPending] = useState(false)
  const states = useQuery({
    queryKey: ["http-bookings", "assignment-tables", booking.businessDate],
    queryFn: () => bookingApi!.assignmentTables(booking.businessDate),
    enabled: bookingApi !== null,
    retry: false,
  })
  const stateById = new Map((states.data ?? []).map((table) => [table.id, table]))
  const selectedTables = catalogTables.filter((table) => selected.includes(table.id))
  const totalCapacity = selectedTables.reduce((total, table) => total + table.capacity, 0)
  const unchanged = [...selected].sort((a, b) => a - b).join(",") === [...originalIds].sort((a, b) => a - b).join(",")

  const toggle = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((tableId) => tableId !== id) : [...current, id]))
  }

  const submit = async () => {
    if (!bookingApi || pending || !selected.length || unchanged || unresolvedCodes.length) return
    setPending(true)
    try {
      const saved = await bookingApi.assign(booking, selected)
      await invalidateBookingData(qc, saved.id)
      toast.success(booking.tableCodes.length ? "Backend đã đổi bàn cho booking." : "Backend đã phân bàn cho booking.")
      close()
    } catch (cause) {
      reportError(cause)
      if (booking) await invalidateBookingData(qc, booking.id)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(value) => !value && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{booking.tableCodes.length ? "Đổi bàn" : "Phân bàn"}</DialogTitle>
          <DialogDescription>
            Booking #{booking.id} · {booking.partySize} khách · {fmtTime(booking.expectedAt)}. Trạng thái dưới đây là
            read model của ngày nghiệp vụ; backend vẫn kiểm tra lại trong transaction khi xác nhận.
          </DialogDescription>
        </DialogHeader>
        {states.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((id) => (
              <Skeleton key={id} className="h-20" />
            ))}
          </div>
        ) : states.error ? (
          <Message
            title="Không tải được trạng thái bàn"
            body={errorMessage(states.error)}
            action={() => void states.refetch()}
          />
        ) : (
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {catalogTables.map((table) => {
              const live = stateById.get(table.id)
              const currentlyAssigned = originalIds.includes(table.id)
              const unavailable =
                table.status === "OUT_OF_SERVICE" ||
                live?.state === "OUT_OF_SERVICE" ||
                table.isSpare ||
                ((live?.state === "RESERVED" || live?.state === "IN_USE") && !currentlyAssigned)
              const active = selected.includes(table.id)
              return (
                <button
                  key={table.id}
                  type="button"
                  disabled={unavailable}
                  aria-pressed={active}
                  onClick={() => toggle(table.id)}
                  className={`grid gap-1 rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-primary bg-primary/10" : "bg-surface-1"}`}
                >
                  <span className="font-semibold">{table.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {table.capacity} chỗ · {live ? ASSIGNMENT_STATE_LABEL[live.state] : "Chưa có trạng thái"}
                  </span>
                  {table.isSpare ? (
                    <span className="text-xs text-amber-600">Bàn sơ cua · backend không cho đặt</span>
                  ) : null}
                  {currentlyAssigned ? (
                    <span className="text-xs text-emerald-600">Đang gán cho booking này</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
        <div className="rounded-lg border bg-surface-1 p-3 text-sm">
          <p>
            Đã chọn: <b>{selectedTables.map((table) => table.code).join(" + ") || "chưa chọn"}</b> · tổng sức chứa{" "}
            {totalCapacity}
          </p>
          {selected.length && totalCapacity < booking.partySize ? (
            <p className="mt-1 text-amber-600">
              Tổng sức chứa thấp hơn số khách. Backend hiện chưa có validation capacity; cần Product Owner xác nhận quy
              tắc.
            </p>
          ) : null}
          {unresolvedCodes.length ? (
            <p className="mt-1 text-destructive">
              Catalog không ánh xạ được bàn đang gán: {unresolvedCodes.join(", ")}. Đã chặn thao tác để không làm mất
              assignment.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Đóng
          </Button>
          <Button
            disabled={pending || states.isLoading || !selected.length || unchanged || unresolvedCodes.length > 0}
            onClick={() => void submit()}
          >
            {pending ? "Đang xác nhận…" : booking.tableCodes.length ? "Xác nhận đổi bàn" : "Xác nhận phân bàn"}
          </Button>
        </DialogFooter>
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

export function BookingEditor({
  editor,
  sources,
  defaultBusinessDate,
  close,
  select,
  directTable,
  onPartial,
}: {
  editor: { mode: "create" | "edit"; booking?: HttpBooking } | null
  sources: { code: BookingSourceCode; name: string }[]
  defaultBusinessDate: BusinessDate
  close: () => void
  select: (id: number) => void
  directTable?: TableView
  onPartial?: (booking: HttpBooking) => void
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={(value) => !value && close()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {editor ? (
          <BookingEditorBody
            key={`${editor.mode}-${editor.booking?.id ?? "new"}`}
            editor={editor}
            sources={sources}
            defaultBusinessDate={defaultBusinessDate}
            close={close}
            select={select}
            directTable={directTable}
            onPartial={onPartial}
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
  directTable,
  onPartial,
}: {
  editor: { mode: "create" | "edit"; booking?: HttpBooking }
  sources: { code: BookingSourceCode; name: string }[]
  defaultBusinessDate: BusinessDate
  close: () => void
  select: (id: number) => void
  directTable?: TableView
  onPartial?: (booking: HttpBooking) => void
}) {
  const booking = editor.booking
  const now = useNow(30_000)
  const [name, setName] = useState(booking?.guestName ?? "")
  const [party, setParty] = useState(booking?.partySize ?? 2)
  const [date, setDate] = useState<BusinessDate>(booking?.businessDate ?? defaultBusinessDate)
  const [time, setTime] = useState(
    booking ? fmtTime(booking.expectedAt) : (defaultBookingSlot(defaultBusinessDate, now) ?? "19:00"),
  )
  const [source, setSource] = useState<BookingSourceCode>(booking?.sourceCode ?? sources[0]?.code ?? "HOTLINE")
  const [classification, setClassification] = useState<BookingClassification>(booking?.classification ?? "UNCLASSIFIED")
  const [note, setNote] = useState(booking?.note ?? "")
  const [phone, setPhone] = useState("")
  const [removePhone, setRemovePhone] = useState(false)
  const [pending, setPending] = useState(false)
  const qc = useQueryClient()
  const originalSchedule = !!booking && date === booking.businessDate && time === fmtTime(booking.expectedAt)
  const legacyTime = originalSchedule && !isBookingSlot(time) ? time : null
  const timeError = originalSchedule ? null : validateBookingTime(date, time, now)
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 120 &&
    Number.isSafeInteger(party) &&
    party > 0 &&
    !timeError &&
    note.length <= 500 &&
    phone.length <= 40
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
        classification,
        note,
        ...(phone.trim() ? { phoneNumber: phone } : booking && removePhone ? { phoneNumber: null } : {}),
      }
      let saved: HttpBooking
      if (!booking && directTable) {
        const result = await createAndAssignDirectBooking(bookingApi, fields, directTable.id)
        saved = result.booking
        if (result.outcome === "created-unassigned") {
          await invalidateBookingData(qc, saved.id)
          toast.warning(`Booking #${saved.id} đã được tạo nhưng chưa gán ${directTable.code}.`, {
            description: `${errorMessage(result.assignmentError)} Mở booking này để phân bàn lại; hệ thống không tự hủy hoặc retry.`,
          })
          if (onPartial) {
            onPartial(saved)
            return
          }
          select(saved.id)
          close()
          return
        }
      } else {
        saved = booking ? await bookingApi.update(booking, fields) : await bookingApi.create(fields)
      }
      await invalidateBookingData(qc, saved.id)
      toast.success(
        booking
          ? "Đã cập nhật booking từ backend."
          : directTable
            ? `Đã tạo booking và gán ${directTable.code}.`
            : "Backend đã tạo booking.",
      )
      select(saved.id)
      close()
    } catch (cause) {
      reportError(cause)
      if (booking) await invalidateBookingData(qc, booking.id)
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
            : directTable
              ? `Đặt trực tiếp ${directTable.displayName}. Backend thực hiện create rồi assign bằng hai transaction riêng.`
              : "Số điện thoại là tùy chọn và được backend mã hóa; thao tác gán bàn vẫn là transaction riêng."}
        </DialogDescription>
      </DialogHeader>
      {directTable && !booking ? (
        <p className="rounded-lg border bg-surface-1 px-3 py-2 text-sm">
          Bàn đã chọn: <b>{directTable.displayName}</b> · {directTable.capacity} chỗ
        </p>
      ) : null}
      <div className="grid gap-3">
        <Field label="Tên khách">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Số điện thoại (tùy chọn)">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            maxLength={40}
            disabled={removePhone}
            placeholder={
              booking?.phoneLast3 ? `Đã lưu ••• ${booking.phoneLast3}; để trống để giữ nguyên` : "Ví dụ 0987 654 321"
            }
            onChange={(e) => setPhone(e.target.value)}
          />
          {booking?.phoneLast3 ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={removePhone}
                onChange={(event) => {
                  setRemovePhone(event.target.checked)
                  if (event.target.checked) setPhone("")
                }}
              />
              Xóa số điện thoại đang lưu
            </label>
          ) : null}
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
        <Field label="Loại khách">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as BookingClassification)}
            className="h-11 rounded-md border bg-background px-3"
          >
            <option value="UNCLASSIFIED">Chưa phân loại</option>
            <option value="NEW">Khách mới (N)</option>
            <option value="RETURNING">Khách quen (O)</option>
          </select>
        </Field>
        <Field label="Ngày nghiệp vụ">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value as BusinessDate)} />
        </Field>
        <BookingTimePicker
          date={date}
          value={time}
          now={now}
          onChange={setTime}
          error={timeError}
          legacyValue={legacyTime}
        />
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

export function CancelBooking({ booking, close }: { booking: HttpBooking; close: () => void }) {
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
      await invalidateBookingData(qc, booking.id)
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
