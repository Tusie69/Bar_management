/**
 * TU-34 — Màn bắt buộc đổi mật khẩu tạm.
 *
 * Tài khoản vừa được tạo hoặc vừa được reset đăng nhập bằng mật khẩu tạm.
 * Backend chặn mọi API nghiệp vụ bằng 403 PASSWORD_CHANGE_REQUIRED cho tới
 * khi đổi xong; nếu web không chặn ở cửa thì người dùng sẽ vào app rồi gặp
 * lỗi ở từng thao tác mà không hiểu vì sao.
 */
import { KeyRound, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import { useSession } from "@/state/session"

const PASSWORD_MIN = 12

export function PasswordChangeGate() {
  const expire = useSession((state) => state.expire)
  const logout = useSession((state) => state.logout)
  const displayName = useSession((state) => state.principal?.displayName ?? "")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword
  const ready =
    currentPassword.length > 0 && newPassword.length >= PASSWORD_MIN && !mismatch && confirmPassword.length > 0

  const submit = () => {
    if (pending || !ready) return
    setPending(true)
    void api
      .changeOwnPassword(currentPassword, newPassword)
      // Đổi mật khẩu thu hồi mọi phiên, kể cả phiên này: đăng nhập lại bằng
      // mật khẩu mới là bước cuối, không phải lỗi.
      .then(() => expire("Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới."))
      .catch(reportError)
      .finally(() => setPending(false))
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="grid w-full max-w-md gap-4 rounded-3xl border bg-surface-1 p-6 shadow-xl">
        <div className="grid gap-1.5">
          <KeyRound className="size-8 text-primary-ink" />
          <h1 className="text-xl font-semibold">Đổi mật khẩu trước khi tiếp tục</h1>
          <p className="text-sm text-muted-foreground">
            {displayName ? `${displayName}, tài khoản ` : "Tài khoản "}
            đang dùng mật khẩu tạm. Hãy đặt mật khẩu riêng của bạn; trước khi đổi, các chức năng khác đều bị khóa.
          </p>
        </div>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-current">Mật khẩu tạm</Label>
            <Input
              id="pwd-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-new">Mật khẩu mới (tối thiểu {PASSWORD_MIN} ký tự)</Label>
            <Input
              id="pwd-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-confirm">Nhập lại mật khẩu mới</Label>
            <Input
              id="pwd-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={mismatch}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {mismatch ? <p className="text-xs text-destructive">Hai ô mật khẩu chưa giống nhau.</p> : null}
          </div>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : null} Đổi mật khẩu
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => void logout()}>
            Đăng xuất
          </Button>
        </form>
      </section>
    </main>
  )
}
