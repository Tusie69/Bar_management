import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Clock3, ListPlus, Users, X } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { GuestPicker, guestCount, guestValueFrom, type GuestValue } from "@/components/booking-pickers"
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
import { Textarea } from "@/components/ui/textarea"
import { NOTE_PHONE_ERROR, isPlausibleVnPhone, maskedPhone, noteHasPhoneNumber } from "@/lib/text"
import { fmtTime, type BusinessDate } from "@/lib/time"
import { activeWaitlistEntries, isApiError, waitlistApi, type HttpWaitlistEntry } from "@/services"
import { useCan } from "@/state/session"
import type { FloorModel } from "./use-floor-model"
import type { WaitlistAssignmentContext, WaitlistWorkflow } from "./use-layout-table-controller"

interface PanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessDate: BusinessDate
  entries: HttpWaitlistEntry[]
  loading: boolean
  error: unknown
  beginAssignment: (context: WaitlistAssignmentContext) => void
}

export function LayoutWaitlistPanel({
  open,
  onOpenChange,
  businessDate,
  entries,
  loading,
  error,
  beginAssignment,
}: PanelProps) {
  const queryClient = useQueryClient()
  const canCreate = useCan("waitlist.create")
  const canAccept = useCan("waitlist.accept_offer")
  const canReserve = useCan("reservation.create")
  const canAssignTable = useCan("table.assign")
  const canAssign = canAccept && canReserve && canAssignTable
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [guests, setGuests] = useState<GuestValue>(() => guestValueFrom(2))
  const [note, setNote] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const active = activeWaitlistEntries(entries)

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    const partySize = guestCount(guests)
    if (!name.trim() || !partySize || (phone.trim() && !isPlausibleVnPhone(phone)) || noteHasPhoneNumber(note)) return
    if (!waitlistApi) return
    setPending(true)
    setFormError(null)
    try {
      await waitlistApi.create({
        guestName: name.trim(),
        ...(phone.trim() ? { phoneNumber: phone.trim() } : {}),
        partySize,
        businessDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setName("")
      setPhone("")
      setGuests(guestValueFrom(2))
      setNote("")
      setSubmitted(false)
      await queryClient.invalidateQueries({ queryKey: ["http-waitlist", businessDate] })
      toast.success("Đã thêm khách vào bàn chờ theo thời gian của máy chủ.")
    } catch (cause) {
      setFormError(isApiError(cause) ? cause.message : "Không thể thêm khách vào bàn chờ.")
    } finally {
      setPending(false)
    }
  }

  const choose = (entry: HttpWaitlistEntry) => {
    if (entry.status !== "WAITING" || !canAssign) return
    onOpenChange(false)
    beginAssignment({
      entryId: entry.id,
      version: entry.version,
      partySize: entry.partySize,
      displayName: entry.guestName,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bàn chờ trên Floor Layout</DialogTitle>
          <DialogDescription>
            Thứ tự FIFO do backend quyết định theo thời điểm vào hàng. Bàn chờ không phải bàn phục vụ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_1.05fr]">
          <form className="space-y-3 rounded-xl border bg-surface-1 p-4" onSubmit={(event) => void create(event)}>
            <div className="flex items-center gap-2">
              <ListPlus className="size-4" />
              <h2 className="text-sm font-semibold">Thêm khách walk-in</h2>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-name">Tên khách</Label>
              <Input
                id="waitlist-name"
                value={name}
                maxLength={120}
                disabled={pending}
                aria-invalid={submitted && !name.trim()}
                onChange={(event) => setName(event.target.value)}
              />
              {submitted && !name.trim() ? <p className="text-xs text-destructive">Vui lòng nhập tên khách.</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-phone">Số điện thoại (không bắt buộc)</Label>
              <Input
                id="waitlist-phone"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                disabled={pending}
                aria-invalid={submitted && !!phone.trim() && !isPlausibleVnPhone(phone)}
                onChange={(event) => setPhone(event.target.value)}
              />
              {submitted && phone.trim() && !isPlausibleVnPhone(phone) ? (
                <p className="text-xs text-destructive">Số điện thoại 10 số, bắt đầu bằng 0.</p>
              ) : null}
            </div>
            <GuestPicker value={guests} onChange={setGuests} showErrors={submitted} />
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-time">Giờ vào hàng</Label>
              <Input id="waitlist-time" value="Tự động theo giờ máy chủ" readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-note">Ghi chú</Label>
              <Textarea
                id="waitlist-note"
                value={note}
                maxLength={500}
                disabled={pending}
                aria-invalid={noteHasPhoneNumber(note)}
                onChange={(event) => setNote(event.target.value)}
              />
              {noteHasPhoneNumber(note) ? <p className="text-xs text-destructive">{NOTE_PHONE_ERROR}</p> : null}
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button className="w-full" type="submit" disabled={!canCreate || pending || !waitlistApi}>
              {pending ? "Đang thêm…" : "Thêm vào bàn chờ"}
            </Button>
            {!canCreate ? <p className="text-xs text-amber-600">Tài khoản không có quyền waitlist.create.</p> : null}
          </form>

          <section className="min-w-0 space-y-3" aria-label="Danh sách khách đang chờ">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Đang chờ</h2>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                {active.length} nhóm
              </span>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Đang tải danh sách…</p>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                Không tải được bàn chờ.
              </p>
            ) : active.length === 0 ? (
              <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                Chưa có khách đang chờ.
              </p>
            ) : (
              <ol className="space-y-2">
                {active.map((entry, index) => (
                  <li key={entry.id} className="rounded-xl border p-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{entry.guestName}</p>
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="size-3" />
                            {entry.partySize} khách
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock3 className="size-3" />
                            {fmtTime(entry.queuedAt)}
                          </span>
                          <span>{maskedPhone(entry.phoneLast3)}</span>
                        </p>
                        {entry.note ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">{entry.note}</p>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        disabled={!canAssign || entry.status !== "WAITING"}
                        onClick={() => choose(entry)}
                      >
                        Chọn bàn
                      </Button>
                    </div>
                    {entry.status !== "WAITING" ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Đang được xử lý ở trạng thái {entry.status}; tải lại trước khi gán.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface AssignmentProps {
  workflow: WaitlistWorkflow
  model: FloorModel
  cancel: () => void
  back: () => void
  submitting: () => void
  success: () => void
  fail: (message: string) => void
}

export function LayoutWaitlistAssignment({
  workflow,
  model,
  cancel,
  back,
  submitting,
  success,
  fail,
}: AssignmentProps) {
  const queryClient = useQueryClient()
  if (workflow.phase === "IDLE") return null
  const target = "targetTableId" in workflow ? model.byId.get(workflow.targetTableId) : null

  const submit = async () => {
    if (workflow.phase !== "CONFIRMING" || !target || !waitlistApi) return
    submitting()
    try {
      await waitlistApi.assign(workflow.context.entryId, workflow.context.version, target.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["http-waitlist"] }),
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings"] }),
      ])
      success()
      toast.success(`Đã giữ bàn ${target.code} cho ${workflow.context.displayName}.`)
    } catch (cause) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["http-waitlist"] }),
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
      ])
      fail(isApiError(cause) ? cause.message : "Không thể gán khách chờ vào bàn.")
    }
  }

  return (
    <>
      {workflow.phase === "SELECTING_WAITLIST_TABLE" || workflow.phase === "SUCCESS" ? (
        <div className="absolute top-3 right-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:left-1/2 sm:max-w-xl sm:-translate-x-1/2">
          {workflow.phase === "SUCCESS" ? (
            <CheckCircle2 className="size-5 text-emerald-600" />
          ) : (
            <Users className="size-5 text-primary" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {workflow.phase === "SUCCESS" ? "Backend đã xác nhận giữ bàn" : "Chọn một bàn trống đủ sức chứa"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workflow.context.displayName} · {workflow.context.partySize} khách
            </p>
          </div>
          <Button variant={workflow.phase === "SUCCESS" ? "default" : "outline"} size="sm" onClick={cancel}>
            {workflow.phase === "SUCCESS" ? (
              "Hoàn tất"
            ) : (
              <>
                <X /> Hủy thao tác
              </>
            )}
          </Button>
        </div>
      ) : null}

      {workflow.phase === "CONFIRMING" || workflow.phase === "SUBMITTING" ? (
        <Dialog open onOpenChange={(open) => !open && workflow.phase === "CONFIRMING" && cancel()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bạn có chắc chắn muốn gán khách vào bàn này không?</DialogTitle>
              <DialogDescription>
                {workflow.context.displayName} → bàn {target?.code}. Hệ thống sẽ tạo booking và giữ bàn. Chưa tạo visit
                và chưa check-in khách.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border bg-surface-1 p-3 text-sm">
              <b>{workflow.context.displayName}</b> · {workflow.context.partySize} khách · Bàn {target?.code}
            </p>
            <DialogFooter>
              <Button variant="ghost" disabled={workflow.phase === "SUBMITTING"} onClick={cancel}>
                Hủy
              </Button>
              <Button disabled={workflow.phase === "SUBMITTING" || !target} onClick={() => void submit()}>
                {workflow.phase === "SUBMITTING" ? "Đang gán…" : "Xác nhận giữ bàn"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {workflow.phase === "ERROR" ? (
        <Dialog open onOpenChange={(open) => !open && cancel()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Không thể gán bàn</DialogTitle>
              <DialogDescription>Không có thay đổi optimistic. Dữ liệu đã được tải lại.</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-destructive" role="alert">
              {workflow.message}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={cancel}>
                Hủy
              </Button>
              <Button onClick={back}>Chọn bàn khác</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
