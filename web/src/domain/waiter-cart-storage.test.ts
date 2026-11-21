/**
 * `environment: "node"` nên không có `sessionStorage` thật. Test dựng một bản
 * tối thiểu đúng API được dùng, cộng một bản luôn ném lỗi để kiểm rằng storage
 * bị khóa (chế độ riêng tư, quota) không làm sập màn gọi món.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  WAITER_CART_PREFIX,
  clearWaiterCartDrafts,
  readWaiterCartDraft,
  removeWaiterCartDraft,
  waiterCartKey,
  writeWaiterCartDraft,
} from "./waiter-cart-storage"

class MemorySessionStorage {
  private readonly entries = new Map<string, string>()
  get length(): number {
    return this.entries.size
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
  removeItem(key: string): void {
    this.entries.delete(key)
  }
  clear(): void {
    this.entries.clear()
  }
}

const hostile = new Proxy(
  {},
  {
    get() {
      throw new DOMException("storage bị khóa")
    },
  },
)

function install(storage: unknown): void {
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true, writable: true })
}

beforeEach(() => install(new MemorySessionStorage()))
afterEach(() => install(undefined))

describe("nháp giỏ gọi món", () => {
  it("phân vùng theo người dùng, địa điểm và Phiên", () => {
    expect(waiterCartKey(6, 1, 42)).toBe(`${WAITER_CART_PREFIX}:6:1:42`)
    // Ba khóa khác nhau: cùng Phiên nhưng khác người hoặc khác quán là ba giỏ.
    const keys = new Set([waiterCartKey(6, 1, 42), waiterCartKey(7, 1, 42), waiterCartKey(6, 2, 42)])
    expect(keys.size).toBe(3)
  })

  it("ghi rồi đọc lại đúng nháp, và không thấy nháp của phân vùng khác", () => {
    writeWaiterCartDraft(waiterCartKey(6, 1, 42), { visitId: 42, lines: [{ variantId: 1 }] })
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 42))).toEqual({ visitId: 42, lines: [{ variantId: 1 }] })
    expect(readWaiterCartDraft(waiterCartKey(7, 1, 42))).toBeNull()
  })

  it("xóa một nháp không chạm tới nháp còn lại", () => {
    writeWaiterCartDraft(waiterCartKey(6, 1, 42), { visitId: 42 })
    writeWaiterCartDraft(waiterCartKey(6, 1, 43), { visitId: 43 })
    removeWaiterCartDraft(waiterCartKey(6, 1, 42))
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 42))).toBeNull()
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 43))).toEqual({ visitId: 43 })
  })

  it("đăng xuất dọn mọi nháp giỏ nhưng không chạm dữ liệu khác của tab", () => {
    writeWaiterCartDraft(waiterCartKey(6, 1, 42), { visitId: 42 })
    writeWaiterCartDraft(waiterCartKey(6, 1, 43), { visitId: 43 })
    sessionStorage.setItem("21gam.session-end.v1", "AUTH_SESSION_REVOKED")
    clearWaiterCartDrafts()
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 42))).toBeNull()
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 43))).toBeNull()
    expect(sessionStorage.getItem("21gam.session-end.v1")).toBe("AUTH_SESSION_REVOKED")
  })

  it("nháp rác đọc ra null thay vì ném lỗi", () => {
    sessionStorage.setItem(waiterCartKey(6, 1, 42), "{không phải JSON")
    expect(readWaiterCartDraft(waiterCartKey(6, 1, 42))).toBeNull()
  })

  it("storage bị khóa không làm sập màn gọi món", () => {
    install(hostile)
    expect(readWaiterCartDraft("k")).toBeNull()
    expect(() => writeWaiterCartDraft("k", { a: 1 })).not.toThrow()
    expect(() => removeWaiterCartDraft("k")).not.toThrow()
    expect(() => clearWaiterCartDrafts()).not.toThrow()
  })
})
