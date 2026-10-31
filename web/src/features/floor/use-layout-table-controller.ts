import { useCallback, useMemo, useReducer, useState } from "react"
import type { FloorTableState, TableView } from "@/domain/models"
import type { FloorModel } from "./use-floor-model"

export interface MoveContext {
  entityKind: "booking" | "visit"
  entityId: number
  version: number
  sourceTableIds: number[]
  partySize: number
  displayName: string
}

export type MergeContext = MoveContext

export interface WaitlistAssignmentContext {
  entryId: number
  version: number
  partySize: number
  displayName: string
}

export type WaitlistWorkflow =
  | { phase: "IDLE" }
  | { phase: "SELECTING_WAITLIST_TABLE"; context: WaitlistAssignmentContext; tableIds: number[] }
  | { phase: "CONFIRMING"; context: WaitlistAssignmentContext; tableIds: number[] }
  | { phase: "SUBMITTING"; context: WaitlistAssignmentContext; tableIds: number[] }
  | { phase: "SUCCESS"; context: WaitlistAssignmentContext; tableIds: number[] }
  | { phase: "ERROR"; context: WaitlistAssignmentContext; tableIds: number[]; message: string }

type WaitlistAction =
  | { type: "BEGIN"; context: WaitlistAssignmentContext }
  | { type: "TOGGLE"; tableId: number }
  | { type: "CONFIRM" }
  | { type: "BACK" }
  | { type: "SUBMIT" }
  | { type: "SUCCEED" }
  | { type: "FAIL"; message: string }
  | { type: "CANCEL" }

export function waitlistWorkflowReducer(state: WaitlistWorkflow, action: WaitlistAction): WaitlistWorkflow {
  switch (action.type) {
    case "BEGIN":
      return { phase: "SELECTING_WAITLIST_TABLE", context: action.context, tableIds: [] }
    case "TOGGLE":
      return state.phase === "SELECTING_WAITLIST_TABLE"
        ? {
            ...state,
            tableIds: state.tableIds.includes(action.tableId)
              ? state.tableIds.filter((id) => id !== action.tableId)
              : [...state.tableIds, action.tableId],
          }
        : state
    case "CONFIRM":
      return state.phase === "SELECTING_WAITLIST_TABLE" && state.tableIds.length > 0
        ? { phase: "CONFIRMING", context: state.context, tableIds: state.tableIds }
        : state
    case "BACK":
      return state.phase === "CONFIRMING" || state.phase === "ERROR"
        ? { phase: "SELECTING_WAITLIST_TABLE", context: state.context, tableIds: state.tableIds }
        : state
    case "SUBMIT":
      return state.phase === "CONFIRMING" ? { ...state, phase: "SUBMITTING" } : state
    case "SUCCEED":
      return state.phase === "SUBMITTING" ? { ...state, phase: "SUCCESS" } : state
    case "FAIL":
      return state.phase === "SUBMITTING" ? { ...state, phase: "ERROR", message: action.message } : state
    case "CANCEL":
      return { phase: "IDLE" }
  }
}

export type DirectBookingWorkflow =
  | { phase: "IDLE" }
  | { phase: "READY"; originTableId: number; tableIds: number[] }
  | { phase: "SELECTING_DIRECT_BOOKING_TABLES"; originTableId: number; tableIds: number[]; snapshotTableIds: number[] }

export type DirectBookingAction =
  | { type: "START"; originTableId: number }
  | { type: "BEGIN_EXTRA" }
  | { type: "TOGGLE"; tableId: number }
  | { type: "CANCEL_EXTRA" }
  | { type: "FINISH_EXTRA" }
  | { type: "RESET" }

export function directBookingWorkflowReducer(
  state: DirectBookingWorkflow,
  action: DirectBookingAction,
): DirectBookingWorkflow {
  switch (action.type) {
    case "START":
      return { phase: "READY", originTableId: action.originTableId, tableIds: [action.originTableId] }
    case "BEGIN_EXTRA":
      return state.phase === "READY"
        ? { ...state, phase: "SELECTING_DIRECT_BOOKING_TABLES", snapshotTableIds: [...state.tableIds] }
        : state
    case "TOGGLE":
      if (state.phase !== "SELECTING_DIRECT_BOOKING_TABLES" || action.tableId === state.originTableId) return state
      return {
        ...state,
        tableIds: state.tableIds.includes(action.tableId)
          ? state.tableIds.filter((id) => id !== action.tableId)
          : [...state.tableIds, action.tableId],
      }
    case "CANCEL_EXTRA":
      return state.phase === "SELECTING_DIRECT_BOOKING_TABLES"
        ? { phase: "READY", originTableId: state.originTableId, tableIds: [...state.snapshotTableIds] }
        : state
    case "FINISH_EXTRA":
      return state.phase === "SELECTING_DIRECT_BOOKING_TABLES"
        ? { phase: "READY", originTableId: state.originTableId, tableIds: [...state.tableIds] }
        : state
    case "RESET":
      return { phase: "IDLE" }
  }
}

export type MergeWorkflow =
  | { phase: "IDLE" }
  | { phase: "SELECTING_MERGE_TARGETS"; context: MergeContext; tableIds: number[] }
  | { phase: "CONFIRMING"; context: MergeContext; tableIds: number[] }
  | { phase: "SUBMITTING"; context: MergeContext; tableIds: number[] }
  | { phase: "SUCCESS"; context: MergeContext; tableIds: number[] }
  | { phase: "ERROR"; context: MergeContext; tableIds: number[]; message: string }

export type MergeAction =
  | { type: "BEGIN"; context: MergeContext }
  | { type: "SET_TABLES"; tableIds: number[] }
  | { type: "CONFIRM" }
  | { type: "BACK" }
  | { type: "SUBMIT" }
  | { type: "SUCCEED" }
  | { type: "FAIL"; message: string }
  | { type: "CANCEL" }

export function mergeWorkflowReducer(state: MergeWorkflow, action: MergeAction): MergeWorkflow {
  switch (action.type) {
    case "BEGIN":
      return {
        phase: "SELECTING_MERGE_TARGETS",
        context: action.context,
        tableIds: [...new Set(action.context.sourceTableIds)],
      }
    case "SET_TABLES":
      return state.phase === "SELECTING_MERGE_TARGETS" ? { ...state, tableIds: action.tableIds } : state
    case "CONFIRM":
      return state.phase === "SELECTING_MERGE_TARGETS" && state.tableIds.length > state.context.sourceTableIds.length
        ? { phase: "CONFIRMING", context: state.context, tableIds: state.tableIds }
        : state
    case "BACK":
      return state.phase === "CONFIRMING" || state.phase === "ERROR"
        ? { phase: "SELECTING_MERGE_TARGETS", context: state.context, tableIds: state.tableIds }
        : state
    case "SUBMIT":
      return state.phase === "CONFIRMING" ? { ...state, phase: "SUBMITTING" } : state
    case "SUCCEED":
      return state.phase === "SUBMITTING" ? { ...state, phase: "SUCCESS" } : state
    case "FAIL":
      return state.phase === "SUBMITTING" ? { ...state, phase: "ERROR", message: action.message } : state
    case "CANCEL":
      return { phase: "IDLE" }
  }
}

export type MoveWorkflow =
  | { phase: "IDLE" }
  | { phase: "SELECTING_MOVE_TARGET"; context: MoveContext; tableIds: number[] }
  | { phase: "CONFIRMING"; context: MoveContext; tableIds: number[] }
  | { phase: "SUBMITTING"; context: MoveContext; tableIds: number[] }
  | { phase: "SUCCESS"; context: MoveContext; tableIds: number[] }
  | { phase: "ERROR"; context: MoveContext; tableIds: number[]; message: string }

export type MoveAction =
  | { type: "BEGIN"; context: MoveContext }
  | { type: "TOGGLE_TARGET"; tableId: number }
  | { type: "CONFIRM" }
  | { type: "BACK" }
  | { type: "SUBMIT" }
  | { type: "SUCCEED" }
  | { type: "FAIL"; message: string }
  | { type: "CANCEL" }

export function moveWorkflowReducer(state: MoveWorkflow, action: MoveAction): MoveWorkflow {
  switch (action.type) {
    case "BEGIN":
      return { phase: "SELECTING_MOVE_TARGET", context: action.context, tableIds: [] }
    case "TOGGLE_TARGET":
      return state.phase === "SELECTING_MOVE_TARGET"
        ? {
            ...state,
            tableIds: state.tableIds.includes(action.tableId)
              ? state.tableIds.filter((id) => id !== action.tableId)
              : [...state.tableIds, action.tableId],
          }
        : state
    case "CONFIRM":
      return state.phase === "SELECTING_MOVE_TARGET" && state.tableIds.length > 0
        ? { phase: "CONFIRMING", context: state.context, tableIds: state.tableIds }
        : state
    case "BACK":
      return state.phase === "CONFIRMING" || state.phase === "ERROR"
        ? { phase: "SELECTING_MOVE_TARGET", context: state.context, tableIds: state.tableIds }
        : state
    case "SUBMIT":
      return state.phase === "CONFIRMING"
        ? { phase: "SUBMITTING", context: state.context, tableIds: state.tableIds }
        : state
    case "SUCCEED":
      return state.phase === "SUBMITTING"
        ? { phase: "SUCCESS", context: state.context, tableIds: state.tableIds }
        : state
    case "FAIL":
      return state.phase === "SUBMITTING"
        ? { phase: "ERROR", context: state.context, tableIds: state.tableIds, message: action.message }
        : state
    case "CANCEL":
      return { phase: "IDLE" }
  }
}

export type LayoutTableIntent =
  | { kind: "create" }
  | ({ kind: "booking"; reservationId: number } & Omit<MoveContext, "entityKind" | "entityId">)
  | ({ kind: "visit"; visitId: number } & Omit<MoveContext, "entityKind" | "entityId">)
  | { kind: "blocked"; reason: string }

export function resolveLayoutTableIntent(
  table: TableView,
  state: FloorTableState | undefined,
  permissions: ReadonlySet<string>,
): LayoutTableIntent {
  if (table.status === "OUT_OF_SERVICE" || state?.state === "oos") {
    return { kind: "blocked", reason: "Bàn đang ngưng phục vụ." }
  }
  if (table.isSpare || state?.state === "spare") {
    return { kind: "blocked", reason: "Backend chưa cho phép đặt trực tiếp bàn sơ cua." }
  }
  const claim = state?.claim
  if (claim?.kind === "reservation" && claim.reservationId) {
    return {
      kind: "booking",
      reservationId: claim.reservationId,
      version: claim.version,
      sourceTableIds: [...claim.tableIds],
      partySize: claim.partySize,
      displayName: claim.displayName,
    }
  }
  if (claim?.kind === "visit" && claim.visitId) {
    return {
      kind: "visit",
      visitId: claim.visitId,
      version: claim.version,
      sourceTableIds: [...claim.tableIds],
      partySize: claim.partySize,
      displayName: claim.displayName,
    }
  }
  if (claim?.kind === "waitlist_hold") {
    return { kind: "blocked", reason: "Bàn đang được giữ cho khách chờ; xử lý từ luồng waitlist." }
  }
  if (state && state.state !== "free") {
    return { kind: "blocked", reason: "Floor State chưa cung cấp đối tượng nghiệp vụ duy nhất cho bàn này." }
  }
  if (!permissions.has("reservation.create")) {
    return { kind: "blocked", reason: "Tài khoản không có quyền tạo booking." }
  }
  if (!permissions.has("table.assign")) {
    return { kind: "blocked", reason: "Tài khoản không có quyền gán bàn." }
  }
  return { kind: "create" }
}

export function isValidMoveTarget(
  table: TableView,
  state: FloorTableState | undefined,
  context: MoveContext,
  firstTarget?: TableView,
): boolean {
  return (
    !context.sourceTableIds.includes(table.id) &&
    table.status === "ACTIVE" &&
    !table.isSpare &&
    state?.state === "free" &&
    (!firstTarget || table.kind === firstTarget.kind)
  )
}

export function isValidMergeTarget(
  table: TableView,
  state: FloorTableState | undefined,
  source: TableView | undefined,
): boolean {
  return (
    source !== undefined &&
    table.zoneId === source.zoneId &&
    table.kind === source.kind &&
    table.status === "ACTIVE" &&
    !table.isSpare &&
    state?.state === "free"
  )
}

export function isValidWaitlistTarget(
  table: TableView,
  state: FloorTableState | undefined,
  firstSelected: TableView | undefined,
): boolean {
  return (
    table.status === "ACTIVE" &&
    !table.isSpare &&
    state?.state === "free" &&
    (!firstSelected || (table.zoneId === firstSelected.zoneId && table.kind === firstSelected.kind))
  )
}

export function isValidDirectBookingTarget(
  table: TableView,
  state: FloorTableState | undefined,
  origin: TableView | undefined,
): boolean {
  return (
    origin !== undefined &&
    table.zoneId === origin.zoneId &&
    table.kind === origin.kind &&
    table.status === "ACTIVE" &&
    !table.isSpare &&
    state?.state === "free"
  )
}

export function useLayoutTableController(model: FloorModel, permissions: readonly string[]) {
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null)
  const [workflow, dispatch] = useReducer(moveWorkflowReducer, { phase: "IDLE" })
  const [mergeWorkflow, dispatchMerge] = useReducer(mergeWorkflowReducer, { phase: "IDLE" })
  const [waitlistWorkflow, dispatchWaitlist] = useReducer(waitlistWorkflowReducer, { phase: "IDLE" })
  const [directBookingWorkflow, dispatchDirectBooking] = useReducer(directBookingWorkflowReducer, { phase: "IDLE" })
  const permissionSet = useMemo(() => new Set(permissions), [permissions])
  const table = selectedTableId === null ? undefined : model.byId.get(selectedTableId)
  const state = selectedTableId === null ? undefined : model.states.get(selectedTableId)
  const intent = table
    ? directBookingWorkflow.phase !== "IDLE" && directBookingWorkflow.originTableId === table.id
      ? { kind: "create" as const }
      : resolveLayoutTableIntent(table, state, permissionSet)
    : null
  const pickable = useMemo(() => {
    if (workflow.phase !== "SELECTING_MOVE_TARGET") return null
    const firstTarget = model.byId.get(workflow.tableIds[0] ?? -1)
    return new Set(
      model.tables
        .filter((candidate) =>
          workflow.tableIds.includes(candidate.id) ||
          isValidMoveTarget(candidate, model.states.get(candidate.id), workflow.context, firstTarget),
        )
        .map((candidate) => candidate.id),
    )
  }, [model.byId, model.states, model.tables, workflow])
  const mergePickable = useMemo(() => {
    if (mergeWorkflow.phase !== "SELECTING_MERGE_TARGETS") return null
    const selected = new Set(mergeWorkflow.tableIds)
    const source = model.byId.get(mergeWorkflow.context.sourceTableIds[0] ?? -1)
    return new Set(
      model.tables
        .filter((candidate) => {
          if (selected.has(candidate.id)) return !mergeWorkflow.context.sourceTableIds.includes(candidate.id)
          return isValidMergeTarget(candidate, model.states.get(candidate.id), source)
        })
        .map((candidate) => candidate.id),
    )
  }, [mergeWorkflow, model.byId, model.states, model.tables])
  const waitlistPickable = useMemo(() => {
    if (waitlistWorkflow.phase !== "SELECTING_WAITLIST_TABLE") return null
    const firstSelected = model.byId.get(waitlistWorkflow.tableIds[0] ?? -1)
    return new Set(
      model.tables
        .filter((candidate) => isValidWaitlistTarget(candidate, model.states.get(candidate.id), firstSelected))
        .map((candidate) => candidate.id),
    )
  }, [model.byId, model.states, model.tables, waitlistWorkflow])
  const directBookingPickable = useMemo(() => {
    if (directBookingWorkflow.phase !== "SELECTING_DIRECT_BOOKING_TABLES") return null
    const origin = model.byId.get(directBookingWorkflow.originTableId)
    return new Set(
      model.tables
        .filter((candidate) =>
          (directBookingWorkflow.tableIds.includes(candidate.id) && candidate.id !== directBookingWorkflow.originTableId) ||
          isValidDirectBookingTarget(candidate, model.states.get(candidate.id), origin),
        )
        .map((candidate) => candidate.id)
        .filter((id) => id !== directBookingWorkflow.originTableId),
    )
  }, [directBookingWorkflow, model.byId, model.states, model.tables])
  const activePickable =
    directBookingWorkflow.phase === "SELECTING_DIRECT_BOOKING_TABLES"
      ? directBookingPickable
      : waitlistWorkflow.phase === "SELECTING_WAITLIST_TABLE"
      ? waitlistPickable
      : mergeWorkflow.phase === "SELECTING_MERGE_TARGETS"
        ? mergePickable
        : pickable

  const selectTable = useCallback(
    (tableId: number) => {
      if (directBookingWorkflow.phase === "SELECTING_DIRECT_BOOKING_TABLES") {
        if (directBookingPickable?.has(tableId)) dispatchDirectBooking({ type: "TOGGLE", tableId })
        return
      }
      if (waitlistWorkflow.phase === "SELECTING_WAITLIST_TABLE") {
        if (waitlistPickable?.has(tableId)) dispatchWaitlist({ type: "TOGGLE", tableId })
        return
      }
      if (mergeWorkflow.phase === "SELECTING_MERGE_TARGETS") {
        if (!mergePickable?.has(tableId)) return
        const selected = mergeWorkflow.tableIds.includes(tableId)
        const next = selected
          ? mergeWorkflow.tableIds.filter((id) => id !== tableId)
          : [...mergeWorkflow.tableIds, tableId]
        dispatchMerge({ type: "SET_TABLES", tableIds: next })
        return
      }
      if (workflow.phase === "SELECTING_MOVE_TARGET") {
        if (pickable?.has(tableId)) dispatch({ type: "TOGGLE_TARGET", tableId })
        return
      }
      if (workflow.phase !== "IDLE") return
      const candidate = model.byId.get(tableId)
      const candidateIntent = candidate
        ? resolveLayoutTableIntent(candidate, model.states.get(tableId), permissionSet)
        : null
      setSelectedTableId((current) => (current === tableId ? null : tableId))
      if (candidateIntent?.kind === "create") dispatchDirectBooking({ type: "START", originTableId: tableId })
      else dispatchDirectBooking({ type: "RESET" })
    },
    [
      directBookingPickable,
      directBookingWorkflow.phase,
      mergePickable,
      mergeWorkflow,
      model.byId,
      model.states,
      permissionSet,
      pickable,
      waitlistPickable,
      waitlistWorkflow.phase,
      workflow.phase,
    ],
  )

  const clearSelection = useCallback(() => {
    if (
      workflow.phase === "IDLE" &&
      mergeWorkflow.phase === "IDLE" &&
      waitlistWorkflow.phase === "IDLE" &&
      directBookingWorkflow.phase !== "SELECTING_DIRECT_BOOKING_TABLES"
    ) {
      setSelectedTableId(null)
      dispatchDirectBooking({ type: "RESET" })
    }
  }, [directBookingWorkflow.phase, mergeWorkflow.phase, waitlistWorkflow.phase, workflow.phase])

  const beginMove = useCallback((context: MoveContext) => {
    setSelectedTableId(null)
    dispatch({ type: "BEGIN", context: { ...context, sourceTableIds: [...new Set(context.sourceTableIds)] } })
  }, [])
  const beginMerge = useCallback((context: MergeContext) => {
    setSelectedTableId(null)
    dispatchMerge({ type: "BEGIN", context: { ...context, sourceTableIds: [...new Set(context.sourceTableIds)] } })
  }, [])
  const beginWaitlistAssignment = useCallback((context: WaitlistAssignmentContext) => {
    setSelectedTableId(null)
    dispatchWaitlist({ type: "BEGIN", context })
  }, [])

  const normalGroupIds = state?.claim?.tableIds ?? (table ? [table.id] : [])
  const selectedIds =
    directBookingWorkflow.phase !== "IDLE"
      ? directBookingWorkflow.tableIds
      : waitlistWorkflow.phase !== "IDLE"
      ? waitlistWorkflow.tableIds
      : mergeWorkflow.phase !== "IDLE"
        ? mergeWorkflow.tableIds
        : workflow.phase !== "IDLE"
          ? [...new Set([...workflow.context.sourceTableIds, ...workflow.tableIds])]
          : normalGroupIds

  return {
    selectedTableId,
    selectedIds,
    table,
    state,
    intent,
    workflow,
    mergeWorkflow,
    waitlistWorkflow,
    directBookingWorkflow,
    pickable: activePickable,
    selectTable,
    clearSelection,
    beginMove,
    beginMerge,
    beginWaitlistAssignment,
    beginDirectBookingSelection: () => dispatchDirectBooking({ type: "BEGIN_EXTRA" }),
    cancelDirectBookingSelection: () => dispatchDirectBooking({ type: "CANCEL_EXTRA" }),
    finishDirectBookingSelection: () => dispatchDirectBooking({ type: "FINISH_EXTRA" }),
    closeDirectBooking: () => {
      dispatchDirectBooking({ type: "RESET" })
      setSelectedTableId(null)
    },
    cancelOperation: () => dispatch({ type: "CANCEL" }),
    backToSelection: () => dispatch({ type: "BACK" }),
    confirmMove: () => dispatch({ type: "CONFIRM" }),
    startSubmitting: () => dispatch({ type: "SUBMIT" }),
    markSuccess: () => dispatch({ type: "SUCCEED" }),
    markError: (message: string) => dispatch({ type: "FAIL", message }),
    cancelMerge: () => dispatchMerge({ type: "CANCEL" }),
    confirmMerge: () => dispatchMerge({ type: "CONFIRM" }),
    backMerge: () => dispatchMerge({ type: "BACK" }),
    startMergeSubmitting: () => dispatchMerge({ type: "SUBMIT" }),
    markMergeSuccess: () => dispatchMerge({ type: "SUCCEED" }),
    markMergeError: (message: string) => dispatchMerge({ type: "FAIL", message }),
    cancelWaitlist: () => dispatchWaitlist({ type: "CANCEL" }),
    confirmWaitlist: () => dispatchWaitlist({ type: "CONFIRM" }),
    backWaitlist: () => dispatchWaitlist({ type: "BACK" }),
    startWaitlistSubmitting: () => dispatchWaitlist({ type: "SUBMIT" }),
    markWaitlistSuccess: () => dispatchWaitlist({ type: "SUCCEED" }),
    markWaitlistError: (message: string) => dispatchWaitlist({ type: "FAIL", message }),
  }
}
