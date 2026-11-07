import { describe, expect, it } from "vitest"

import { contactNameUpdate, initialContactName } from "./booking-identity"

const fallback = "Khách"

describe("WF-01 booking editor guest name", () => {
  it("never seeds the input with the display fallback", () => {
    expect(initialContactName(false, fallback)).toBe("")
    expect(initialContactName(true, "Nguyễn An")).toBe("Nguyễn An")
  })

  it("omits the name when a phone-only booking is edited without one", () => {
    // Only the note changed: the identity must not be written.
    expect(contactNameUpdate(false, "")).toEqual({})
    expect(contactNameUpdate(false, "   ")).toEqual({})
  })

  it("sends a real name the user typed on a phone-only booking", () => {
    expect(contactNameUpdate(false, "Nguyễn An")).toEqual({ contactName: "Nguyễn An" })
  })

  it("keeps a real name that happens to equal the fallback", () => {
    // Decided from the flag, not by comparing the text, so this is a real name.
    expect(contactNameUpdate(false, fallback)).toEqual({ contactName: fallback })
    expect(contactNameUpdate(true, fallback)).toEqual({ contactName: fallback })
  })

  it("treats an emptied field on a named booking as an intentional clear", () => {
    expect(contactNameUpdate(true, "")).toEqual({ contactName: "" })
  })

  it("passes the typed text through untrimmed so the server decides", () => {
    expect(contactNameUpdate(true, " Nguyễn An ")).toEqual({ contactName: " Nguyễn An " })
  })
})
