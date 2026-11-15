/**
 * Ghi nhớ những cảnh báo lễ tân đã xem, sống qua F5.
 *
 * Trước đây `seen` và `handled` chỉ nằm trong state của `MobileApp`. Máy lễ tân
 * bị tải lại trang nhiều lần trong một ca — đổi mạng, hết pin, bấm nhầm — và
 * mỗi lần tải lại thì mọi cảnh báo cũ lại hiện như mới. Chuông nhảy số lại từ
 * đầu và toast "tới muộn" bắn lại cho cùng một booking, nên lễ tân học cách
 * bỏ qua chuông, và đó là lúc cảnh báo thật bị bỏ sót.
 *
 * Lưu theo NGÀY NGHIỆP VỤ, không phải một danh sách phẳng: khoá cảnh báo là
 * `r12`, `h9801`… tức là theo id booking/bàn, và cùng một bàn sẽ cảnh báo lại
 * vào ca hôm sau. Gộp chung các ngày sẽ làm cảnh báo của ca mới bị coi là đã
 * xem từ hôm trước.
 */
import { useCallback, useMemo, useState } from "react"

/** Số ngày nghiệp vụ còn giữ. Quá số này thì ngày cũ nhất bị bỏ đi. */
const KEEP_DAYS = 7

type Store = Record<string, string[]>

function read(storageKey: string): Store {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Store = {}
    for (const [day, keys] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(keys)) out[day] = keys.filter((k): k is string => typeof k === "string")
    }
    return out
  } catch {
    // localStorage bị chặn, hoặc nội dung hỏng. Mất trí nhớ chỉ làm chuông
    // hiện lại số cũ; nó không được phép làm hỏng màn hình sơ đồ.
    return {}
  }
}

function write(storageKey: string, store: Store): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(store))
  } catch {
    /* hết quota hoặc bị chặn: bỏ qua, phiên này vẫn chạy bằng state trong RAM */
  }
}

/** Giữ lại `KEEP_DAYS` ngày mới nhất. Khoá ngày là YYYY-MM-DD nên sắp xếp chuỗi là đúng thứ tự. */
export function pruneStore(store: Store, keepDays = KEEP_DAYS): Store {
  const days = Object.keys(store).sort()
  if (days.length <= keepDays) return store
  const out: Store = {}
  for (const day of days.slice(days.length - keepDays)) out[day] = store[day]!
  return out
}

/** Các khoá đã xem của một ngày nghiệp vụ. */
export function readSeenKeys(storageKey: string, businessDate: string): Set<string> {
  return new Set(read(storageKey)[businessDate] ?? [])
}

/**
 * Ghi thêm khoá đã xem cho một ngày nghiệp vụ.
 *
 * Hợp nhất với nội dung đang có trên đĩa thay vì ghi đè: hai tab cùng mở trên
 * một máy lễ tân thì tab này không được xoá dấu đã-xem của tab kia.
 */
export function addSeenKeys(storageKey: string, businessDate: string, keys: Iterable<string>): Set<string> {
  const store = read(storageKey)
  const merged = new Set([...(store[businessDate] ?? []), ...keys])
  store[businessDate] = [...merged]
  write(storageKey, pruneStore(store))
  return merged
}

/**
 * Tập khoá đã xem của ngày nghiệp vụ đang mở, cùng hàm đánh dấu thêm.
 *
 * Đổi ngày thì `useMemo` đọc lại từ đĩa ngay trong lượt render đó. Cố ý không
 * dùng `useEffect` để đồng bộ: một effect gọi setState sẽ render hai lượt mỗi
 * lần đổi ngày, và trong khoảng giữa hai lượt đó chuông hiển thị số của ngày
 * cũ. `revision` chỉ để ép đọc lại sau khi vừa ghi.
 */
export function useSeenKeys(
  storageKey: string,
  businessDate: string,
): [Set<string>, (keys: Iterable<string>) => void] {
  // Nền: những gì đã nằm trên đĩa cho ngày này. Đổi ngày là đọc lại, ngay
  // trong lượt render đó.
  const persisted = useMemo(() => readSeenKeys(storageKey, businessDate), [storageKey, businessDate])
  // Thêm: những gì vừa đánh dấu trong phiên này. Giữ riêng để không phải đọc
  // lại localStorage sau mỗi lần bấm, và mang theo `key` để dấu của ngày cũ
  // không dính sang ngày vừa chọn.
  const [added, setAdded] = useState<{ key: string; keys: string[] }>({ key: businessDate, keys: [] })

  const keys = useMemo(() => {
    if (added.key !== businessDate || added.keys.length === 0) return persisted
    return new Set([...persisted, ...added.keys])
  }, [persisted, added, businessDate])

  const mark = useCallback(
    (next: Iterable<string>) => {
      const list = [...next]
      addSeenKeys(storageKey, businessDate, list)
      setAdded((prev) => ({
        key: businessDate,
        keys: prev.key === businessDate ? [...prev.keys, ...list] : list,
      }))
    },
    [storageKey, businessDate],
  )

  return [keys, mark]
}
