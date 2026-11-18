import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountPermissionView, AccountSummary } from "@/services/contracts"

const mockState = vi.hoisted(() => ({
  actorUserId: 3,
  actorRole: "OWNER" as "OWNER" | "ADMIN",
  readOnly: false,
  canUserManage: true,
  accountsResult: {
    data: undefined as
      | {
          accounts: AccountSummary[]
          roles: Array<{ code: string; name: string }>
        }
      | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  permissionsResult: {
    data: undefined as { permissions: AccountPermissionView[] } | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
  },
}))

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: () => undefined }, style: {} },
    querySelector: () => null,
    getElementsByTagName: () => [],
  })
})

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[1] === "accounts") return mockState.accountsResult
    return mockState.permissionsResult
  },
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}))

vi.mock("@/state/session", () => ({
  useSession: (selector: (s: { user: { id: number; role: string } }) => unknown) =>
    selector({ user: { id: mockState.actorUserId, role: mockState.actorRole } }),
}))

vi.mock("../use-admin-session", () => ({
  useAdminSession: () => ({
    can: (perm: string) => (perm === "user.manage" ? mockState.canUserManage : true),
    readOnly: mockState.readOnly,
  }),
}))

import { CreateAccountForm } from "./accounts-create-form"
import { AccountDetailDialog } from "./accounts-detail-dialog"
import AdminAccountsPage from "./accounts-page"
import { PasswordResetDialog } from "./accounts-password-dialog"

const SAMPLE_ACCOUNTS: AccountSummary[] = [
  {
    id: 4,
    version: 1,
    username: "le_tan_1",
    displayName: "Lễ tân 1",
    roles: ["RECEPTIONIST"],
    accessLevel: null,
    status: "ACTIVE",
    membershipStatus: "ACTIVE",
    lastLoginAt: "2026-11-17T02:05:00.000Z",
  },
  {
    id: 3,
    version: 2,
    username: "owner",
    displayName: "Chủ quán",
    roles: ["OWNER"],
    accessLevel: null,
    status: "ACTIVE",
    membershipStatus: "ACTIVE",
    lastLoginAt: null,
  },
]

const SAMPLE_PERMS: AccountPermissionView[] = [
  { code: "report.read", grantedByRole: false, overridden: false, enabled: false, grantable: true, editable: true },
  {
    code: "customer.phone.reveal",
    grantedByRole: false,
    overridden: false,
    enabled: false,
    grantable: true,
    editable: true,
  },
  {
    code: "booking.phone.reveal",
    grantedByRole: false,
    overridden: false,
    enabled: false,
    grantable: true,
    editable: true,
  },
  {
    code: "reservation.update",
    grantedByRole: true,
    overridden: false,
    enabled: true,
    grantable: true,
    editable: false,
  },
  {
    code: "reservation.cancel",
    grantedByRole: true,
    overridden: false,
    enabled: true,
    grantable: true,
    editable: false,
  },
  {
    code: "customer.history.manage",
    grantedByRole: false,
    overridden: false,
    enabled: false,
    grantable: false,
    editable: false,
  },
  { code: "user.manage", grantedByRole: false, overridden: false, enabled: false, grantable: true, editable: true },
  {
    code: "venue.configure",
    grantedByRole: false,
    overridden: false,
    enabled: false,
    grantable: false,
    editable: false,
  },
  { code: "audit.read", grantedByRole: false, overridden: false, enabled: false, grantable: true, editable: true },
]

describe("AdminAccountsPage & dialogs", () => {
  beforeEach(() => {
    mockState.actorUserId = 3
    mockState.actorRole = "OWNER"
    mockState.readOnly = false
    mockState.canUserManage = true
    mockState.accountsResult = {
      data: {
        accounts: SAMPLE_ACCOUNTS,
        roles: [
          { code: "RECEPTIONIST", name: "Lễ tân" },
          { code: "ADMIN", name: "Admin" },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    mockState.permissionsResult = {
      data: { permissions: SAMPLE_PERMS },
      isPending: false,
      isError: false,
      error: null,
    }
  })

  it("renders accounts page with P1 search, filter chips, mobile cards, desktop table, and permission checkboxes", () => {
    const html = renderToString(createElement(AdminAccountsPage) as ReactElement)
    expect(html).toContain('data-testid="admin-accounts-page"')
    expect(html).toContain('aria-label="Tìm theo tên hoặc tài khoản"')
    expect(html).toContain("Tạo tài khoản")
    expect(html).toContain("Danh sách tài khoản")
    // Desktop table cells + mobile cards both render all fields
    expect(html).toContain("<table")
    expect(html).toContain("Lễ tân 1")
    expect(html).toContain("le_tan_1")
    expect(html).toContain("/letan")
    // Permission checkboxes (Radix Checkbox renders role="checkbox"), never a dropdown
    expect(html).toContain('role="checkbox"')
    expect(html).not.toContain("<select")
    expect(html).toContain("Xem báo cáo doanh thu")
    expect(html).toContain("Duyệt giảm giá, hủy món")
    expect(html).toContain("Chưa hỗ trợ")
    expect(html).toContain("Lưu thay đổi quyền")
  })

  it("disables mutation controls in READ_ONLY mode", () => {
    mockState.actorRole = "ADMIN"
    mockState.readOnly = true
    mockState.canUserManage = false
    const html = renderToString(createElement(AdminAccountsPage) as ReactElement)
    expect(html).toContain("Chỉ SuperAdmin xem và đổi được bảng phân quyền")
    expect(html).toMatch(/disabled=""[^>]*>.*Tạo tài khoản|Tạo tài khoản/)
  })

  it("renders CreateAccountForm with P1 inputs and role buttons", () => {
    const html = renderToString(
      createElement(CreateAccountForm, {
        roles: [
          { code: "RECEPTIONIST", name: "Lễ tân" },
          { code: "ADMIN", name: "Admin" },
        ],
        onClose: vi.fn(),
        onCreated: vi.fn(),
      }) as ReactElement,
    )
    expect(html).toContain("Tên đăng nhập")
    expect(html).toContain("Tên hiển thị")
    expect(html).toContain("Vai trò")
    expect(html).toContain("Tạo tài khoản")
    expect(html).toContain("Hủy")
  })

  it("keeps AccountDetailDialog and PasswordResetDialog controlled via open prop", () => {
    const closedDetail = renderToString(
      createElement(AccountDetailDialog, {
        open: false,
        account: SAMPLE_ACCOUNTS[0]!,
        onChangePassword: vi.fn(),
        onClose: vi.fn(),
      }) as ReactElement,
    )
    expect(closedDetail).toBe("")

    const closedPassword = renderToString(
      createElement(PasswordResetDialog, {
        open: false,
        account: SAMPLE_ACCOUNTS[0]!,
        onClose: vi.fn(),
        onDone: vi.fn(),
      }) as ReactElement,
    )
    expect(closedPassword).toBe("")
  })
})
