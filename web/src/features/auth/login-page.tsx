import { Construction, Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PORTAL_CONFIG, type AuthPortal } from "@/domain/auth-portal"
import { sessionEndUnsavedWarning } from "@/domain/session-end"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"

/**
 * Ghi chú cổng riêng, theo prototype màn 00. Mỗi cổng liệt kê đúng những vai
 * KHÔNG vào được ở đây, để nhân viên biết mình phải gõ URL nào.
 */
const PORTAL_NOTE: Record<AuthPortal, string> = {
  admin: "Mỗi vai trò đăng nhập ở cổng riêng. Tài khoản Thu ngân, Lễ tân, Phục vụ không đăng nhập được tại cổng này.",
  receptionist:
    "Mỗi vai trò đăng nhập ở cổng riêng. Tài khoản Quản trị, Thu ngân, Phục vụ không đăng nhập được tại cổng này.",
  cashier: "Mỗi vai trò đăng nhập ở cổng riêng. Tài khoản Quản trị, Lễ tân, Phục vụ không đăng nhập được tại cổng này.",
  waiter: "Mỗi vai trò đăng nhập ở cổng riêng. Tài khoản Quản trị, Lễ tân, Thu ngân không đăng nhập được tại cổng này.",
  "customer-care": "Mỗi vai trò đăng nhập ở cổng riêng. Tài khoản của vai khác không đăng nhập được tại cổng này.",
}

export function LoginPage({ portal }: { portal: AuthPortal }) {
  const login = useSession((state) => state.login)
  const sessionMessage = useSession((state) => state.authError)
  const sessionEndCode = useSession((state) => state.authEndCode)
  // TU-33: hệ thống chưa có cơ chế lưu nháp, nên khi phiên bị đẩy ra giữa lúc
  // đang gõ thì phải nói rõ là mất, không để nhân viên tự suy ra là còn.
  const unsavedWarning = sessionEndCode ? sessionEndUnsavedWarning(sessionEndCode) : null
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    setPending(true)
    setError(null)
    try {
      await login(username.trim(), password, portal)
      setPassword("")
      window.location.replace(PORTAL_CONFIG[portal].home)
    } catch (cause) {
      setPassword("")
      setError(isApiError(cause) ? cause.message : "Không thể đăng nhập. Vui lòng thử lại.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="grid w-full max-w-md gap-6 rounded-3xl border bg-surface-1 p-6 shadow-xl sm:p-8">
        <header className="grid gap-3 text-center">
          <img src="/21gam-logo.png" alt="21GAM" className="mx-auto size-14 rounded-xl object-cover" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Đăng nhập {PORTAL_CONFIG[portal].label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Chỉ tài khoản được cấp quyền cho cổng {PORTAL_CONFIG[portal].label.toLocaleLowerCase("vi-VN")} mới có thể
              đăng nhập.
            </p>
          </div>
        </header>

        {/*
          TU-32 AC: prototype màn "00 · Đăng nhập /admin" yêu cầu nói rõ mỗi vai
          có cổng riêng. Nhân viên gõ nhầm cổng là chuyện xảy ra hằng tuần, và
          "sai tên đăng nhập hoặc mật khẩu" là câu trả lời sai cho việc đó.
        */}
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-tx-2">{PORTAL_NOTE[portal]}</p>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="username">Tên đăng nhập</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mật khẩu</Label>
            {/* Lễ tân gõ mật khẩu trên bàn phím điện thoại giữa ca đông, gõ sai
                mà không thấy gì thì chỉ còn cách xoá hết gõ lại. */}
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                required
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-pressed={showPassword}
                title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {error || sessionMessage ? (
            <div
              role="alert"
              className="grid gap-1 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
            >
              <p>{error ?? sessionMessage}</p>
              {!error && unsavedWarning ? <p className="text-xs text-muted-foreground">{unsavedWarning}</p> : null}
            </div>
          ) : null}
          <Button type="submit" size="lg" disabled={pending || !username.trim() || !password}>
            <LogIn /> {pending ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </form>

        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" /> Phiên đăng nhập dùng cookie HttpOnly và CSRF protection.
        </p>
      </div>
    </main>
  )
}

export function PortalUnderConstruction({ label }: { label: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="grid w-full max-w-md gap-4 rounded-3xl border bg-surface-1 p-8 text-center shadow-xl">
        <Construction className="mx-auto size-12 text-amber-500" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold">Cổng {label} đang xây dựng</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vai trò và quyền truy cập của cổng này đang chờ phê duyệt. Hệ thống chưa cho phép đăng nhập tại đây.
          </p>
        </div>
      </section>
    </main>
  )
}
