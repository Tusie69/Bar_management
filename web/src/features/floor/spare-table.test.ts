import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { TableLiveState, TableView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { api } from "@/services"
import { ApiError } from "@/services/contracts"
import { createHttpApi } from "@/services/http/http-api"
import { HttpClient } from "@/services/http/http-client"
import { spareDecision, useSpareToggle } from "./spare-table"

vi.mock("@/hooks/use-action", () => ({ useAction: vi.fn() }))
vi.mock("@/services", () => ({ api: { setTableStatus: vi.fn() } }))

const table: TableView = {
  id: 94,
  version: 7,
  code: "C9",
  displayName: "Bàn C9",
  zoneId: 3,
  zoneCode: "C",
  kind: "TABLE",
  capacity: 4,
  seqNo: null,
  isSpare: false,
  status: "ACTIVE",
  x: 100,
  y: 200,
  w: 40,
  h: 40,
  seating: "four-sides",
}
const input = { table, state: "free" as TableLiveState, hasClaim: false, inGroup: false, canConfigure: true }

describe("spareDecision", () => {
  it.each(["A", "B", "C", "BAR"] as const)("allows an idle table or seat in %s without a code list", (zoneCode) => {
    expect(
      spareDecision({ ...input, table: { ...table, zoneCode, kind: zoneCode === "BAR" ? "BAR_SEAT" : "TABLE" } }),
    ).toEqual({ action: "mark", allowed: true })
  })

  it.each([false, true])("requires permission when isSpare=%s", (isSpare) => {
    expect(spareDecision({ ...input, table: { ...table, isSpare }, canConfigure: false })).toEqual({
      action: isSpare ? "unmark" : "mark",
      allowed: false,
      reason: "Bạn không có quyền quản lý bàn sơ cua.",
    })
  })

  it.each([false, true])("rejects grouped tables when isSpare=%s", (isSpare) => {
    expect(spareDecision({ ...input, table: { ...table, isSpare }, inGroup: true })).toMatchObject({
      action: isSpare ? "unmark" : "mark",
      allowed: false,
      reason: expect.stringContaining("nhóm ghép"),
    })
  })

  it.each([false, true])("rejects a claim even with an idle visual state when isSpare=%s", (isSpare) => {
    expect(spareDecision({ ...input, table: { ...table, isSpare }, hasClaim: true })).toMatchObject({
      action: isSpare ? "unmark" : "mark",
      allowed: false,
      reason: expect.stringContaining("booking, khách"),
    })
  })

  it.each<TableLiveState>([
    "reserved",
    "upcoming",
    "late",
    "late_confirmed",
    "noshow",
    "seated",
    "hold",
    "hold_overdue",
  ])("rejects %s even if the claim has not loaded", (state) => {
    for (const isSpare of [false, true]) {
      expect(spareDecision({ ...input, table: { ...table, isSpare }, state })).toMatchObject({
        action: isSpare ? "unmark" : "mark",
        allowed: false,
        reason: expect.stringContaining("booking, khách"),
      })
    }
  })

  it.each<TableLiveState>(["free", "spare", "oos"])("allows unmarking an idle spare with state %s", (state) => {
    expect(spareDecision({ ...input, table: { ...table, isSpare: true }, state })).toEqual({
      action: "unmark",
      allowed: true,
    })
  })
})

describe("useSpareToggle", () => {
  const run = vi.fn<ReturnType<typeof useAction>["run"]>()
  const action = { run: run as ReturnType<typeof useAction>["run"], pending: false }
  let patch: MockInstance<HttpClient["patch"]>

  beforeEach(() => {
    vi.clearAllMocks()
    const client = new HttpClient("http://api.test")
    patch = vi.spyOn(client, "patch").mockResolvedValue({})
    vi.mocked(api.setTableStatus).mockImplementation(createHttpApi(client, 1).setTableStatus)
    run.mockImplementation(async (fn) => fn())
    vi.mocked(useAction).mockReturnValue(action)
  })

  it.each([false, true])(
    "sends the current table version and only the spare attribute when isSpare=%s",
    async (isSpare) => {
      const current = { ...table, isSpare }
      const original = structuredClone(current)
      expect(await useSpareToggle().toggle(current)).toBe(true)
      expect(api.setTableStatus).toHaveBeenCalledExactlyOnceWith(table.id, table.version, {
        isSpare: !isSpare,
        reason: "Nhân viên cập nhật cờ bàn sơ cua.",
      })
      expect(patch).toHaveBeenCalledExactlyOnceWith(`/tables/${table.id}/configuration`, {
        version: table.version,
        isSpare: !isSpare,
        reason: "Nhân viên cập nhật cờ bàn sơ cua.",
      })
      expect(current).toEqual(original)
    },
  )

  it("uses the shared action pending state and returns false when the action declines to run", async () => {
    run.mockResolvedValue(null)
    vi.mocked(useAction).mockReturnValue({ ...action, pending: true })
    const toggle = useSpareToggle()
    expect(toggle.pending).toBe(true)
    expect(await toggle.toggle(table)).toBe(false)
    expect(patch).not.toHaveBeenCalled()
  })

  it("passes version conflicts to the existing action path without retrying or changing the table", async () => {
    const conflict = new ApiError(409, "VERSION_CONFLICT", "Bàn vừa được thay đổi. Vui lòng tải lại.")
    patch.mockRejectedValue(conflict)
    run.mockResolvedValue(null)
    expect(await useSpareToggle().toggle(table)).toBe(false)
    const mutation = run.mock.calls[0]![0]
    await expect(mutation()).rejects.toBe(conflict)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(table.isSpare).toBe(false)
  })
})
