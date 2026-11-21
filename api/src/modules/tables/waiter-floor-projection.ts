/**
 * Module Phục vụ 1 — read model sơ đồ bàn cho WAITER.
 *
 * Phục vụ cần biết bàn nào đang có khách, mấy khách, mở Phiên bao lâu rồi và
 * Phiên đã chuyển sang chờ thanh toán chưa. Phục vụ KHÔNG được biết khách là
 * ai. Biên bản 15/11 không cấp cho cấp thứ sáu bất kỳ quyền `customer.*` nào,
 * kể cả `customer.view_masked`, nên ba số cuối của số điện thoại cũng không
 * thuộc phạm vi của họ.
 *
 * Vì thế đây là một PHÉP CHIẾU Ở MÁY CHỦ, không phải một tuỳ chọn hiển thị.
 * Ẩn tên bằng CSS hay bằng một cờ `hideGuestNames` ở frontend chỉ che mắt
 * người xem: dữ liệu vẫn đi qua mạng và vẫn nằm trong DevTools, trong cache
 * của TanStack Query và trong mọi lần ai đó gọi thẳng endpoint bằng cookie
 * phiên của mình. Hàm dưới đây xoá các trường đó khỏi payload trước khi nó rời
 * máy chủ, nên frontend không có gì để lỡ tay hiển thị.
 *
 * Hàm là THUẦN và nhận vào `FloorProjection` đã dựng sẵn: nó không truy vấn
 * lại database, không nhân đôi câu SQL dài 200 dòng của Lễ tân, và vì thế
 * không thể lệch khỏi trạng thái mà Lễ tân đang thấy. Nó cũng test được không
 * cần MySQL — xem api/test/waiter-floor-projection.test.ts.
 */
import type {
  FloorClaimProjection,
  FloorGroupProjection,
  FloorProjection,
  FloorTableProjection,
} from './floor-projection.repository.js'

/**
 * Claim nhìn từ phía Phục vụ.
 *
 * Danh sách trường ở đây là một ALLOW-LIST, không phải một bản sao đã bỏ vài
 * cột: thêm một trường nhận dạng khách vào `FloorClaimProjection` sau này sẽ
 * KHÔNG tự động chảy sang đây. Đó là điểm khác biệt giữa allow-list và
 * deny-list, và là lý do type này được viết tay thay vì `Omit<...>`.
 *
 * Không có: `guestName`, `phoneLast3`, `honorific`, `iconKeys`, `flags`,
 * `sourceCode`, `origin`, `reservationId`, `waitlistEntryId`, `holdId`,
 * `canCall`, `lateConfirmedAt`.
 */
export interface WaiterFloorClaim {
  kind: FloorClaimProjection['kind']
  /**
   * Định danh nghiệp vụ của Phiên. Mọi thao tác của Phục vụ (gọi món, đổi,
   * ghép, tách) đi theo giá trị này, không theo `tableId`: một cụm bàn ghép có
   * nhiều ô bàn nhưng chỉ có MỘT Phiên, và đơn thuộc về Phiên.
   */
  visitId: number | null
  partySize: number
  /** Thời điểm mở Phiên (hoặc giờ hẹn của một booking chưa tới). */
  startsAt: string
  deadlineAt: string | null
  holdOverdue: boolean
  /** Đã bấm "đã thanh toán": Phục vụ chỉ còn được xem. */
  paid: boolean
  /** Phiên bản của Phiên, cho optimistic concurrency khi đổi/ghép/tách. */
  version: number
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  /* Các trường dưới đây giữ ĐÚNG hình dạng hợp đồng chung mà adapter của web
   * đang đọc, với giá trị trung tính. Không bỏ hẳn vì adapter dùng chung cho
   * cả Lễ tân và Phục vụ; không mang dữ liệu thật vì chúng là dữ liệu khách. */
  flags: never[]
  origin: null
  sourceCode: null
  turnNo: null
}

export interface WaiterFloorTable {
  tableId: number
  tableCode: string
  catalogStatus: FloorTableProjection['catalogStatus']
  isSpare: boolean
  displayState: FloorTableProjection['displayState']
  arrivalPhase: FloorTableProjection['arrivalPhase']
  minutesLate: number
  staleFromPreviousDay: boolean
  seatedTurnCount: number
  claimOwner: FloorTableProjection['claimOwner']
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  claim: WaiterFloorClaim | null
  /**
   * Giờ hẹn của booking chưa tới. Đây là dữ liệu vận hành của BÀN, không phải
   * của khách: Phục vụ cần biết bàn này sắp có người để không kê dọn vào đó.
   */
  arrivalTime: string | null
}

export interface WaiterFloorGroup {
  id: number
  symbolNo: number
  displayCode: string
  tableIds: number[]
  origin?: FloorGroupProjection['origin']
  version?: number
  name?: string
  zoneId?: number
  totalSeats?: number
  isOutOfService?: boolean
  displayState?: FloorGroupProjection['displayState']
  claim?: WaiterFloorClaim | null
  businessDate?: string
  seatedTurnCount?: number
}

export interface WaiterFloorProjection {
  businessDate: string
  serverNow: string
  changeSeq: string
  tables: WaiterFloorTable[]
  groups: WaiterFloorGroup[]
}

function toWaiterClaim(claim: FloorClaimProjection | null): WaiterFloorClaim | null {
  if (claim === null) return null
  return {
    kind: claim.kind,
    visitId: claim.visitId,
    partySize: claim.partySize,
    startsAt: claim.startsAt,
    deadlineAt: claim.deadlineAt,
    holdOverdue: claim.holdOverdue,
    paid: claim.paid,
    version: claim.version,
    groupId: claim.groupId,
    groupDisplayCode: claim.groupDisplayCode,
    groupMemberTableIds: [...claim.groupMemberTableIds],
    flags: [],
    origin: null,
    sourceCode: null,
    turnNo: null,
  }
}

/** Phép chiếu an toàn cho Phục vụ. Không đọc database, không đổi dữ liệu gốc. */
export function toWaiterFloorProjection(projection: FloorProjection): WaiterFloorProjection {
  return {
    businessDate: projection.businessDate,
    serverNow: projection.serverNow,
    changeSeq: projection.changeSeq,
    tables: projection.tables.map((table) => ({
      tableId: table.tableId,
      tableCode: table.tableCode,
      catalogStatus: table.catalogStatus,
      isSpare: table.isSpare,
      displayState: table.displayState,
      arrivalPhase: table.arrivalPhase,
      arrivalTime: table.arrivalTime,
      minutesLate: table.minutesLate,
      staleFromPreviousDay: table.staleFromPreviousDay,
      seatedTurnCount: table.seatedTurnCount,
      claimOwner: table.claimOwner,
      groupId: table.groupId,
      groupDisplayCode: table.groupDisplayCode,
      groupMemberTableIds: [...table.groupMemberTableIds],
      claim: toWaiterClaim(table.claim),
    })),
    groups: projection.groups.map((group) => ({
      id: group.id,
      symbolNo: group.symbolNo,
      displayCode: group.displayCode,
      tableIds: [...group.tableIds],
      ...(group.origin === undefined ? {} : { origin: group.origin }),
      ...(group.version === undefined ? {} : { version: group.version }),
      ...(group.name === undefined ? {} : { name: group.name }),
      ...(group.zoneId === undefined ? {} : { zoneId: group.zoneId }),
      ...(group.totalSeats === undefined ? {} : { totalSeats: group.totalSeats }),
      ...(group.isOutOfService === undefined ? {} : { isOutOfService: group.isOutOfService }),
      ...(group.displayState === undefined ? {} : { displayState: group.displayState }),
      ...(group.claim === undefined ? {} : { claim: toWaiterClaim(group.claim) }),
      ...(group.businessDate === undefined ? {} : { businessDate: group.businessDate }),
      ...(group.seatedTurnCount === undefined ? {} : { seatedTurnCount: group.seatedTurnCount }),
    })),
  }
}

/**
 * Mọi khoá mà payload của Phục vụ không bao giờ được chứa, ở bất kỳ độ sâu nào.
 * Test dùng danh sách này để quét toàn bộ JSON thật, nên một trường mới lọt
 * vào read model sẽ làm test đỏ chứ không âm thầm đi ra ngoài.
 */
export const WAITER_FORBIDDEN_KEYS: readonly string[] = [
  'guestName',
  'displayName',
  'phone',
  'phoneLast3',
  'honorific',
  'iconKeys',
  'contactName',
  'customerName',
  'note',
  'notes',
  'activeVisit',
]
