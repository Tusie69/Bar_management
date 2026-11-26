/**
 * Module Phục vụ 1 — panel chi tiết bàn, kiểm trên HTML đã render.
 *
 * Dự án chưa có jsdom, nên panel được render bằng `react-dom/server` và kiểm
 * trên chuỗi HTML — đủ để chứng minh ba điều mà đọc code không chứng minh
 * được: nút nào tắt, câu thông báo nào hiện ra, và không có tên hay số điện
 * thoại khách nào lọt vào markup.
 *
 * Bài kiểm "không render tên khách" cố ý nạp vào một claim CÓ tên, dù phép
 * chiếu của Phục vụ không bao giờ mang tên. Nếu một ngày nào đó panel đọc
 * thêm `claim.displayName`, test này đỏ ngay.
 */
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import type { ClaimView, FloorTableState, TableView } from "@/domain/models"
import { WAITER_PAYMENT_NOTICE } from "./waiter-access"
import { PreparationQueue } from "@/features/preparation/preparation-queue"
import { WaiterQueueButton } from "./waiter-page"
import { buildWaiterSheetView, WaiterTableSheetBody, type WaiterTableSheetBodyProps } from "./waiter-table-sheet"

const GUEST_NAME = "Chị Hồng Nhung"
const GUEST_PHONE_LAST3 = "789"
const SERVER_NOW = new Date("2026-11-20T14:00:00.000Z")

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

const TABLES = [table(11, "A1"), table(12, "A2"), table(13, "A3")]
const BY_ID = new Map(TABLES.map((entry) => [entry.id, entry]))

function render(
  state: FloorTableState | undefined,
  options: {
    states?: Map<number, FloorTableState>
    canOrder?: boolean
    canRearrange?: boolean
    canSplit?: boolean
    tableId?: number
  } = {},
): string {
  const states =
    options.states ??
    new Map<number, FloorTableState>([
      [11, state ?? tableState()],
      [12, tableState({ tableId: 12, state: "free", claim: null })],
      [13, tableState({ tableId: 13, state: "free", claim: null })],
    ])
  const view = buildWaiterSheetView({
    tableId: options.tableId ?? 11,
    state,
    byId: BY_ID,
    zoneName: "Khu A",
    serverNow: SERVER_NOW,
    canOrder: options.canOrder ?? true,
    canRearrange: options.canRearrange ?? true,
  })
  const props: WaiterTableSheetBodyProps = {
    view,
    tables: TABLES,
    states,
    byId: BY_ID,
    canMove: true,
    canCombine: true,
    canSplit: options.canSplit ?? true,
    pending: false,
    onOrder: () => undefined,
    onViewOrders: () => undefined,
    onRearrange: () => undefined,
  }
  return renderSheetBody(props)
}

/**
 * Panel giờ nạp "Món đã gọi" qua TanStack Query, nên nó cần một client. Hộp
 * chứa chỉ để `renderToString` chạy được; không có request nào đi ra trong lần
 * render đầu, nên test vẫn đọc đúng phần tĩnh của panel.
 */
function renderSheetBody(props: WaiterTableSheetBodyProps): string {
  return renderToString(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(WaiterTableSheetBody, props)),
  )
}

/**
 * Nút `Gọi món` đang bật hay tắt, đọc từ HTML thay vì đoán.
 *
 * Chỉ xét THẺ MỞ của nút, và chỉ xét thuộc tính `disabled=""`: class của nút có
 * chứa `disabled:opacity-45` (biến thể Tailwind), nên tìm chuỗi "disabled"
 * trong cả nút sẽ luôn khớp và test sẽ xanh vì lý do sai.
 */
function orderButtonDisabled(html: string): boolean {
  const index = html.indexOf("Gọi món")
  expect(index, "panel phải luôn có nút Gọi món").toBeGreaterThan(-1)
  const start = html.lastIndexOf("<button", index)
  const openingTag = html.slice(start, html.indexOf(">", start))
  return openingTag.includes('disabled=""')
}

describe("panel chi tiết bàn — nút Gọi món", () => {
  it("bàn trống: nút Gọi món tắt", () => {
    const html = render(tableState({ state: "free", claim: null }))
    expect(orderButtonDisabled(html)).toBe(true)
    expect(html).toContain("Trống")
  })

  it("bàn đã đặt, khách chưa tới: nút Gọi món tắt", () => {
    const html = render(tableState({ state: "reserved", claim: claim({ kind: "reservation", visitId: null }) }))
    expect(orderButtonDisabled(html)).toBe(true)
    expect(html).toContain("Đã đặt, khách chưa tới")
  })

  it("bàn có Phiên đang mở: nút Gọi món bật", () => {
    const html = render(tableState())
    expect(orderButtonDisabled(html)).toBe(false)
    // v1.1: khối màu nói trạng thái LƯỢT KHÁCH. Máy chủ chưa gửi trạng thái
    // thì panel đoán "Mới vào" — phía làm Phục vụ đi tới bàn.
    expect(html).toContain("Mới vào")
    expect(html).toContain("4 khách")
    expect(html).toContain("55 phút")
  })

  it("khối màu đi theo trạng thái lượt khách mà máy chủ gửi", () => {
    const html = render({ ...tableState(), waiterPhase: "AWAITING_FOOD" })
    expect(html).toContain("Chờ đồ")
    expect(html).toContain("#7B3FF2")
  })

  it("Phiên chờ thanh toán: nút Gọi món tắt và hiện đúng câu đã chốt", () => {
    const html = render(tableState({ claim: claim({ paid: true }) }))
    expect(orderButtonDisabled(html)).toBe(true)
    expect(html).toContain(WAITER_PAYMENT_NOTICE)
    expect(html).toContain("Thanh toán")
  })

  /**
   * v1.1 bỏ nút "Xem đơn đã gọi": món đã gọi hiện thẳng trong panel. Đường vào
   * màn Đơn của bàn — nơi có Xin hủy món và Xin ghi hao (V6) — nằm dưới danh
   * sách món, nên nó chỉ xuất hiện khi đã tải được danh sách đó.
   */
  it("không còn nút Xem đơn đã gọi trên bảng thao tác", () => {
    expect(render(tableState())).not.toContain("Xem đơn đã gọi")
  })

  /** Bảng thông tin trùng lặp đã bị bỏ; mọi con số nằm trên một dòng. */
  it("không còn bảng Khu vực / Bàn / Số khách lặp lại", () => {
    const html = render(tableState())
    expect(html).not.toContain(">Mở Phiên<")
    expect(html).not.toContain(">Trạng thái Phiên<")
    expect(html).not.toContain(">Lượt trong ca<")
  })

  it("thiếu order.create: Phiên vẫn đang phục vụ nhưng nút Gọi món tắt", () => {
    const html = render(tableState(), { canOrder: false })
    expect(html).toContain("Mới vào")
    expect(orderButtonDisabled(html)).toBe(true)
  })
})

describe("luồng hàng đợi Bartender", () => {
  it("nút có accessible name chứa badge thật và vùng chạm 44px", () => {
    const html = renderToString(createElement(WaiterQueueButton, { count: 4, onClick: () => undefined }))
    expect(html).toContain("Hàng đợi Bar: 4 phiếu chưa hoàn tất")
    expect(html).toContain("min-h-11")
    expect(html).toContain(">4<")
  })

  it.each([
    ["BAR", "Bar", "preparation.bar.read"],
    ["KITCHEN", "Bếp", "preparation.kitchen.read"],
  ] as const)(
    "deep-link thiếu quyền %s hiện từ chối đúng station và không lộ mã quyền",
    (station, label, permission) => {
      const client = new QueryClient()
      const html = renderToString(
        createElement(
          QueryClientProvider,
          { client },
          createElement(PreparationQueue, {
            station,
            canRead: false,
            canTransition: false,
            canRetry: false,
            embedded: true,
          }),
        ),
      )
      expect(html).toContain(`Không có quyền xem hàng đợi ${label}`)
      expect(html).toContain("liên hệ quản lý")
      expect(html).not.toContain(permission)
      expect(html).not.toContain("Backend")
    },
  )

  it("hàng đợi trong WaiterShell có nút về sơ đồ, không có chọn station hay đăng xuất riêng", () => {
    const client = new QueryClient()
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PreparationQueue, {
          station: "BAR",
          canRead: true,
          canTransition: true,
          canRetry: true,
          embedded: true,
          onBack: () => undefined,
        }),
      ),
    )
    expect(html).toContain("Quay về sơ đồ")
    expect(html).toContain("Hàng đợi Bar")
    expect(html).not.toContain(">Bếp<")
    expect(html).not.toContain("Đăng xuất")
  })
})

describe("panel chi tiết bàn — không có dữ liệu khách", () => {
  it("không render tên, ba số cuối, nguồn đặt hay ghi chú booking", () => {
    const html = render(
      tableState({
        claim: claim({
          displayName: GUEST_NAME,
          phoneLast3: GUEST_PHONE_LAST3,
          honorific: "MS",
          iconKeys: ["boss"],
          flags: ["BIRTHDAY"],
          sourceCode: "HOTLINE",
          origin: "RESERVATION",
          note: "khách quen, ngồi bàn trong",
          canCall: true,
        }),
      }),
    )
    expect(html).not.toContain(GUEST_NAME)
    expect(html).not.toContain("Hồng")
    expect(html).not.toContain("HOTLINE")
    expect(html).not.toContain("BIRTHDAY")
    expect(html).not.toContain("khách quen")
    expect(html).not.toContain(`>${GUEST_PHONE_LAST3}<`)
    // Và panel vẫn nói đúng trạng thái lượt khách.
    expect(html).toContain("Mới vào")
  })
})

describe("panel chi tiết bàn — bàn ghép", () => {
  const shared = claim({ tableIds: [11, 12], groupId: 7, groupDisplayCode: "G01" })

  it("chạm ô bàn nào của cụm cũng mở đúng một Phiên chung", () => {
    const states = new Map<number, FloorTableState>([
      [11, tableState({ tableId: 11, claim: shared, claimOwner: "GROUP" })],
      [12, tableState({ tableId: 12, claim: shared, claimOwner: "GROUP" })],
      [13, tableState({ tableId: 13, state: "free", claim: null })],
    ])
    const views = [11, 12].map((tableId) =>
      buildWaiterSheetView({
        tableId,
        state: states.get(tableId),
        byId: BY_ID,
        zoneName: "Khu A",
        serverNow: SERVER_NOW,
        canOrder: true,
        canRearrange: true,
      }),
    )
    expect(new Set(views.map((view) => view.capability.visitId))).toEqual(new Set([9001]))
    expect(views[0].title).toBe("Cụm G01")
    expect(views[1].title).toBe("Cụm G01")
    expect(views[0].tableCodes).toEqual(["A1", "A2"])
    expect(views[0].groupId).toBe(7)

    // Và mỗi ô bàn vẫn hiện riêng trong danh sách thành viên của cụm.
    const html = renderSheetBody({
      view: views[1],
      tables: TABLES,
      states,
      byId: BY_ID,
      canMove: true,
      canCombine: true,
      canSplit: true,
      pending: false,
      onOrder: () => undefined,
      onViewOrders: () => undefined,
      onRearrange: () => undefined,
    } satisfies WaiterTableSheetBodyProps)
    // v1.1: mã các bàn của cụm nằm trên DÒNG THÔNG TIN gộp, không còn ở một
    // câu riêng bên dưới tiêu đề.
    expect(html).toContain("A1 + A2")
    // `>Tách bàn<` là nhãn trên nút; tiêu đề nhóm "Đổi / Ghép / Tách bàn" cũng
    // chứa cụm từ đó, nên so khớp cả chuỗi sẽ khớp cả khi nút không có.
    expect(html).toContain(">Tách bàn<")
  })

  it("Phiên một bàn không hiện nút Tách bàn", () => {
    const html = render(tableState())
    expect(html).toContain(">Đổi bàn<")
    expect(html).toContain(">Ghép bàn<")
    expect(html).not.toContain(">Tách bàn<")
  })

  it("thiếu quyền dọn chỗ thì cả cụm nút Đổi/Ghép/Tách không hiện", () => {
    const html = render(tableState(), { canRearrange: false })
    expect(html).not.toContain("Đổi / Ghép / Tách bàn")
    expect(html).not.toContain(">Đổi bàn<")
  })
})
