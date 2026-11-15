/**
 * TU-34 — Form tạo tài khoản.
 *
 * Mật khẩu do máy chủ sinh, không có ô nhập: mật khẩu do người quản trị nghĩ
 * ra giữa ca luôn là một chuỗi dễ đoán, và tài khoản mới dù sao cũng bị buộc
 * đổi ở lần đăng nhập đầu. Mật khẩu tạm hiện đúng một lần trong panel này;
 * tải lại trang là mất, phải reset để lấy chuỗi mới.
 */
import { Copy, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
      <section className="adm-card grid gap-3 p-5">
        <h2 className="adm-h2">Mật khẩu tạm của {issued.username}</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Chuỗi này chỉ hiện một lần. Gửi cho nhân viên; hệ thống sẽ bắt họ đổi mật khẩu ngay lần đăng nhập đầu.
        </p>
        <code className="adm-h2 rounded-lg bg-[var(--adm-surface-sunken)] px-4 py-3 tracking-widest">
          {issued.password}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(issued.password)
                .then(() => toast.success("Đã chép mật khẩu tạm."))
                .catch(() => toast.error("Trình duyệt không cho chép tự động. Hãy chọn và chép tay."))
            }}
            className="adm-body inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--adm-border)] px-4"
          >
            <Copy className="size-4" /> Chép
          </button>
          <button
            type="button"
            onClick={() => {
              setIssued(null)
              onClose()
            }}
            className="adm-body h-10 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)]"
          >
            Đã ghi lại, đóng
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="adm-card grid gap-3 p-5">
      <h2 className="adm-h2">Tạo tài khoản</h2>
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
          <div className="grid gap-1.5">
            <span className="adm-label">Vai trò</span>
            <div className="flex flex-wrap gap-2">
              {roles.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setRoleCode(item.code)}
                  aria-pressed={role === item.code}
                  className="adm-body h-10 rounded-lg border px-3"
                  style={{
                    borderColor: role === item.code ? "var(--adm-action)" : "var(--adm-border)",
                    background: role === item.code ? "var(--adm-tint-blue)" : "var(--adm-surface)",
                    color: role === item.code ? "var(--adm-action)" : "var(--adm-text)",
                  }}
                >
                  {ADMIN_ROLE_LABEL[item.code] ?? item.name}
                </button>
              ))}
            </div>
          </div>
          {role === "ADMIN" ? (
            <div className="grid gap-1.5">
              <span className="adm-label">Cấp truy cập Admin</span>
              <div className="flex gap-2">
                {(["WRITE", "READ_ONLY"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setAccessLevel(level)}
                    aria-pressed={accessLevel === level}
                    className="adm-body h-10 rounded-lg border px-3"
                    style={{
                      borderColor: accessLevel === level ? "var(--adm-action)" : "var(--adm-border)",
                      background: accessLevel === level ? "var(--adm-tint-blue)" : "var(--adm-surface)",
                      color: accessLevel === level ? "var(--adm-action)" : "var(--adm-text)",
                    }}
                  >
                    {level === "WRITE" ? "Admin Edit" : "Admin Read-Only"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready || pending}
              onClick={submit}
              className="adm-body inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : null} Tạo tài khoản
            </button>
            <button
              type="button"
              onClick={onClose}
              className="adm-body h-11 rounded-lg border border-[var(--adm-border)] px-4"
            >
              Hủy
            </button>
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
      <label htmlFor={id} className="adm-label">
        {label}
      </label>
      <input
        id={id}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="adm-body h-11 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-3"
      />
    </div>
  )
}
