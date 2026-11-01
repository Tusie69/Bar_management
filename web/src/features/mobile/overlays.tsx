import { CalendarPlus, Clock, ListPlus, TriangleAlert, UserPlus, X, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useNavigate } from "react-router"
import { roleCan, type Permission } from "@/domain/access"
import { ROLE_LABEL } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { fmtTime12 } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useSession } from "@/state/session"
import { NAV } from "@/app/nav"
import type { Alert } from "../floor/alerts"
import { useMobileActions } from "./actions"
import { useM, type Confirm } from "./context"
import { lateOf, tableText } from "./model"
import { Seg } from "./ui"

export function Scrim({ onClick }: { onClick?: () => void }) {
  return <div aria-hidden onClick={onClick} className="fixed inset-0 z-[45] bg-[var(--scrim)]" />
}

function BottomSheet({ label, children, onClose }: { label: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-[50] flex max-h-[85dvh] flex-col rounded-t-[24px] bg-surface-1 px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[var(--shadow-float)]"
    >
      <div className="mx-auto mb-3.5 h-[5px] w-9 shrink-0 rounded-[3px] bg-strong" />
      <h2 className="m-0 mb-1.5 text-lg font-semibold text-tx-strong">{label}</h2>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pt-1.5">{children}</div>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 h-12 w-full shrink-0 rounded-[14px] bg-surface-3 text-[15px] font-medium text-tx-1"
      >
        Đóng
      </button>
    </div>
  )
}

function SheetItem({
  icon: Icon,
  label,
  sub,
  onClick,
}: {
  icon: LucideIcon
  label: string
  sub: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[68px] items-center gap-3.5 rounded-2xl border border-border bg-background px-3.5 py-2.5 text-left text-tx-1 active:bg-surface-2"
    >
      <span className="grid size-[42px] shrink-0 place-items-center rounded-xl bg-primary-tint text-primary-ink">
        <Icon className="size-[21px]" strokeWidth={1.8} />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] font-medium text-tx-strong">{label}</span>
        <span className="text-[13px] text-[var(--text-muted)]">{sub}</span>
      </span>
    </button>
  )
}

export function CreateSheet({ onClose }: { onClose: () => void }) {
  const m = useM()
  const items: { icon: LucideIcon; label: string; sub: string; permission: Permission; go: () => void }[] = [
    {
      icon: CalendarPlus,
      label: "Tạo đặt trước",
      sub: "Booking cho giờ sau, có hẹn giờ đến",
      permission: "reservation.create",
      go: () => m.openForm({ mode: "booking" }),
    },
    {
      icon: UserPlus,
      label: "Mở bàn Walk-in",
      sub: "Khách đã đến, xếp bàn ngay",
      permission: "visit.walkin",
      go: () => m.openForm({ mode: "walkin" }),
    },
    {
      icon: ListPlus,
      label: "Thêm danh sách chờ",
      sub: "Khách đến nhưng chưa có bàn phù hợp",
      permission: "waitlist.create",
      go: () => m.openForm({ mode: "walkin" }),
    },
  ]
  return (
    <BottomSheet label="Tạo mới" onClose={onClose}>
      {items
        .filter((i) => roleCan(m.role, i.permission))
        .map((i) => (
          <SheetItem key={i.label} icon={i.icon} label={i.label} sub={i.sub} onClick={i.go} />
        ))}
    </BottomSheet>
  )
}

export function AlertsSheet({
  alerts,
  onOpen,
  onClose,
}: {
  alerts: Alert[]
  onOpen: (a: Alert) => void
  onClose: () => void
}) {
  return (
    <BottomSheet label="Thông báo" onClose={onClose}>
      {alerts.length ? (
        alerts.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onOpen(a)}
            className="flex items-start gap-3 rounded-2xl border border-border bg-background px-3.5 py-3 text-left text-tx-1"
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full"
              style={{ background: `var(--st-${a.tone}-tint)`, color: `var(--st-${a.tone}-ink)` }}
            >
              <Clock className="size-4" />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-medium text-tx-strong">{a.title}</span>
              <span className="text-[13px] text-[var(--text-muted)]">{a.detail}</span>
            </span>
          </button>
        ))
      ) : (
        <p className="m-0 py-6 text-center text-[14px] text-[var(--text-muted)]">Chưa có cảnh báo trong ca.</p>
      )}
    </BottomSheet>
  )
}

/** Demo user, theme and the pages that are not in the tab bar (Khách, Báo cáo, Cài đặt). */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { user, users, theme, setUser, setTheme } = useSession()
  const navigate = useNavigate()
  const more = NAV.filter((n) => ["/guests", "/reports", "/settings"].includes(n.to)).filter(
    (n) => !n.permission || roleCan(user.role, n.permission),
  )
  return (
    <BottomSheet label="Tài khoản" onClose={onClose}>
      <Seg
        label="Giao diện"
        value={theme}
        onChange={setTheme}
        opts={[
          ["light", "Sáng"],
          ["dark", "Tối"],
        ]}
      />
      <span className="pt-2 text-[13px] text-[var(--text-muted)]">Người dùng demo</span>
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          aria-pressed={u.id === user.id}
          onClick={() => {
            setUser(u.id)
            onClose()
          }}
          className={cn(
            "flex min-h-12 items-center justify-between rounded-2xl border px-3.5 text-left",
            u.id === user.id ? "border-primary bg-primary-tint" : "border-border bg-background",
          )}
        >
          <span className="text-[15px] font-medium text-tx-strong">{u.displayName}</span>
          <span className="text-[13px] text-[var(--text-muted)]">{ROLE_LABEL[u.role]}</span>
        </button>
      ))}
      {more.length ? <span className="pt-2 text-[13px] text-[var(--text-muted)]">Trang khác</span> : null}
      {more.map((n) => (
        <SheetItem
          key={n.to}
          icon={n.icon}
          label={n.label}
          sub="Mở trang đầy đủ"
          onClick={() => {
            onClose()
            navigate(n.to)
          }}
        />
      ))}
    </BottomSheet>
  )
}

export function StatusDialog({ r, onClose }: { r: ReservationView; onClose: () => void }) {
  const m = useM()
  const a = useMobileActions()
  const late = lateOf(r, m.now)
  const close = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }
  const opts: { label: string; dot: string; sub?: string; disabled?: boolean; go: () => void }[] =
    r.status === "BOOKED"
      ? [
          { label: "Khách đã đến (check-in)", dot: "var(--st-seated-fill)", go: close(() => a.checkIn(r)) },
          { label: "Đổi bàn", dot: "var(--st-reserved)", go: close(() => a.move(r)) },
          {
            label: "Khách không đến",
            dot: "var(--st-noshow)",
            disabled: r.warning !== "noshow",
            sub:
              r.warning === "noshow"
                ? ""
                : `Chỉ dùng sau mốc ${m.th.noshow} phút${late ? `, hiện trễ ${late} phút` : ""}`,
            go: close(() => a.noShow(r)),
          },
          { label: "Hủy booking", dot: "var(--st-oos)", go: close(() => a.cancel(r)) },
        ]
      : r.status === "CHECKED_IN"
        ? [
            { label: "Đổi bàn", dot: "var(--st-reserved)", go: close(() => a.move(r)) },
            { label: "Nhả bàn khi khách rời", dot: "var(--st-oos)", go: close(() => a.release(r)) },
          ]
        : []
  return (
    <div
      role="dialog"
      aria-label="Đổi trạng thái booking"
      className="fixed inset-x-6 top-1/2 z-[50] flex -translate-y-1/2 flex-col overflow-hidden rounded-[22px] bg-surface-1 shadow-[var(--shadow-float)]"
    >
      <div className="flex flex-col items-center gap-0.5 border-b border-border px-4 pt-4 pb-3 text-center">
        <span className="text-[17px] font-semibold text-tx-strong">Đổi trạng thái booking</span>
        <span className="text-[13px] text-[var(--text-muted)]">
          {r.displayName}, {fmtTime12(r.expectedAt)}, {tableText(r.tableIds, m.model)}
        </span>
      </div>
      {opts.map((o, i) => (
        <button
          key={o.label}
          type="button"
          onClick={o.go}
          disabled={o.disabled}
          className={cn(
            "flex min-h-[54px] items-center gap-3.5 px-5 py-1.5 text-left text-tx-1 active:bg-surface-2 disabled:opacity-45",
            i && "border-t border-border",
          )}
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.dot }} />
          <span className="flex flex-1 flex-col">
            <span className="text-[15px]">{o.label}</span>
            {o.sub ? <span className="text-xs text-subtle">{o.sub}</span> : null}
          </span>
        </button>
      ))}
      {!opts.length ? (
        <span className="px-5 py-4 text-[14px] text-[var(--text-muted)]">Booking đã đóng, không còn thao tác.</span>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="h-[52px] border-t border-border text-[15px] font-semibold text-primary-ink"
      >
        Đóng
      </button>
    </div>
  )
}

export function ConfirmDialog({ c, onClose }: { c: Confirm; onClose: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label={c.title}
      className="fixed inset-x-6 top-1/2 z-[55] flex -translate-y-1/2 flex-col gap-3 rounded-[22px] bg-surface-1 p-5 shadow-[var(--shadow-float)]"
    >
      <span className="text-[17px] font-semibold text-tx-strong">{c.title}</span>
      <span className="text-[14px] text-pretty text-[var(--text-muted)]">{c.body}</span>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-12 flex-1 rounded-xl border border-strong text-[15px] text-tx-1"
        >
          Quay lại
        </button>
        <button
          type="button"
          onClick={() => {
            onClose()
            void c.run()
          }}
          className="h-12 flex-1 rounded-xl bg-st-noshow text-[15px] font-medium text-white"
        >
          {c.label}
        </button>
      </div>
    </div>
  )
}

/** 30': stays until the host picks an action. Never auto-cancels, never releases the table. */
export function Alert30({ r, onAck }: { r: ReservationView; onAck: () => void }) {
  const m = useM()
  const a = useMobileActions()
  return (
    <div
      role="alertdialog"
      aria-labelledby="m-a30"
      className="fixed inset-x-5 top-1/2 z-[55] flex -translate-y-1/2 flex-col gap-4 rounded-[22px] border-[1.5px] border-st-noshow bg-surface-1 px-[18px] pt-5 pb-4 shadow-[var(--shadow-float)]"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-st-noshow-tint text-st-noshow-ink">
          <TriangleAlert className="size-[22px]" />
        </span>
        <span id="m-a30" className="text-lg font-semibold text-tx-strong">
          {r.displayName} đã trễ {m.th.noshow} phút
        </span>
        <span className="text-[14px] text-tx-2">
          {r.partySize} khách, {tableText(r.tableIds, m.model)}, hẹn {fmtTime12(r.expectedAt)}
        </span>
        <span className="text-[13px] text-pretty text-[var(--text-muted)]">
          Booking và bàn vẫn được giữ. Hệ thống không tự hủy, không tự nhả bàn.
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            onAck()
            void a.checkIn(r)
          }}
          className="h-[50px] rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          Khách đã đến
        </button>
        <button
          type="button"
          onClick={() => {
            onAck()
            a.noShow(r)
          }}
          className="h-[50px] rounded-[14px] border border-strong text-[15px] font-medium text-st-noshow-ink"
        >
          Xác nhận không đến
        </button>
        <button type="button" onClick={onAck} className="h-11 rounded-xl text-[14px] text-tx-2">
          Đã xem, xử lý sau
        </button>
      </div>
    </div>
  )
}

/** 15': light banner, never blocks. */
export function Toast15({ r, onView, onClose }: { r: ReservationView; onView: () => void; onClose: () => void }) {
  const m = useM()
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(var(--top-safe)+8px)] z-[42] flex items-center gap-2.5 rounded-[18px] border border-border bg-surface-1 py-2.5 pr-1.5 pl-3 shadow-[var(--shadow-float)]"
    >
      <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-st-late-tint text-st-late-ink">
        <Clock className="size-[17px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-semibold text-tx-strong">
          {r.displayName} đã trễ {m.th.late} phút
        </span>
        <span className="truncate text-[13px] text-[var(--text-muted)]">
          {r.partySize} khách, {tableText(r.tableIds, m.model)}, hẹn {fmtTime12(r.expectedAt)}
        </span>
      </span>
      <button
        type="button"
        onClick={onView}
        className="h-11 shrink-0 rounded-xl px-2.5 text-[14px] font-semibold text-primary-ink"
      >
        Xem
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng thông báo"
        className="grid h-11 w-9 shrink-0 place-items-center text-subtle"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
