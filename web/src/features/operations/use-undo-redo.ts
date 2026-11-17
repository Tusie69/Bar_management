/**
 * BA-020 / US-10 — shared Undo/Redo client state.
 *
 * Desktop (AppShell top bar) and Mobile V1 (its own shell) both drive undo/redo
 * through this hook so there is exactly one HTTP contract and one eligibility
 * rule. Eligibility is never decided on the client: the server returns the only
 * operation this device/session may compensate, and the buttons mirror it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { MOCK_NOTE, reportError, undoOperation } from "@/hooks/use-action"
import { api } from "@/services"
import type { UndoStateItem } from "@/services/contracts"
import { useCan } from "@/state/session"
import { useUi } from "@/state/ui"
import { isEditableTarget } from "./editable-target"

export interface UndoRedoController {
  enabled: boolean
  undo: UndoStateItem | null
  redo: UndoStateItem | null
  pending: boolean
  apply: (mode: "undo" | "redo") => Promise<void>
}

export function useUndoRedo(): UndoRedoController {
  const queryClient = useQueryClient()
  const permitted = useCan("operation.undo")
  const httpMode = api.mode === "http"
  const enabled = permitted
  const undoStack = useUi((s) => s.undoStack)
  const redoStack = useUi((s) => s.redoStack)
  const state = useQuery({
    queryKey: ["undo-state"],
    queryFn: () => api.getUndoState(),
    enabled: permitted && httpMode,
    refetchInterval: 5_000,
    retry: false,
  })
  const [pending, setPending] = useState(false)
  const lastMockUndo = undoStack[undoStack.length - 1]
  const lastMockRedo = redoStack[redoStack.length - 1]
  const undo = useMemo<UndoStateItem | null>(
    () =>
      httpMode
        ? (state.data?.undo ?? null)
        : lastMockUndo
          ? { operationId: lastMockUndo.id, action: "MOCK", summary: lastMockUndo.summary }
          : null,
    [httpMode, lastMockUndo, state.data?.undo],
  )
  const redo = useMemo<UndoStateItem | null>(
    () =>
      httpMode
        ? (state.data?.redo ?? null)
        : lastMockRedo
          ? { operationId: lastMockRedo.id, action: "MOCK", summary: lastMockRedo.summary }
          : null,
    [httpMode, lastMockRedo, state.data?.redo],
  )

  const apply = useCallback(
    async (mode: "undo" | "redo") => {
      const item = mode === "undo" ? undo : redo
      if (!enabled || !item || pending) return
      setPending(true)
      try {
        if (!httpMode) {
          if (mode === "undo") {
            const popped = useUi.getState().popUndo()
            if (popped) await undoOperation(popped.id, popped.summary)
          } else {
            const popped = useUi.getState().popRedo()
            if (popped) {
              const res = await api.redo(popped.id)
              useUi.getState().pushUndo({ id: res.operationId!, summary: popped.summary })
              toast.success(`Đã làm lại: ${popped.summary}`, { description: MOCK_NOTE })
            }
          }
          await queryClient.invalidateQueries()
          return
        }
        const response = mode === "undo" ? await api.undo(item.operationId) : await api.redo(item.operationId)
        toast.success(response.summary)
        // A compensation moves allocations and venue change_seq: refetch every view.
        await queryClient.invalidateQueries()
      } catch (error) {
        // A business conflict is final; never retry it automatically.
        reportError(error)
        if (httpMode) await state.refetch()
      } finally {
        setPending(false)
      }
    },
    [enabled, httpMode, pending, queryClient, redo, state, undo],
  )

  return { enabled, undo, redo, pending, apply }
}

/** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, ignored while the user is typing a draft. */
export function useUndoRedoShortcuts(controller: UndoRedoController): void {
  const { enabled, apply } = controller
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target as HTMLElement | null)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        void apply(event.shiftKey ? "redo" : "undo")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [apply, enabled])
}
