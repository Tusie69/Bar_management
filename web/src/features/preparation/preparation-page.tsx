import { useCallback, useEffect, useMemo, useState } from "react"
import { ChefHat, Clock3, GlassWater, LogOut, Printer, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { type Permission } from "@/domain/access"
import { httpClient, newIdempotencyKey } from "@/services"
import { useSession } from "@/state/session"
import {
  PREPARATION_ACTION_CLASS,
  PREPARATION_COLUMNS,
  PREPARATION_NEXT_ACTION,
  PREPARATION_QUEUE_LAYOUT_CLASS,
  canShowPrintRetry,
  preparationLineDisplay,
  type PreparationTicketStatus,
} from "./preparation-layout"

type Station = "BAR" | "KITCHEN"
type TicketStatus = PreparationTicketStatus

interface Ticket {
  ticketId: number
  orderId: number
  visitId: number
  visitSequence: number
  station: Station
  status: TicketStatus
  version: number
  submittedAt: string
  waitSeconds: number
  tableCodes: string[]
  // L2: `quantity` là số CÒN PHẢI LÀM (API đã trừ phần bị hủy); hai trường kia
  // để phiếu nói được "đã hủy n trên m" thay vì chỉ hiện một con số nhỏ hơn mà
  // không giải thích.
  lines: Array<{
    lineNo: number
    itemName: string
    variantDisplayName: string
    quantity: number
    cancelledQuantity: number
    originalQuantity: number
    note: string | null
  }>
}

interface QueueSnapshot {
  station: Station
  changeCursor: string
  generatedAt: string
  printing: { enabled: boolean }
  limit: number
  tickets: Ticket[]
}

function waitText(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes} phút` : "< 1 phút"
}

function TicketCard({ ticket, canTransition, canRetry, onTransition, onRetry, pending }: {
  ticket: Ticket
  canTransition: boolean
  canRetry: boolean
  onTransition: (ticket: Ticket, status: TicketStatus) => void
  onRetry: (ticket: Ticket) => void
  pending: boolean
}) {
  const action = PREPARATION_NEXT_ACTION[ticket.status]
  return (
    <article className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 shadow-xs" data-ticket-id={ticket.ticketId}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-foreground">{ticket.tableCodes.length ? ticket.tableCodes.join(" · ") : "Đang đổi bàn"}</p>
          <p className="text-xs text-muted-foreground">Đơn {ticket.visitSequence} · Phiên #{ticket.visitId}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-xs font-medium">
          <Clock3 className="size-3.5" aria-hidden="true" /> {waitText(ticket.waitSeconds)}
        </span>
      </header>
      <ul className="grid gap-2" aria-label="Món trên phiếu">
        {ticket.lines.map((line) => {
          // L2: số lượng, kiểu gạch/mờ và nhãn đã hủy đều do một hàm thuần
          // quyết định, nên luật đó test được mà không cần dựng DOM.
          const display = preparationLineDisplay(line)
          return (
            <li
              key={line.lineNo}
              className={`border-t border-border-subtle pt-2 first:border-0 first:pt-0${display.fullyCancelled ? " opacity-60" : ""}`}
              data-line-no={line.lineNo}
              data-cancelled={display.cancelledLabel === null ? undefined : display.fullyCancelled ? "all" : "partial"}
            >
              <div className={`flex gap-2 text-sm${display.fullyCancelled ? " line-through decoration-2" : ""}`}>
                <strong className="min-w-6 text-primary-ink">{display.quantity}×</strong><span>{line.itemName}</span>
              </div>
              {/* Đơn vị bán và ghi chú giữ nguyên ở MỌI trạng thái hủy: quầy vẫn
                  cần biết khách gọi lon hay chai, và "ít đá" vẫn đúng cho phần
                  còn lại. */}
              {line.variantDisplayName ? <p className="pl-8 text-xs text-muted-foreground">{line.variantDisplayName}</p> : null}
              {display.cancelledLabel ? (
                <p
                  className="mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"
                  role="status"
                >
                  {display.cancelledLabel}
                </p>
              ) : null}
              {line.note ? <p className="mt-1 rounded-md bg-amber-400/10 px-2 py-1 text-xs font-medium">Ghi chú: {line.note}</p> : null}
            </li>
          )
        })}
      </ul>
      <footer className="flex gap-2">
        {action && canTransition ? <Button className={PREPARATION_ACTION_CLASS} disabled={pending} onClick={() => onTransition(ticket, action.status)}>{action.label}</Button> : null}
        {canRetry ? <Button variant="outline" size="icon" className="size-11 shrink-0" disabled={pending} onClick={() => onRetry(ticket)} aria-label="Yêu cầu in lại"><Printer className="size-4" /></Button> : null}
      </footer>
    </article>
  )
}

export default function PreparationPage() {
  const role = useSession((state) => state.user.role)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const fixedStation = role === "BAR" ? "BAR" : role === "KITCHEN" ? "KITCHEN" : null
  const [station, setStation] = useState<Station>(fixedStation ?? "BAR")
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const can = useCallback((permission: Permission) => permissions.includes(permission), [permissions])
  const canRead = can(`preparation.${station.toLowerCase()}.read` as Permission)
  const canTransition = can(`preparation.${station.toLowerCase()}.transition` as Permission)
  const canRetry = canShowPrintRetry(can("preparation.print.retry"), snapshot?.printing.enabled === true)

  const load = useCallback(async () => {
    if (!httpClient || !canRead) return
    try {
      const data = await httpClient.get<QueueSnapshot>(`/preparation/${station}/tickets`)
      setSnapshot(data)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được hàng đợi.")
    }
  }, [canRead, station])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!httpClient || !canRead) return
    const stream = new EventSource(`${httpClient.root}/tables/stream`, { withCredentials: true })
    const changed = () => void load()
    stream.addEventListener("floor-changed", changed)
    return () => stream.close()
  }, [canRead, load])
  useEffect(() => {
    const timer = window.setInterval(() => setSnapshot((current) => current ? {
      ...current,
      tickets: current.tickets.map((ticket) => ({ ...ticket, waitSeconds: ticket.waitSeconds + 30 })),
    } : current), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const transition = async (ticket: Ticket, toStatus: TicketStatus) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(`/preparation/${station}/tickets/${ticket.ticketId}/transition`, {
        toStatus, expectedVersion: ticket.version, idempotencyKey,
      }, { idempotencyKey })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được phiếu.")
      await load()
    } finally { setPendingId(null) }
  }

  const retry = async (ticket: Ticket) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(`/preparation/${station}/tickets/${ticket.ticketId}/print-retry`, { idempotencyKey }, { idempotencyKey })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không yêu cầu in lại được.")
    } finally { setPendingId(null) }
  }

  const grouped = useMemo(() => Object.fromEntries(PREPARATION_COLUMNS.map((column) => [column.status,
    snapshot?.tickets.filter((ticket) => ticket.status === column.status) ?? []])) as Record<Exclude<TicketStatus, "COLLECTED">, Ticket[]>, [snapshot])

  if (!canRead) return <main className="grid min-h-dvh place-items-center p-6 text-center"><div><h1 className="text-xl font-semibold">Không có quyền truy cập quầy {station}</h1><p className="mt-2 text-sm text-muted-foreground">Backend cũng từ chối snapshot và mọi transition của quầy này.</p></div></main>

  return (
    <main className="min-h-dvh bg-background p-3 sm:p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-1 p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">{station === "BAR" ? <GlassWater className="size-5" /> : <ChefHat className="size-5" />}</span>
          <div><h1 className="text-xl font-bold">Hàng đợi {station === "BAR" ? "Bar" : "Bếp"}</h1><p className="text-xs text-muted-foreground">Cursor {snapshot?.changeCursor ?? "—"} · tự tải lại khi có thay đổi</p></div>
        </div>
        <div className="flex gap-2">
          {!fixedStation ? <div className="flex rounded-lg border border-border p-1"><Button size="sm" variant={station === "BAR" ? "default" : "ghost"} onClick={() => setStation("BAR")}>Bar</Button><Button size="sm" variant={station === "KITCHEN" ? "default" : "ghost"} onClick={() => setStation("KITCHEN")}>Bếp</Button></div> : null}
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Tải lại"><RefreshCw className="size-4" /></Button>
          <Button variant="outline" size="icon" onClick={() => void logout()} aria-label="Đăng xuất"><LogOut className="size-4" /></Button>
        </div>
      </header>
      {error ? <p role="alert" className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">{error}</p> : null}
      <section className={PREPARATION_QUEUE_LAYOUT_CLASS} aria-label="Các trạng thái hàng đợi">
        {PREPARATION_COLUMNS.map((column) => <section key={column.status} className={`min-w-0 rounded-2xl border p-2.5 ${column.tone}`}>
          <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold"><span>{column.label}</span><span className="rounded-full bg-surface-1 px-2 py-0.5 text-xs">{grouped[column.status].length}</span></h2>
          <div className="grid gap-2.5">{grouped[column.status].map((ticket) => <TicketCard key={ticket.ticketId} ticket={ticket} canTransition={canTransition} canRetry={canRetry} pending={pendingId === ticket.ticketId} onTransition={(item, status) => void transition(item, status)} onRetry={(item) => void retry(item)} />)}</div>
        </section>)}
      </section>
    </main>
  )
}
