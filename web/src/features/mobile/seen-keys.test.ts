import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { addSeenKeys, pruneStore, readSeenKeys } from "./seen-keys"

const KEY = "test.seen"

// Vitest của web chạy environment "node" nên không có DOM. Dựng một
// localStorage tối thiểu bằng vi.stubGlobal, đúng cách state/session.test.ts
// đang làm, thay vì kéo thêm jsdom vào chỉ cho một file.
let store: Record<string, string> = {}
const fakeStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    store = {}
  },
}
vi.stubGlobal("localStorage", fakeStorage)

beforeEach(() => {
  store = {}
  vi.restoreAllMocks()
  vi.stubGlobal("localStorage", fakeStorage)
})
afterAll(() => vi.unstubAllGlobals())

describe("cảnh báo đã xem sống qua F5", () => {
  it("đọc lại đúng những khoá đã ghi", () => {
    // Chính là kịch bản lỗi: xem chuông, F5, chuông phải im.
    addSeenKeys(KEY, "2026-11-15", ["r12", "h9801"])
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set(["r12", "h9801"]))
  })

  it("tách theo ngày nghiệp vụ", () => {
    // Cùng một bàn cảnh báo lại vào ca hôm sau: dấu đã-xem của hôm qua không
    // được làm im cảnh báo của hôm nay.
    addSeenKeys(KEY, "2026-11-15", ["h9801"])
    expect(readSeenKeys(KEY, "2026-11-16")).toEqual(new Set())
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set(["h9801"]))
  })

  it("hợp nhất thay vì ghi đè, để hai tab không xoá dấu của nhau", () => {
    addSeenKeys(KEY, "2026-11-15", ["r1"])
    const merged = addSeenKeys(KEY, "2026-11-15", ["r2"])
    expect(merged).toEqual(new Set(["r1", "r2"]))
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set(["r1", "r2"]))
  })

  it("không nhân đôi khi ghi lại cùng một khoá", () => {
    addSeenKeys(KEY, "2026-11-15", ["r1", "r1"])
    addSeenKeys(KEY, "2026-11-15", ["r1"])
    expect([...readSeenKeys(KEY, "2026-11-15")]).toEqual(["r1"])
  })

  it("chỉ giữ 7 ngày gần nhất", () => {
    // Máy lễ tân chạy liên tục nhiều tháng; không cắt bớt thì localStorage
    // phình ra mãi vì mỗi ca thêm một danh sách khoá mới.
    for (let day = 1; day <= 10; day += 1) {
      addSeenKeys(KEY, `2026-11-${String(day).padStart(2, "0")}`, [`r${day}`])
    }
    expect(readSeenKeys(KEY, "2026-11-10")).toEqual(new Set(["r10"]))
    expect(readSeenKeys(KEY, "2026-11-04")).toEqual(new Set(["r4"]))
    // Ba ngày cũ nhất đã bị bỏ.
    expect(readSeenKeys(KEY, "2026-11-01")).toEqual(new Set())
    expect(readSeenKeys(KEY, "2026-11-03")).toEqual(new Set())
  })

  it("pruneStore giữ nguyên khi chưa vượt ngưỡng", () => {
    const store = { "2026-11-01": ["a"], "2026-11-02": ["b"] }
    expect(pruneStore(store, 7)).toBe(store)
  })

  it("không vỡ khi localStorage chứa rác", () => {
    localStorage.setItem(KEY, "{khong-phai-json")
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set())
    localStorage.setItem(KEY, '["mang-chu-khong-phai-object"]')
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set())
    localStorage.setItem(KEY, '{"2026-11-15":"khong-phai-mang"}')
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set())
    // Ghi đè được bằng dữ liệu tốt sau khi gặp rác.
    expect(addSeenKeys(KEY, "2026-11-15", ["r1"])).toEqual(new Set(["r1"]))
  })

  it("bỏ qua phần tử không phải chuỗi trong danh sách đã lưu", () => {
    localStorage.setItem(KEY, '{"2026-11-15":["r1",7,null,"r2"]}')
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set(["r1", "r2"]))
  })

  it("không ném lỗi khi localStorage bị chặn", () => {
    // Chế độ ẩn danh hoặc site data bị khoá: mất trí nhớ là chấp nhận được,
    // nhưng màn hình sơ đồ không được phép trắng vì chuyện đó.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(() => readSeenKeys(KEY, "2026-11-15")).not.toThrow()
    expect(readSeenKeys(KEY, "2026-11-15")).toEqual(new Set())
    expect(() => addSeenKeys(KEY, "2026-11-15", ["r1"])).not.toThrow()
    // Phiên hiện tại vẫn biết khoá vừa đánh dấu, chỉ là không lưu được.
    expect(addSeenKeys(KEY, "2026-11-15", ["r1"])).toEqual(new Set(["r1"]))
  })
})
