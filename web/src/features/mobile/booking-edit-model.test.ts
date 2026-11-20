import { describe, expect, it } from "vitest"
import { guestValueFrom, toggleClassification } from "@/domain/booking-rules"
import type { FloorTableState, ReservationView, TableAvailability, TableView } from "@/domain/models"
import { NOTE_PHONE_ERROR } from "@/lib/text"
import { atBusinessTime } from "@/lib/time"
import {
  BOOKING_NOTE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  applySavedBookingEdit,
  buildUpdateReservationInput,
  diffBookingEditDraft,
  initialBookingEditDraft,
  pinLoadedBooking,
  prepareTablePickerTarget,
  resolveBookingEditBackAction,
  syncBookingEditSession,
  validateBookingEditDraft,
} from "./booking-edit-model"

const BD = "2026-11-19"
const NOW = new Date("2026-11-19T12:00:00+07:00") // 19:00 venue time? Wait: +07:00 12:00 is 12:00 ICT (before 19:00)

function makeReservation(overrides: Partial<ReservationView> = {}): ReservationView {
  return {
    id: 42,
    version: 3,
    customerId: 7,
    displayName: "Tú",
    hasGuestName: true,
    phoneLast3: "789",
    partySize: 4,
    expectedAt: atBusinessTime(BD, "21:00"),
    businessDate: BD,
    classification: "UNCLASSIFIED",
    guestType: null,
    isBirthday: false,
    status: "BOOKED",
    sourceCode: "HOTLINE",
    socialPlatform: null,
    iconKeys: [],
    honorific: null,
    note: null,
    tableIds: [1],
    holdId: 10,
    symbolNo: null,
    subState: "DANG_GIU_BAN",
    warning: null,
    minutesLate: 0,
    waitlistEntryId: null,
    visitId: null,
    checkedInAt: null,
    closedAt: null,
    closeReasonCode: null,
    closeReasonNote: null,
    createdAt: new Date("2026-11-19T10:00:00+07:00"),
    createdByName: "Lễ tân 1",
    lateConfirmedAt: null,
    canCall: true,
    ...overrides,
  }
}

function makeTable(id: number, code: string, zoneId = 1, kind: "TABLE" | "BAR_SEAT" = "TABLE"): TableView {
  return {
    id,
    version: 1,
    code,
    displayName: code,
    zoneId,
    zoneCode: zoneId === 1 ? "A" : "B",
    kind,
    capacity: 4,
    seqNo: null,
    isSpare: false,
    status: "ACTIVE",
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    seating: undefined,
  }
}

function makeValidationCtx(
  overrides: {
    tables?: TableView[]
    avail?: TableAvailability[]
    availReady?: boolean
    now?: Date
  } = {},
) {
  const tables = overrides.tables ?? [makeTable(1, "A5", 1), makeTable(2, "A6", 1), makeTable(3, "B1", 2)]
  const byId = new Map(tables.map((t) => [t.id, t]))
  const states = new Map<number, FloorTableState>(
    tables.map((t) => [
      t.id,
      { tableId: t.id, state: t.id === 1 ? "reserved" : "free", claim: null, staleFromPreviousDay: false },
    ]),
  )
  const availList: TableAvailability[] = overrides.avail ?? [
    {
      tableId: 1,
      status: "reserved",
      reason: "Đã giữ",
      claimStartsAt: null,
      bookingConflicts: [{ reservationId: 42, expectedAt: atBusinessTime(BD, "21:00") }],
    },
    { tableId: 2, status: "available", reason: "", claimStartsAt: null },
    { tableId: 3, status: "available", reason: "", claimStartsAt: null },
  ]
  const availMap = new Map(availList.map((a) => [a.tableId, a]))
  return {
    now: overrides.now ?? NOW,
    quickTimes: ["19:30", "20:30", "21:30"],
    byId,
    states,
    availMap,
    bookableZoneIds: new Set([1, 2]),
    availReady: overrides.availReady ?? true,
    isSameBusinessDate: true,
  }
}

describe("booking-edit-model dirty state and field diff", () => {
  it("starts clean and stays clean when whitespace-only or equivalent values are set", () => {
    const r = makeReservation()
    const draft = initialBookingEditDraft(r)
    expect(diffBookingEditDraft(r, draft).isDirty).toBe(false)

    // Trailing spaces on name/note do not mark dirty
    const spaceDraft = { ...draft, name: "  Tú  ", note: "   " }
    expect(diffBookingEditDraft(r, spaceDraft).isDirty).toBe(false)

    // Leading zero in "số khác..." parses to 4 (invalid in GuestPicker because <=6, so dirty & invalid)
    // while leading zero for >6 (e.g. "08" for partySize 8) stays clean
    const r8 = makeReservation({ partySize: 8 })
    const draft8 = initialBookingEditDraft(r8)
    expect(draft8.guest).toEqual({ mode: "other", party: 8, otherText: "8" })
    expect(diffBookingEditDraft(r8, { ...draft8, guest: { mode: "other", party: 8, otherText: "08" } }).isDirty).toBe(
      false,
    )
  })

  it("detects edits and returns to clean when reverted across all fields", () => {
    const r = makeReservation({
      honorific: "MR",
      classification: "RETURNING",
      iconKeys: ["star"],
      isBirthday: true,
      sourceCode: "SOCIAL",
      socialPlatform: "FB",
      note: "Bàn góc",
      tableIds: [1, 2],
    })
    const initial = initialBookingEditDraft(r)

    // Edit multiple fields
    const edited = {
      ...initial,
      name: "Lan",
      honorific: null,
      classification: "NEW" as const,
      guest: guestValueFrom(6),
      businessDate: "2026-11-20",
      time: "22:00",
      tableIds: [2],
      source: "HOTLINE" as const,
      platform: "" as const,
      isBirthday: false,
      iconKeys: [],
      note: "Ghi chú mới",
    }
    const diffEdited = diffBookingEditDraft(r, edited)
    expect(diffEdited.isDirty).toBe(true)
    expect(diffEdited.fieldsDirty).toBe(true)
    expect(diffEdited.tablesDirty).toBe(true)
    expect(Object.values(diffEdited.changed).every(Boolean)).toBe(true)

    // Revert back (even with reversed tableIds order [2, 1] vs [1, 2])
    const reverted = {
      ...initial,
      tableIds: [2, 1],
    }
    const diffReverted = diffBookingEditDraft(r, reverted)
    expect(diffReverted.isDirty).toBe(false)
    expect(diffReverted.fieldsDirty).toBe(false)
    expect(diffReverted.tablesDirty).toBe(false)
  })

  it("returns draft to clean when choice chips (source, icon, classification, honorific, guest, time, date) revert to original", () => {
    const r = makeReservation({
      partySize: 4,
      honorific: "MR",
      classification: "UNCLASSIFIED",
      sourceCode: "HOTLINE",
      socialPlatform: null,
      iconKeys: ["pin"],
      isBirthday: false,
    })
    const initial = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    // 1. Source chip: HOTLINE -> SOCIAL (FB) -> HOTLINE
    const toSocial = { ...initial, source: "SOCIAL" as const, platform: "FB" as const }
    expect(diffBookingEditDraft(r, toSocial).isDirty).toBe(true)
    const backHotline = { ...toSocial, source: "HOTLINE" as const, platform: "" as const }
    expect(diffBookingEditDraft(r, backHotline).isDirty).toBe(false)

    // 2. Icon chips: ["pin"] -> ["pin", "star"] + birthday -> toggle back
    const toggledIcons = { ...initial, iconKeys: ["pin", "star"], isBirthday: true }
    expect(diffBookingEditDraft(r, toggledIcons).changed.icons).toBe(true)
    const revertedIcons = { ...toggledIcons, iconKeys: ["pin"], isBirthday: false }
    expect(diffBookingEditDraft(r, revertedIcons).isDirty).toBe(false)

    // 3. Classification toggle: UNCLASSIFIED -> RETURNING -> toggle RETURNING again -> UNCLASSIFIED
    const toReturning = { ...initial, classification: toggleClassification(initial.classification, "RETURNING") }
    expect(toReturning.classification).toBe("RETURNING")
    expect(diffBookingEditDraft(r, toReturning).changed.classification).toBe(true)
    const backUnclassified = {
      ...toReturning,
      classification: toggleClassification(toReturning.classification, "RETURNING"),
    }
    expect(backUnclassified.classification).toBe("UNCLASSIFIED")
    expect(diffBookingEditDraft(r, backUnclassified).isDirty).toBe(false)

    // 4. GuestPicker: 4 -> 8 ("số khác") -> 4 quick chip
    const toOther = { ...initial, guest: { mode: "other" as const, party: 8, otherText: "8" } }
    expect(diffBookingEditDraft(r, toOther).changed.partySize).toBe(true)
    expect(buildUpdateReservationInput(r, toOther).partySize).toBe(8)
    const backQuick4 = { ...toOther, guest: guestValueFrom(4) }
    expect(diffBookingEditDraft(r, backQuick4).isDirty).toBe(false)

    // 5. Honorific, date, time: change and revert
    const changedSchedule = {
      ...initial,
      honorific: null,
      businessDate: "2026-11-20",
      time: "21:30",
    }
    expect(diffBookingEditDraft(r, changedSchedule).isDirty).toBe(true)
    const revertedSchedule = {
      ...changedSchedule,
      honorific: "MR" as const,
      businessDate: BD,
      time: "21:00",
    }
    expect(diffBookingEditDraft(r, revertedSchedule).isDirty).toBe(false)
    expect(validateBookingEditDraft(r, revertedSchedule, diffBookingEditDraft(r, revertedSchedule), ctx).canSave).toBe(
      false,
    )
  })

  it("handles WF-01 phone-only booking (hasGuestName=false) without leaking fallback name", () => {
    const r = makeReservation({ hasGuestName: false, displayName: "Khách", phoneLast3: "789" })
    const draft = initialBookingEditDraft(r)
    expect(draft.name).toBe("")
    expect(diffBookingEditDraft(r, draft).isDirty).toBe(false)

    // Note-only edit omits contactName in update payload
    const noteEdited = { ...draft, note: "Khách quen" }
    const payload = buildUpdateReservationInput(r, noteEdited)
    expect(payload).not.toHaveProperty("contactName")
    expect(payload.note).toBe("Khách quen")

    // Intentional name edit sends contactName
    const nameEdited = { ...draft, name: "Anh Minh" }
    expect(buildUpdateReservationInput(r, nameEdited).contactName).toBe("Anh Minh")
  })

  it("ignores stale socialPlatform diff when source is not SOCIAL", () => {
    const r = makeReservation({ sourceCode: "SOCIAL", socialPlatform: "FB" })
    const initial = initialBookingEditDraft(r)

    // Switch to HOTLINE (clears platform), then back to SOCIAL + FB
    const hotline = { ...initial, source: "HOTLINE" as const, platform: "" as const }
    expect(diffBookingEditDraft(r, hotline).changed.source).toBe(true)
    expect(diffBookingEditDraft(r, hotline).changed.platform).toBe(true)

    const backToSocial = { ...hotline, source: "SOCIAL" as const, platform: "FB" as const }
    expect(diffBookingEditDraft(r, backToSocial).isDirty).toBe(false)
  })
})

describe("booking-edit-model validation", () => {
  it("validates GuestPicker values (quick 1-6, >6 'số khác', and max 500)", () => {
    const r = makeReservation({ partySize: 4 })
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    // Quick pick 1..6 and valid "số khác" > 6 up to 500
    const quick6 = { ...base, guest: guestValueFrom(6) }
    expect(validateBookingEditDraft(r, quick6, diffBookingEditDraft(r, quick6), ctx).errors.partySize).toBeNull()

    const other500 = { ...base, guest: guestValueFrom(500) }
    expect(validateBookingEditDraft(r, other500, diffBookingEditDraft(r, other500), ctx).errors.partySize).toBeNull()

    // Invalid "số khác": empty, 0, <=6, >500, non-numeric
    for (const badText of ["", "0", "4", "abc", "501"]) {
      const bad = { ...base, guest: { mode: "other" as const, party: 4, otherText: badText } }
      const res = validateBookingEditDraft(r, bad, diffBookingEditDraft(r, bad), ctx)
      expect(res.errors.partySize).toBeTruthy()
      expect(res.canSave).toBe(false)
    }
  })

  it("rejects phone numbers (including full-width NFKC digits) and >500 chars in note", () => {
    const r = makeReservation()
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    const withPhone = { ...base, note: "Gọi 0901234567" }
    const resPhone = validateBookingEditDraft(r, withPhone, diffBookingEditDraft(r, withPhone), ctx)
    expect(resPhone.errors.note).toBe(NOTE_PHONE_ERROR)
    expect(resPhone.canSave).toBe(false)

    const withFullWidth = { ...base, note: "Gọi ０９０１２３４５６７" }
    const resNfkc = validateBookingEditDraft(r, withFullWidth, diffBookingEditDraft(r, withFullWidth), ctx)
    expect(resNfkc.errors.note).toBe(NOTE_PHONE_ERROR)

    const tooLongNote = { ...base, note: "a".repeat(BOOKING_NOTE_MAX_LENGTH + 1) }
    const resLong = validateBookingEditDraft(r, tooLongNote, diffBookingEditDraft(r, tooLongNote), ctx)
    expect(resLong.errors.note).toContain(String(BOOKING_NOTE_MAX_LENGTH))
    expect(resLong.canSave).toBe(false)
  })

  it("validates guest name max length and contact requirement when no phone", () => {
    const r = makeReservation({ phoneLast3: null })
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    const cleared = { ...base, name: "" }
    const resCleared = validateBookingEditDraft(r, cleared, diffBookingEditDraft(r, cleared), ctx)
    expect(resCleared.errors.name).toBe("Cần ít nhất tên khách hoặc số điện thoại.")
    expect(resCleared.canSave).toBe(false)

    const tooLong = { ...base, name: "a".repeat(GUEST_NAME_MAX_LENGTH + 1) }
    const resLong = validateBookingEditDraft(r, tooLong, diffBookingEditDraft(r, tooLong), ctx)
    expect(resLong.errors.name).toContain(String(GUEST_NAME_MAX_LENGTH))
  })

  it("validates tables (cannot clear existing tables, cannot mix zones, allows own table)", () => {
    const r = makeReservation({ tableIds: [1] })
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    // Merge with same-zone free table A6 -> valid
    const merged = { ...base, tableIds: [1, 2] }
    const resMerged = validateBookingEditDraft(r, merged, diffBookingEditDraft(r, merged), ctx)
    expect(resMerged.errors.tables).toBeNull()
    expect(resMerged.canSave).toBe(true)

    // Mix zone A5 (zone 1) + B1 (zone 2) -> inline Vietnamese error
    const mixed = { ...base, tableIds: [1, 3] }
    const resMixed = validateBookingEditDraft(r, mixed, diffBookingEditDraft(r, mixed), ctx)
    expect(resMixed.errors.tables).toBe("Chỉ có thể chọn các bàn trong cùng một khu vực.")
    expect(resMixed.canSave).toBe(false)

    // Clear all tables on an already-assigned booking -> error
    const cleared = { ...base, tableIds: [] }
    const resCleared = validateBookingEditDraft(r, cleared, diffBookingEditDraft(r, cleared), ctx)
    expect(resCleared.errors.tables).toBe("Booking đã xếp bàn cần giữ ít nhất 1 bàn.")
    expect(resCleared.canSave).toBe(false)
  })

  it("preserves legacy off-slot time when schedule is unchanged, and validates when time changes", () => {
    const r = makeReservation({ expectedAt: atBusinessTime(BD, "21:03") })
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx({ now: new Date("2026-11-19T22:00:00+07:00") })

    // Editing note only does not trigger past/slot time error
    const noteOnly = { ...base, note: "Đổi ghi chú" }
    const resNote = validateBookingEditDraft(r, noteOnly, diffBookingEditDraft(r, noteOnly), ctx)
    expect(resNote.errors.time).toBeNull()
    expect(resNote.legacyTime).toBe("21:03")
    expect(resNote.canSave).toBe(true)

    // Picking a past time triggers inline error
    const pastTime = { ...base, time: "20:00" }
    const resPast = validateBookingEditDraft(r, pastTime, diffBookingEditDraft(r, pastTime), ctx)
    expect(resPast.errors.time).toContain("đã qua")
    expect(resPast.canSave).toBe(false)
  })

  it("requires social platform when source is SOCIAL", () => {
    const r = makeReservation({ sourceCode: "HOTLINE" })
    const base = initialBookingEditDraft(r)
    const ctx = makeValidationCtx()

    const socialNoPlat = { ...base, source: "SOCIAL" as const, platform: "" as const }
    const res = validateBookingEditDraft(r, socialNoPlat, diffBookingEditDraft(r, socialNoPlat), ctx)
    expect(res.errors.platform).toBe("Vui lòng chọn nền tảng mạng xã hội.")
    expect(res.canSave).toBe(false)
  })
})

describe("booking-edit-model session pinning (B01) and pending guard (B03)", () => {
  it("replaces source, version, and draft together on refresh while clean", () => {
    const initialRecord = makeReservation({ version: 3, partySize: 2, note: null })
    const session = {
      source: initialRecord,
      draft: initialBookingEditDraft(initialRecord),
    }

    const refreshed = makeReservation({ version: 4, partySize: 3, note: "Bàn gần cửa" })
    const next = syncBookingEditSession(session, refreshed)

    expect(next).not.toBe(session)
    expect(next.source.version).toBe(4)
    expect(next.source.partySize).toBe(3)
    expect(next.draft.guest).toEqual({ mode: "quick", party: 3, otherText: "" })
    expect(next.draft.note).toBe("Bàn gần cửa")
    expect(diffBookingEditDraft(next.source, next.draft).isDirty).toBe(false)
  })

  it("pins source and version while dirty so concurrent refresh neither overwrites nor leaks remote changes", () => {
    const initialRecord = makeReservation({ version: 3, partySize: 2, note: null })
    const dirtySession = {
      source: initialRecord,
      draft: { ...initialBookingEditDraft(initialRecord), note: "Ghi chú mới" },
    }

    const refreshed = makeReservation({ version: 4, partySize: 3, note: null })
    const next = syncBookingEditSession(dirtySession, refreshed)

    expect(next).toBe(dirtySession)
    expect(next.source.version).toBe(3)
    expect(next.source.partySize).toBe(2)

    const diff = diffBookingEditDraft(next.source, next.draft)
    expect(diff.isDirty).toBe(true)
    expect(diff.changed.note).toBe(true)
    expect(diff.changed.partySize).toBe(false)

    const payload = buildUpdateReservationInput(next.source, next.draft)
    expect(payload.version).toBe(3)
    expect(payload.partySize).toBe(2)
    expect(payload.note).toBe("Ghi chú mới")

    // Reverting the local edit back to source makes the draft clean so a refresh can sync again.
    const revertedSession = {
      ...next,
      draft: { ...next.draft, note: "" },
    }
    const syncedAfterRevert = syncBookingEditSession(revertedSession, refreshed)
    expect(syncedAfterRevert.source.version).toBe(4)
    expect(syncedAfterRevert.draft.guest).toEqual({ mode: "quick", party: 3, otherText: "" })
    expect(diffBookingEditDraft(syncedAfterRevert.source, syncedAfterRevert.draft).isDirty).toBe(false)
  })

  it("blocks back/close while save is pending regardless of dirty state", () => {
    expect(resolveBookingEditBackAction({ pending: true, isDirty: false })).toBe("block_pending")
    expect(resolveBookingEditBackAction({ pending: true, isDirty: true })).toBe("block_pending")
    expect(resolveBookingEditBackAction({ pending: false, isDirty: true })).toBe("confirm_discard")
    expect(resolveBookingEditBackAction({ pending: false, isDirty: false })).toBe("leave")
  })

  it("keeps loaded booking pinned when missing from refreshed list (B01-R1)", () => {
    const initialRecord = makeReservation({ version: 2, note: null })
    const key = "42:2026-11-19"

    // Never loaded -> stays null ("Không tìm thấy booking")
    expect(pinLoadedBooking(null, key, undefined)).toBeNull()

    // Loaded -> stays pinned even after booking disappears from refreshed list
    const loaded = pinLoadedBooking(null, key, initialRecord)
    expect(loaded).toEqual({ key, record: initialRecord })
    expect(pinLoadedBooking(loaded, key, undefined)).toBe(loaded)
    expect(pinLoadedBooking(loaded, "42:2026-11-20", undefined)).toBeNull()

    // Dirty session keeps local edits, pinned version, and discard guard when refreshed row is missing
    const dirtySession = {
      source: initialRecord,
      draft: { ...initialBookingEditDraft(initialRecord), note: "Ghi chú trước khi đổi ngày" },
    }
    const dirtyAfterMissing = syncBookingEditSession(dirtySession, undefined)
    expect(dirtyAfterMissing).toBe(dirtySession)
    expect(diffBookingEditDraft(dirtyAfterMissing.source, dirtyAfterMissing.draft).isDirty).toBe(true)
    expect(buildUpdateReservationInput(dirtyAfterMissing.source, dirtyAfterMissing.draft).version).toBe(2)
    expect(resolveBookingEditBackAction({ pending: false, isDirty: true })).toBe("confirm_discard")

    // Clean session stays mounted with pinned data and disabled save when refreshed row is missing
    const cleanSession = {
      source: initialRecord,
      draft: initialBookingEditDraft(initialRecord),
    }
    const cleanAfterMissing = syncBookingEditSession(cleanSession, undefined)
    expect(cleanAfterMissing).toBe(cleanSession)
    const cleanDiff = diffBookingEditDraft(cleanAfterMissing.source, cleanAfterMissing.draft)
    expect(cleanDiff.isDirty).toBe(false)
    expect(
      validateBookingEditDraft(cleanAfterMissing.source, cleanAfterMissing.draft, cleanDiff, makeValidationCtx())
        .canSave,
    ).toBe(false)
  })
})

describe("booking-edit-model save-and-pick re-pin and error recovery (PR17-01, PR17-02)", () => {
  it("keeps saved display fields clean without incrementing version until server read confirms it", async () => {
    const original = makeReservation({ version: 3, businessDate: BD, note: null })
    const editedDraft = {
      ...initialBookingEditDraft(original),
      businessDate: "2026-11-20",
      time: "20:00",
      note: "Đổi ngày rồi đổi bàn",
    }

    const saved = applySavedBookingEdit(original, editedDraft)
    expect(saved.version).toBe(original.version)
    expect(saved.businessDate).toBe("2026-11-20")
    expect(saved.note).toBe("Đổi ngày rồi đổi bàn")

    const cleanDraft = initialBookingEditDraft(saved)
    const cleanDiff = diffBookingEditDraft(saved, cleanDraft)
    expect(cleanDiff.isDirty).toBe(false)
    expect(validateBookingEditDraft(saved, cleanDraft, cleanDiff, makeValidationCtx()).canSave).toBe(false)

    // Unconfirmed post-save session ignores background refreshes until the confirmed read runs.
    const unconfirmedSession = {
      source: saved,
      draft: cleanDraft,
      versionConfirmed: false,
    }
    const staleFromCache = makeReservation({ version: 3, businessDate: "2026-11-20", note: "Old" })
    expect(syncBookingEditSession(unconfirmedSession, staleFromCache)).toBe(unconfirmedSession)

    // Confirmed read supplies the authoritative version from the server (e.g. 7, never source.version + 1).
    const fetchedFromServer = makeReservation({
      version: 7,
      businessDate: "2026-11-20",
      note: "Đổi ngày rồi đổi bàn",
    })
    let synced: ReservationView | null = null
    let opened: ReservationView | null = null
    const res = await prepareTablePickerTarget(saved, true, {
      loadBooking: async () => fetchedFromServer,
      ensureWaitlist: async () => {},
      checkPolicy: () => ({ canReassign: true }),
      onSessionSync: (r) => {
        synced = r
      },
      onMissingOrClosed: () => {},
      openPicker: (r) => {
        opened = r
      },
    })
    expect(res).toEqual({ status: "opened" })
    expect(synced).toEqual(fetchedFromServer)
    expect(synced!.version).toBe(7)
    expect(opened).toEqual(fetchedFromServer)
    expect(opened!.version).toBe(7)
  })

  it("handles booking and waitlist load errors cleanly, keeps waitlist guard, and allows picker retry", async () => {
    const saved = applySavedBookingEdit(makeReservation({ version: 3, businessDate: BD }), {
      ...initialBookingEditDraft(makeReservation({ version: 3, businessDate: BD })),
      businessDate: "2026-11-20",
      note: "Đã lưu",
    })
    const latestFromServer: ReservationView = { ...saved, version: 9, tableIds: [], holdId: null }

    // 1. Target-date booking query fails with 503 -> onSessionSync is not called, stage is "booking"
    let synced: ReservationView | null = null
    let opened: ReservationView | null = null
    const bookingFail = await prepareTablePickerTarget(saved, true, {
      loadBooking: async () => {
        throw new Error("503 booking list unavailable")
      },
      ensureWaitlist: async () => {},
      checkPolicy: () => ({ canReassign: true }),
      onSessionSync: (r) => {
        synced = r
      },
      onMissingOrClosed: () => {},
      openPicker: (r) => {
        opened = r
      },
    })
    expect(synced).toBeNull()
    expect(bookingFail.status).toBe("error")
    if (bookingFail.status === "error") {
      expect(bookingFail.savedBeforePick).toBe(true)
      expect(bookingFail.stage).toBe("booking")
      expect(bookingFail.message).toContain("Đã lưu thay đổi")
    }
    expect(opened).toBeNull()

    // 2. Booking query recovers and syncs server version (9), then target-date waitlist fails with 503
    const waitlistFail = await prepareTablePickerTarget(saved, true, {
      loadBooking: async () => latestFromServer,
      ensureWaitlist: async () => {
        throw new Error("503 waitlist unavailable")
      },
      checkPolicy: () => ({ canReassign: true }),
      onSessionSync: (r) => {
        synced = r
      },
      onMissingOrClosed: () => {},
      openPicker: (r) => {
        opened = r
      },
    })
    expect(synced).toEqual(latestFromServer)
    expect(synced!.version).toBe(9)
    expect(waitlistFail.status).toBe("error")
    if (waitlistFail.status === "error") {
      expect(waitlistFail.savedBeforePick).toBe(true)
      expect(waitlistFail.stage).toBe("waitlist")
      expect(waitlistFail.message).toContain("Đã lưu thay đổi")
    }
    expect(opened).toBeNull()

    // 3. Waitlist policy check blocks opening picker when policy is not reassignable
    const policyBlocked = await prepareTablePickerTarget(saved, false, {
      loadBooking: async () => latestFromServer,
      ensureWaitlist: async () => {},
      checkPolicy: () => ({ canReassign: false, reason: "Không tải được đơn chờ" }),
      onSessionSync: () => {},
      onMissingOrClosed: () => {},
      openPicker: (r) => {
        opened = r
      },
    })
    expect(policyBlocked).toEqual({
      status: "error",
      savedBeforePick: false,
      stage: "policy",
      message: "Không tải được đơn chờ",
    })
    expect(opened).toBeNull()

    // 4. After recovery, retry opens picker with the synced booking (no second save needed)
    const recovered = await prepareTablePickerTarget(latestFromServer, true, {
      loadBooking: async () => latestFromServer,
      ensureWaitlist: async () => {},
      checkPolicy: () => ({ canReassign: true }),
      onSessionSync: () => {},
      onMissingOrClosed: () => {},
      openPicker: (r) => {
        opened = r
      },
    })
    expect(recovered).toEqual({ status: "opened" })
    expect(opened).toEqual(latestFromServer)
  })
})
