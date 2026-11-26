/**
 * TU-45 — Màn 3, chế độ "Bản in 80mm".
 *
 * Giấy in hoá đơn nhiệt rộng 80mm, vùng in khoảng 72mm, nên khối này cố định
 * `max-width: 288px` (72mm ở 96dpi) và dùng font đẳng khoảng. Nó KHÔNG gọi máy
 * in: mockup ghi rõ nút In chỉ mô phỏng, và phần in thật chờ TN-02.
 *
 * Tờ giấy cộng đúng bằng tay được, nên nó in SỔ TÍNH TIỀN từ máy chủ
 * (`charges`) chứ không in khối tổng đã lược của màn hình — kể cả hàng làm tròn
 * 0đ. Người đọc thấy bước đó đã chạy, thay vì phải đoán nó bị quên.
 *
 * Nhãn "CHƯA PHẢI HOÁ ĐƠN" là bắt buộc: hoá đơn điện tử chờ CH-20, và một tờ
 * giấy có tổng tiền mà không nói nó là gì sẽ được khách cầm đi như hoá đơn.
 */
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { fmtTime } from "@/lib/time"
import { chargeRows, seatingLabel } from "./bill-display"
import type { BillAmounts, BillCharge, BillLine } from "./billing-api"

export interface BillPrintData extends BillAmounts {
  /** Mã bill đã chốt, hoặc `null` với tạm tính (chưa có mã). */
  billCode: string | null
  tableCodes: string[]
  groupSymbol: string | null
  orderCount: number
  lines: BillLine[]
  charges: BillCharge[]
  /** Mốc thời gian in: `previewedAt` của tạm tính, `closedAt` của bill đã chốt. */
  issuedAt: string
}

export function BillPrintView({ data }: { data: BillPrintData }) {
  const issued = new Date(data.issuedAt)
  return (
    <div
      className="mx-auto w-full max-w-[288px] bg-white p-3 font-mono text-[11px] leading-snug text-black"
      data-testid="bill-print-80mm"
    >
      <div className="text-center">
        <p className="text-sm font-bold tracking-wide">21GAM</p>
        {/* Địa chỉ và mã số thuế chờ quán cung cấp (CH-20). Không tự đặt số liệu. */}
        <p className="text-[10px]">[Địa chỉ quán — chờ cung cấp]</p>
        {/* Hoá đơn đã xuất mang mã bill; tờ tạm tính thì chưa, và phải nói rõ. */}
        <p className="mt-1 border-y border-dashed border-black py-1 text-[10px] font-bold">
          {data.billCode ? "HÓA ĐƠN" : "TẠM TÍNH – CHƯA PHẢI HÓA ĐƠN"}
        </p>
      </div>

      <dl className="mt-2 grid gap-0.5 text-[10px]">
        <div className="flex justify-between gap-2">
          <dt>Bàn</dt>
          <dd>{seatingLabel(data.tableCodes, data.groupSymbol)}</dd>
        </div>
        {data.billCode ? (
          <div className="flex justify-between gap-2">
            <dt>Mã bill</dt>
            <dd className="font-bold">{data.billCode}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <dt>Số đơn</dt>
          <dd className="tnum">{data.orderCount}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>In lúc</dt>
          <dd>{fmtTime(issued)}</dd>
        </div>
      </dl>

      <table className="mt-2 w-full border-t border-dashed border-black pt-1">
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.lineNo} className="align-top">
              <td className="py-0.5 pr-1">
                {line.itemName}
                <span className="block text-[10px]">{`${line.variantDisplayName} × ${line.quantity}`}</span>
              </td>
              <td className="tnum py-0.5 text-right whitespace-nowrap">{formatVnd(line.amountVnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-1 grid gap-0.5 border-t border-dashed border-black pt-1">
        {chargeRows(data.charges).map((row) => (
          <div key={row.key} className="flex justify-between gap-2">
            <dt>{row.label}</dt>
            <dd className="tnum">{formatVnd(row.amountVnd)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-2 border-t border-black pt-1 text-xs font-bold">
          <dt>KHÁCH PHẢI TRẢ</dt>
          <dd className="tnum">{formatVnd(data.totalVnd)}</dd>
        </div>
      </dl>

      <p className="mt-2 text-center text-[10px]">Cảm ơn quý khách</p>
    </div>
  )
}
