import { describe, expect, it } from "vitest"

import { isPlausibleVnPhone, maskedPhone, noteHasPhoneNumber } from "./text"

describe("Vietnam phone input", () => {
  it.each(["0987654321", "0987 654 321", "0987.654.321", "(0987) 654-321"])("accepts %s", (value) => {
    expect(isPlausibleVnPhone(value)).toBe(true)
  })

  it.each(["", "987654321", "1234567890", "+84987654321", "0084987654321", "0987abc654321"])(
    "rejects %s",
    (value) => {
      expect(isPlausibleVnPhone(value)).toBe(false)
    },
  )

  it("returns only the last three digits in the masked display", () => {
    expect(maskedPhone("321")).toBe("•••• ••• 321")
    expect(maskedPhone(null)).toBe("Không có SĐT")
  })

  it.each([
    "0987654321",
    "0987 654 321",
    "0987.654.321",
    "0987-654-321",
    "(0987) 654-321",
    "+84 987 654 321",
    "0084 987 654 321",
    "Gọi khách theo số 0987 654 321 giúp em",
  ])("detects phone number in note %s", (value) => {
    expect(noteHasPhoneNumber(value)).toBe(true)
  })

  it.each(["Ngày 20261029", "Mã đơn 12345678", "Bàn A12 lúc 21:30", "Mã 1234567890"])(
    "allows ordinary numeric note %s",
    (value) => expect(noteHasPhoneNumber(value)).toBe(false),
  )
})
