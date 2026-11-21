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
import type { WaiterVisitPhase } from './waiter-visit-phase.js'

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
  /** Thời điểm mở Phiên. Phép chiếu này chỉ mang Phiên đang có khách ngồi. */
  startsAt: string
  /**
   * Hạn giữ chỗ của một Bàn chờ. Luôn `null` ở đây: phép chiếu của Phục vụ chỉ
   * mang Phiên đang có khách ngồi, và giữ chỗ là việc của Lễ tân. Trường vẫn ở
   * lại vì adapter dùng chung của web đọc nó cho mọi claim; bỏ hẳn thì nó nhận
   * `undefined` và ném lỗi hợp đồng.
   */
  deadlineAt: null
  /** Luôn `false`, cùng lý do với `deadlineAt`. */
  holdOverdue: false
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
  /**
   * Chỉ còn ba giá trị: `IN_USE` (có khách ngồi), `OUT_OF_SERVICE`, `EMPTY`.
   *
   * Tài liệu v1.1 bỏ toàn bộ màu đặt bàn khỏi sơ đồ Phục vụ, nên một bàn đã
   * đặt mà khách chưa tới được chiếu thành `EMPTY` — nó TRẮNG trên sơ đồ của
   * Phục vụ, y như một bàn trống thật. Việc thu gọn làm Ở MÁY CHỦ chứ không
   * phải bằng cách frontend lờ đi `BOOKED`: giữ giá trị thật trong payload
   * nghĩa là "bàn A4 có khách đặt lúc 21:35 cho 2 người" vẫn nằm trong
   * DevTools và trong cache của bất kỳ máy Phục vụ nào.
   */
  displayState: 'EMPTY' | 'IN_USE' | 'OUT_OF_SERVICE'
  /**
   * Sáu trạng thái của lượt khách; `null` khi bàn không có khách ngồi.
   *
   * Đây là thứ quyết định MÀU ô bàn trên sơ đồ Phục vụ. `displayState` chỉ còn
   * để phân biệt trống / có khách / ngừng phục vụ.
   */
  waiterPhase: WaiterVisitPhase | null
  staleFromPreviousDay: boolean
  seatedTurnCount: number
  claimOwner: FloorTableProjection['claimOwner']
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  claim: WaiterFloorClaim | null
  /* Hai trường dưới giữ hình dạng hợp đồng chung mà adapter của web đọc, với
   * giá trị trung tính. `arrivalPhase` và `arrivalTime` là lịch đặt bàn —
   * chúng KHÔNG còn mang dữ liệu thật ở đây. */
  arrivalPhase: null
  arrivalTime: null
  minutesLate: 0
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

/**
 * Bàn có khách đang ngồi hay không.
 *
 * Mọi thứ khác — đã đặt, sắp tới, tới muộn, no-show, đang giữ chỗ cho Bàn chờ
 * — đều là việc của Lễ tân và được thu về `EMPTY` trước khi payload rời máy
 * chủ.
 */
function isSeated(table: FloorTableProjection): boolean {
  return table.displayState === 'IN_USE'
}

function toWaiterClaim(claim: FloorClaimProjection | null): WaiterFloorClaim | null {
  if (claim === null) return null
  return {
    kind: claim.kind,
    visitId: claim.visitId,
    partySize: claim.partySize,
    startsAt: claim.startsAt,
    deadlineAt: null,
    holdOverdue: false,
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

/**
 * Phép chiếu an toàn cho Phục vụ. Không đọc database, không đổi dữ liệu gốc.
 *
 * `phases` là bản đồ `visitId → trạng thái lượt khách`, dựng từ
 * `waiter-visit-phase.ts`. Nó được TRUYỀN VÀO thay vì tính ở đây để hàm này
 * vẫn thuần: trạng thái cần số đơn và số phiếu, hai thứ chỉ có trong database.
 *
 * Một Phiên không có mặt trong `phases` được chiếu thành `ARRIVED`. Đó là giá
 * trị an toàn nhất khi thiếu số liệu: "khách vừa ngồi xuống, chưa gọi gì" làm
 * Phục vụ đi tới hỏi bàn, còn đoán nhầm thành "Đang dùng" thì không ai ra cả.
 */
export function toWaiterFloorProjection(
  projection: FloorProjection,
  phases: ReadonlyMap<number, WaiterVisitPhase> = new Map(),
): WaiterFloorProjection {
  return {
    businessDate: projection.businessDate,
    serverNow: projection.serverNow,
    changeSeq: projection.changeSeq,
    tables: projection.tables.map((table) => {
      const seated = isSeated(table)
      const claim = seated ? toWaiterClaim(table.claim) : null
      const visitId = claim?.visitId ?? null
      return {
        tableId: table.tableId,
        tableCode: table.tableCode,
        catalogStatus: table.catalogStatus,
        isSpare: table.isSpare,
        displayState:
          table.displayState === 'OUT_OF_SERVICE' ? ('OUT_OF_SERVICE' as const) : seated ? ('IN_USE' as const) : ('EMPTY' as const),
        waiterPhase: visitId === null ? null : (phases.get(visitId) ?? 'ARRIVED'),
        staleFromPreviousDay: table.staleFromPreviousDay,
        seatedTurnCount: table.seatedTurnCount,
        claimOwner: table.claimOwner,
        groupId: table.groupId,
        groupDisplayCode: table.groupDisplayCode,
        groupMemberTableIds: [...table.groupMemberTableIds],
        claim,
        arrivalPhase: null,
        arrivalTime: null,
        minutesLate: 0,
      }
    }),
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
      // Cụm bàn cũng theo luật "chỉ khách đang ngồi": một cụm đã đặt mà khách
      // chưa tới hiện như cụm trống, và claim đặt bàn của nó không đi theo.
      ...(group.displayState === undefined
        ? {}
        : {
            displayState:
              group.displayState === 'IN_USE' || group.displayState === 'OUT_OF_SERVICE'
                ? group.displayState
                : ('EMPTY' as const),
          }),
      ...(group.claim === undefined
        ? {}
        : { claim: group.displayState === 'IN_USE' ? toWaiterClaim(group.claim) : null }),
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
  // v1.1: lịch đặt bàn rời khỏi sơ đồ Phục vụ. Hai khoá dưới VẪN có trong
  // payload với giá trị trung tính (adapter chung của web đọc chúng), nên
  // chúng không nằm trong danh sách này — xem `WAITER_NEUTRAL_KEYS`.
  'reservationId',
  'waitlistEntryId',
  'holdId',
  'lateConfirmedAt',
  'canCall',
  'reservedExpectedAt',
]

/**
 * Những khoá phải CÓ MẶT nhưng không bao giờ mang dữ liệu thật.
 *
 * Danh sách này tồn tại vì "bỏ hẳn" và "để trung tính" là hai quyết định khác
 * nhau, và chỉ cái thứ hai mới giữ được adapter dùng chung của web. Test đọc
 * nó để khẳng định giá trị đúng là trung tính, chứ không phải khoá đã biến mất
 * — một trường lặng lẽ quay lại mang giá trị thật sẽ làm test đỏ.
 */
export const WAITER_NEUTRAL_KEYS: readonly { key: string; value: unknown }[] = [
  { key: 'arrivalPhase', value: null },
  { key: 'arrivalTime', value: null },
  { key: 'minutesLate', value: 0 },
  { key: 'deadlineAt', value: null },
  { key: 'holdOverdue', value: false },
  { key: 'origin', value: null },
  { key: 'sourceCode', value: null },
  { key: 'turnNo', value: null },
]

/**
 * Mã các Phiên đang hiện trên sơ đồ, để đi hỏi số đơn và số phiếu.
 *
 * Đọc từ chính phép chiếu đã dựng thay vì truy vấn lại theo ngày kinh doanh:
 * hai điều kiện khác nhau là hai câu trả lời có thể lệch nhau trong cùng một
 * lần tải màn hình.
 */
export function seatedVisitIds(projection: FloorProjection): number[] {
  const ids = new Set<number>()
  for (const table of projection.tables) {
    if (!isSeated(table)) continue
    const visitId = table.claim?.visitId ?? null
    if (visitId !== null) ids.add(visitId)
  }
  return [...ids]
}
