import { LogIn, ShieldCheck } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"

export function LoginPage() {
  const login = useSession((state) => state.login)
  const sessionMessage = useSession((state) => state.authError)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    setPending(true)
    setError(null)
    try {
      await login(username.trim(), password)
      setPassword("")
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
            <h1 className="text-2xl font-semibold tracking-tight">Đăng nhập 21GAM</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sử dụng tài khoản vận hành do quản trị viên cấp.</p>
          </div>
        </header>

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
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          {error || sessionMessage ? (
            <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {error ?? sessionMessage}
            </p>
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
