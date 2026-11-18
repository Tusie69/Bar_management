/**
 * TU-34 — Form tạo tài khoản.
 *
 * Mật khẩu do máy chủ sinh, không có ô nhập: mật khẩu do người quản trị nghĩ
 * ra giữa ca luôn là một chuỗi dễ đoán, và tài khoản mới dù sao cũng bị buộc
 * đổi ở lần đăng nhập đầu. Mật khẩu tạm hiện đúng một lần trong panel này;
 * tải lại trang là mất, phải reset để lấy chuỗi mới.
 */
import { Copy, LoaderCircle, UserPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import { ADMIN_ROLE_LABEL } from "../accounts-model"

interface Props {
  roles: { code: string; name: string }[]
  onClose: () => void
  onCreated: () => void
}

export function CreateAccountForm({ roles, onClose, onCreated }: Props) {
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [roleCode, setRoleCode] = useState(roles[0]?.code ?? "")
  const [accessLevel, setAccessLevel] = useState<"WRITE" | "READ_ONLY">("WRITE")
  const [pending, setPending] = useState(false)
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null)

  const role = roleCode || roles[0]?.code || ""
  const ready = username.trim().length > 0 && displayName.trim().length > 0 && role.length > 0

  const submit = () => {
    if (pending || !ready) return
    setPending(true)
    void api
      .createAccount({
        username: username.trim(),
        displayName: displayName.trim(),
        roleCode: role,
        ...(role === "ADMIN" ? { accessLevel } : {}),
      })
      .then((result) => {
        toast.success(`Đã tạo tài khoản ${result.account.username}.`)
        setIssued(
          result.temporaryPassword ? { username: result.account.username, password: result.temporaryPassword } : null,
        )
        setUsername("")
        setDisplayName("")
        onCreated()
      })
      .catch(reportError)
      .finally(() => setPending(false))
  }

  if (issued) {
    return (
      <section className="adm-card grid gap-4 p-5">
        <div className="grid gap-1">
          <h2 className="adm-h2">Mật khẩu tạm của {issued.username}</h2>
          <p className="adm-supporting text-[var(--adm-text-muted)]">
            Chuỗi này chỉ hiện một lần. Gửi cho nhân viên; hệ thống sẽ bắt họ đổi mật khẩu ngay lần đăng nhập đầu.
          </p>
        </div>
        <code className="adm-h2 rounded-xl border border-[var(--adm-action)]/25 bg-[var(--adm-tint-blue)]/45 px-4 py-3 text-center tracking-widest break-all select-all">
          {issued.password}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(issued.password)
                .then(() => toast.success("Đã chép mật khẩu tạm."))
                .catch(() => toast.error("Trình duyệt không cho chép tự động. Hãy chọn và chép tay."))
            }}
          >
            <Copy className="size-4" aria-hidden /> Chép
          </Button>
          <Button
            type="button"
            onClick={() => {
              setIssued(null)
              onClose()
            }}
          >
            Đã ghi lại, đóng
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="adm-card grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="adm-h2">Tạo tài khoản</h2>
        <p className="adm-supporting text-[var(--adm-text-muted)]">
          Hệ thống tự sinh mật khẩu tạm một lần; nhân viên sẽ đổi mật khẩu khi đăng nhập lần đầu.
        </p>
      </div>
      {roles.length === 0 ? (
        <p className="adm-body text-[var(--adm-text-muted)]">
          Tài khoản của bạn không được phép tạo vai trò nào trong phạm vi này.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="acc-username" label="Tên đăng nhập" value={username} onChange={setUsername} />
            <Field id="acc-display" label="Tên hiển thị" value={displayName} onChange={setDisplayName} />
          </div>
          <div className="grid gap-2">
            <span className="adm-label">Vai trò</span>
            <div className="flex flex-wrap gap-2">
              {roles.map((item) => {
                const selected = role === item.code
                return (
                  <Button
                    key={item.code}
                    type="button"
                    variant="outline"
                    onClick={() => setRoleCode(item.code)}
                    aria-pressed={selected}
                    className={
                      selected
                        ? "border-[var(--adm-action)] bg-[var(--adm-tint-blue)] text-[var(--adm-action)] hover:bg-[var(--adm-tint-blue-hover)]"
                        : "bg-[var(--adm-surface)]"
                    }
                  >
                    {ADMIN_ROLE_LABEL[item.code] ?? item.name}
                  </Button>
                )
              })}
            </div>
          </div>
          {role === "ADMIN" ? (
            <div className="grid gap-2">
              <span className="adm-label">Cấp truy cập Admin</span>
              <div className="flex flex-wrap gap-2">
                {(["WRITE", "READ_ONLY"] as const).map((level) => {
                  const selected = accessLevel === level
                  return (
                    <Button
                      key={level}
                      type="button"
                      variant="outline"
                      onClick={() => setAccessLevel(level)}
                      aria-pressed={selected}
                      className={
                        selected
                          ? "border-[var(--adm-action)] bg-[var(--adm-tint-blue)] text-[var(--adm-action)] hover:bg-[var(--adm-tint-blue-hover)]"
                          : "bg-[var(--adm-surface)]"
                      }
                    >
                      {level === "WRITE" ? "Admin Edit" : "Admin Read-Only"}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" disabled={!ready || pending} onClick={submit}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <UserPlus className="size-4" aria-hidden />
              )}
              Tạo tài khoản
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="adm-label">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="h-11 bg-[var(--adm-surface)]"
      />
    </div>
  )
}
