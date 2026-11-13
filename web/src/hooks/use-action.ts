/**
 * Runs a mutation with consistent UX:
 * - success toast that is honest about the mock ("bản mô phỏng"),
 *   with an inline Undo when the operation is undoable;
 * - OVERRIDE_REQUIRED -> asks for a reason, then retries once;
 * - 409 conflicts -> conflict dialog naming who changed what;
 * - everything else -> error toast.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import type { MutationResult } from "@/domain/models"
import { api, isApiError } from "@/services"
import { useUi } from "@/state/ui"

/**
 * Codes where the server refused the write until an operator takes
 * responsibility. Each maps to the confirmation flag the retry carries, so the
 * decision is recorded on the server and audited there, not assumed in the browser.
 */
const CONFIRM_REQUIRED: Record<string, { key: keyof ActionConfirmations; title: string; confirmLabel: string }> = {
  CAPACITY_OVERRIDE_REQUIRED: {
    key: "capacityOverrideConfirmed",
    title: "Vượt sức chứa đề xuất",
    confirmLabel: "Vẫn đặt số khách này",
  },
  SPARE_TABLE_OVERRIDE_REQUIRED: {
    key: "spareOverrideConfirmed",
    title: "Có bàn sơ cua trong cụm",
    confirmLabel: "Vẫn ghép bàn sơ cua",
  },
}

export interface ActionConfirmations {
  capacityOverrideConfirmed?: boolean
  spareOverrideConfirmed?: boolean
}

const CONFLICT_TITLE: Record<string, string> = {
  TABLE_CONFLICT: "Bàn không còn trống",
  VERSION_CONFLICT: "Dữ liệu vừa thay đổi",
  // Ba mã dưới đây là luật ghép bàn từ chối, không phải dữ liệu đổi trên máy
  // khác. Gọi đúng tên để lễ tân biết tải lại trang cũng không giúp được gì.
  TABLE_GROUP_MULTIPLE_CLAIMS: "Không ghép được hai booking",
  TABLE_GROUP_MIXED_STATE: "Không ghép bàn trống với bàn đang có khách",
  TABLE_ALREADY_GROUPED: "Bàn đã thuộc cụm khác",
  ENTRY_ALREADY_CLAIMED: "Người khác đang liên hệ",
  NO_SYMBOL_AVAILABLE: "Hết ký hiệu ghép bàn",
  UNDO_CONFLICT_MODIFIED: "Không thể hoàn tác",
}

export const MOCK_NOTE = "Bản mô phỏng: chỉ cập nhật dữ liệu trên máy này, chưa gửi máy chủ."

export function reportError(e: unknown) {
  const ui = useUi.getState()
  if (isApiError(e)) {
    if (e.status === 409 || CONFLICT_TITLE[e.code]) {
      ui.showConflict({
        title: CONFLICT_TITLE[e.code] ?? "Dữ liệu vừa thay đổi",
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
    toast.success(`Đã hoàn tác: ${summary}`, { description: api.mode === "mock" ? MOCK_NOTE : undefined })
    return true
  } catch (e) {
    reportError(e)
    return false
  }
}

export function useAction() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  const run = useCallback(
    async <T extends MutationResult>(
      fn: (overrideReason?: string, confirmations?: ActionConfirmations) => Promise<T>,
      opts: { silent?: boolean } = {},
    ): Promise<T | null> => {
      if (inFlight.current) return null
      inFlight.current = true
      setPending(true)
      try {
        let result: T
        // One pass per distinct confirmation the server can ask for, so a request
        // needing both capacity and spare confirmation still resolves, and a server
        // that keeps asking cannot loop.
        const confirmations: ActionConfirmations = {}
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await fn(undefined, confirmations)
            break
          } catch (e) {
            const needed = isApiError(e) ? CONFIRM_REQUIRED[e.code] : undefined
            if (needed && !confirmations[needed.key] && attempt <= Object.keys(CONFIRM_REQUIRED).length) {
              const accepted = await useUi.getState().askConfirm({
                title: needed.title,
                message: (e as { message: string }).message,
                confirmLabel: needed.confirmLabel,
              })
              // Declining saves nothing: the server already refused the write.
              if (!accepted) return null
              confirmations[needed.key] = true
              continue
            }
            if (api.mode === "mock" && isApiError(e) && e.code === "OVERRIDE_REQUIRED") {
              const reason = await useUi.getState().askOverride(e.message)
              if (!reason) return null
              result = await fn(reason, confirmations)
              break
            }
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
            description: api.mode === "mock" ? MOCK_NOTE : undefined,
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
        inFlight.current = false
        setPending(false)
        void qc.invalidateQueries()
      }
    },
    [qc],
  )

  return { run, pending }
}
