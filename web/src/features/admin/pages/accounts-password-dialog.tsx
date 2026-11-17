/**
 * TU-34 — Hộp thoại "Đổi mật khẩu" của một tài khoản.
 *
 * Trước đây bấm "Đổi mật khẩu" là máy chủ sinh luôn một chuỗi ngẫu nhiên,
 * không hỏi gì. Nhanh, nhưng sai trong tình huống hay gặp nhất: Chủ quán đứng
 * cạnh nhân viên và muốn đặt một mật khẩu hai bên cùng biết ngay tại chỗ.
 *
 * Hai lối ra của hộp thoại này KHÔNG tương đương nhau, và đó là lý do chúng
 * không nằm chung một nút:
 * - Tự nhập: máy chủ ghi đúng chuỗi đó và KHÔNG bật `must_change_password`,
 *   nên nhân viên dùng luôn mật khẩu vừa được đọc cho.
 * - Sinh ngẫu nhiên: máy chủ bật `must_change_password`, nhân viên buộc phải
 *   đổi ở lần đăng nhập đầu. Chuỗi chỉ hiện đúng một lần ở đây.
 *
 * Cả hai đều thu hồi mọi phiên đang đăng nhập của tài khoản đó.
 */
import { Copy, Eye, EyeOff, LoaderCircle, ShieldAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import type { AccountSummary } from "@/services/contracts"
import { newPasswordIssue, PASSWORD_MIN, roleLabel } from "../accounts-model"

interface Props {
  account: AccountSummary
  onClose: () => void
  onDone: () => void
}

export function PasswordResetDialog({ account, onClose, onDone }: Props) {
  const [password, setPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState<"manual" | "random" | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const issue = newPasswordIssue(password)
  const canSubmit = issue === null && pending === null

  const reset = (newPassword?: string) => {
    if (pending !== null) return
    setPending(newPassword === undefined ? "random" : "manual")
    void api
      .resetAccountPassword(account.id, account.version, newPassword)
      .then((result) => {
        onDone()
        if (newPassword === undefined) {
          // Chuỗi này không đọc lại được ở bất kỳ đâu, nên giữ hộp thoại mở
          // cho tới khi người dùng tự bấm đóng.
          setIssued(result.temporaryPassword)
          return
        }
        toast.success(`Đã đổi mật khẩu của ${account.displayName} và thu hồi phiên cũ.`)
        onClose()
      })
      .catch(reportError)
      .finally(() => setPending(null))
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="admin-portal adm-dialog gap-0 border-[var(--adm-border)] p-0"
        data-testid="admin-password-dialog"
      >
        <div className="grid gap-4 p-6">
          <div className="grid gap-1">
            <DialogTitle className="adm-h2">Đổi mật khẩu</DialogTitle>
            <DialogDescription className="adm-body text-[var(--adm-text-muted)]">
              {account.displayName} (@{account.username}) · {roleLabel(account)}
            </DialogDescription>
          </div>

          {issued !== null ? (
            <IssuedPassword password={issued} onClose={onClose} />
          ) : (
            <>
              <div className="grid gap-1.5">
                <label htmlFor="adm-new-password" className="adm-label">
                  Mật khẩu mới
                </label>
                <div className="flex gap-2">
                  <input
                    id="adm-new-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    disabled={pending !== null}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder={`Tối thiểu ${PASSWORD_MIN} ký tự`}
                    className="adm-body h-11 min-w-0 flex-1 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-3"
                    data-testid="admin-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((current) => !current)}
                    aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--adm-border)]"
                  >
                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {touched && issue ? (
                  <p className="adm-label text-[var(--adm-state-late)]" role="alert">
                    {issue}
                  </p>
                ) : (
                  <p className="adm-label text-[var(--adm-text-muted)]">
                    Nhân viên dùng luôn mật khẩu này, hệ thống không bắt đổi lại.
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => reset(password)}
                className="adm-body inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)] disabled:cursor-not-allowed disabled:opacity-45"
                data-testid="admin-password-submit"
              >
                {pending === "manual" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Đặt mật khẩu này
              </button>

              <div className="grid gap-2 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-canvas)] p-4">
                <p className="adm-label">Hoặc để hệ thống sinh một chuỗi ngẫu nhiên</p>
                <p className="adm-body text-[var(--adm-text-muted)]">
                  Chuỗi 16 ký tự, chỉ hiện một lần. Nhân viên sẽ bị bắt đổi mật khẩu ngay lần đăng nhập đầu.
                </p>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => reset()}
                  className="adm-body inline-flex h-11 items-center justify-center gap-2 justify-self-start rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 disabled:cursor-not-allowed disabled:opacity-45"
                  data-testid="admin-password-random"
                >
                  {pending === "random" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  Tạo mật khẩu ngẫu nhiên
                </button>
              </div>

              <p className="adm-label flex items-start gap-2 text-[var(--adm-text-muted)]">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                Dù chọn cách nào, mọi phiên đang đăng nhập của tài khoản này đều bị thu hồi.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function IssuedPassword({ password, onClose }: { password: string | null; onClose: () => void }) {
  if (!password) {
    return (
      <div className="grid gap-3">
        <p className="adm-body">Đã đổi mật khẩu và thu hồi phiên cũ, nhưng máy chủ không trả về chuỗi tạm.</p>
        <button
          type="button"
          onClick={onClose}
          className="adm-body h-11 justify-self-start rounded-lg border border-[var(--adm-border)] px-4"
        >
          Đóng
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-3" data-testid="admin-password-issued">
      <p className="adm-body text-[var(--adm-text-muted)]">
        Chuỗi này chỉ hiện một lần, không đọc lại được ở bất kỳ đâu. Ghi lại rồi mới đóng.
      </p>
      <code className="adm-h2 rounded-lg bg-[var(--adm-surface-sunken)] px-4 py-3 tracking-widest">{password}</code>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(password)
              .then(() => toast.success("Đã chép mật khẩu tạm."))
              .catch(() => toast.error("Trình duyệt không cho chép tự động. Hãy chọn và chép tay."))
          }}
          className="adm-body inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--adm-border)] px-4"
        >
          <Copy className="size-4" /> Chép
        </button>
        <button
          type="button"
          onClick={onClose}
          className="adm-body h-11 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)]"
        >
          Đã ghi lại, đóng
        </button>
      </div>
    </div>
  )
}
