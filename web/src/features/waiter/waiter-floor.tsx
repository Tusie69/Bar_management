/**
 * Module Phục vụ 1 — sơ đồ bàn của ca hiện tại.
 *
 * Dùng LẠI `FloorCanvas` của Lễ tân, không sao chép nó. Sơ đồ là thứ nhân viên
 * đã học vị trí từng ô; hai bản vẽ song song sẽ lệch nhau ngay lần đầu có ai
 * kê lại bàn, và lúc đó không ai biết bản nào đúng.
 *
 * `hideGuestNames` được bật, nhưng nó KHÔNG phải chốt bảo mật: phép chiếu của
 * Phục vụ không mang tên khách, nên không có gì để ẩn. Cờ này chỉ để canvas
 * không vẽ một ô trống ở chỗ đáng ra có nhãn tên.
 *
 * Phục vụ chỉ xem ca hiện tại: không lịch chọn ngày, không timeline đặt bàn
 * tương lai, không danh sách booking, không Bàn chờ, không nút tạo booking hay
 * mở Walk-in. Những thứ đó không có ở đây vì chúng không được mount, không
 * phải vì chúng bị ẩn bằng CSS.
 */
import { FloorCanvas } from "@/features/floor/floor-canvas"
import type { FloorGroup, FloorTableState, TableView, ZoneView } from "@/domain/models"

export interface WaiterFloorProps {
  tables: TableView[]
  zones: ZoneView[]
  states: Map<number, FloorTableState>
  groups: FloorGroup[]
  now: Date
  selectedIds: number[]
  onTableClick: (tableId: number) => void
  className?: string
}

export function WaiterFloor({
  tables,
  zones,
  states,
  groups,
  now,
  selectedIds,
  onTableClick,
  className,
}: WaiterFloorProps) {
  return (
    <FloorCanvas
      mode="live"
      tables={tables}
      zones={zones}
      states={states}
      groups={groups}
      now={now}
      selectedIds={selectedIds}
      onTableClick={onTableClick}
      hideGuestNames
      // Khoá camera và luôn fit cả sơ đồ: Phục vụ cầm điện thoại một tay, không
      // có nhịp nào để pan/zoom giữa lúc đang nhận món.
      mobileShell
      preserveWidthFit
      className={className}
      ariaLabel="Sơ đồ bàn ca hiện tại"
    />
  )
}
