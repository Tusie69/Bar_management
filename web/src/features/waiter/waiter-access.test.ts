/**
 * Module Phục vụ 1 — hợp đồng của khu vực `/phucvu`.
 *
 * Test chạy ở môi trường Node, không có DOM (dự án chưa có jsdom hay
 * testing-library), nên chúng kiểm phần quyết định: luật vào cửa, luật hành
 * động theo trạng thái bàn, luật đổi/ghép/tách, và hình học sơ đồ ở các
 * viewport bắt buộc. Phần "API có trả dữ liệu khách hay không" được kiểm ở
 * backend qua HTTP thật (api/test/waiter-module1.mysql.test.ts), vì đó là chỗ
 * duy nhất chứng minh được.
 */
import { describe, expect, it } from "vitest"
import { NAV } from "@/app/nav"
import { PERMISSION_MATRIX, type Permission } from "@/domain/access"
import { PORTAL_CONFIG, portalFromPath, portalLoginPath, canonicalPortalPath } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import type { ClaimView, FloorTableState, TableView } from "@/domain/models"
import { FLOOR_H, FLOOR_W, WALL_BOUNDS } from "@/domain/venue-layout"
import { isRedactedForWaiter, redactFloorForWaiter } from "@/domain/waiter-privacy"
import {
  WAITER_FORBIDDEN_PATHS,
  WAITER_HOME_PATH,
  WAITER_LEGACY_BASE_PATH,
  WAITER_PAYMENT_NOTICE,
  WAITER_QUEUE_ABSOLUTE_PATH,
  WAITER_QUEUE_PATH,
  WAITER_REARRANGE_PERMISSIONS,
  WAITER_ROLES,
  canEnterWaiter,
  waiterOrderPath,
  waiterOrdersViewPath,
  waiterRoleLabel,
  waiterServedDuration,
  waiterTableCapability,
  waiterVisitTableIds,
} from "./waiter-access"
import { waiterRoute } from "./waiter-routes"
import {
  WAITER_TOOLBAR_ACTION_CLASS,
  WAITER_TOOLBAR_CLASS,
  WAITER_TOOLBAR_TEXT_CLASS,
  WAITER_TOOLBAR_TEXT_ITEM_CLASS,
} from "./waiter-toolbar-layout"
import { isSplitRequest, waiterCurrentTables, waiterRearrangePlan, waiterTargetTables } from "./waiter-rearrange"

const GUEST_NAME = "Chị Hồng Nhung"

function claim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    kind: "visit",
    visitId: 9001,
    reservationId: null,
    waitlistEntryId: null,
    holdId: null,
    displayName: "",
    phoneLast3: null,
    partySize: 4,
    startsAt: new Date("2026-11-20T13:05:00.000Z"),
    deadlineAt: null,
    paid: false,
    origin: null,
    tableIds: [11],
    groupId: null,
    warning: null,
    minutesLate: 0,
    sourceCode: null,
    note: null,
    version: 3,
    ...overrides,
  }
}

function tableState(overrides: Partial<FloorTableState> = {}): FloorTableState {
  return { tableId: 11, state: "seated", claim: claim(), staleFromPreviousDay: false, ...overrides }
}

const table = (id: number, code: string, extra: Partial<TableView> = {}): TableView => ({
  id,
  version: 1,
  code,
  displayName: code,
  zoneId: 1,
  zoneCode: "A",
  kind: "TABLE",
  capacity: 4,
  seqNo: null,
  isSpare: false,
  status: "ACTIVE",
  x: 0,
  y: 0,
  w: 40,
  h: 30,
  seating: undefined,
  ...extra,
})

function permissionsOf(role: RoleCode): Permission[] {
  return (Object.keys(PERMISSION_MATRIX) as Permission[]).filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role),
  )
}

describe("định tuyến khu vực Phục vụ", () => {
  it("đăng nhập tại /phucvu/login rồi về đúng /phucvu", () => {
    expect(portalLoginPath("waiter")).toBe("/phucvu/login")
    expect(portalFromPath("/phucvu/login")).toBe("waiter")
    // Hai giá trị lệch nhau nghĩa là đăng nhập xong rơi vào màn của Lễ tân.
    expect(PORTAL_CONFIG.waiter.home).toBe(WAITER_HOME_PATH)
    expect(WAITER_HOME_PATH).toBe("/phucvu")
  })

  it("URL cũ /waiter vẫn mở được và chỉ chuyển hướng, không cấp quyền", () => {
    expect(portalFromPath(WAITER_LEGACY_BASE_PATH)).toBe("waiter")
    expect(canonicalPortalPath(`${WAITER_LEGACY_BASE_PATH}/login`)).toBe("/phucvu/login")
    // Alias không đổi vai nào được vào cửa.
    expect(canEnterWaiter("RECEPTIONIST", "waiter")).toBe(false)
  })

  it("chỉ WAITER và BAR đăng nhập ở cổng waiter vào được", () => {
    expect(canEnterWaiter("WAITER", "waiter")).toBe(true)
    // Chế độ mock của prototype không có cổng.
    expect(canEnterWaiter("WAITER", null)).toBe(true)
    expect(canEnterWaiter("WAITER", "receptionist")).toBe(false)
    for (const role of ["OWNER", "ADMIN", "RECEPTIONIST", "CASHIER", "CUSTOMER_CARE", "KITCHEN"] as RoleCode[]) {
      expect(canEnterWaiter(role, "waiter"), `${role} không được vào /phucvu`).toBe(false)
      expect(canEnterWaiter(role, null), `${role} không được vào /phucvu`).toBe(false)
    }
  })

  // L9 — Bartender lên đơn cho khách gọi ngay tại quầy (câu trả lời Q1).
  it("BAR vào được /phucvu, nhưng chỉ khi phiên dùng đúng cổng waiter", () => {
    expect(canEnterWaiter("BAR", "waiter")).toBe(true)
    // Phiên Bar ở cổng chế biến phải ở lại /chebien; nếu nó cũng mở được khu
    // vực Phục vụ thì hai màn hình tranh nhau cùng một tài khoản.
    expect(canEnterWaiter("BAR", "preparation")).toBe(false)
    expect(canEnterWaiter("BAR", null)).toBe(false)
    expect(WAITER_ROLES).toEqual(["WAITER", "BAR"])
    // Hai danh sách phải khớp nhau, nếu không đăng nhập xong lại bị chặn ở cửa.
    expect([...PORTAL_CONFIG.waiter.roles]).toEqual([...WAITER_ROLES])
  })

  it("mọi mục navigation của Lễ tân đều nằm ngoài khu vực Phục vụ", () => {
    // Khung Phục vụ không mount `NAV`; test này là chốt để một mục mới thêm vào
    // navigation phải được cân nhắc, chứ không tự chảy vào màn Phục vụ.
    for (const item of NAV) {
      expect(WAITER_FORBIDDEN_PATHS, `${item.to} phải nằm ngoài /phucvu`).toContain(item.to)
    }
    for (const forbidden of ["/reservations", "/waitlist", "/guests", "/reports", "/settings", "/admin"]) {
      expect(WAITER_FORBIDDEN_PATHS).toContain(forbidden)
    }
    // Không có đường nào từ khu vực Phục vụ trỏ ra ngoài nó.
    expect(waiterOrderPath(5).startsWith(WAITER_HOME_PATH)).toBe(true)
    expect(waiterOrdersViewPath(5).startsWith(WAITER_HOME_PATH)).toBe(true)
  })

  it("giữ các route gọi món/xem đơn và thêm hàng đợi trong cùng WaiterShell", () => {
    const childPaths = waiterRoute.children?.map((route) => route.path).filter(Boolean)
    expect(childPaths).toContain("phien/:visitId/goi-mon")
    expect(childPaths).toContain("orders/:visitId")
    expect(childPaths).toContain(WAITER_QUEUE_PATH)
    expect(WAITER_QUEUE_ABSOLUTE_PATH).toBe("/phucvu/hang-doi")
  })

  it("nhãn vai phân biệt Bartender và Phục vụ", () => {
    expect(waiterRoleLabel("BAR")).toBe("Bartender")
    expect(waiterRoleLabel("WAITER")).toBe("Phục vụ")
  })
})

describe("phân quyền của vai Phục vụ", () => {
  it("có quyền gọi món, sửa số lượng, xin hủy và ba quyền dọn chỗ; không có gì khác", () => {
    expect([...permissionsOf("WAITER")].sort()).toEqual([
      // Module Phục vụ 5 thêm hai quyền: sửa số lượng khi quầy chưa nhận phiếu,
      // và GỬI yêu cầu hủy. Quyền phê duyệt và quyền ghi hao cố ý không có —
      // người gọi món không phải người cho phép bỏ món.
      "order.cancel.request",
      "order.create",
      "order.line.adjust",
      "order.read",
      "visit.combine",
      "visit.move",
      "visit.split",
    ])
  })

  it("không tự phê duyệt hủy món và không ghi hao được", () => {
    const granted = permissionsOf("WAITER")
    expect(granted).not.toContain("order.cancel.approve")
    expect(granted).not.toContain("order.cancel.ready")
  })

  it("không có table.group.manage và không có quyền nào về khách hàng", () => {
    const granted = permissionsOf("WAITER")
    for (const forbidden of [
      "table.group.manage",
      "customer.view_masked",
      "customer.phone.reveal",
      "booking.phone.call",
      "payment.collect",
      "visit.end",
      "visit.mark_paid",
      "visit.checkin",
      "visit.walkin",
      "reservation.create",
      "waitlist.create",
      "report.read",
      "audit.read",
      "venue.configure",
      "user.read",
    ] as Permission[]) {
      expect(granted, `Phục vụ KHÔNG được có ${forbidden}`).not.toContain(forbidden)
    }
  })

  it("ba quyền dọn chỗ đều có thật trong ma trận RBAC", () => {
    for (const permission of WAITER_REARRANGE_PERMISSIONS) {
      expect(PERMISSION_MATRIX[permission]).toBeDefined()
      expect(PERMISSION_MATRIX[permission]).toContain("WAITER")
    }
  })
})

describe("hành động được phép trên một ô bàn", () => {
  it("bàn trống: không có nút Gọi món", () => {
    const capability = waiterTableCapability(tableState({ state: "free", claim: null }))
    expect(capability.phase).toBe("empty")
    expect(capability.canOrder).toBe(false)
    expect(capability.canRearrange).toBe(false)
    expect(capability.visitId).toBeNull()
  })

  it("bàn sơ cua cũng là bàn trống với Phục vụ", () => {
    expect(waiterTableCapability(tableState({ state: "spare", claim: null })).canOrder).toBe(false)
  })

  it("bàn đã đặt nhưng khách chưa tới: không gọi món được", () => {
    for (const state of ["reserved", "upcoming", "late", "late_confirmed", "noshow", "hold", "hold_overdue"] as const) {
      const capability = waiterTableCapability(
        tableState({ state, claim: claim({ kind: "reservation", visitId: null }) }),
      )
      expect(capability.phase, state).toBe("booked")
      expect(capability.canOrder, state).toBe(false)
      expect(capability.canRearrange, state).toBe(false)
    }
  })

  it("bàn có khách và Phiên đang mở: gọi món, xem đơn, đổi/ghép/tách", () => {
    const capability = waiterTableCapability(tableState())
    expect(capability.phase).toBe("serving")
    expect(capability.canOrder).toBe(true)
    expect(capability.canViewOrders).toBe(true)
    expect(capability.canRearrange).toBe(true)
    expect(capability.visitId).toBe(9001)
    expect(capability.notice).toBeNull()
  })

  it("Phiên chờ thanh toán: khoá gửi món mới và nói đúng câu đã chốt", () => {
    const capability = waiterTableCapability(tableState({ claim: claim({ paid: true }) }))
    expect(capability.phase).toBe("payment")
    expect(capability.canOrder).toBe(false)
    expect(capability.canRearrange).toBe(false)
    expect(capability.canViewOrders).toBe(true)
    expect(capability.notice).toBe(WAITER_PAYMENT_NOTICE)
  })

  it("Phiên đã đóng: ô bàn không còn claim nên không gọi món và không dọn chỗ", () => {
    const capability = waiterTableCapability(tableState({ state: "free", claim: null }))
    expect(capability.canOrder).toBe(false)
    expect(capability.canRearrange).toBe(false)
  })

  it("bàn ngừng phục vụ: chỉ xem", () => {
    const capability = waiterTableCapability(tableState({ state: "oos", claim: null }))
    expect(capability.phase).toBe("out_of_service")
    expect(capability.canOrder).toBe(false)
  })

  it("thiếu permission thì nút tắt, kể cả khi bàn đang phục vụ", () => {
    const capability = waiterTableCapability(tableState(), { canOrder: false, canRearrange: false })
    expect(capability.phase).toBe("serving")
    expect(capability.canOrder).toBe(false)
    expect(capability.canRearrange).toBe(false)
    // Xem đơn vẫn mở: nó dựa vào order.read, không vào order.create.
    expect(capability.canViewOrders).toBe(true)
  })

  it("bàn ghép: chạm ô nào cũng mở đúng một Phiên chung", () => {
    const shared = claim({ tableIds: [11, 12], groupId: 7, groupDisplayCode: "G01" })
    const first = tableState({ tableId: 11, claim: shared, claimOwner: "GROUP" })
    const second = tableState({ tableId: 12, claim: shared, claimOwner: "GROUP" })
    expect(waiterTableCapability(first).visitId).toBe(waiterTableCapability(second).visitId)
    expect(waiterVisitTableIds(first)).toEqual([11, 12])
    expect(waiterVisitTableIds(second)).toEqual([11, 12])
  })

  it("thời gian đã phục vụ nói bằng tiếng người", () => {
    const start = new Date("2026-11-20T13:00:00.000Z")
    expect(waiterServedDuration(start, new Date("2026-11-20T13:40:00.000Z"))).toBe("40 phút")
    expect(waiterServedDuration(start, new Date("2026-11-20T14:00:00.000Z"))).toBe("1 giờ")
    expect(waiterServedDuration(start, new Date("2026-11-20T14:25:00.000Z"))).toBe("1 giờ 25 phút")
    // Mốc máy chủ đi sau mốc hiện tại (lệch đồng hồ) không ra số âm.
    expect(waiterServedDuration(start, new Date("2026-11-20T12:00:00.000Z"))).toBe("0 phút")
  })
})

describe("đổi / ghép / tách bàn", () => {
  const tables = [
    table(11, "A1"),
    table(12, "A2"),
    table(13, "A3"),
    table(14, "A4", { isSpare: true }),
    table(15, "A5", { status: "OUT_OF_SERVICE" }),
  ]
  const states = new Map<number, FloorTableState>([
    [11, tableState({ tableId: 11 })],
    [12, tableState({ tableId: 12, state: "free", claim: null })],
    [13, tableState({ tableId: 13, state: "reserved", claim: claim({ kind: "reservation", visitId: null }) })],
    [14, tableState({ tableId: 14, state: "spare", claim: null })],
    [15, tableState({ tableId: 15, state: "oos", claim: null })],
  ])
  const byId = new Map(tables.map((entry) => [entry.id, entry]))

  it("bàn đích chỉ gồm bàn trống đang hoạt động", () => {
    expect(waiterTargetTables(tables, states, [11]).map((entry) => entry.code)).toEqual(["A2"])
  })

  it("đổi bàn gửi bộ bàn cuối cùng, không tạo Phiên mới", () => {
    const plan = waiterRearrangePlan({
      mode: "MOVE",
      visitId: 9001,
      version: 3,
      groupId: null,
      currentTableIds: [11],
      selectedTableIds: [12],
      byId,
    })
    expect(plan.request).toEqual({ visitId: 9001, version: 3, mode: "MOVE", tableIds: [12] })
    expect(plan.summary).toContain("A2")
  })

  it("ghép bàn gộp bàn hiện tại với bàn được chọn", () => {
    const plan = waiterRearrangePlan({
      mode: "MERGE",
      visitId: 9001,
      version: 3,
      groupId: null,
      currentTableIds: [11],
      selectedTableIds: [12],
      byId,
    })
    expect(plan.request).toEqual({ visitId: 9001, version: 3, mode: "MERGE", tableIds: [11, 12] })
  })

  it("chưa chọn bàn thì không gửi được và nói rõ vì sao", () => {
    for (const mode of ["MOVE", "MERGE"] as const) {
      const plan = waiterRearrangePlan({
        mode,
        visitId: 9001,
        version: 3,
        groupId: null,
        currentTableIds: [11],
        selectedTableIds: [],
        byId,
      })
      expect(plan.request).toBeNull()
      expect(plan.reason).toBeTruthy()
    }
  })

  it("Phiên không còn mở thì không dựng được yêu cầu", () => {
    const plan = waiterRearrangePlan({
      mode: "MOVE",
      visitId: null,
      version: null,
      groupId: null,
      currentTableIds: [11],
      selectedTableIds: [12],
      byId,
    })
    expect(plan.request).toBeNull()
  })

  it("tách bàn gửi danh sách bàn GIỮ LẠI và phải nhả ít nhất một bàn", () => {
    const base = {
      mode: "SPLIT" as const,
      visitId: 9001,
      version: 3,
      groupId: 7,
      currentTableIds: [11, 12],
      byId,
    }
    const ok = waiterRearrangePlan({ ...base, selectedTableIds: [11] })
    expect(isSplitRequest(ok.request)).toBe(true)
    expect(ok.request).toEqual({ groupId: 7, keepTableIds: [11] })

    expect(waiterRearrangePlan({ ...base, selectedTableIds: [11, 12] }).request).toBeNull()
    expect(waiterRearrangePlan({ ...base, selectedTableIds: [] }).request).toBeNull()
    // Không tách sang một bàn ngoài cụm: đó là đổi bàn, không phải tách.
    expect(waiterRearrangePlan({ ...base, selectedTableIds: [13] }).request).toBeNull()
  })

  it("Phiên một bàn không có gì để tách", () => {
    const plan = waiterRearrangePlan({
      mode: "SPLIT",
      visitId: 9001,
      version: 3,
      groupId: null,
      currentTableIds: [11],
      selectedTableIds: [11],
      byId,
    })
    expect(plan.request).toBeNull()
    expect(plan.reason).toBeTruthy()
  })

  it("bàn hiện tại của một Phiên lấy từ claim, không từ ô bàn vừa chạm", () => {
    expect(waiterCurrentTables(tableState({ tableId: 12, claim: claim({ tableIds: [11, 12] }) }))).toEqual([11, 12])
    expect(waiterCurrentTables(tableState({ tableId: 11, claim: null }))).toEqual([11])
  })
})

describe("dữ liệu khách không tới được màn Phục vụ", () => {
  it("redactFloorForWaiter xoá mọi trường nhận dạng khách", () => {
    const leaked = {
      at: new Date("2026-11-20T14:00:00.000Z"),
      businessDate: "2026-11-20",
      changeSeq: 10,
      tables: [
        tableState({
          claim: claim({
            displayName: GUEST_NAME,
            phoneLast3: "789",
            honorific: "MS",
            iconKeys: ["boss"],
            flags: ["BIRTHDAY"],
            sourceCode: "HOTLINE",
            origin: "RESERVATION",
            note: "khách quen",
            canCall: true,
            contactStatus: "CONTACTED" as const,
          }),
        }),
      ],
      groups: [
        {
          id: 7,
          symbolNo: 1,
          tableIds: [11, 12],
          claim: claim({ displayName: GUEST_NAME, phoneLast3: "789" }),
        },
      ],
    }
    const redacted = redactFloorForWaiter(leaked)
    expect(isRedactedForWaiter(redacted)).toBe(true)
    expect(JSON.stringify(redacted)).not.toContain(GUEST_NAME)
    expect(JSON.stringify(redacted)).not.toContain("HOTLINE")
    // Thông tin vận hành vẫn còn nguyên.
    expect(redacted.tables[0].claim?.partySize).toBe(4)
    expect(redacted.tables[0].claim?.version).toBe(3)
    expect(redacted.tables[0].claim?.tableIds).toEqual([11])
    // Không làm thay đổi dữ liệu gốc.
    expect(leaked.tables[0].claim?.displayName).toBe(GUEST_NAME)
  })

  it("isRedactedForWaiter phát hiện được một trường còn sót", () => {
    const floor = {
      at: new Date(),
      businessDate: "2026-11-20",
      changeSeq: 1,
      tables: [tableState({ claim: claim({ displayName: GUEST_NAME }) })],
      groups: [],
    }
    expect(isRedactedForWaiter(floor)).toBe(false)
  })
})

describe("mobile-first: sơ đồ vừa khung Phục vụ ở mọi viewport bắt buộc", () => {
  /** Header 56px + dòng ngày/ca/chú giải 44px. Chú giải là nút tròn trên cùng
   *  dòng đó, không phải một dải riêng: dải đầy đủ ăn ~130px và cắt mất hàng
   *  bàn dưới cùng của sơ đồ trên điện thoại. */
  const CHROME_H = 56 + 44
  /** Khung nội dung được giới hạn bề ngang trên màn lớn (`max-w-3xl`). */
  const MAX_CONTENT_W = 768
  const PAD_H = 8
  const PAD_V = 6

  const viewports = [
    { label: "phone 360x800", vw: 360, vh: 800 },
    { label: "phone 390x844", vw: 390, vh: 844 },
    { label: "phone 430x932", vw: 430, vh: 932 },
    { label: "iPad portrait 768x1024", vw: 768, vh: 1024 },
    { label: "laptop 1280x800", vw: 1280, vh: 800 },
  ]

  it("toolbar 360px cho text co lại và giữ action ở kích thước chạm", () => {
    expect(WAITER_TOOLBAR_CLASS).toContain("min-w-0")
    expect(WAITER_TOOLBAR_TEXT_CLASS).toContain("min-w-0")
    expect(WAITER_TOOLBAR_TEXT_CLASS).toContain("flex-1")
    expect(WAITER_TOOLBAR_TEXT_CLASS).toContain("overflow-hidden")
    expect(WAITER_TOOLBAR_TEXT_ITEM_CLASS).toContain("min-w-0")
    expect(WAITER_TOOLBAR_TEXT_ITEM_CLASS).toContain("truncate")
    expect(WAITER_TOOLBAR_ACTION_CLASS).toContain("shrink-0")
  })

  it.each(viewports)("$label: cả sơ đồ nằm trong khung, không cuộn ngang", ({ label, vw, vh }) => {
    const containerW = Math.min(vw, MAX_CONTENT_W)
    const canvasH = vh - CHROME_H
    const k = Math.min((containerW - PAD_H * 2) / FLOOR_W, (canvasH - PAD_V * 2) / FLOOR_H)
    expect(k, `${label} tỉ lệ phải dương`).toBeGreaterThan(0)

    const x = (containerW - FLOOR_W * k) / 2
    const y = (canvasH - FLOOR_H * k) / 2
    const wallLeft = x + WALL_BOUNDS.x * k
    const wallRight = x + (WALL_BOUNDS.x + WALL_BOUNDS.w) * k
    const wallTop = y + WALL_BOUNDS.y * k
    const wallBottom = y + (WALL_BOUNDS.y + WALL_BOUNDS.h) * k

    expect(wallLeft, `${label} wallLeft`).toBeGreaterThanOrEqual(0)
    expect(wallRight, `${label} wallRight`).toBeLessThanOrEqual(containerW)
    expect(wallTop, `${label} wallTop`).toBeGreaterThanOrEqual(0)
    expect(wallBottom, `${label} wallBottom`).toBeLessThanOrEqual(canvasH)

    // Bottom sheet cao tối đa 85dvh vẫn chừa chỗ cho header.
    expect(Math.round(vh * 0.85)).toBeLessThanOrEqual(vh - 56)
  })
})
