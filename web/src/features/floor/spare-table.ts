import type { TableLiveState, TableView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { api } from "@/services"

export type SpareDecision = { action: "mark" | "unmark"; allowed: boolean; reason?: string }

export function spareDecision(input: {
  table: TableView
  state: TableLiveState
  hasClaim: boolean
  inGroup: boolean
  canConfigure: boolean
}): SpareDecision {
  const action = input.table.isSpare ? "unmark" : "mark"
  if (!input.canConfigure) return { action, allowed: false, reason: "Bạn không có quyền quản lý bàn sơ cua." }
  if (input.inGroup) return { action, allowed: false, reason: "Bàn đang thuộc nhóm ghép. Vui lòng tách nhóm trước." }
  if (input.hasClaim || !["free", "spare", "oos"].includes(input.state)) {
    return { action, allowed: false, reason: "Không thể đổi sơ cua khi bàn có booking, khách hoặc đang được giữ." }
  }
  return { action, allowed: true }
}

export function useSpareToggle(): { toggle: (table: TableView) => Promise<boolean>; pending: boolean } {
  const { run, pending } = useAction()
  return {
    toggle: async (table) =>
      !!(await run(() =>
        api.setTableStatus(table.id, table.version, {
          isSpare: !table.isSpare,
          reason: "Nhân viên cập nhật cờ bàn sơ cua.",
        }),
      )),
    pending,
  }
}
