import { describe, expect, it } from "vitest"

import { EDITABLE_SELECTOR, isEditableTarget } from "./editable-target"

/** Stand-in for an element whose closest() matches only the listed selectors. */
function target(matching: string[]) {
  return { closest: (selector: string) => (matching.includes(selector) ? {} : null) }
}

describe("BA-020 undo shortcut draft preservation", () => {
  it("treats form controls and contenteditable hosts as editable", () => {
    expect(isEditableTarget(target([EDITABLE_SELECTOR]))).toBe(true)
  })

  it("lets the shortcut through outside editable controls", () => {
    expect(isEditableTarget(target([]))).toBe(false)
  })

  it("never throws on a missing or non-element target", () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
    expect(isEditableTarget({} as never)).toBe(false)
  })

  it("covers every control that can hold a draft", () => {
    for (const control of ["input", "textarea", "select", "[contenteditable=true]"])
      expect(EDITABLE_SELECTOR).toContain(control)
  })
})
