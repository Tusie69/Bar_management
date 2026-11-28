/**
 * HU-44 v1.1 (V12) — gộp những dòng đơn CHƯA LÊN BILL thành dòng bill.
 *
 * Tách khỏi SQL và viết thành hàm thuần vì đây là chỗ dễ sai nhất của V12: một
 * Phiên có nhiều bill, nên câu hỏi không còn là "Phiên này có món gì" mà là
 * "món nào CÒN LẠI chưa lên bill nào". Lấy nhầm thành câu thứ nhất thì bill
 * thứ hai lặp lại toàn bộ món của bill thứ nhất, và khách bị thu tiền hai lần.
 *
 * Phép gộp theo (ĐỢT GỌI, biến thể, ghi chú, GIÁ LÚC GỌI). Giá nằm trong khoá
 * vì hai đơn của cùng một tối có thể mang hai giá khác nhau nếu quán đổi giá
 * giữa chừng; gộp chúng lại sẽ phải chọn một giá để in, và con số đó sai với
 * một trong hai lần khách đã nghe.
 *
 * Đợt nằm trong khoá vì tờ hoá đơn của HU-44 v1.1 xếp món THEO ĐỢT. Gộp hai
 * đợt vào một dòng thì dòng đó phải chọn một nhãn đợt, và cả số lượng của đợt
 * sau hiện dưới nhãn của đợt trước: khách đọc "4 ly, đợt 1" khi họ gọi 2 ly ở
 * đợt 1 và 2 ly nữa một tiếng sau. Hai lần rót cách nhau một tiếng là hai dòng
 * trên tờ hoá đơn, không phải một.
 *
 * Mỗi dòng bill mang theo DANH SÁCH NGUỒN: dòng đơn nào góp bao nhiêu. Đó là
 * thứ `bill_line_sources` lưu, và là thứ cho phép lần xuất hóa đơn sau trừ ra
 * đúng phần đã tính.
 *
 * Xem `api/test/bill-grouping.test.ts`.
 */

/** Một dòng đơn, kèm phần SỐ LƯỢNG CÒN LẠI chưa lên bill nào. */
export interface BillableOrderLine {
  orderLineId: number
  variantId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: string
  note: string | null
  unitPriceVnd: number
  /** `net_quantity` trừ phần đã góp vào các bill chưa huỷ. Có thể là 0. */
  remainingQuantity: number
  /** Đợt gọi món (`sales_orders.visit_sequence`). */
  orderRound: number
  /** Bar/Bếp đã mang ra chưa. Món đang làm vẫn tính tiền. */
  state: BillLineState
}

/** Dòng đơn nào góp bao nhiêu vào một dòng bill. */
import type { BillLineState } from './bill.model.js'

export interface BillLineSource {
  orderLineId: number
  quantity: number
}

export interface GroupedBillLine {
  lineNo: number
  orderRound: number
  state: BillLineState
  /** `MIN(orderLineId)` của nhóm — con trỏ tra ngược, KHÔNG phải khoá. */
  sourceOrderLineId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: string
  note: string | null
  quantity: number
  unitPriceVnd: number
  amountVnd: number
  /** Đủ để trừ ra ở lần xuất hóa đơn sau. */
  sources: BillLineSource[]
}

/**
 * Khoá gộp.
 *
 * Ghi chú vào khoá dưới dạng chuỗi thô: chuẩn hoá Unicode đã làm ở máy Phục vụ
 * lúc nhận đơn (`cart-model.ts`), và làm lại ở đây bằng một luật khác là cách
 * để hai lời nhắn thật sự khác nhau bị gộp thành một.
 *
 * `\u0000` làm dấu phân cách vì nó không xuất hiện trong bất kỳ trường nào ở
 * trên — dùng dấu `|` thì một ghi chú chứa `|` sẽ trộn hai nhóm vào nhau.
 */
function groupKey(line: BillableOrderLine): string {
  return [line.orderRound, line.variantId, line.note ?? '', line.unitPriceVnd].join('\u0000')
}

/**
 * Gộp các dòng còn lại thành dòng bill, giữ thứ tự theo dòng đơn sớm nhất.
 *
 * Dòng có `remainingQuantity <= 0` bị bỏ: nó đã lên bill hết, hoặc đã bị huỷ
 * hết. Trả về mảng rỗng nghĩa là KHÔNG CÒN GÌ ĐỂ XUẤT HÓA ĐƠN — và đó cũng
 * chính là điều kiện để đóng Phiên (TN-13).
 */
export function groupBillableLines(lines: readonly BillableOrderLine[]): GroupedBillLine[] {
  const groups = new Map<string, GroupedBillLine>()

  for (const line of lines) {
    if (!Number.isSafeInteger(line.remainingQuantity) || line.remainingQuantity <= 0) continue
    const key = groupKey(line)
    const existing = groups.get(key)
    if (existing) {
      existing.quantity += line.remainingQuantity
      existing.amountVnd = existing.unitPriceVnd * existing.quantity
      existing.sources.push({ orderLineId: line.orderLineId, quantity: line.remainingQuantity })
      // Đợt đã nằm trong khoá gộp, nên mọi dòng trong nhóm cùng một đợt. Còn
      // trạng thái thì chỉ cần một phần chưa mang ra là cả dòng còn "đang làm"
      // — nói đã ra khi còn thiếu là nói sai với người đang bưng đồ.
      if (line.state === 'MAKING') existing.state = 'MAKING'
      // Con trỏ tra ngược luôn là dòng đơn SỚM NHẤT của nhóm, kể cả khi dữ liệu
      // về không theo thứ tự id.
      if (line.orderLineId < existing.sourceOrderLineId) existing.sourceOrderLineId = line.orderLineId
      continue
    }
    groups.set(key, {
      lineNo: 0,
      orderRound: line.orderRound,
      state: line.state,
      sourceOrderLineId: line.orderLineId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      variantDisplayName: line.variantDisplayName,
      unitCode: line.unitCode,
      note: line.note,
      quantity: line.remainingQuantity,
      unitPriceVnd: line.unitPriceVnd,
      amountVnd: line.unitPriceVnd * line.remainingQuantity,
      sources: [{ orderLineId: line.orderLineId, quantity: line.remainingQuantity }],
    })
  }

  return [...groups.values()]
    .sort((left, right) => left.sourceOrderLineId - right.sourceOrderLineId)
    .map((line, index) => ({ ...line, lineNo: index + 1 }))
}

/**
 * Bất biến phải đúng trước khi ghi bill: mỗi dòng bill cộng đúng bằng các nguồn
 * của nó, và thành tiền bằng đơn giá nhân số lượng.
 *
 * Kiểm ở đây chứ không chỉ ở test, vì một dòng bill không khớp nguồn nghĩa là
 * lần xuất hóa đơn SAU sẽ trừ sai — và lúc đó khách bị thu thiếu hoặc thu thừa
 * mà không ai thấy lỗi ở đâu.
 */
export function assertGroupingIsConsistent(lines: readonly GroupedBillLine[]): void {
  for (const line of lines) {
    const fromSources = line.sources.reduce((sum, source) => sum + source.quantity, 0)
    if (fromSources !== line.quantity) {
      throw new Error(`Dòng bill ${line.lineNo} lệch nguồn: ${fromSources} ≠ ${line.quantity}`)
    }
    if (line.amountVnd !== line.unitPriceVnd * line.quantity) {
      throw new Error(`Dòng bill ${line.lineNo} lệch thành tiền`)
    }
  }
}
