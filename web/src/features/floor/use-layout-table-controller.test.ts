import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView } from "@/domain/models"
import {
  isValidMoveTarget,
  isValidMergeTarget,
  mergeWorkflowReducer,
  moveWorkflowReducer,
  isValidWaitlistTarget,
  resolveLayoutTableIntent,
  waitlistWorkflowReducer,
  type MoveContext,
} from "./use-layout-table-controller"

const table: TableView = {
  id: 7,
  version: 1,
  code: "A7",
  displayName: "Bàn A7",
  zoneId: 1,
  zoneCode: "A",
  kind: "TABLE",
  capacity: 4,
  seqNo: null,
  isSpare: false,
  status: "ACTIVE",
  x: 0,
  y: 0,
  w: 40,
  h: 30,
}
const permissions = new Set(["reservation.create", "table.assign"])

const floorState = (patch: Partial<FloorTableState>): FloorTableState => ({
  tableId: table.id,
  state: "free",
  claim: null,
  ...patch,
})

describe("waitlist table assignment state machine", () => {
  const context = { entryId: 18, version: 2, partySize: 4, displayName: "Khách chờ" }

  it("requires selection and confirmation before submit, while cancel clears state", () => {
    const selecting = waitlistWorkflowReducer({ phase: "IDLE" }, { type: "BEGIN", context })
    expect(selecting.phase).toBe("SELECTING_WAITLIST_TABLE")
    const confirming = waitlistWorkflowReducer(selecting, { type: "SELECT", tableId: 7 })
    expect(confirming).toMatchObject({ phase: "CONFIRMING", targetTableId: 7 })
    const submitting = waitlistWorkflowReducer(confirming, { type: "SUBMIT" })
    expect(waitlistWorkflowReducer(submitting, { type: "SUCCEED" }).phase).toBe("SUCCESS")
    expect(waitlistWorkflowReducer(confirming, { type: "CANCEL" })).toEqual({ phase: "IDLE" })
  })

  it("allows only active, free, non-spare tables with enough capacity", () => {
    expect(isValidWaitlistTarget(table, floorState({}), 4)).toBe(true)
    expect(isValidWaitlistTarget({ ...table, capacity: 2 }, floorState({}), 4)).toBe(false)
    expect(isValidWaitlistTarget({ ...table, isSpare: true }, floorState({}), 4)).toBe(false)
    expect(isValidWaitlistTarget({ ...table, status: "OUT_OF_SERVICE" }, floorState({ state: "oos" }), 4)).toBe(false)
    expect(isValidWaitlistTarget(table, floorState({ state: "reserved" }), 4)).toBe(false)
  })
})

describe("same-zone merge state machine", () => {
  const context: MoveContext = {
    entityKind: "visit",
    entityId: 52,
    version: 4,
    sourceTableIds: [7],
    partySize: 3,
    displayName: "Walk-in",
  }
  it("allows any free table of the same kind and database zone", () => {
    const distantSameZone = { ...table, id: 99, code: "A99", x: 500, y: 500 }
    expect(isValidMergeTarget(distantSameZone, floorState({ tableId: 99 }), table)).toBe(true)
    expect(
      isValidMergeTarget({ ...distantSameZone, zoneId: 2, zoneCode: "B" }, floorState({ tableId: 99 }), table),
    ).toBe(false)
    expect(isValidMergeTarget({ ...distantSameZone, kind: "BAR_SEAT" }, floorState({ tableId: 99 }), table)).toBe(false)
    expect(isValidMergeTarget(distantSameZone, floorState({ tableId: 99, state: "seated" }), table)).toBe(false)
  })

  it("requires a real addition before confirmation and preserves the selected set", () => {
    const selecting = mergeWorkflowReducer({ phase: "IDLE" }, { type: "BEGIN", context })
    expect(mergeWorkflowReducer(selecting, { type: "CONFIRM" }).phase).toBe("SELECTING_MERGE_TARGETS")
    const expanded = mergeWorkflowReducer(selecting, { type: "SET_TABLES", tableIds: [7, 8] })
    const confirming = mergeWorkflowReducer(expanded, { type: "CONFIRM" })
    expect(confirming).toMatchObject({ phase: "CONFIRMING", tableIds: [7, 8] })
    const submitting = mergeWorkflowReducer(confirming, { type: "SUBMIT" })
    expect(mergeWorkflowReducer(submitting, { type: "SUCCEED" }).phase).toBe("SUCCESS")
  })
})

describe("layout table intent", () => {
  it("opens direct booking for an available table with both permissions", () => {
    expect(resolveLayoutTableIntent(table, floorState({}), permissions)).toEqual({ kind: "create" })
  })

  it("opens the related booking for a reserved table", () => {
    expect(
      resolveLayoutTableIntent(
        table,
        floorState({
          state: "reserved",
          claim: {
            kind: "reservation",
            reservationId: 91,
            visitId: null,
            waitlistEntryId: null,
            holdId: 3,
            displayName: "Khách test",
            phoneLast3: null,
            partySize: 2,
            startsAt: new Date("2030-01-01T12:00:00Z"),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [7],
            groupId: null,
            symbolNo: null,
            warning: null,
            minutesLate: 0,
            sourceCode: "HOTLINE",
            note: null,
            version: 1,
          },
        }),
        permissions,
      ),
    ).toEqual({
      kind: "booking",
      reservationId: 91,
      version: 1,
      sourceTableIds: [7],
      partySize: 2,
      displayName: "Khách test",
    })
  })

  it("separates an active visit from a pending booking", () => {
    const state = floorState({
      state: "seated",
      claim: {
        kind: "visit",
        reservationId: null,
        visitId: 52,
        waitlistEntryId: null,
        holdId: null,
        displayName: "Walk-in",
        phoneLast3: null,
        partySize: 3,
        startsAt: new Date("2030-01-01T12:00:00Z"),
        deadlineAt: null,
        paid: false,
        origin: "WALK_IN",
        tableIds: [7],
        groupId: null,
        symbolNo: null,
        warning: null,
        minutesLate: 0,
        sourceCode: null,
        note: null,
        version: 1,
      },
    })
    expect(resolveLayoutTableIntent(table, state, permissions)).toEqual({
      kind: "visit",
      visitId: 52,
      version: 1,
      sourceTableIds: [7],
      partySize: 3,
      displayName: "Walk-in",
    })
  })

  it("blocks out-of-service and spare tables", () => {
    expect(resolveLayoutTableIntent({ ...table, status: "OUT_OF_SERVICE" }, undefined, permissions).kind).toBe(
      "blocked",
    )
    expect(
      resolveLayoutTableIntent({ ...table, isSpare: true }, floorState({ state: "spare" }), permissions).kind,
    ).toBe("blocked")
  })

  it("blocks direct booking when either permission is missing", () => {
    expect(resolveLayoutTableIntent(table, floorState({}), new Set(["reservation.create"]))).toEqual({
      kind: "blocked",
      reason: "Tài khoản không có quyền gán bàn.",
    })
  })
})

describe("two-step move state machine", () => {
  const context: MoveContext = {
    entityKind: "booking",
    entityId: 91,
    version: 3,
    sourceTableIds: [7, 8],
    partySize: 4,
    displayName: "Khách test",
  }

  it("moves through selection, confirmation, submission and success", () => {
    const selecting = moveWorkflowReducer({ phase: "IDLE" }, { type: "BEGIN", context })
    const confirming = moveWorkflowReducer(selecting, { type: "SELECT_TARGET", tableId: 9 })
    const submitting = moveWorkflowReducer(confirming, { type: "SUBMIT" })
    expect(moveWorkflowReducer(submitting, { type: "SUCCEED" })).toMatchObject({
      phase: "SUCCESS",
      targetTableId: 9,
    })
  })

  it("returns to selection after confirmation/error and cancel always clears stale state", () => {
    const confirming = moveWorkflowReducer(
      { phase: "SELECTING_MOVE_TARGET", context },
      { type: "SELECT_TARGET", tableId: 9 },
    )
    expect(moveWorkflowReducer(confirming, { type: "BACK" }).phase).toBe("SELECTING_MOVE_TARGET")
    const failed = moveWorkflowReducer(moveWorkflowReducer(confirming, { type: "SUBMIT" }), {
      type: "FAIL",
      message: "conflict",
    })
    expect(moveWorkflowReducer(failed, { type: "BACK" }).phase).toBe("SELECTING_MOVE_TARGET")
    expect(moveWorkflowReducer(failed, { type: "CANCEL" })).toEqual({ phase: "IDLE" })
  })

  it("allows only free, active, non-spare targets with enough capacity", () => {
    const target = { ...table, id: 9, capacity: 4 }
    expect(isValidMoveTarget(target, floorState({ tableId: 9 }), context)).toBe(true)
    expect(isValidMoveTarget({ ...target, capacity: 2 }, floorState({ tableId: 9 }), context)).toBe(false)
    expect(isValidMoveTarget(target, floorState({ tableId: 9, state: "seated" }), context)).toBe(false)
    expect(isValidMoveTarget({ ...target, isSpare: true }, floorState({ tableId: 9 }), context)).toBe(false)
  })
})
