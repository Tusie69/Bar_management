import { useState } from "react"
import { fmtBusinessDate, fmtDayMonth } from "@/lib/time"
import type { DailyTurnPoint } from "./turns-helpers"
import { TurnsRadioGroup, type TurnsRadioOption } from "./turns-radio-group"

const DAILY_VIEW_OPTIONS: readonly TurnsRadioOption<"chart" | "table">[] = [
  { id: "chart", label: "Biểu đồ", testId: "turns-daily-mode-chart" },
  { id: "table", label: "Bảng", testId: "turns-daily-mode-table" },
]

interface TurnsDailyChartProps {
  days: readonly DailyTurnPoint[]
  /** TU-38: the venue's own shift ("17:00 → 05:00"), read from configuration by the page. */
  shiftLabel: string
}

function findPeakDay(days: readonly DailyTurnPoint[]): DailyTurnPoint | null {
  let peak: DailyTurnPoint | null = null
  for (const day of days) {
    if (!peak || day.turns > peak.turns || (day.turns === peak.turns && day.guests > peak.guests)) {
      peak = day
    }
  }
  return peak && peak.turns > 0 ? peak : null
}

/**
 * Daily business-date bar chart and compact table for multi-day ranges.
 * Every day in the selected range is rendered (0 when no turns exist).
 */
export function TurnsDailyChart({ days, shiftLabel }: TurnsDailyChartProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart")
  if (days.length === 0) return null

  const maxTurns = Math.max(1, ...days.map((d) => d.turns))
  const maxGuests = Math.max(1, ...days.map((d) => d.guests))
  const peak = findPeakDay(days)

  const summaryLine = peak
    ? `${days.length} ngày · Cao nhất ${fmtBusinessDate(peak.businessDate, "short")}: ${peak.turns} lượt (${peak.guests} khách)`
    : `${days.length} ngày · Chưa có lượt nào được ghi nhận`

  return (
    <section className="turns-card" aria-labelledby="turns-daily-heading" data-testid="turns-daily-section">
      <div className="turns-card-header turns-card-header-bordered">
        <div>
          <h2 id="turns-daily-heading" className="turns-card-title">
            Theo ngày
          </h2>
          <p className="turns-card-subtitle">{summaryLine}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Legend with pattern + shape differentiation (not color-only) */}
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--turns-muted)" }}>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-[3px]"
                style={{ backgroundColor: "var(--turns-blue)" }}
              />
              Lượt
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-[3px] border"
                style={{
                  borderColor: "var(--turns-navy)",
                  backgroundImage:
                    "repeating-linear-gradient(135deg, var(--turns-navy) 0, var(--turns-navy) 2px, transparent 2px, transparent 5px)",
                }}
              />
              Khách
            </span>
          </div>

          <TurnsRadioGroup
            ariaLabel="Kiểu hiển thị theo ngày"
            options={DAILY_VIEW_OPTIONS}
            value={viewMode}
            onValueChange={setViewMode}
            className="turns-segmented-track turns-segmented-track--compact"
            itemClassName="turns-segmented-item turns-segmented-item--compact"
          />
        </div>
      </div>

      {viewMode === "chart" ? (
        <div className="p-5">
          <div className="turns-table-scroll">
            <div
              role="img"
              aria-label={`Biểu đồ lượt và khách theo ngày: ${summaryLine}`}
              className="grid items-end gap-2.5"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(${days.length > 10 ? "68px" : "92px"}, 1fr))`,
              }}
              data-testid="turns-daily-bars"
            >
              {days.map((day) => {
                const turnsHeightPct = day.turns === 0 ? 0 : Math.max(8, Math.round((day.turns / maxTurns) * 100))
                const guestsHeightPct = day.guests === 0 ? 0 : Math.max(8, Math.round((day.guests / maxGuests) * 100))
                const shortLabel = fmtBusinessDate(day.businessDate, "short")
                const longLabel = `${fmtBusinessDate(day.businessDate, "long")}: ${day.turns} lượt, ${day.guests} khách`
                const isPeak = peak?.businessDate === day.businessDate

                return (
                  <div
                    key={day.businessDate}
                    aria-label={longLabel}
                    data-business-date={day.businessDate}
                    className="flex flex-col items-center gap-2 rounded-xl border px-2 py-2.5"
                    style={{
                      backgroundColor: isPeak ? "var(--turns-tint-blue)" : "var(--turns-canvas)",
                      borderColor: isPeak ? "color-mix(in oklab, var(--turns-blue) 28%, transparent)" : "transparent",
                    }}
                  >
                    <div className="text-center text-xs leading-4">
                      <div
                        className="font-semibold whitespace-nowrap"
                        style={{ color: day.turns === 0 ? "var(--turns-muted)" : "var(--turns-navy)" }}
                      >
                        {day.turns} lượt
                      </div>
                      <div className="font-medium whitespace-nowrap" style={{ color: "var(--turns-muted)" }}>
                        {day.guests} khách
                      </div>
                    </div>

                    <div
                      className="flex h-24 w-full items-end justify-center gap-1.5 border-b pb-0.5"
                      style={{ borderColor: "var(--turns-border)" }}
                      aria-hidden="true"
                    >
                      <div
                        className="w-4 rounded-t-[4px]"
                        style={{
                          height: `${turnsHeightPct}%`,
                          minHeight: day.turns === 0 ? "2px" : "6px",
                          backgroundColor: day.turns === 0 ? "var(--turns-border)" : "var(--turns-blue)",
                        }}
                      />
                      <div
                        className="w-4 rounded-t-[4px] border"
                        style={{
                          height: `${guestsHeightPct}%`,
                          minHeight: day.guests === 0 ? "2px" : "6px",
                          borderColor: day.guests === 0 ? "var(--turns-border)" : "var(--turns-navy)",
                          backgroundColor: day.guests === 0 ? "var(--turns-border)" : "transparent",
                          backgroundImage:
                            day.guests === 0
                              ? "none"
                              : "repeating-linear-gradient(135deg, var(--turns-navy) 0, var(--turns-navy) 2px, rgba(16,42,67,0.12) 2px, rgba(16,42,67,0.12) 5px)",
                        }}
                      />
                    </div>

                    <div className="text-center">
                      <div
                        className="text-xs leading-4 font-semibold"
                        style={{ color: isPeak ? "var(--turns-blue-ink)" : "var(--turns-text)" }}
                      >
                        {shortLabel.split(", ")[0]}
                      </div>
                      <div className="text-[11px] leading-4" style={{ color: "var(--turns-muted)" }}>
                        {fmtDayMonth(day.businessDate)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="mt-2.5 text-xs" style={{ color: "var(--turns-muted)" }}>
            Đọc nhanh: <strong>số lượt</strong> và <strong>số khách</strong> theo từng ngày kinh doanh {shiftLabel}.
          </p>
        </div>
      ) : (
        <div
          className="turns-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Bảng tổng hợp lượt và khách theo ngày"
        >
          <table className="turns-table" data-testid="turns-daily-table">
            <thead>
              <tr>
                <th>Ngày kinh doanh</th>
                <th className="text-right">Lượt</th>
                <th className="text-right">Khách</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.businessDate}>
                  <td className="font-medium">{fmtBusinessDate(day.businessDate, "long")}</td>
                  <td className="text-right font-semibold whitespace-nowrap">{day.turns} lượt</td>
                  <td className="text-right whitespace-nowrap">{day.guests} khách</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
