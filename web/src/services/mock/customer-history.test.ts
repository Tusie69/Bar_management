import { beforeEach, expect, it } from "vitest"
import type { AssignmentUndo, DuplicateDecisionInput } from "@/domain/models"
import { businessDateOf } from "@/lib/time"
import { clock } from "../clock"
import type { MockDb } from "./db"
import { DEMO_USERS } from "./seed"
import { MockGamApi } from "./server"

let api: MockGamApi, db: MockDb, range: { from: string; to: string }
const decision = (
  source: { id: number; version: number },
  target: { id: number; version: number },
): DuplicateDecisionInput => ({
  sourceCustomerId: source.id,
  targetCustomerId: target.id,
  sourceVersion: source.version,
  targetVersion: target.version,
})
beforeEach(() => {
  clock.resetToScenario()
  api = new MockGamApi({ businessDayWorkerEnabled: false })
  api.setSession(DEMO_USERS.find((user) => user.role === "OWNER")!)
  db = (api as unknown as { db: MockDb }).db
  range = { from: businessDateOf(clock.now()), to: businessDateOf(clock.now()) }
})
it("seeds several anonymous visits and three masked duplicate pairs, assigns existing/new customers and retains new profile on undo", async () => {
  const list = await api.getAnonymousVisits(range),
    duplicates = await api.getDuplicateCustomers()
  expect(list.visits.length).toBeGreaterThan(2)
  expect(duplicates.total).toBeGreaterThanOrEqual(3)
  expect(duplicates.pairs.every((pair) => /^••• \d{3}$/.test(pair.target.maskedPhone!))).toBe(true)
  const visit = list.visits[0]!,
    target = duplicates.pairs[0]!.target
  const stored = db.customers.get(target.id)!
  const phone = `0${stored.phoneE164!.slice(3)}`
  const assigned = await api.assignAnonymousVisit({ ...visit, phone })
  expect(assigned.customer.id).toBe(target.id)
  expect(assigned.customerCreated).toBe(false)
  expect(JSON.stringify(assigned)).not.toContain(phone)
  await api.undoAnonymousAssignment(assigned.undo)
  await expect(api.assignAnonymousVisit({ ...visit, version: 3, phone: "0909999678" })).rejects.toMatchObject({
    status: 422,
    code: "CUSTOMER_NAME_REQUIRED",
  })
  const created = await api.assignAnonymousVisit({
    ...visit,
    version: 3,
    phone: "0909999678",
    displayName: "Nguyễn Mới",
  })
  expect(created.customerCreated).toBe(true)
  await api.undoAnonymousAssignment(created.undo)
  expect(db.customers.get(created.customer.id)?.status).toBe("ACTIVE")
  await expect(api.undoAnonymousAssignment({ ...created.undo, version: 5 })).rejects.toMatchObject({ status: 409 })
})
it("rejects version conflicts, invalid phone/name, cross-venue visits, unauthorized writes and stale undo", async () => {
  const visit = (await api.getAnonymousVisits(range)).visits[0]!
  await expect(api.assignAnonymousVisit({ ...visit, version: 999, phone: "0901234678" })).rejects.toMatchObject({
    status: 409,
  })
  await expect(api.assignAnonymousVisit({ ...visit, phone: "+84901234678" })).rejects.toMatchObject({ status: 422 })
  await expect(
    api.assignAnonymousVisit({ ...visit, phone: "0901234678", displayName: "0901111222" }),
  ).rejects.toMatchObject({ status: 422 })
  const result = await api.assignAnonymousVisit({ ...visit, phone: "0901234678", displayName: "An" })
  db.visits.get(visit.visitId)!.version++
  await expect(api.undoAnonymousAssignment({ ...result.undo, version: 3 })).rejects.toMatchObject({ status: 409 })
  db.visits.get(visit.visitId)!.venueId = 999
  await expect(api.undoAnonymousAssignment({ ...result.undo, version: 3 })).rejects.toMatchObject({ status: 404 })
  api.setSession({ id: 99, displayName: "Read only", role: "ADMIN", deviceLabel: "test", accessLevel: "READ_ONLY" })
  expect((await api.getDuplicateCustomers()).canMerge).toBe(false)
  await expect(api.assignAnonymousVisit({ ...visit, phone: "0901234678" })).rejects.toMatchObject({ status: 403 })
  await expect(api.undoAnonymousAssignment(result.undo)).rejects.toMatchObject({ status: 403 })
})
it("merges all customer links, preserves target identity and excludes merged/dismissed profiles", async () => {
  const { pairs } = await api.getDuplicateCustomers(),
    first = pairs[0]!,
    second = pairs[1]!
  const beforeTarget = structuredClone(db.customers.get(first.target.id)!)
  const visit = [...db.visits.values()][0]!,
    booking = [...db.reservations.values()][0]!,
    wait = [...db.waitlist.values()].find((row) => row.kind === "WALK_IN")!
  for (const row of [visit, booking, wait]) row.customerId = first.source.id
  booking.venueId = 999
  const result = await api.mergeDuplicateCustomers(decision(first.source, first.target))
  expect(result.moved).toMatchObject({ visits: 1, reservations: 1, waitlist_entries: 1 })
  expect([visit, booking, wait].every((row) => row.customerId === first.target.id)).toBe(true)
  expect(db.customers.get(first.target.id)).toMatchObject({
    displayName: beforeTarget.displayName,
    phoneE164: beforeTarget.phoneE164,
    version: beforeTarget.version + 1,
  })
  expect(db.customers.get(first.source.id)?.status).toBe("MERGED")
  await api.dismissDuplicateCustomers(decision(second.source, second.target))
  const remaining = await api.getDuplicateCustomers()
  expect(
    remaining.pairs.some((pair) => pair.source.id === first.source.id || pair.source.id === second.source.id),
  ).toBe(false)
  await expect(api.mergeDuplicateCustomers(decision(second.source, second.target))).rejects.toMatchObject({
    code: "DUPLICATE_PAIR_DISMISSED",
  })
  expect(db.ops.slice(-2).every((op) => op.actorKind === "USER" && op.changes)).toBe(true)
})
it("venue admins get local activity/counts and cannot decide pairs; org-wide read-only cannot write", async () => {
  const first = (await api.getDuplicateCustomers()).pairs[0]!
  for (const row of [...db.visits.values(), ...db.reservations.values(), ...db.waitlist.values()]) {
    if (row.customerId === first.source.id || row.customerId === first.target.id) row.venueId = 999
  }
  api.setSession({
    id: 99,
    displayName: "Scoped",
    role: "ADMIN",
    deviceLabel: "test",
    adminScope: "VENUE",
    accessLevel: "WRITE",
  })
  expect((await api.getDuplicateCustomers()).pairs.some((pair) => pair.source.id === first.source.id)).toBe(false)
  const row = [...db.waitlist.values()].find((entry) => entry.kind === "WALK_IN")!
  row.venueId = 1
  row.customerId = first.source.id
  const listed = (await api.getDuplicateCustomers()).pairs.find((pair) => pair.source.id === first.source.id)!
  expect(listed.target).toMatchObject({ visitCount: 0, bookingCount: 0 })
  for (const action of [api.mergeDuplicateCustomers.bind(api), api.dismissDuplicateCustomers.bind(api)]) {
    await expect(action(decision(first.source, first.target))).rejects.toMatchObject({
      status: 403,
      code: "CUSTOMER_ORG_WRITE_REQUIRED",
    })
  }
  api.setSession({
    id: 99,
    displayName: "Read only",
    role: "ADMIN",
    deviceLabel: "test",
    adminScope: "ORGANIZATION",
    accessLevel: "READ_ONLY",
  })
  await expect(api.mergeDuplicateCustomers(decision(first.source, first.target))).rejects.toMatchObject({ status: 403 })
  await expect(api.dismissDuplicateCustomers(decision(first.source, first.target))).rejects.toMatchObject({
    status: 403,
  })
})
it("validates pagination and date ranges", async () => {
  await expect(api.getAnonymousVisits({ ...range, from: "2030-02-30" })).rejects.toMatchObject({ status: 422 })
  await expect(api.getDuplicateCustomers({ pageSize: 51 })).rejects.toMatchObject({ status: 422 })
  const result = await api.getAnonymousVisits({ ...range, pageSize: 1 })
  expect(result.visits).toHaveLength(1)
  expect(result.hasMore).toBe(true)
  await expect(
    api.undoAnonymousAssignment({
      operationId: 999,
      visitId: result.visits[0]!.visitId,
      version: result.visits[0]!.version,
      previousCustomerId: null,
    } satisfies AssignmentUndo),
  ).rejects.toMatchObject({ status: 404 })
})
it("replays successful assign, merge and dismiss without extra writes and rejects changed requests", async () => {
  const visit = (await api.getAnonymousVisits(range)).visits[0]!
  const assign = {
    visitId: visit.visitId,
    version: visit.version,
    phone: "0909999678",
    displayName: "New guest",
    idempotencyKey: "na34-assign-replay",
  }
  const assigned = await api.assignAnonymousVisit(assign)
  const auditCount = db.ops.length
  expect(await api.assignAnonymousVisit(assign)).toEqual(assigned)
  expect(db.ops).toHaveLength(auditCount)
  expect(db.visits.get(visit.visitId)?.version).toBe(assigned.version)
  await expect(api.assignAnonymousVisit({ ...assign, phone: "0909999679" })).rejects.toMatchObject({
    status: 422,
    code: "IDEMPOTENCY_KEY_REUSED",
  })
  const pairs = (await api.getDuplicateCustomers()).pairs
  for (const [index, method] of ["mergeDuplicateCustomers", "dismissDuplicateCustomers"].entries()) {
    const action = method as "mergeDuplicateCustomers" | "dismissDuplicateCustomers"
    const pair = pairs[index]!
    const input = { ...decision(pair.source, pair.target), idempotencyKey: `na34-${action}` }
    const result = await api[action](input)
    const audits = db.ops.length,
      version = db.customers.get(pair.source.id)?.version
    expect(await api[action](input)).toEqual(result)
    expect(db.ops).toHaveLength(audits)
    expect(db.customers.get(pair.source.id)?.version).toBe(version)
    await expect(api[action]({ ...input, targetVersion: input.targetVersion + 1 })).rejects.toMatchObject({
      status: 422,
      code: "IDEMPOTENCY_KEY_REUSED",
    })
  }
  const fresh = pairs[2]!
  await expect(
    api.dismissDuplicateCustomers({ ...decision(fresh.source, fresh.target), idempotencyKey: assign.idempotencyKey }),
  ).rejects.toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" })
  api.setSession({ ...DEMO_USERS.find((user) => user.role === "OWNER")!, id: 999 })
  await expect(api.assignAnonymousVisit(assign)).rejects.toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" })
})
it("validates keys, only remembers successes and clears replay state on demo reset", async () => {
  const visit = (await api.getAnonymousVisits(range)).visits[0]!
  const input = {
    visitId: visit.visitId,
    version: visit.version,
    phone: "0909999678",
    idempotencyKey: "na34-failed-attempt",
  }
  await expect(api.assignAnonymousVisit({ ...input, idempotencyKey: "bad" })).rejects.toMatchObject({
    status: 400,
    code: "INVALID_IDEMPOTENCY_KEY",
  })
  await expect(api.assignAnonymousVisit(input)).rejects.toMatchObject({ status: 422, code: "CUSTOMER_NAME_REQUIRED" })
  const assigned = await api.assignAnonymousVisit({ ...input, displayName: "New guest" })
  // Returned objects cannot mutate the stored replay response.
  assigned.customer.displayName = "Changed locally"
  expect((await api.assignAnonymousVisit({ ...input, displayName: "New guest" })).customer.displayName).toBe(
    "New guest",
  )
  api.reset()
  const resetVisit = (await api.getAnonymousVisits(range)).visits[0]!
  await expect(
    api.assignAnonymousVisit({
      visitId: resetVisit.visitId,
      version: resetVisit.version,
      phone: input.phone,
      displayName: "After reset",
      idempotencyKey: input.idempotencyKey,
    }),
  ).resolves.toMatchObject({ customerCreated: true })
})
