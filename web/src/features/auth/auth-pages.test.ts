import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSession = vi.hoisted(() => ({
  authStatus: "anonymous" as "loading" | "authenticated" | "anonymous" | "error",
  mustChangePassword: false,
  authError: null as string | null,
  authEndCode: null as string | null,
  portal: "admin" as "admin" | "receptionist",
  sessionEndNotice: false,
  principal: {
    id: 3,
    username: "owner",
    displayName: "Chủ quán",
    organizationId: 1,
    venueId: 1,
    roles: ["OWNER"],
    accessLevel: null,
  },
  permissions: ["report.read", "user.manage"],
  login: vi.fn(),
  logout: vi.fn(),
  expire: vi.fn(),
  bootstrap: vi.fn(),
  leaveToLogin: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}))

vi.mock("@/services", () => ({
  api: { mode: "http", changeOwnPassword: vi.fn() },
  clock: { now: () => new Date("2026-11-17T14:30:00.000Z") },
  isApiError: () => false,
}))

vi.mock("@/state/session", () => ({
  useSession: (selector: (s: typeof mockSession) => unknown) => selector(mockSession),
}))

import { AuthBoundary } from "./auth-boundary"
import { LoginPage, PortalUnderConstruction } from "./login-page"
import { PasswordChangeGate } from "./password-change-gate"
import { ServerSessionPage } from "./server-session-page"
import { SessionEndedNotice } from "./session-ended-notice"

function renderHtml(el: ReactElement): string {
  return renderToString(el).replaceAll("<!-- -->", "")
}

describe("Auth screens presentation", () => {
  beforeEach(() => {
    mockSession.authStatus = "anonymous"
    mockSession.mustChangePassword = false
    mockSession.authError = null
    mockSession.authEndCode = null
    mockSession.sessionEndNotice = false
  })

  it("renders LoginPage with portal label, fields, toggle, note, and alert on error", () => {
    mockSession.authError = "Phiên đã hết hạn"
    const html = renderHtml(createElement(LoginPage, { portal: "admin" }) as ReactElement)
    expect(html).toContain("Đăng nhập Quản trị")
    expect(html).toContain("Tên đăng nhập")
    expect(html).toContain("Mật khẩu")
    expect(html).toContain('aria-label="Hiện mật khẩu"')
    expect(html).toContain("Phiên đã hết hạn")
    expect(html).toContain('role="alert"')
    expect(html).toContain("cookie HttpOnly")
  })

  it("renders PortalUnderConstruction, PasswordChangeGate, ServerSessionPage, and SessionEndedNotice", () => {
    const constructionHtml = renderHtml(createElement(PortalUnderConstruction, { label: "Kho" }) as ReactElement)
    expect(constructionHtml).toContain("Cổng Kho đang xây dựng")
    expect(constructionHtml).toContain("text-amber-500")
    expect(constructionHtml).not.toContain("text-amber-600")

    const pwdHtml = renderHtml(createElement(PasswordChangeGate) as ReactElement)
    expect(pwdHtml).toContain("Đổi mật khẩu trước khi tiếp tục")
    expect(pwdHtml).toContain("Mật khẩu tạm")
    expect(pwdHtml).toContain("tối thiểu 12 ký tự")

    const srvHtml = renderHtml(createElement(ServerSessionPage) as ReactElement)
    expect(srvHtml).toContain("Xin chào, Chủ quán")
    expect(srvHtml).toContain('aria-label="Đã xác thực"')
    expect(srvHtml).toContain("report.read")

    mockSession.authEndCode = "SESSION_REPLACED"
    const endedHtml = renderHtml(createElement(SessionEndedNotice) as ReactElement)
    expect(endedHtml).toContain('data-testid="session-ended-notice"')
    expect(endedHtml).toContain('data-testid="session-ended-login"')
    expect(endedHtml).toContain('data-testid="session-ended-countdown"')
    expect(endedHtml).toContain("Đăng nhập lại")
    expect(endedHtml).toContain("text-amber-500")
    expect(endedHtml).not.toContain("text-amber-600")
  })

  it("renders AuthBoundary loading and error states cleanly", () => {
    mockSession.authStatus = "loading"
    expect(renderHtml(createElement(AuthBoundary, null, createElement("div", null, "App")) as ReactElement)).toContain(
      "Đang kiểm tra phiên đăng nhập",
    )

    mockSession.authStatus = "error"
    mockSession.authError = "Lỗi mạng"
    const errHtml = renderHtml(createElement(AuthBoundary, null, createElement("div", null, "App")) as ReactElement)
    expect(errHtml).toContain("Không thể khôi phục phiên")
    expect(errHtml).toContain("Thử lại")
    expect(errHtml).toContain("text-amber-500")
    expect(errHtml).not.toContain("text-amber-600")
  })
})
