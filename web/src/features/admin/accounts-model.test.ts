/**
 * TU-34 — Phần quyết định của màn Tài khoản & phân quyền.
 *
 * Dự án chưa có jsdom nên test bám vào các hàm thuần: tìm, lọc, đếm, đọc
 * trạng thái dòng, và quyền bấm nút. Phần nhìn kiểm bằng mắt ở 1440/768.
 */
import { describe, expect, it } from "vitest"
import type { AccountSummary } from "@/services/contracts"
import {
  ACCOUNT_FILTERS,
  accountState,
  canActOn,
  fmtAccountTimestamp,
  newPasswordIssue,
  PASSWORD_MIN,
  filterAccounts,
  filterCounts,
  portalPath,
  primaryRole,
  roleLabel,
} from "./accounts-model"
import { groupPayload, groupStates, PERMISSION_GROUPS } from "./permission-groups"

function account(partial: Partial<AccountSummary> & Pick<AccountSummary, "id" | "username" | "roles">): AccountSummary {
  return {
    displayName: partial.username,
    status: "ACTIVE",
    membershipStatus: "ACTIVE",
    accessLevel: null,
    lastLoginAt: null,
    version: 1,
    ...partial,
  }
}

const accounts: AccountSummary[] = [
  account({ id: 1, username: "luan", displayName: "Luân Nguyễn", roles: ["OWNER"] }),
  account({ id: 2, username: "hung", displayName: "Lương Tuấn Hưng", roles: ["ADMIN"], accessLevel: "WRITE" }),
  account({ id: 3, username: "ha", displayName: "Trần Thu Hà", roles: ["ADMIN"], accessLevel: "READ_ONLY" }),
  account({ id: 4, username: "letan1", displayName: "Lễ tân ca 1", roles: ["RECEPTIONIST"] }),
  account({ id: 5, username: "letan2", displayName: "Lễ tân ca 2", roles: ["RECEPTIONIST"] }),
  account({ id: 6, username: "letan3", displayName: "Lễ tân ca 3", roles: ["RECEPTIONIST"], status: "DISABLED" }),
  account({ id: 7, username: "thungan", displayName: "Thu ngân", roles: ["CASHIER"] }),
  account({ id: 8, username: "phucvu1", displayName: "Phục vụ 1", roles: ["WAITER"] }),
]

describe("tìm kiếm và lọc", () => {
  it("tìm theo tên hiển thị, không phân biệt hoa thường và dấu cách", () => {
    expect(filterAccounts(accounts, "all", "thu hà").map((item) => item.id)).toEqual([3])
    expect(filterAccounts(accounts, "all", "TRẦN").map((item) => item.id)).toEqual([3])
  })

  it("tìm theo tên đăng nhập", () => {
    expect(filterAccounts(accounts, "all", "letan").map((item) => item.id)).toEqual([4, 5, 6])
  })

  it("ô tìm trống thì giữ nguyên danh sách", () => {
    expect(filterAccounts(accounts, "all", "   ")).toHaveLength(accounts.length)
  })

  it("lọc theo vai trò, gộp SuperAdmin vào nhóm Admin", () => {
    expect(filterAccounts(accounts, "admin", "").map((item) => item.id)).toEqual([1, 2, 3])
    expect(filterAccounts(accounts, "receptionist", "").map((item) => item.id)).toEqual([4, 5, 6])
    expect(filterAccounts(accounts, "cashier", "").map((item) => item.id)).toEqual([7])
    expect(filterAccounts(accounts, "waiter", "").map((item) => item.id)).toEqual([8])
  })

  it("lọc và tìm áp dụng cùng lúc", () => {
    expect(filterAccounts(accounts, "receptionist", "ca 2").map((item) => item.id)).toEqual([5])
  })

  it("đếm trên từng chip tính theo toàn danh sách", () => {
    const counts = filterCounts(accounts)
    expect(counts.all).toBe(8)
    expect(counts.admin).toBe(3)
    expect(counts.receptionist).toBe(3)
    expect(counts.warehouse).toBe(0)
  })

  it("giữ ô Kho của prototype ở trạng thái chưa hỗ trợ thay vì tạo vai trò mới", () => {
    const warehouse = ACCOUNT_FILTERS.find((filter) => filter.key === "warehouse")!
    expect(warehouse.unsupported).toBe(true)
  })
})

describe("một dòng trong bảng", () => {
  it("nhãn vai trò theo prototype", () => {
    expect(roleLabel(accounts[0])).toBe("SuperAdmin")
    expect(roleLabel(accounts[1])).toBe("Admin")
    expect(roleLabel(accounts[3])).toBe("Lễ tân")
    expect(primaryRole(accounts[0])).toBe("OWNER")
  })

  it("cổng đăng nhập đúng URL công bố cho nhân viên", () => {
    expect(portalPath(accounts[0])).toBe("/admin")
    expect(portalPath(accounts[3])).toBe("/letan")
    expect(portalPath(accounts[6])).toBe("/thungan")
    expect(portalPath(accounts[7])).toBe("/phucvu")
  })

  it("trạng thái phân biệt hoạt động, chỉ xem và đã khóa", () => {
    expect(accountState(accounts[1])).toEqual({ label: "Hoạt động", tone: "active" })
    expect(accountState(accounts[2])).toEqual({ label: "Chỉ xem", tone: "readonly" })
    expect(accountState(accounts[5])).toEqual({ label: "Đã khóa", tone: "locked" })
  })
})

describe("ai bấm được nút thao tác", () => {
  const superAdmin = { userId: 1, role: "OWNER", readOnly: false }
  const adminEdit = { userId: 2, role: "ADMIN", readOnly: false }
  const adminReadOnly = { userId: 3, role: "ADMIN", readOnly: true }

  it("SuperAdmin thao tác được với Admin và nhân viên, trừ chính mình", () => {
    expect(canActOn(superAdmin, accounts[1])).toBe(true)
    expect(canActOn(superAdmin, accounts[3])).toBe(true)
    expect(canActOn(superAdmin, accounts[0])).toBe(false)
  })

  it("Admin Edit chỉ thao tác với nhân viên", () => {
    expect(canActOn(adminEdit, accounts[3])).toBe(true)
    expect(canActOn(adminEdit, accounts[2])).toBe(false)
    expect(canActOn(adminEdit, accounts[0])).toBe(false)
  })

  it("Admin Read-Only không thao tác được với ai", () => {
    for (const item of accounts) expect(canActOn(adminReadOnly, item)).toBe(false)
  })
})

describe("nhóm quyền của tài khoản", () => {
  /**
   * `role` = vai trò có sẵn quyền, `on` = quyền hiệu dụng, `ceiling` = cấp
   * thêm được. Mặc định mọi quyền đều trong trần, trừ khi test nói khác.
   */
  const views = (entries: [string, { role: boolean; on: boolean; ceiling?: boolean }][]) =>
    entries.map(([code, state]) => {
      const grantable = state.ceiling ?? true
      return {
        code,
        grantedByRole: state.role,
        enabled: state.on,
        overridden: state.role !== state.on,
        editable: grantable && code !== "user.read",
        grantable,
      }
    })

  it("giữ thứ tự nhóm quyền và thêm nhóm hồ sơ khách riêng", () => {
    expect(PERMISSION_GROUPS.map((group) => group.label)).toEqual([
      "Xem báo cáo doanh thu",
      "Xem số điện thoại đầy đủ",
      "Sửa / hủy booking",
      "Gán lượt khuyết danh / xử lý hồ sơ trùng",
      "Duyệt giảm giá, hủy món",
      "Quản lý tài khoản nhân viên",
      "Cấu hình vận hành",
      "Xem nhật ký thao tác",
    ])
  })

  it.each([
    { role: true, on: true, ceiling: true },
    { role: true, on: false, ceiling: true },
    { role: false, on: false, ceiling: true },
    { role: false, on: false, ceiling: false },
  ])("nhóm hồ sơ khách tuân theo quyền hiệu dụng và trần: %j", (state) => {
    const history = groupStates(views([["customer.history.manage", state]]))
      .find((item) => item.group.key === "customer-history")!
    expect(history.checked).toBe(state.on)
    expect(history.editable).toBe(state.ceiling)
    expect(history.outOfCeiling).toBe(!state.ceiling)
    expect(groupPayload(history, !state.on)).toEqual(
      state.ceiling ? { "customer.history.manage": !state.on } : {},
    )
  })

  it("checkbox phản ánh quyền hiệu dụng chứ không phải quyền vai trò", () => {
    const states = groupStates(
      views([
        ["report.read", { role: true, on: false }],
        ["audit.read", { role: true, on: true }],
      ]),
    )
    expect(states.find((state) => state.group.key === "report")!.checked).toBe(false)
    expect(states.find((state) => state.group.key === "audit")!.checked).toBe(true)
  })

  it("nhóm nhiều quyền chỉ tick khi mọi quyền trong nhóm đều bật", () => {
    const half = groupStates(
      views([
        ["reservation.update", { role: true, on: true }],
        ["reservation.cancel", { role: true, on: false }],
      ]),
    )
    expect(half.find((state) => state.group.key === "booking")!.checked).toBe(false)
  })

  it("quyền ngoài vai trò nhưng trong trần thì vẫn tick được để cấp thêm", () => {
    // TU-32: SuperAdmin cấp thêm quyền cho vai trò chưa có.
    const states = groupStates(views([["report.read", { role: false, on: false }]]))
    const report = states.find((state) => state.group.key === "report")!
    expect(report.checked).toBe(false)
    expect(report.editable).toBe(true)
    expect(report.outOfCeiling).toBe(false)
    expect(groupPayload(report, true)).toEqual({ "report.read": true })
  })

  it("quyền ngoài trần thì khóa hẳn và nói rõ là không cấp được", () => {
    const states = groupStates(views([["venue.configure", { role: false, on: false, ceiling: false }]]))
    const venue = states.find((state) => state.group.key === "venue")!
    expect(venue.editable).toBe(false)
    expect(venue.outOfCeiling).toBe(true)
    expect(groupPayload(venue, true)).toEqual({})
  })

  it("nhóm chưa có permission trong backend hiện là chưa hỗ trợ", () => {
    const discount = groupStates([]).find((state) => state.group.key === "discount")!
    expect(discount.unsupported).toBe(true)
    expect(discount.editable).toBe(false)
    expect(groupPayload(discount, true)).toEqual({})
  })

  it("payload chỉ gửi những mã sửa được", () => {
    const states = groupStates(
      views([
        ["customer.phone.reveal", { role: true, on: true }],
        ["booking.phone.reveal", { role: false, on: false, ceiling: false }],
      ]),
    )
    expect(
      groupPayload(
        states.find((state) => state.group.key === "phone")!,
        false,
      ),
    ).toEqual({
      "customer.phone.reveal": false,
    })
  })
})

describe("mật khẩu tự nhập khi đổi mật khẩu", () => {
  it("nhận một chuỗi đủ dài", () => {
    expect(newPasswordIssue("a".repeat(PASSWORD_MIN))).toBeNull()
  })

  it("từ chối chuỗi ngắn hơn giới hạn của máy chủ", () => {
    // Lệch với `PASSWORD_MIN` trong account.repository.ts thì người dùng gõ
    // xong mới bị từ chối, lúc đó không biết mình sai ở đâu.
    expect(PASSWORD_MIN).toBe(12)
    expect(newPasswordIssue("a".repeat(PASSWORD_MIN - 1))).toContain(String(PASSWORD_MIN))
  })

  it("nói rõ là chưa nhập gì, thay vì báo quá ngắn", () => {
    expect(newPasswordIssue("")).toBe("Chưa nhập mật khẩu.")
  })

  it("chặn dấu cách ở hai đầu", () => {
    // Chuỗi được đọc to hoặc chép tay cho nhân viên; dấu cách đầu cuối là
    // thứ không ai đọc thấy và sẽ thành một cuộc gọi "tôi không đăng nhập được".
    expect(newPasswordIssue(` ${"a".repeat(PASSWORD_MIN)}`)).not.toBeNull()
    expect(newPasswordIssue(`${"a".repeat(PASSWORD_MIN)} `)).not.toBeNull()
  })

  it("không tự bịa luật độ mạnh máy chủ không có", () => {
    // Máy chủ chỉ kiểm độ dài. Chặn thêm ở trình duyệt sẽ làm hỏng những
    // chuỗi máy chủ chấp nhận, mà không làm hệ thống an toàn hơn.
    expect(newPasswordIssue("123456789012")).toBeNull()
    expect(newPasswordIssue("mat khau co dau cach o giua")).toBeNull()
  })
})

describe("mốc đăng nhập gần nhất", () => {
  it("đọc theo giờ quán (UTC+7), không theo giờ máy", () => {
    expect(fmtAccountTimestamp("2026-11-17T02:05:00.000Z")).toBe("09:05 · 17/11/2026")
  })

  it("chưa đăng nhập thì nói rõ, không để ô trống", () => {
    expect(fmtAccountTimestamp(null)).toBe("Chưa đăng nhập lần nào")
  })

  it("mốc hỏng thì nói là hỏng, không hiện Invalid Date", () => {
    expect(fmtAccountTimestamp("không phải ngày")).toBe("Không đọc được mốc thời gian")
  })
})
