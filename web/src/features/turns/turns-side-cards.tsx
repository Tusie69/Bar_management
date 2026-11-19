import { Bot, Check, Layers, Square, X } from "lucide-react"
import type { TableTurnSummary } from "@/domain/models"
import { formatStaffName, resolveStaffIdentity, type ExtendedStaffBucket } from "./turns-helpers"

interface StaffBreakdownCardProps {
  byStaff: ExtendedStaffBucket[]
  selectedStaffId: number | undefined
  onSelectStaff: (staffId: number | undefined) => void
}

/**
 * Staff breakdown card ("Theo nhân viên") with required "Người check-in" column header.
 * Clicking a staff row toggles the staff filter on the turn history list.
 */
export function StaffBreakdownCard({ byStaff, selectedStaffId, onSelectStaff }: StaffBreakdownCardProps) {
  return (
    <section className="turns-card" aria-labelledby="turns-staff-heading" data-testid="turns-staff-card">
      <div className="turns-card-header turns-card-header-bordered">
        <div>
          <h2 id="turns-staff-heading" className="turns-card-title">
            Theo nhân viên
          </h2>
          <p className="turns-card-subtitle">Nhân sự thao tác check-in khách vào bàn</p>
        </div>

        {selectedStaffId !== undefined ? (
          <button
            type="button"
            onClick={() => onSelectStaff(undefined)}
            className="turns-filter-chip"
            data-testid="turns-staff-clear"
          >
            <X className="size-3.5" aria-hidden="true" />
            Bỏ lọc
          </button>
        ) : null}
      </div>

      {byStaff.length === 0 ? (
        <p className="px-5 py-6 text-sm" style={{ color: "var(--turns-muted)" }}>
          Chưa có dữ liệu nhân viên trong khoảng này.
        </p>
      ) : (
        <div className="turns-table-scroll" tabIndex={0} role="region" aria-label="Bảng lượt theo nhân viên check-in">
          <table className="turns-table" data-testid="turns-staff-table">
            <thead>
              <tr>
                <th scope="col">Người check-in</th>
                <th scope="col" className="text-right">
                  Lượt
                </th>
                <th scope="col" className="text-right">
                  Khách
                </th>
              </tr>
            </thead>
            <tbody>
              {byStaff.map((row) => {
                const { userId, displayName: rawDisplayName } = resolveStaffIdentity(row)
                const displayName = formatStaffName(userId, rawDisplayName)
                const isSystem = userId === null
                const isSelected = !isSystem && selectedStaffId === userId

                const handleToggle = () => {
                  if (userId === null) return
                  onSelectStaff(isSelected ? undefined : userId)
                }

                return (
                  <tr
                    key={userId === null ? "system" : `staff-${userId}`}
                    onClick={isSystem ? undefined : handleToggle}
                    data-staff-id={userId === null ? "null" : String(userId)}
                    data-selected={isSelected ? "true" : "false"}
                    data-state={isSelected ? "selected" : undefined}
                    style={{
                      cursor: isSystem ? "default" : "pointer",
                    }}
                  >
                    <td>
                      {isSystem ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-medium"
                          style={{ color: "var(--turns-muted)" }}
                        >
                          <Bot className="size-4 shrink-0" aria-hidden="true" />
                          <span>{displayName}</span>
                          <span className="turns-badge turns-badge-uncounted">Tự động</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleToggle()
                          }}
                          className="turns-staff-filter-btn"
                          style={{
                            color: isSelected ? "var(--turns-blue-ink)" : "var(--turns-text)",
                            fontWeight: isSelected ? 600 : 500,
                          }}
                          data-testid={`turns-staff-filter-${userId}`}
                        >
                          {isSelected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                          <span className="truncate">{displayName}</span>
                        </button>
                      )}
                    </td>
                    <td className="text-right font-semibold">{row.turns}</td>
                    <td className="text-right" style={{ color: "var(--turns-muted)" }}>
                      {row.guests}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

interface TopScopesCardProps {
  byScope: TableTurnSummary["byScope"]
}

/**
 * Top-10 most-seated tables and table groups from `summary.byScope`.
 * Renders the API aggregation directly without unnesting group members or recounting.
 */
export function TopScopesCard({ byScope }: TopScopesCardProps) {
  const top10 = byScope.slice(0, 10)

  return (
    <section className="turns-card" aria-labelledby="turns-top-scopes-heading" data-testid="turns-top-scopes-card">
      <div className="turns-card-header turns-card-header-bordered">
        <div>
          <h2 id="turns-top-scopes-heading" className="turns-card-title">
            Bàn được ngồi nhiều nhất
          </h2>
          <p className="turns-card-subtitle">Top 10 theo lượt mở bàn (giữ nguyên cụm bàn)</p>
        </div>
      </div>

      {top10.length === 0 ? (
        <p className="px-5 py-6 text-sm" style={{ color: "var(--turns-muted)" }}>
          Chưa có dữ liệu bàn trong khoảng này.
        </p>
      ) : (
        <div
          className="turns-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Bảng xếp hạng bàn và cụm được ngồi nhiều nhất"
        >
          <table className="turns-table" data-testid="turns-top-scopes-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Bàn / Cụm</th>
                <th scope="col" className="text-right">
                  Lượt
                </th>
                <th scope="col" className="text-right">
                  Khách
                </th>
              </tr>
            </thead>
            <tbody>
              {top10.map((item, index) => {
                const isGroup = item.scope === "GROUP"
                const isCombinedTable = !isGroup && item.label.includes("+")
                const badgeLabel = isGroup ? "Cụm" : isCombinedTable ? "Bàn ghép" : "Bàn"
                const badgeTitle = isGroup
                  ? "Cụm bàn cố định (tính chung một lượt cho cả cụm)"
                  : isCombinedTable
                    ? "Bàn ghép tạm (thống kê theo bàn đại diện)"
                    : "Bàn đơn"

                return (
                  <tr
                    key={`${item.scope}-${item.groupId ?? item.tableId ?? item.label}-${index}`}
                    data-scope-type={item.scope}
                  >
                    <td className="w-9">
                      <span className={index < 3 ? "turns-rank-pill turns-rank-pill--top" : "turns-rank-pill"}>
                        {index + 1}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold" style={{ color: "var(--turns-text)" }}>
                          {item.label}
                        </span>
                        <span
                          className={`turns-badge ${isGroup ? "turns-badge-group" : "turns-badge-table"}`}
                          title={badgeTitle}
                        >
                          {isGroup ? (
                            <Layers className="size-3" aria-hidden="true" />
                          ) : (
                            <Square className="size-3" aria-hidden="true" />
                          )}
                          {badgeLabel}
                        </span>
                      </div>
                    </td>
                    <td className="text-right font-semibold">{item.turns}</td>
                    <td className="text-right" style={{ color: "var(--turns-muted)" }}>
                      {item.guests}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {top10.length > 0 ? (
        <p className="turns-card-footnote" data-testid="turns-top-scopes-footnote">
          Bàn ghép tạm được thống kê theo bàn đại diện; cụm cố định tính chung một lượt cho cả cụm.
        </p>
      ) : null}
    </section>
  )
}
