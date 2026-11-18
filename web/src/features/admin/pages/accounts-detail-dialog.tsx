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
import { type ReactNode, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { AccountSummary } from "@/services/contracts"
import { accountState, fmtAccountTimestamp, portalPath, roleLabel } from "../accounts-model"

interface Props {
  open: boolean
  account: AccountSummary | null
  /** Mở thẳng hộp thoại đổi mật khẩu, hoặc `null` khi phiên không được phép. */
  onChangePassword: (() => void) | null
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}

const STATE_BADGE_CLASS: Record<string, string> = {
  active: "border-transparent bg-[var(--adm-tint-green)] text-[var(--admin-state-inuse-ink)]",
  readonly: "border-transparent bg-[var(--adm-tint-amber)] text-[var(--admin-state-soon-ink)]",
  locked: "border-transparent bg-[var(--adm-tint-red)] text-[var(--admin-state-late-ink)]",
}

export function AccountDetailDialog({ open, account, onChangePassword, onClose, onCloseAutoFocus }: Props) {
  // Giữ snapshot trong khi đang đóng để dialog chạy hết exit animation mà không chớp rỗng.
  const [snapshot, setSnapshot] = useState<{ account: AccountSummary; canChange: boolean } | null>(
    account ? { account, canChange: Boolean(onChangePassword) } : null,
  )
  if (account && (account !== snapshot?.account || Boolean(onChangePassword) !== snapshot?.canChange)) {
    setSnapshot({ account, canChange: Boolean(onChangePassword) })
  }
  const displayAccount = account ?? snapshot?.account ?? null
  const showChangePassword = account ? Boolean(onChangePassword) : Boolean(snapshot?.canChange)
  if (!displayAccount) return null

  const state = accountState(displayAccount)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="admin-portal adm-dialog gap-0 border-[var(--adm-border)] p-0"
        data-testid="admin-account-detail-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="grid gap-4 p-5 sm:p-6">
          <DialogHeader className="text-left">
            <div className="flex flex-wrap items-center gap-2 pr-10">
              <DialogTitle className="adm-h2">Thông tin tài khoản</DialogTitle>
              <Badge className={STATE_BADGE_CLASS[state.tone]}>{state.label}</Badge>
            </div>
            <DialogDescription className="adm-supporting text-[var(--adm-text-muted)]">
              Mọi thông tin hệ thống đang giữ về tài khoản này.
            </DialogDescription>
          </DialogHeader>

          <dl className="grid gap-0 rounded-xl border border-[var(--adm-border-subtle)] bg-[var(--adm-surface)] px-4">
            <Row label="Tên hiển thị">{displayAccount.displayName}</Row>
            <Row label="Tên đăng nhập">@{displayAccount.username}</Row>
            <Row label="Vai trò">{roleLabel(displayAccount)}</Row>
            {displayAccount.accessLevel ? (
              <Row label="Cấp truy cập">{displayAccount.accessLevel === "READ_ONLY" ? "Chỉ xem" : "Toàn quyền"}</Row>
            ) : null}
            <Row label="Cổng đăng nhập">{portalPath(displayAccount)}</Row>
            <Row label="Trạng thái">{state.label}</Row>
            <Row label="Đăng nhập gần nhất">{fmtAccountTimestamp(displayAccount.lastLoginAt)}</Row>
            <Row label="Mã tài khoản">#{displayAccount.id}</Row>
          </dl>

          <section className="grid gap-2.5 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-canvas)] p-4">
            <p className="adm-label flex items-center gap-2 text-[var(--adm-text)]">
              <ShieldAlert className="size-4 shrink-0 text-[var(--adm-state-soon)]" aria-hidden />
              Mật khẩu hiện tại
            </p>
            <p className="adm-supporting text-[var(--adm-text-muted)]">
              Không xem được, kể cả bằng tài khoản SuperAdmin. Hệ thống chỉ lưu bản băm một chiều của mật khẩu, nên
              không có chỗ nào đọc ngược ra chuỗi gốc. Nhân viên quên mật khẩu thì đặt lại một mật khẩu mới cho họ.
            </p>
            {showChangePassword ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onChangePassword?.()}
                className="justify-self-start bg-[var(--adm-surface)]"
                data-testid="admin-detail-change-password"
              >
                <KeyRound className="size-4" aria-hidden /> Đổi mật khẩu
              </Button>
            ) : (
              <p className="adm-caption text-[var(--adm-text-muted)]">
                Tài khoản của bạn không được phép đổi mật khẩu của tài khoản này.
              </p>
            )}
          </section>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[var(--adm-border-subtle)] py-2.5 last:border-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="adm-label text-[var(--adm-text-muted)]">{label}</dt>
      <dd className="adm-body min-w-0 break-words">{children}</dd>
    </div>
  )
}
