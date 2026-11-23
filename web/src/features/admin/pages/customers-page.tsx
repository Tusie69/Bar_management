/**
 * Admin · Khách hàng — danh sách và cửa vào hồ sơ riêng của từng khách.
 *
 * `/admin/customers` là danh sách, `/admin/customers/:id` là hồ sơ. Tìm kiếm và
 * bộ lọc nằm trên URL (`?q=&f=`) nên quay lại từ hồ sơ vẫn giữ nguyên trạng thái.
 *
 * Dữ liệu đi qua `searchCustomers` / `getCustomer` có sẵn. Backend v1 chưa có hai
 * endpoint này, nên chế độ HTTP hiện thông báo thay vì số liệu giả; chế độ mock
 * hiện dữ liệu mô phỏng có nhãn DEMO.
 */
import { AlertTriangle, ChevronRight, PlugZap, Search, Users, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useParams, useSearchParams } from "react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CustomerSummary } from "@/domain/models"
import { useCustomers, useNow } from "@/hooks/use-data"
import { maskedPhone } from "@/lib/text"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { CUSTOMERS_PATH, CustomerAvatar, CustomerName, DemoBadge } from "./customer-parts"
import CustomerProfilePage from "./customer-profile"
import {
  customerCode,
  fmtDate,
  isSegment,
  matchesSegment,
  relativeDays,
  SEGMENTS,
  type CustomerSegment,
} from "./customers-model"

const PAGE_SIZE = 20

export default function AdminCustomersPage() {
  const splat = useParams()["*"] ?? ""
  if (api.mode === "http") return <NotConnected />
  if (!splat) return <CustomerList />
  const id = /^\d+$/.test(splat) ? Number(splat) : null
  return <CustomerProfilePage key={splat} id={id} />
}

/* ------------------------------------------------------------------ */

function CustomerList() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get("q") ?? ""
  const rawSegment = params.get("f")
  const segment: CustomerSegment = isSegment(rawSegment) ? rawSegment : "all"
  const [draft, setDraft] = useState(urlQuery)
  const [shown, setShown] = useState(PAGE_SIZE)
  const inputRef = useRef<HTMLInputElement>(null)

  // Gõ tới đâu lọc tới đó, nhưng chỉ ghi URL sau một nhịp để lịch sử trình duyệt không bị ngập.
  useEffect(() => {
    if (draft === urlQuery) return
    const timer = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (draft.trim()) next.set("q", draft)
          else next.delete("q")
          return next
        },
        { replace: true },
      )
      setShown(PAGE_SIZE)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [draft, urlQuery, setParams])

  const list = useCustomers(urlQuery)
  // Đồng hồ của ứng dụng (mock có giờ mô phỏng), không phải giờ máy.
  const now = useNow(60_000)
  const all = list.data ?? []
  const counts = Object.fromEntries(
    SEGMENTS.map((s) => [s.id, all.filter((c) => matchesSegment(c, s.id, now)).length]),
  ) as Record<CustomerSegment, number>
  const rows = all.filter((c) => matchesSegment(c, segment, now))
  const visible = rows.slice(0, shown)

  const setSegment = (id: CustomerSegment) => {
    setShown(PAGE_SIZE)
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id === "all") next.delete("f")
        else next.set("f", id)
        return next
      },
      { replace: true },
    )
  }

  const clearSearch = () => {
    setDraft("")
    inputRef.current?.focus()
  }

  const trimmedDraft = draft.trim()
  const phoneHint = /^\d+$/.test(trimmedDraft) && trimmedDraft.length !== 3

  return (
    <div className="grid min-w-0 gap-4">
      <div data-adm-reveal className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="grid min-w-0 flex-1 basis-72 gap-1.5 md:max-w-md">
            <label htmlFor="customer-search" className="sr-only">
              Tìm khách
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--adm-text-muted)]"
                aria-hidden
              />
              <Input
                ref={inputRef}
                id="customer-search"
                type="search"
                autoComplete="off"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && draft) clearSearch()
                }}
                placeholder="Tên khách hoặc 3 số cuối SĐT"
                aria-describedby="customer-search-hint"
                className="h-11 bg-[var(--adm-surface)] pr-10 pl-10 [&::-webkit-search-cancel-button]:hidden"
              />
              {draft ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Xóa tìm kiếm"
                  className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[var(--adm-text-muted)] transition-colors hover:bg-[var(--adm-surface-sunken)] hover:text-[var(--adm-text)] focus-visible:outline-2 focus-visible:outline-[var(--adm-action)]"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <p
              id="customer-search-hint"
              className={cn("adm-caption", phoneHint ? "text-[var(--admin-state-soon-ink)]" : "sr-only")}
            >
              {phoneHint
                ? "Tìm theo số điện thoại chỉ nhận đúng 3 số cuối."
                : "Số điện thoại chỉ tìm được bằng 3 số cuối, số đầy đủ không hiển thị."}
            </p>
          </div>
          <DemoBadge className="mt-2 sm:ml-auto" />
        </div>

        <div
          role="group"
          aria-label="Lọc khách"
          className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0"
        >
          {SEGMENTS.map((item) => {
            const active = item.id === segment
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                title={item.hint}
                onClick={() => setSegment(item.id)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-action)] active:scale-[0.97] xl:h-10",
                  active
                    ? "border-[var(--adm-action)]/40 bg-[var(--adm-tint-blue)] text-[var(--adm-action-active)]"
                    : "border-[var(--adm-border)] bg-[var(--adm-surface)] text-[var(--adm-text)] hover:bg-[var(--adm-surface-sunken)]",
                )}
              >
                {item.label}
                {list.data ? (
                  <span
                    className={cn(
                      "min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums",
                      active
                        ? "bg-[var(--adm-surface)] text-[var(--adm-action-active)]"
                        : "bg-[var(--adm-surface-sunken)] text-[var(--adm-text-muted)]",
                    )}
                  >
                    {counts[item.id]}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <section data-adm-reveal aria-labelledby="customer-list-title" className="adm-card min-w-0 overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
          <h2 id="customer-list-title" className="adm-h2 min-w-0 break-words">
            {urlQuery.trim() ? `Kết quả cho “${urlQuery.trim()}”` : "Danh sách khách"}
          </h2>
          {list.data ? (
            <p className="adm-supporting tabular-nums" aria-live="polite">
              {rows.length} khách{list.isFetching ? " · đang cập nhật…" : ""}
            </p>
          ) : null}
        </header>

        {list.isPending ? (
          <ListSkeleton />
        ) : list.isError ? (
          <ListError
            message={list.error instanceof Error ? list.error.message : null}
            onRetry={() => void list.refetch()}
          />
        ) : rows.length === 0 ? (
          <ListEmpty
            searching={urlQuery.trim() !== "" || segment !== "all"}
            onClear={() => {
              clearSearch()
              setSegment("all")
            }}
          />
        ) : (
          <>
            <ul className="border-t border-[var(--adm-border-subtle)] md:hidden">
              {visible.map((customer) => (
                <MobileRow key={customer.id} customer={customer} now={now} />
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Khách hàng</TableHead>
                    <TableHead className="hidden xl:table-cell">Mã khách</TableHead>
                    <TableHead>Số điện thoại</TableHead>
                    <TableHead className="text-right">Lượt ghé</TableHead>
                    <TableHead>Lần ghé gần nhất</TableHead>
                    <TableHead className="w-10 pr-4">
                      <span className="sr-only">Mở hồ sơ</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((customer) => (
                    <DesktopRow key={customer.id} customer={customer} now={now} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--adm-border-subtle)] px-4 py-3 sm:px-5">
              <p className="adm-caption tabular-nums">
                Đang hiện {visible.length} / {rows.length} khách
                {all.length >= 60 ? " · chỉ lấy 60 khách ghé gần nhất, hãy tìm để thu hẹp" : ""}
              </p>
              {visible.length < rows.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShown((n) => n + PAGE_SIZE)}
                  className="bg-[var(--adm-surface)]"
                >
                  Xem thêm {Math.min(PAGE_SIZE, rows.length - visible.length)} khách
                </Button>
              ) : null}
            </footer>
          </>
        )}
      </section>

      <p data-adm-reveal className="adm-caption px-1">
        Chi tiêu và phân hạng khách sẽ hiện khi hệ thống có dữ liệu hóa đơn (đợt 2).
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function useProfileLink(id: number) {
  const location = useLocation()
  return { pathname: `${CUSTOMERS_PATH}/${id}`, search: location.search }
}

function DesktopRow({ customer, now }: { customer: CustomerSummary; now: Date }) {
  const to = useProfileLink(customer.id)
  return (
    <TableRow className="group relative cursor-pointer transition-colors hover:bg-[var(--adm-tint-blue)]/45 has-[a:focus-visible]:bg-[var(--adm-tint-blue)]/60">
      <TableCell className="py-3 pl-5">
        <div className="flex min-w-0 items-center gap-3">
          <CustomerAvatar customer={customer} />
          <div className="min-w-0">
            {/* Liên kết phủ cả hàng: bấm chỗ nào trên hàng cũng mở hồ sơ, bàn phím chỉ dừng một lần. */}
            <Link to={to} className="block truncate outline-none after:absolute after:inset-0 after:content-['']">
              <CustomerName name={customer.displayName} />
            </Link>
            <span className="adm-caption block xl:hidden">{customerCode(customer.id)}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden text-[var(--adm-text-muted)] tabular-nums xl:table-cell">
        {customerCode(customer.id)}
      </TableCell>
      <TableCell className="text-[var(--adm-text-muted)] tabular-nums">
        {customer.phoneLast3 ? maskedPhone(customer.phoneLast3) : <span className="text-xs">Không có SĐT</span>}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {customer.visitCount > 0 ? (
          customer.visitCount
        ) : (
          <span className="font-normal text-[var(--adm-text-muted)]">—</span>
        )}
      </TableCell>
      <TableCell>
        {customer.lastVisitAt ? (
          <span className="grid">
            <span className="tabular-nums">{fmtDate(customer.lastVisitAt)}</span>
            <span className="adm-caption">{relativeDays(customer.lastVisitAt, now)}</span>
          </span>
        ) : (
          <span className="text-[var(--adm-text-muted)]">Chưa ghé</span>
        )}
      </TableCell>
      <TableCell className="pr-4">
        <ChevronRight
          className="size-4 text-[var(--adm-text-muted)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--adm-action)]"
          aria-hidden
        />
      </TableCell>
    </TableRow>
  )
}

function MobileRow({ customer, now }: { customer: CustomerSummary; now: Date }) {
  const to = useProfileLink(customer.id)
  return (
    <li className="border-b border-[var(--adm-border-subtle)] last:border-b-0">
      <Link
        to={to}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors outline-none hover:bg-[var(--adm-tint-blue)]/45 focus-visible:bg-[var(--adm-tint-blue)]/60 active:bg-[var(--adm-tint-blue)]/70"
      >
        <CustomerAvatar customer={customer} size={40} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <CustomerName name={customer.displayName} className="truncate" />
          <span className="adm-caption truncate tabular-nums">
            {customerCode(customer.id)} · {customer.phoneLast3 ? maskedPhone(customer.phoneLast3) : "Không có SĐT"}
          </span>
        </div>
        <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
          <span className="text-sm font-semibold tabular-nums">
            {customer.visitCount > 0 ? `${customer.visitCount} lượt` : "Chưa ghé"}
          </span>
          {customer.lastVisitAt ? <span className="adm-caption">{relativeDays(customer.lastVisitAt, now)}</span> : null}
        </div>
        <ChevronRight className="size-4 shrink-0 text-[var(--adm-text-muted)]" aria-hidden />
      </Link>
    </li>
  )
}

/* ------------------------------------------------------------------ */

function ListSkeleton() {
  return (
    <div className="border-t border-[var(--adm-border-subtle)]" aria-busy="true">
      <p className="sr-only">Đang tải danh sách khách…</p>
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="flex items-center gap-3 border-b border-[var(--adm-border-subtle)] px-5 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

function ListError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="mx-4 mb-4 grid gap-2.5 rounded-xl border border-[var(--adm-state-late)]/25 bg-[var(--adm-tint-red)] p-4 sm:mx-5">
      <p className="adm-h3 flex items-center gap-2 text-[var(--admin-state-late-ink)]">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Không tải được danh sách khách
      </p>
      <p className="adm-body break-words text-[var(--adm-text-muted)]">{message ?? "Lỗi không xác định."}</p>
      <Button type="button" variant="outline" onClick={onRetry} className="justify-self-start bg-[var(--adm-surface)]">
        Thử lại
      </Button>
    </div>
  )
}

function ListEmpty({ searching, onClear }: { searching: boolean; onClear: () => void }) {
  return (
    <div className="grid justify-items-center gap-2 border-t border-[var(--adm-border-subtle)] px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] text-[var(--adm-text-muted)]">
        {searching ? <Search className="size-5" aria-hidden /> : <Users className="size-5" aria-hidden />}
      </span>
      <p className="adm-h3 mt-1">{searching ? "Không tìm thấy khách phù hợp" : "Chưa có hồ sơ khách nào"}</p>
      <p className="adm-body max-w-sm text-[var(--adm-text-muted)]">
        {searching
          ? "Thử tên khác, đúng 3 số cuối SĐT, hoặc bỏ bộ lọc đang chọn."
          : "Hồ sơ được tạo khi lễ tân nhận booking hoặc khách walk-in có tên hay số điện thoại."}
      </p>
      {searching ? (
        <Button type="button" variant="outline" onClick={onClear} className="mt-2 bg-[var(--adm-surface)]">
          Xóa tìm kiếm và bộ lọc
        </Button>
      ) : null}
    </div>
  )
}

function NotConnected() {
  return (
    <section data-adm-reveal className="adm-card grid max-w-2xl gap-4 p-6" aria-labelledby="customers-not-connected">
      <span className="grid size-11 place-items-center rounded-xl border border-[var(--adm-action)]/20 bg-[var(--adm-tint-blue)]">
        <PlugZap className="size-5 text-[var(--adm-action)]" aria-hidden />
      </span>
      <div className="grid gap-1.5">
        <h2 id="customers-not-connected" className="adm-h2">
          Chưa kết nối dữ liệu khách hàng
        </h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Giao diện danh sách và hồ sơ khách đã sẵn sàng, nhưng máy chủ chưa có API tìm khách và xem hồ sơ khách. Trang
          sẽ hiện dữ liệu thật ngay khi hai API này được bật.
        </p>
      </div>
      <p className="adm-supporting border-t border-[var(--adm-border-subtle)] pt-3">
        Trong lúc chờ, lịch sử từng lượt khách vẫn xem được ở mục Sổ lượt.
      </p>
    </section>
  )
}
