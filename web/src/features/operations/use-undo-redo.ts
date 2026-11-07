/**
 * BA-020 / US-10 — shared Undo/Redo client state.
 *
 * Desktop (AppShell top bar) and Mobile V1 (its own shell) both drive undo/redo
 * through this hook so there is exactly one HTTP contract and one eligibility
 * rule. Eligibility is never decided on the client: the server returns the only
 * operation this device/session may compensate, and the buttons mirror it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import type { UndoStateItem } from "@/services/contracts"
import { useSession } from "@/state/session"
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
  const permitted = useSession((state) => state.permissions.includes("operation.undo"))
  // Mock mode keeps its own local stack; only HTTP mode has server-owned state.
  const enabled = permitted && api.mode === "http"
  const state = useQuery({
    queryKey: ["undo-state"],
    queryFn: () => api.getUndoState(),
    enabled,
    refetchInterval: 5_000,
    retry: false,
  })
  const [pending, setPending] = useState(false)
  const undo = state.data?.undo ?? null
  const redo = state.data?.redo ?? null

  const apply = useCallback(
    async (mode: "undo" | "redo") => {
      const item = mode === "undo" ? undo : redo
      if (!enabled || !item || pending) return
      setPending(true)
      try {
        const response = mode === "undo" ? await api.undo(item.operationId) : await api.redo(item.operationId)
        toast.success(response.summary)
        // A compensation moves allocations and venue change_seq: refetch every view.
        await queryClient.invalidateQueries()
      } catch (error) {
        // A business conflict is final; never retry it automatically.
        reportError(error)
        await state.refetch()
      } finally {
        setPending(false)
      }
    },
    [enabled, pending, queryClient, redo, state, undo],
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
