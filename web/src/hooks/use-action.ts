/**
 * Runs a mutation with consistent UX:
 * - success toast that is honest about the mock ("bản mô phỏng"),
 *   with an inline Undo when the operation is undoable;
 * - OVERRIDE_REQUIRED -> asks for a reason, then retries once;
 * - 409 conflicts -> conflict dialog naming who changed what;
 * - everything else -> error toast.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import type { MutationResult } from "@/domain/models"
import { api, isApiError } from "@/services"
import { useUi } from "@/state/ui"

const CONFLICT_TITLE: Record<string, string> = {
  TABLE_CONFLICT: "Bàn không còn trống",
  VERSION_CONFLICT: "Dữ liệu vừa thay đổi",
  ENTRY_ALREADY_CLAIMED: "Người khác đang liên hệ",
  NO_SYMBOL_AVAILABLE: "Hết ký hiệu ghép bàn",
  UNDO_CONFLICT_MODIFIED: "Không thể hoàn tác",
}

export const MOCK_NOTE = "Bản mô phỏng: chỉ cập nhật dữ liệu trên máy này, chưa gửi máy chủ."

export function reportError(e: unknown) {
  const ui = useUi.getState()
  if (isApiError(e)) {
    if (CONFLICT_TITLE[e.code]) {
      ui.showConflict({
        title: CONFLICT_TITLE[e.code],
        message: e.message,
        by: typeof e.details.by === "string" ? e.details.by : undefined,
        hint:
          e.code === "UNDO_CONFLICT_MODIFIED"
            ? "Thao tác gốc vẫn giữ nguyên. Kiểm tra lại trên sơ đồ rồi xử lý thủ công nếu cần. Liên hệ đã gửi cho khách (gọi, Zalo) không hoàn tác được."
            : e.code === "TABLE_CONFLICT"
              ? "Chọn bàn khác, nhận trước xếp sau, hoặc thêm khách vào danh sách chờ."
              : undefined,
      })
      return
    }
    toast.error(e.message, {
      description: e.code === "PERMISSION_DENIED" ? "Quyền do máy chủ kiểm tra (RBAC)." : undefined,
    })
    return
  }
  toast.error("Có lỗi không mong muốn", { description: e instanceof Error ? e.message : String(e) })
}

export async function undoOperation(id: number, summary: string) {
  const ui = useUi.getState()
  try {
    const res = await api.undo(id)
    ui.pushRedo({ id: res.operationId!, summary })
    toast.success(`Đã hoàn tác: ${summary}`, { description: MOCK_NOTE })
    return true
  } catch (e) {
    reportError(e)
    return false
  }
}

export function useAction() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async <T extends MutationResult>(
      fn: (overrideReason?: string) => Promise<T>,
      opts: { silent?: boolean } = {},
    ): Promise<T | null> => {
      setPending(true)
      try {
        let result: T
        try {
          result = await fn()
        } catch (e) {
          if (isApiError(e) && e.code === "OVERRIDE_REQUIRED") {
            const reason = await useUi.getState().askOverride(e.message)
            if (!reason) return null
            result = await fn(reason)
          } else {
            throw e
          }
        }
        const ui = useUi.getState()
        if (result.undoable && result.operationId) {
          ui.pushUndo({ id: result.operationId, summary: result.summary })
          useUi.setState({ redoStack: [] })
        }
        if (!opts.silent) {
          toast.success(result.summary, {
            description: MOCK_NOTE,
            action:
              result.undoable && result.operationId
                ? {
                    label: "Hoàn tác",
                    onClick: () => {
                      const stack = useUi.getState().undoStack
                      useUi.setState({ undoStack: stack.filter((i) => i.id !== result.operationId) })
                      void undoOperation(result.operationId!, result.summary)
                    },
                  }
                : undefined,
          })
        }
        return result
      } catch (e) {
        reportError(e)
        return null
      } finally {
        setPending(false)
        void qc.invalidateQueries()
      }
    },
    [qc],
  )

  return { run, pending }
}
