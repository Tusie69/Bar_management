import type { PreparationStation, PreparationTicket } from "./preparation-queue-data"

type PreparationLine = PreparationTicket["lines"][number]

export interface PreparationGroupedCancellationSummary {
  groupedLineCount: number
  groupedQuantity: number
  activeLineCount: number
  coversAllActiveLines: boolean
  hasSingleLinePendingAlongsideGroup: boolean
  groupCount: number
}

export function isGroupedPendingCancellation(line: PreparationLine): boolean {
  return line.quantity > 0 && line.pendingCancellation?.groupId != null
}

/**
 * Chỉ tóm tắt phần dữ liệu station hiện tại thực sự nhìn thấy. `groupId` cho
 * biết một dòng thuộc thao tác "Hủy đơn?", nhưng không chứng minh station kia
 * cũng đang chờ duyệt; vì vậy helper không tạo kết luận cấp order.
 */
export function summarizePreparationGroupedCancellation(
  lines: readonly PreparationLine[],
): PreparationGroupedCancellationSummary | null {
  const activeLines = lines.filter((line) => line.quantity > 0)
  const groupedLines = activeLines.filter(isGroupedPendingCancellation)
  if (groupedLines.length === 0) return null

  const groupIds = new Set(groupedLines.map((line) => line.pendingCancellation!.groupId!))
  const hasSingleLinePendingAlongsideGroup = activeLines.some(
    (line) => line.pendingCancellation !== null && line.pendingCancellation.groupId === null,
  )
  const coversAllActiveLines =
    activeLines.length > 0 &&
    groupIds.size === 1 &&
    activeLines.every((line) => line.pendingCancellation?.groupId != null)

  return {
    groupedLineCount: groupedLines.length,
    groupedQuantity: groupedLines.reduce((total, line) => total + Math.max(0, line.pendingCancellation!.quantity), 0),
    activeLineCount: activeLines.length,
    coversAllActiveLines,
    hasSingleLinePendingAlongsideGroup,
    groupCount: groupIds.size,
  }
}

function stationPartLabel(station: PreparationStation): "Bar" | "Bếp" {
  return station === "BAR" ? "Bar" : "Bếp"
}

export function preparationGroupedCancellationTitle(
  station: PreparationStation,
  summary: PreparationGroupedCancellationSummary,
): string {
  const stationLabel = stationPartLabel(station)
  return summary.coversAllActiveLines
    ? `Toàn bộ phần ${stationLabel} của phiếu đang chờ duyệt hủy theo đơn.`
    : `Một phần phiếu ${stationLabel} thuộc yêu cầu hủy theo đơn đang chờ duyệt.`
}

export function preparationGroupedCancellationDetail(summary: PreparationGroupedCancellationSummary): string {
  return `${summary.groupedLineCount} dòng · ${summary.groupedQuantity} phần đang chờ duyệt.`
}
