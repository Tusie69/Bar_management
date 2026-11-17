/**
 * TU-34 — Hộp thoại "Xem thông tin" của một tài khoản.
 *
 * Màn này KHÔNG hiện mật khẩu hiện tại, và không phải vì chưa làm: hệ thống
 * không giữ mật khẩu ở dạng đọc được. `users.password_hash` lưu một chuỗi
 * scrypt một chiều (`api/src/auth/password.ts`), nên không ai — kể cả
 * SuperAdmin, kể cả người có quyền vào thẳng database — đọc ngược ra được
 * mật khẩu. Muốn hiện được mật khẩu thì phải lưu nó ở dạng giải mã được, và
 * lúc đó một lần lộ cơ sở dữ liệu là lộ mật khẩu của toàn bộ nhân viên.
 *
 * Nhu cầu thật đằng sau câu hỏi "mật khẩu của nhân viên này là gì" là "nhân
 * viên quên mật khẩu, tôi cần cho họ vào lại". Việc đó dùng "Đổi mật khẩu":
 * đặt một chuỗi hai bên cùng biết, hoặc sinh một chuỗi tạm đọc một lần.
 */
import { KeyRound, ShieldAlert } from "lucide-react"
import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { AccountSummary } from "@/services/contracts"
import { accountState, fmtAccountTimestamp, portalPath, roleLabel } from "../accounts-model"

interface Props {
  account: AccountSummary
  /** Mở thẳng hộp thoại đổi mật khẩu, hoặc `null` khi phiên không được phép. */
  onChangePassword: (() => void) | null
  onClose: () => void
}

export function AccountDetailDialog({ account, onChangePassword, onClose }: Props) {
  const state = accountState(account)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="admin-portal adm-dialog gap-0 border-[var(--adm-border)] p-0"
        data-testid="admin-account-detail-dialog"
      >
        <div className="grid gap-4 p-6">
          <div className="grid gap-1">
            <DialogTitle className="adm-h2">Thông tin tài khoản</DialogTitle>
            <DialogDescription className="adm-body text-[var(--adm-text-muted)]">
              Mọi thông tin hệ thống đang giữ về tài khoản này.
            </DialogDescription>
          </div>

          <dl className="grid gap-0">
            <Row label="Tên hiển thị">{account.displayName}</Row>
            <Row label="Tên đăng nhập">@{account.username}</Row>
            <Row label="Vai trò">{roleLabel(account)}</Row>
            {account.accessLevel ? (
              <Row label="Cấp truy cập">{account.accessLevel === "READ_ONLY" ? "Chỉ xem" : "Toàn quyền"}</Row>
            ) : null}
            <Row label="Cổng đăng nhập">{portalPath(account)}</Row>
            <Row label="Trạng thái">{state.label}</Row>
            <Row label="Đăng nhập gần nhất">{fmtAccountTimestamp(account.lastLoginAt)}</Row>
            <Row label="Mã tài khoản">#{account.id}</Row>
          </dl>

          <section className="grid gap-2 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-canvas)] p-4">
            <p className="adm-label flex items-center gap-2">
              <ShieldAlert className="size-4 shrink-0" />
              Mật khẩu hiện tại
            </p>
            <p className="adm-body text-[var(--adm-text-muted)]">
              Không xem được, kể cả bằng tài khoản SuperAdmin. Hệ thống chỉ lưu bản băm một chiều của mật khẩu, nên
              không có chỗ nào đọc ngược ra chuỗi gốc. Nhân viên quên mật khẩu thì đặt lại một mật khẩu mới cho họ.
            </p>
            {onChangePassword ? (
              <button
                type="button"
                onClick={onChangePassword}
                className="adm-body inline-flex h-11 items-center gap-2 justify-self-start rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-4"
                data-testid="admin-detail-change-password"
              >
                <KeyRound className="size-4" /> Đổi mật khẩu
              </button>
            ) : (
              <p className="adm-label text-[var(--adm-text-muted)]">
                Tài khoản của bạn không được phép đổi mật khẩu của tài khoản này.
              </p>
            )}
          </section>

          <button
            type="button"
            onClick={onClose}
            className="adm-body h-11 justify-self-start rounded-lg border border-[var(--adm-border)] px-4"
          >
            Đóng
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-[var(--adm-border)] py-2.5 last:border-0">
      <dt className="adm-label text-[var(--adm-text-muted)]">{label}</dt>
      <dd className="adm-body min-w-0 break-words">{children}</dd>
    </div>
  )
}
