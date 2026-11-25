/**
 * TU-34 — Màn bắt buộc đổi mật khẩu tạm.
 *
 * Tài khoản vừa được tạo hoặc vừa được reset đăng nhập bằng mật khẩu tạm.
 * Backend chặn mọi API nghiệp vụ bằng 403 PASSWORD_CHANGE_REQUIRED cho tới
 * khi đổi xong; nếu web không chặn ở cửa thì người dùng sẽ vào app rồi gặp
 * lỗi ở từng thao tác mà không hiểu vì sao.
 */
import { Eye, EyeOff, KeyRound, LoaderCircle, LogOut } from "lucide-react"
import { type FocusEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import { useSession } from "@/state/session"

const PASSWORD_MIN = 12

function keepFocusedFieldVisible(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget
  input.form?.querySelector<HTMLElement>('button[type="submit"]')?.scrollIntoView({ block: "nearest" })
  input.scrollIntoView({ block: "nearest" })
}

export function PasswordChangeGate() {
  const expire = useSession((state) => state.expire)
  const logout = useSession((state) => state.logout)
  const displayName = useSession((state) => state.principal?.displayName ?? "")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  // Hai ô mật khẩu MỚI có nút hiện riêng, giống màn đăng nhập. Người dùng phải
  // gõ đúng 12 ký tự hai lần trên bàn phím điện thoại; gõ mù thì "Hai ô mật
  // khẩu chưa giống nhau" không nói được ô nào sai, và cách duy nhất còn lại là
  // xoá hết gõ lại. Ô "Mật khẩu tạm" giữ nguyên: nó được dán từ nơi khác sang.
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
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
    <main className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-4 sm:py-8 [@media(max-height:560px)]:py-2">
      <section className="mx-auto my-auto grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-5 shadow-md sm:gap-5 sm:p-8 [@media(max-height:560px)]:gap-2.5 [@media(max-height:560px)]:p-3.5">
        <div className="grid gap-2">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-tint text-primary-ink">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Đổi mật khẩu trước khi tiếp tục</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {displayName ? `${displayName}, tài khoản ` : "Tài khoản "}
            đang dùng mật khẩu tạm. Hãy đặt mật khẩu riêng của bạn; trước khi đổi, các chức năng khác đều bị khóa.
          </p>
        </div>
        <form
          className="grid gap-3.5"
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
              onFocus={keepFocusedFieldVisible}
              className="h-11 scroll-mt-4 scroll-mb-20"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-new">Mật khẩu mới (tối thiểu {PASSWORD_MIN} ký tự)</Label>
            <div className="relative">
              <Input
                id="pwd-new"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                onFocus={keepFocusedFieldVisible}
                className="h-11 scroll-mt-4 scroll-mb-20 pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowNew((visible) => !visible)}
                aria-label={showNew ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                aria-pressed={showNew}
                title={showNew ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                className="absolute top-0 right-0 size-11 rounded-l-none rounded-r-md text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                {showNew ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-confirm">Nhập lại mật khẩu mới</Label>
            <div className="relative">
              <Input
                id="pwd-confirm"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={mismatch}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                onFocus={keepFocusedFieldVisible}
                className="h-11 scroll-mt-4 scroll-mb-20 pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowConfirm((visible) => !visible)}
                aria-label={showConfirm ? "Ẩn mật khẩu nhập lại" : "Hiện mật khẩu nhập lại"}
                aria-pressed={showConfirm}
                title={showConfirm ? "Ẩn mật khẩu nhập lại" : "Hiện mật khẩu nhập lại"}
                className="absolute top-0 right-0 size-11 rounded-l-none rounded-r-md text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                {showConfirm ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            {mismatch ? <p className="text-xs font-medium text-destructive">Hai ô mật khẩu chưa giống nhau.</p> : null}
          </div>
          <div className="grid gap-2 pt-1">
            <Button type="submit" disabled={!ready || pending} className="w-full">
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              Đổi mật khẩu
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void logout()} className="w-full">
              <LogOut className="size-4" aria-hidden="true" />
              Đăng xuất
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}
