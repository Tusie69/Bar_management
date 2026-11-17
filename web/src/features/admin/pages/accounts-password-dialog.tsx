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
import { Copy, Eye, EyeOff, KeyRound, LoaderCircle, ShieldAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import type { AccountSummary } from "@/services/contracts"
import { newPasswordIssue, PASSWORD_MIN, roleLabel } from "../accounts-model"

interface Props {
  open: boolean
  account: AccountSummary | null
  onClose: () => void
  onDone: () => void
  onCloseAutoFocus?: (event: Event) => void
}

export function PasswordResetDialog({ open, account, onClose, onDone, onCloseAutoFocus }: Props) {
  const [snapshot, setSnapshot] = useState<AccountSummary | null>(account)
  const [password, setPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState<"manual" | "random" | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // Mỗi lần mở, đóng, chuyển tài khoản hoặc mở lại đều cấp một generation mới để
  // kết quả bất đồng bộ cũ không bao giờ ghi đè phiên hộp thoại hiện tại.
  const sessionKey = open && account ? `open:${account.id}` : "closed"
  const [prevSessionKey, setPrevSessionKey] = useState<string>(sessionKey)
  const [sessionGeneration, setSessionGeneration] = useState<number>(() => (open && account ? 1 : 0))
  const activeSessionRef = useRef<number | null>(open && account ? sessionGeneration : null)
  const mountedRef = useRef(true)

  if (account && account !== snapshot) {
    setSnapshot(account)
  }

  // Đặt lại form mỗi lần mở cho một tài khoản (giữ nguyên trạng thái khi đang chạy exit).
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    setSessionGeneration((current) => current + 1)
    if (sessionKey !== "closed") {
      setPassword("")
      setVisible(false)
      setPending(null)
      setIssued(null)
      setTouched(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const accountId = account?.id ?? null
  useEffect(() => {
    activeSessionRef.current = open && accountId !== null ? sessionGeneration : null
    return () => {
      activeSessionRef.current = null
    }
  }, [open, accountId, sessionGeneration])

  const displayAccount = account ?? snapshot
  if (!displayAccount) return null

  const issue = newPasswordIssue(password)
  const canSubmit = issue === null && pending === null

  const handleClose = () => {
    activeSessionRef.current = null
    onClose()
  }

  const reset = (newPassword?: string) => {
    if (!open || !account || pending !== null) return
    const targetAccount = account
    const requestSession = sessionGeneration
    activeSessionRef.current = requestSession
    setPending(newPassword === undefined ? "random" : "manual")
    void api
      .resetAccountPassword(targetAccount.id, targetAccount.version, newPassword)
      .then((result) => {
        if (mountedRef.current) {
          onDone()
        }
        if (activeSessionRef.current !== requestSession) return
        setPending(null)
        if (newPassword === undefined) {
          // Chuỗi này không đọc lại được ở bất kỳ đâu, nên giữ hộp thoại mở
          // cho tới khi người dùng tự bấm đóng.
          setIssued(result.temporaryPassword)
          return
        }
        toast.success(`Đã đổi mật khẩu của ${targetAccount.displayName} và thu hồi phiên cũ.`)
        handleClose()
      })
      .catch((error) => {
        if (activeSessionRef.current !== requestSession) return
        setPending(null)
        reportError(error)
      })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <DialogContent
        className="admin-portal adm-dialog gap-0 border-[var(--adm-border)] p-0"
        data-testid="admin-password-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="grid gap-4 p-5 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="adm-h2 pr-10">Đổi mật khẩu</DialogTitle>
            <DialogDescription className="adm-supporting text-[var(--adm-text-muted)]">
              {displayAccount.displayName} (@{displayAccount.username}) · {roleLabel(displayAccount)}
            </DialogDescription>
          </DialogHeader>

          {issued !== null ? (
            <IssuedPassword password={issued} onClose={handleClose} />
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="adm-new-password" className="adm-label">
                  Mật khẩu mới
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="adm-new-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    disabled={pending !== null}
                    aria-invalid={touched && issue !== null}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder={`Tối thiểu ${PASSWORD_MIN} ký tự`}
                    className="h-11 min-w-0 flex-1 bg-[var(--adm-surface)]"
                    data-testid="admin-password-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setVisible((current) => !current)}
                    aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    aria-pressed={visible}
                    className="shrink-0 bg-[var(--adm-surface)]"
                  >
                    {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </Button>
                </div>
                {touched && issue ? (
                  <p className="adm-error" role="alert">
                    {issue}
                  </p>
                ) : (
                  <p className="adm-caption text-[var(--adm-text-muted)]">
                    Nhân viên dùng luôn mật khẩu này, hệ thống không bắt đổi lại.
                  </p>
                )}
              </div>

              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => reset(password)}
                className="w-full"
                data-testid="admin-password-submit"
              >
                {pending === "manual" ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="size-4" aria-hidden />
                )}
                Đặt mật khẩu này
              </Button>

              <div className="grid gap-2.5 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-canvas)] p-4">
                <p className="adm-label text-[var(--adm-text)]">Hoặc để hệ thống sinh một chuỗi ngẫu nhiên</p>
                <p className="adm-supporting text-[var(--adm-text-muted)]">
                  Chuỗi 16 ký tự, chỉ hiện một lần. Nhân viên sẽ bị bắt đổi mật khẩu ngay lần đăng nhập đầu.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => reset()}
                  className="justify-self-start bg-[var(--adm-surface)]"
                  data-testid="admin-password-random"
                >
                  {pending === "random" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  Tạo mật khẩu ngẫu nhiên
                </Button>
              </div>

              <p className="adm-caption flex items-start gap-2 text-[var(--adm-text-muted)]">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--adm-state-soon)]" aria-hidden />
                <span>Dù chọn cách nào, mọi phiên đang đăng nhập của tài khoản này đều bị thu hồi.</span>
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
        <Button type="button" variant="outline" onClick={onClose} className="justify-self-start">
          Đóng
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-3" data-testid="admin-password-issued">
      <p className="adm-supporting text-[var(--adm-text-muted)]">
        Chuỗi này chỉ hiện một lần, không đọc lại được ở bất kỳ đâu. Ghi lại rồi mới đóng.
      </p>
      <code className="adm-h2 rounded-xl border border-[var(--adm-action)]/25 bg-[var(--adm-tint-blue)]/45 px-4 py-3 text-center tracking-widest break-all select-all">
        {password}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(password)
              .then(() => toast.success("Đã chép mật khẩu tạm."))
              .catch(() => toast.error("Trình duyệt không cho chép tự động. Hãy chọn và chép tay."))
          }}
        >
          <Copy className="size-4" aria-hidden /> Chép
        </Button>
        <Button type="button" onClick={onClose} className="ml-auto">
          Đã ghi lại, đóng
        </Button>
      </div>
    </div>
  )
}
