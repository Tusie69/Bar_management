/**
 * Admin · Hồ sơ khách — một trang riêng cho mỗi khách (`/admin/customers/:id`).
 *
 * Chỉ hiện dữ liệu `CustomerProfile` thật sự có. Chi tiêu chưa có nguồn nên
 * hiện "Chưa có dữ liệu", không bao giờ hiện số 0 thay cho dữ liệu thiếu.
 */
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  EyeOff,
  Footprints,
  GitMerge,
  ListOrdered,
  NotebookPen,
  SearchX,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useLocation } from "react-router"
import { BarChart } from "@/components/bar-chart"
import { TableCodes } from "@/components/common"
import { RevealPhone } from "@/components/reveal-phone"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RESERVATION_STATUS_LABEL, SOURCE_LABEL, type VisitOrigin } from "@/domain/enums"
import type { ReservationView, VisitView } from "@/domain/models"
import { useCatalog, useCustomer, useNow } from "@/hooks/use-data"
import { fmtBusinessDate, fmtElapsed, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { ApiError } from "@/services/contracts"
import { CUSTOMERS_PATH, CustomerAvatar, CustomerName, DemoBadge } from "./customer-parts"
import {
  BOOKING_TONE,
  buildHistory,
  customerCode,
  fmtDate,
  groupByMonth,
  profileNotice,
  relativeDays,
  visitState,
  visitsPerMonth,
  VISIT_ORIGIN_TEXT,
  type HistoryFilter,
  type ProfileNotice,
  type ProfileWithStatus,
  type Tone,
} from "./customers-model"

const TONE_CLASS: Record<Tone, string> = {
  blue: "border-[var(--adm-action)]/20 bg-[var(--adm-tint-blue)] text-[var(--adm-action)]",
  green: "border-[var(--adm-state-inuse)]/25 bg-[var(--adm-tint-green)] text-[var(--admin-state-inuse-ink)]",
  amber: "border-[var(--adm-state-soon)]/30 bg-[var(--adm-tint-amber)] text-[var(--admin-state-soon-ink)]",
  red: "border-[var(--adm-state-late)]/25 bg-[var(--adm-tint-red)] text-[var(--admin-state-late-ink)]",
  neutral: "border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] text-[var(--adm-text-muted)]",
}

const ORIGIN_ICON: Record<VisitOrigin, LucideIcon> = {
  RESERVATION: CalendarCheck2,
  WALK_IN: Footprints,
  WAITLIST: ListOrdered,
}

type BackLink = { pathname: string; search: string }

export default function CustomerProfilePage({ id }: { id: number | null }) {
  const location = useLocation()
  const backTo: BackLink = { pathname: CUSTOMERS_PATH, search: location.search }
  const query = useCustomer(id)

  let body: React.ReactNode
  if (id === null) body = <ProfileProblem kind="notFound" backTo={backTo} />
  else if (query.isPending) body = <ProfileSkeleton />
  else if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : null
    body =
      status === 404 ? (
        <ProfileProblem kind="notFound" backTo={backTo} />
      ) : status === 403 ? (
        <ProfileProblem kind="forbidden" backTo={backTo} />
      ) : (
        <ProfileProblem
          kind="error"
          backTo={backTo}
          message={query.error instanceof Error ? query.error.message : null}
          onRetry={() => void query.refetch()}
        />
      )
  } else body = <ProfileBody profile={query.data} />

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={backTo}
          className="group -ml-2 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 pl-2 text-sm font-medium text-[var(--adm-text-muted)] transition-[background-color,color,transform] duration-150 outline-none hover:bg-[var(--adm-surface-sunken)] hover:text-[var(--adm-text)] focus-visible:outline-2 focus-visible:outline-[var(--adm-action)] active:scale-[0.98] xl:h-10 xl:min-h-10"
        >
          <ArrowLeft className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden />
          Danh sách khách
        </Link>
        <DemoBadge />
      </div>
      {body}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ProfileBody({ profile }: { profile: ProfileWithStatus }) {
  const now = useNow(60_000)
  const notice = profileNotice(profile)
  const anonymized = notice?.kind === "anonymized"
  const perMonth = visitsPerMonth(profile)

  return (
    <>
      {notice ? <StatusNotice notice={notice} /> : null}

      <section data-adm-reveal aria-labelledby="customer-name" className="adm-card min-w-0 overflow-hidden">
        <div className="bg-[var(--adm-surface)] px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            <span className="self-start rounded-full border border-[var(--adm-border-subtle)] bg-[var(--adm-surface)] p-1 shadow-[var(--shadow-xs)] sm:self-auto">
              <CustomerAvatar customer={profile} size={68} />
            </span>
            <div className="grid min-w-0 flex-1 gap-2">
              <h2 id="customer-name" className="adm-h1 min-w-0 break-words">
                <CustomerName name={profile.displayName} />
              </h2>
              <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <MetaItem label="Mã khách">
                  <span className="font-semibold tabular-nums">{customerCode(profile.id)}</span>
                </MetaItem>
                <MetaItem label="SĐT">
                  {anonymized ? (
                    <span className="text-[var(--adm-text-muted)]">Đã xóa khi ẩn danh</span>
                  ) : (
                    <RevealPhone customerId={profile.id} last3={profile.phoneLast3} />
                  )}
                </MetaItem>
                <MetaItem label="Tạo hồ sơ">
                  <span className="tabular-nums">{fmtDate(profile.createdAt)}</span>
                </MetaItem>
              </dl>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-[var(--adm-border-subtle)] bg-[var(--adm-border-subtle)] md:grid-cols-3 2xl:grid-cols-6">
          <Stat
            label="Tổng lượt ghé"
            value={profile.visitCount > 0 ? `${profile.visitCount}` : null}
            empty="Chưa ghé lần nào"
          />
          <Stat
            label="Lần ghé gần nhất"
            value={profile.lastVisitAt ? fmtDate(profile.lastVisitAt) : null}
            sub={relativeDays(profile.lastVisitAt, now)}
            empty="Chưa ghé lần nào"
          />
          <Stat
            label="TB lượt / tháng"
            value={perMonth === null ? null : perMonth.toLocaleString("vi-VN")}
            sub="Tính trên 90 ngày gần nhất"
            empty="Chưa đủ dữ liệu"
          />
          <Stat
            label="Khách TB / lượt"
            value={profile.averageParty === null ? null : profile.averageParty.toLocaleString("vi-VN")}
            sub="người mỗi lần ghé"
            empty="Chưa đủ dữ liệu"
          />
          <Stat label="Tổng chi tiêu" value={null} empty="Chưa có dữ liệu" sub="Cần dữ liệu hóa đơn (đợt 2)" />
          <Stat label="Chi tiêu TB / lượt" value={null} empty="Chưa có dữ liệu" sub="Cần dữ liệu hóa đơn (đợt 2)" />
        </dl>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <HistorySection profile={profile} />
        <aside className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section
            data-adm-reveal
            aria-labelledby="customer-notes"
            className="adm-card grid content-start gap-2.5 p-4 sm:p-5"
          >
            <h2 id="customer-notes" className="adm-h3 flex items-center gap-2">
              <NotebookPen className="size-4 text-[var(--adm-text-muted)]" aria-hidden />
              Ghi chú phục vụ
            </h2>
            {profile.notes ? (
              <p className="adm-body rounded-xl border border-[var(--adm-state-soon)]/20 bg-[color-mix(in_oklab,var(--adm-tint-amber)_55%,var(--adm-surface))] px-3.5 py-3 break-words whitespace-pre-line">
                {profile.notes}
              </p>
            ) : (
              <p className="adm-body text-[var(--adm-text-muted)]">Chưa có ghi chú phục vụ cho khách này.</p>
            )}
          </section>

          <section
            data-adm-reveal
            aria-labelledby="customer-months"
            className="adm-card grid content-start gap-3 p-4 sm:p-5"
          >
            <div className="grid gap-0.5">
              <h2 id="customer-months" className="adm-h3">
                Lượt ghé 6 tháng
              </h2>
              <p className="adm-caption">Đếm theo lượt ngồi bàn, không tính booking.</p>
            </div>
            {profile.visitCount > 0 ? (
              <BarChart
                ariaLabel="Số lượt ghé theo tháng, 6 tháng gần nhất"
                series={["Lượt ghé"]}
                data={profile.visitsByMonth.map((m) => ({
                  key: m.month,
                  label: `T${Number(m.month.slice(5))}`,
                  values: [m.count],
                }))}
                height={130}
                unit=" lượt"
              />
            ) : (
              <p className="adm-body text-[var(--adm-text-muted)]">Chưa có lượt ghé để vẽ biểu đồ.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="text-[var(--adm-text-muted)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/**
 * Ô số liệu. Đường kẻ dọc giữa các ô dùng `gap-px` trên nền viền, nên tự đúng
 * ở mọi số cột (2 / 3 / 6) mà không cần tính `nth-child`.
 */
function Stat({
  label,
  value,
  sub,
  empty,
}: {
  label: string
  value: string | null
  sub?: string | null
  empty: string
}) {
  return (
    <div className="grid content-start gap-1 bg-[var(--adm-surface)] px-4 py-3.5 sm:px-5">
      <dt className="adm-kpi-label">{label}</dt>
      {value === null ? (
        // Thiếu dữ liệu hiện gạch ngang kèm lý do, không bao giờ là số 0.
        <dd className="grid gap-0.5">
          <span className="adm-kpi-value text-[var(--adm-border-strong)]" aria-hidden>
            —
          </span>
          <span className="adm-caption">
            {empty}
            {empty === "Chưa có dữ liệu" && sub ? ` · ${sub}` : ""}
          </span>
        </dd>
      ) : (
        <dd className="grid gap-0.5">
          {/* Ngày đầy đủ (10 ký tự) không vừa ô nửa màn hình điện thoại ở cỡ số lớn. */}
          <span
            className={cn(
              "adm-kpi-value tabular-nums",
              value.length > 6 && "max-sm:text-[clamp(1.0625rem,5vw,1.5rem)]!",
            )}
          >
            {value}
          </span>
          {sub ? <span className="adm-caption">{sub}</span> : null}
        </dd>
      )}
    </div>
  )
}

/* ---------------- Lịch sử ---------------- */

function HistorySection({ profile }: { profile: ProfileWithStatus }) {
  const [filter, setFilter] = useState<HistoryFilter>("all")
  const catalog = useCatalog()
  const groups = useMemo(() => groupByMonth(buildHistory(profile, filter)), [profile, filter])
  const codes = (ids: number[]) =>
    ids.map((tid) => {
      const table = catalog.data?.tables.find((t) => t.id === tid)
      return table ? (table.kind === "BAR_SEAT" ? `Bar ${table.seqNo}` : table.code) : `#${tid}`
    })
  const truncated = profile.visits.length >= 25 || profile.reservations.length >= 25
  const tabs: { id: HistoryFilter; label: string; count: number }[] = [
    { id: "all", label: "Tất cả", count: profile.visits.length + profile.reservations.length },
    { id: "visit", label: "Lượt ghé", count: profile.visits.length },
    { id: "booking", label: "Booking", count: profile.reservations.length },
  ]

  return (
    <section data-adm-reveal aria-labelledby="customer-history" className="adm-card min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="customer-history" className="adm-h2">
            Lịch sử khách
          </h2>
          <p className="adm-caption flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--adm-state-inuse)]" aria-hidden />
              Lượt ghé: khách đã ngồi bàn
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border border-dashed border-[var(--adm-action)]" aria-hidden />
              Booking: lời hẹn đặt trước
            </span>
          </p>
        </div>
        <div
          role="group"
          aria-label="Lọc lịch sử"
          className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--adm-action)] xl:h-9 xl:min-h-9",
                filter === tab.id
                  ? "bg-[var(--adm-surface)] text-[var(--adm-text)] shadow-[var(--shadow-xs)]"
                  : "text-[var(--tx-2)] hover:text-[var(--adm-text)]",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  filter === tab.id ? "text-[var(--adm-text-muted)]" : "text-[var(--tx-2)]",
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="mt-5 grid justify-items-center gap-2 rounded-xl border border-dashed border-[var(--adm-border)] bg-[var(--adm-canvas)]/60 px-6 py-10 text-center">
          <CalendarClock className="size-5 text-[var(--adm-text-muted)]" aria-hidden />
          <p className="adm-body text-[var(--adm-text-muted)]">
            {filter === "booking"
              ? "Khách chưa có booking nào."
              : filter === "visit"
                ? "Khách chưa ngồi bàn lần nào."
                : "Chưa có lượt ghé hay booking nào cho khách này."}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-2.5">
              <h3 className="adm-caption font-semibold text-[var(--adm-text)]">{group.label}</h3>
              <ol className="grid">
                {group.events.map((event, index) => (
                  <li
                    key={`${event.kind}-${event.kind === "visit" ? event.visit.id : event.booking.id}`}
                    className="group relative grid grid-cols-[36px_minmax(0,1fr)] gap-3 pb-3 last:pb-0"
                  >
                    {index < group.events.length - 1 ? (
                      <span className="absolute top-9 bottom-0 left-[17.5px] w-px bg-[var(--adm-border)]" aria-hidden />
                    ) : null}
                    {event.kind === "visit" ? (
                      <VisitEvent visit={event.visit} codes={codes(event.visit.tableIds)} />
                    ) : (
                      <BookingEvent booking={event.booking} codes={codes(event.booking.tableIds)} />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {truncated ? (
        <p className="adm-caption mt-4 border-t border-[var(--adm-border-subtle)] pt-3">
          Đang hiện tối đa 25 lượt ghé và 25 booking gần nhất.
        </p>
      ) : null}
    </section>
  )
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}

function EventCard({ children, dashed }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-1.5",
        dashed
          ? "rounded-lg border border-dashed border-[var(--adm-border-strong)] bg-[var(--adm-canvas)]/55 px-3 py-2.5 transition-colors duration-150 hover:bg-[var(--adm-canvas)]"
          : "border-b border-[var(--adm-border-subtle)] pt-1 pb-3 group-last:border-b-0 group-last:pb-0",
      )}
    >
      {children}
    </div>
  )
}

function Meta({ parts }: { parts: React.ReactNode[] }) {
  const items = parts.filter(Boolean)
  return (
    <p className="adm-supporting flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
      {items.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 ? (
            <span className="text-[var(--adm-border-strong)]" aria-hidden>
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </p>
  )
}

function VisitEvent({ visit, codes }: { visit: VisitView; codes: string[] }) {
  const state = visitState(visit)
  const Icon = ORIGIN_ICON[visit.origin]
  // Lượt hoàn tất là sự kiện thật đã xảy ra: nút xanh đặc, khác hẳn nút booking viền đứt.
  const nodeTone: Tone = state.tone === "neutral" && visit.endReason !== "MERGED" ? "green" : state.tone
  return (
    <>
      <span
        className={cn("relative z-[1] grid size-9 place-items-center rounded-full border", TONE_CLASS[nodeTone])}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <EventCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="adm-body font-semibold">{VISIT_ORIGIN_TEXT[visit.origin]}</p>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
        <Meta
          parts={[
            <span key="d">
              {fmtBusinessDate(visit.businessDate, "short")} · {fmtTime(visit.startedAt)}
              {visit.endedAt ? `–${fmtTime(visit.endedAt)}` : " → nay"}
            </span>,
            visit.endedAt ? (
              <span key="t">ngồi {fmtElapsed(visit.endedAt.getTime() - visit.startedAt.getTime())}</span>
            ) : null,
            <span key="g">{visit.guestCount} khách</span>,
            <TableCodes key="tb" codes={codes} symbolNo={visit.symbolNo} className="[&>span]:text-xs" />,
          ]}
        />
        {visit.note ? <p className="adm-caption break-words">“{visit.note}”</p> : null}
      </EventCard>
    </>
  )
}

function BookingEvent({ booking, codes }: { booking: ReservationView; codes: string[] }) {
  return (
    <>
      <span
        className="relative z-[1] grid size-9 place-items-center rounded-full border border-dashed border-[var(--adm-action)]/60 bg-[var(--adm-surface)] text-[var(--adm-action)]"
        aria-hidden
      >
        <CalendarClock className="size-4" />
      </span>
      <EventCard dashed>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="adm-body font-semibold">
            Booking{" "}
            <span className="font-normal text-[var(--adm-text-muted)]">· {SOURCE_LABEL[booking.sourceCode]}</span>
          </p>
          <Pill tone={BOOKING_TONE[booking.status]}>{RESERVATION_STATUS_LABEL[booking.status]}</Pill>
        </div>
        <Meta
          parts={[
            <span key="d">
              {fmtBusinessDate(booking.businessDate, "short")} · hẹn {fmtTime(booking.expectedAt)}
            </span>,
            <span key="g">{booking.partySize} khách</span>,
            codes.length ? (
              <TableCodes key="tb" codes={codes} symbolNo={booking.symbolNo} className="[&>span]:text-xs" />
            ) : null,
            booking.createdByName ? <span key="by">nhận bởi {booking.createdByName}</span> : null,
          ]}
        />
        {booking.note ? <p className="adm-caption break-words">“{booking.note}”</p> : null}
        {booking.closeReasonNote ? <p className="adm-caption break-words">Lý do: {booking.closeReasonNote}</p> : null}
      </EventCard>
    </>
  )
}

/* ---------------- Trạng thái ---------------- */

function StatusNotice({ notice }: { notice: NonNullable<ProfileNotice> }) {
  const location = useLocation()
  if (notice.kind === "merged") {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--adm-state-soon)]/30 bg-[var(--adm-tint-amber)] px-4 py-3"
      >
        <GitMerge className="size-5 shrink-0 text-[var(--admin-state-soon-ink)]" aria-hidden />
        <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
          <p className="adm-body font-semibold text-[var(--admin-state-soon-ink)]">Hồ sơ này đã được gộp</p>
          <p className="adm-caption text-[var(--admin-state-soon-ink)]">
            Lượt ghé mới được ghi vào hồ sơ đích. Hồ sơ này chỉ còn để tra cứu.
          </p>
        </div>
        {notice.targetId !== null ? (
          <Button asChild variant="outline" className="bg-[var(--adm-surface)]">
            <Link to={{ pathname: `${CUSTOMERS_PATH}/${notice.targetId}`, search: location.search }}>
              Mở hồ sơ {customerCode(notice.targetId)}
            </Link>
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] px-4 py-3"
    >
      <EyeOff className="size-5 shrink-0 text-[var(--adm-text-muted)]" aria-hidden />
      <div className="grid min-w-0 gap-0.5">
        <p className="adm-body font-semibold">Hồ sơ đã ẩn danh</p>
        <p className="adm-caption">
          Tên và số điện thoại đã bị xóa vĩnh viễn, không thể khôi phục. Chỉ còn số liệu lượt ghé.
        </p>
      </div>
    </div>
  )
}

const PROBLEM = {
  notFound: {
    icon: SearchX,
    title: "Không tìm thấy hồ sơ khách",
    body: "Hồ sơ không tồn tại hoặc không thuộc cơ sở này. Kiểm tra lại đường dẫn hoặc tìm khách từ danh sách.",
  },
  forbidden: {
    icon: ShieldAlert,
    title: "Bạn không có quyền xem hồ sơ này",
    body: "Tài khoản cần quyền xem thông tin khách (đã che số). Liên hệ Chủ quán nếu bạn cần quyền này.",
  },
  error: { icon: AlertTriangle, title: "Không tải được hồ sơ khách", body: "Lỗi không xác định." },
}

function ProfileProblem({
  kind,
  backTo,
  message,
  onRetry,
}: {
  kind: keyof typeof PROBLEM
  backTo: BackLink
  message?: string | null
  onRetry?: () => void
}) {
  const content = PROBLEM[kind]
  const Icon = content.icon
  return (
    <section data-adm-reveal className="adm-card grid max-w-2xl justify-items-start gap-3 p-6">
      <span
        className={cn(
          "grid size-11 place-items-center rounded-xl border",
          kind === "error" ? TONE_CLASS.red : TONE_CLASS.neutral,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="adm-h2">{content.title}</h2>
      <p className="adm-body text-[var(--adm-text-muted)]">{message ?? content.body}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            Thử lại
          </Button>
        ) : null}
        <Button asChild variant="outline" className="bg-[var(--adm-surface)]">
          <Link to={backTo}>Về danh sách khách</Link>
        </Button>
      </div>
    </section>
  )
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <p className="sr-only">Đang tải hồ sơ khách…</p>
      <div className="adm-card grid gap-4 p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-[76px] rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-14" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96 rounded-[var(--radius-xl)]" />
        <Skeleton className="h-64 rounded-[var(--radius-xl)]" />
      </div>
    </div>
  )
}
