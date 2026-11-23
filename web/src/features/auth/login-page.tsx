import { Construction, Eye, EyeOff, Info, LogIn, ShieldCheck } from "lucide-react"
import { type FocusEvent, type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PORTAL_CONFIG, resolvePortalLoginDestination, type AuthPortal } from "@/domain/auth-portal"
import { sessionEndUnsavedWarning } from "@/domain/session-end"
import { cn } from "@/lib/utils"
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
  preparation:
    "Tài khoản Bar và Bếp dùng chung cổng đăng nhập, nhưng mỗi tài khoản chỉ thấy và xử lý đúng quầy đã được cấp quyền.",
}

function keepFocusedFieldVisible(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.scrollIntoView({ block: "nearest" })
}

export function LoginPage({ portal, redirectTo }: { portal: AuthPortal; redirectTo?: string | null }) {
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
  const [touched, setTouched] = useState({ username: false, password: false })
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const usernameMissing = !username.trim()
  const passwordMissing = !password
  const submitDisabled = pending || usernameMissing || passwordMissing
  const showUsernameHint = (touched.username || submitAttempted) && usernameMissing
  const showPasswordHint = (touched.password || submitAttempted) && passwordMissing

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (usernameMissing || passwordMissing) {
      setSubmitAttempted(true)
      return
    }
    setPending(true)
    setError(null)
    setTouched({ username: false, password: false })
    setSubmitAttempted(false)
    try {
      await login(username.trim(), password, portal)
      setPassword("")
      const currentUrl =
        typeof window === "undefined"
          ? undefined
          : `${window.location.pathname}${window.location.search}${window.location.hash}`
      const queryRedirect =
        typeof window === "undefined"
          ? null
          : (new URLSearchParams(window.location.search).get("redirect") ??
            new URLSearchParams(window.location.search).get("next"))
      window.location.replace(resolvePortalLoginDestination(portal, currentUrl, redirectTo ?? queryRedirect))
    } catch (cause) {
      setPassword("")
      setError(isApiError(cause) ? cause.message : "Không thể đăng nhập. Vui lòng thử lại.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-4 sm:py-8">
      <div className="mx-auto my-auto grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-5 shadow-md sm:gap-5 sm:p-8">
        <header className="grid gap-2.5 text-center">
          <img
            src="/21gam-logo.png"
            alt="21GAM"
            className="mx-auto size-12 rounded-xl border border-border-subtle object-cover shadow-xs sm:size-14"
          />
          <div className="grid gap-1">
            <h1 className="text-[1.375rem] leading-tight font-bold tracking-[-0.022em] text-foreground sm:text-2xl">
              Đăng nhập {PORTAL_CONFIG[portal].label}
            </h1>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground sm:text-sm">
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
        <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-surface-2/80 px-3.5 py-2.5 text-xs leading-relaxed text-tx-2">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary-ink" aria-hidden="true" />
          <p>{PORTAL_NOTE[portal]}</p>
        </div>

        <form className="grid gap-3.5 sm:gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="username">Tên đăng nhập</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onFocus={keepFocusedFieldVisible}
              onBlur={() => setTouched((prev) => ({ ...prev, username: true }))}
              aria-invalid={showUsernameHint || undefined}
              aria-describedby={showUsernameHint ? "username-hint" : undefined}
              disabled={pending}
              required
              className="h-11 scroll-my-4"
            />
            {showUsernameHint ? (
              <p
                id="username-hint"
                className="text-[length:var(--type-error-size)] leading-[var(--type-error-lh)] font-medium text-destructive"
              >
                Vui lòng nhập tên đăng nhập.
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
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
                onFocus={keepFocusedFieldVisible}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                aria-invalid={showPasswordHint || undefined}
                aria-describedby={showPasswordHint ? "password-hint" : undefined}
                disabled={pending}
                required
                className="h-11 scroll-my-4 pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-pressed={showPassword}
                title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute top-0 right-0 size-11 rounded-l-none rounded-r-md text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            {showPasswordHint ? (
              <p
                id="password-hint"
                className="text-[length:var(--type-error-size)] leading-[var(--type-error-lh)] font-medium text-destructive"
              >
                Vui lòng nhập mật khẩu.
              </p>
            ) : null}
          </div>
          {error || sessionMessage ? (
            <div
              role="alert"
              className="grid gap-1 rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-2.5 text-sm leading-snug text-foreground"
            >
              <p className="font-medium">{error ?? sessionMessage}</p>
              {!error && unsavedWarning ? <p className="text-xs text-muted-foreground">{unsavedWarning}</p> : null}
            </div>
          ) : null}
          <div
            className={cn("w-full", submitDisabled && !pending && "cursor-not-allowed")}
            onClick={() => {
              if (!pending && (usernameMissing || passwordMissing)) {
                setSubmitAttempted(true)
              }
            }}
          >
            <Button type="submit" size="default" disabled={submitDisabled} className="w-full">
              <LogIn className="size-4" aria-hidden="true" />
              {pending ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </div>
        </form>

        <p className="flex items-center justify-center gap-2 border-t border-border-subtle pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <span>Phiên đăng nhập được bảo vệ.</span>
        </p>
      </div>
    </main>
  )
}

export function PortalUnderConstruction({ label }: { label: string }) {
  return (
    <main className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-6">
      <section className="mx-auto my-auto grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-md sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
          <Construction className="size-7 text-amber-500" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] sm:text-2xl">Cổng {label} đang xây dựng</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Vai trò và quyền truy cập của cổng này đang chờ phê duyệt. Hệ thống chưa cho phép đăng nhập tại đây.
          </p>
        </div>
      </section>
    </main>
  )
}
