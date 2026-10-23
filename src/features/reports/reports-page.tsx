import { Lock } from "lucide-react"
import { useMemo, useState } from "react"
import { BarChart } from "@/components/bar-chart"
import { EmptyState, PendingTag, SectionTitle } from "@/components/common"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ReportQuery } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useBusinessDate, useReport } from "@/hooks/use-data"
import { addDays, fmtBusinessDate, fmtDayMonth } from "@/lib/time"
import { useCan } from "@/state/session"

type Range = "today" | "7" | "30"

export default function ReportsPage() {
  const allowed = useCan("report.read")
  const today = useBusinessDate()
  const [range, setRange] = useState<Range>("7")
  const [zone, setZone] = useState<ZoneCode | "ALL">("ALL")
  const q: ReportQuery = useMemo(() => {
    if (range === "today") return { from: today, to: today, zone }
    const days = Number(range)
    return { from: addDays(today, -days), to: addDays(today, -1), zone }
  }, [range, zone, today])
  const report = useReport(q, allowed)
  const r = report.data

  if (!allowed) {
    return (
      <EmptyState title="Báo cáo chỉ dành cho Chủ quán / Admin" icon={<Lock />} className="h-full">
        Đổi vai trò ở góc phải trên cùng để xem bản demo.
      </EmptyState>
    )
  }

  const maxTurns = Math.max(1, ...(r?.byTable ?? []).map((t) => t.turns))

  return (
    <div className="h-full scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] gap-6 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Hoạt động & báo cáo</p>
            <h2 className="mt-1 text-xl font-bold">
              {q.from === q.to ? fmtBusinessDate(q.from) : `${fmtDayMonth(q.from)} → ${fmtDayMonth(q.to)}`}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              value={range}
              onValueChange={(v) => v && setRange(v as Range)}
              aria-label="Khoảng thời gian"
            >
              <ToggleGroupItem value="today" className="px-3">
                Ca hôm nay
              </ToggleGroupItem>
              <ToggleGroupItem value="7" className="px-3">
                7 ngày
              </ToggleGroupItem>
              <ToggleGroupItem value="30" className="px-3">
                30 ngày
              </ToggleGroupItem>
            </ToggleGroup>
            <Select value={zone} onValueChange={(v) => setZone(v as ZoneCode | "ALL")}>
              <SelectTrigger className="h-10 w-[130px]" aria-label="Khu vực">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Mọi khu</SelectItem>
                <SelectItem value="A">Khu A</SelectItem>
                <SelectItem value="B">Khu B</SelectItem>
                <SelectItem value="C">Khu C</SelectItem>
                <SelectItem value="BAR">Quầy Bar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </header>

        {!r ? (
          <div className="grid gap-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-4 xl:grid-cols-7">
              <Metric k="Lượt ghé (visit)" v={r.visits} />
              <Metric k="Tổng khách thực tế" v={r.guests} />
              <Metric k="Lượt sử dụng bàn" v={r.tableTurns} />
              <Metric k="Ghép bàn" v={r.combines} />
              <Metric k="Đổi bàn" v={r.moves} />
              <Metric k="Tách bàn" v={r.splits} />
              <Metric k="Giải phóng bàn" v={r.releases} />
            </dl>

            <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
              <section className="grid min-w-0 content-start gap-3 rounded-2xl border p-4 md:p-5">
                <SectionTitle aside={<span className="text-xs text-subtle">theo ngày kinh doanh</span>}>
                  Lượt ghé
                </SectionTitle>
                <BarChart
                  ariaLabel="Số lượt ghé theo ngày kinh doanh"
                  series={["Lượt ghé"]}
                  data={r.byDate.map((d) => ({ key: d.date, label: fmtDayMonth(d.date), values: [d.visits] }))}
                  labelEvery={r.byDate.length > 14 ? 3 : 1}
                  height={150}
                  unit=" lượt"
                />
                <SectionTitle className="mt-2">Tổng khách thực tế</SectionTitle>
                <BarChart
                  ariaLabel="Tổng khách thực tế theo ngày kinh doanh"
                  series={["Khách"]}
                  data={r.byDate.map((d) => ({ key: d.date, label: fmtDayMonth(d.date), values: [d.guests] }))}
                  labelEvery={r.byDate.length > 14 ? 3 : 1}
                  height={150}
                  unit=" khách"
                />
              </section>
              <section className="grid content-start gap-3 rounded-2xl border p-4 md:p-5">
                <SectionTitle>Cách đếm</SectionTitle>
                <ul className="grid gap-2 text-sm text-muted-foreground">
                  <li>
                    <b className="text-foreground">Lượt ghé</b> và <b className="text-foreground">tổng khách</b> chỉ lấy
                    từ bảng visits: một đoàn ngồi nhiều bàn vẫn là 1 lượt, khách không bị đếm trùng.
                  </li>
                  <li>
                    <b className="text-foreground">Lượt sử dụng bàn</b> = số cặp (lượt ghé, bàn) khác nhau. Ví dụ đoàn 8
                    khách ngồi B21 + B22 rồi đổi sang B4: B21 = 1, B22 = 1, B4 = 1; lượt ghé = 1, khách = 8.
                  </li>
                  <li>Ghép / đổi / tách / giải phóng lấy từ lịch sử table_allocations (không ghi đè).</li>
                  <li className="flex flex-wrap items-center gap-2">
                    Gộp hai lượt ghé thành 1 hay 2 khi tính KPI <PendingTag />
                  </li>
                </ul>
              </section>
            </div>

            <section className="grid gap-3 rounded-2xl border p-4 md:p-5">
              <SectionTitle aside={<span className="text-xs text-subtle">{r.byTable.length} bàn/ghế có sử dụng</span>}>
                Lượt sử dụng theo bàn
              </SectionTitle>
              <ol className="grid gap-x-8 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
                {r.byTable.map((t) => (
                  <li key={t.tableId} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="font-semibold">
                      {t.zone === "BAR" ? t.code.replace("BAR", "Bar ").replace(" 0", " ") : t.code}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-foreground/85"
                        style={{ width: `${(t.turns / maxTurns) * 100}%` }}
                      />
                    </span>
                    <span className="tnum text-right">{t.turns}</span>
                  </li>
                ))}
              </ol>
              {r.byTable.length === 0 ? (
                <p className="text-sm text-muted-foreground">Chưa có dữ liệu trong khoảng này.</p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Metric({ k, v }: { k: string; v: number }) {
  return (
    // 7 cells: the last one spans the leftover columns (2-col and 4-col layouts) so no empty cell shows.
    <div className="grid content-start gap-1 bg-background p-4 last:col-span-2 xl:last:col-span-1">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="tnum text-[26px] leading-none font-bold">{v}</dd>
    </div>
  )
}
