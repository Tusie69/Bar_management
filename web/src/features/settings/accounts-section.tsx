import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { GuardedButton, PendingTag, SectionTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ROLE_LABEL, type RoleCode } from "@/domain/enums"
import { reportError } from "@/hooks/use-action"
import { qk } from "@/hooks/use-data"
import { api } from "@/services"
import { useCan, useSession } from "@/state/session"

const PASSWORD_MIN = 12
type AccessLevel = "WRITE" | "READ_ONLY"
const emptyDraft = { username: "", displayName: "", password: "", roleCode: "", accessLevel: "WRITE" as AccessLevel }

export function AccountsSection({ readOnly = false }: { readOnly?: boolean } = {}) {
  const canReadFromHook = useCan("user.read")
  const canManageFromHook = useCan("user.manage")
  const hasPrincipal = useSession((state) => state.principal !== null)
  const serverPermissions = useSession((state) => state.permissions)
  const canRead = api.mode === "http" || hasPrincipal ? serverPermissions.includes("user.read") : canReadFromHook
  const canManage =
    !readOnly && (api.mode === "http" || hasPrincipal ? serverPermissions.includes("user.manage") : canManageFromHook)
  const currentUserId = useSession((state) => state.user.id)
  const currentRole = useSession((state) => state.user.role)
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [resetTarget, setResetTarget] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState("")

  const accounts = useQuery({
    queryKey: qk.accounts,
    queryFn: () => api.listAccounts(),
    enabled: canRead,
    retry: false,
  })
  const roles = accounts.data?.roles ?? []
  const liveServer = api.mode === "http"
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.accounts })
  const roleLabel = (code: string) => ROLE_LABEL[code as RoleCode] ?? code

  const run = async (operation: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    try {
      await operation()
    } catch (error) {
      reportError(error)
    } finally {
      setPending(false)
    }
  }

  const create = () =>
    run(async () => {
      const roleCode = draft.roleCode || roles[0]?.code || ""
      const created = await api.createAccount({
        username: draft.username,
        displayName: draft.displayName,
        password: draft.password,
        roleCode,
        ...(roleCode === "ADMIN" ? { accessLevel: draft.accessLevel } : {}),
      })
      toast.success(`Đã tạo tài khoản ${created.account.username}.`)
      setDraft(emptyDraft)
      setOpen(false)
      await refresh()
    })

  if (!canRead) return <OwnPasswordSection />

  return (
    <div className="grid gap-5">
      <OwnPasswordSection />
      <section className="grid gap-2">
        <SectionTitle aside={accounts.isFetching ? <PendingTag>Đang tải</PendingTag> : null}>
          Quản lý tài khoản
        </SectionTitle>
        <p className="text-xs text-subtle">
          OWNER quản lý ADMIN và nhân viên. ADMIN WRITE chỉ quản lý nhân viên; ADMIN READ_ONLY chỉ xem. Đổi quyền hoặc
          mật khẩu sẽ kết thúc các phiên hiện hữu của tài khoản mục tiêu.
        </p>
        {!liveServer ? <p className="text-xs text-muted-foreground">Chế độ demo chỉ xem.</p> : null}
        {accounts.isError ? <p className="text-sm text-destructive">Không tải được danh sách tài khoản.</p> : null}

        <div className="scrollbar-thin overflow-x-auto rounded-xl border border-border bg-surface-1 shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tài khoản</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Truy cập</TableHead>
                <TableHead>Trạng thái</TableHead>
                {canManage ? <TableHead className="pr-4 text-right">Thao tác</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(accounts.data?.accounts ?? []).map((account) => {
                const isOwnerTarget = account.roles.includes("OWNER")
                const isAdminTarget = account.roles.includes("ADMIN")
                const canTarget =
                  canManage &&
                  account.id !== currentUserId &&
                  !isOwnerTarget &&
                  (currentRole === "OWNER" || !isAdminTarget)
                return (
                  <TableRow key={account.id}>
                    <TableCell className="pl-4">
                      <span className="font-medium">{account.displayName}</span>
                      <span className="ml-2 text-xs text-subtle">{account.username}</span>
                    </TableCell>
                    <TableCell className="text-sm">{account.roles.map(roleLabel).join(", ") || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {account.accessLevel === "READ_ONLY" ? "Chỉ xem" : account.accessLevel === "WRITE" ? "Ghi" : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {account.status === "ACTIVE" ? "Đang hoạt động" : "Đã khóa"}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="pr-4 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {isAdminTarget && currentRole === "OWNER" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canTarget || pending}
                              onClick={() =>
                                void run(async () => {
                                  await api.setAdminAccessLevel(
                                    account.id,
                                    account.version,
                                    account.accessLevel === "WRITE" ? "READ_ONLY" : "WRITE",
                                  )
                                  toast.success("Đã đổi cấp truy cập và thu hồi phiên cũ.")
                                  await refresh()
                                })
                              }
                            >
                              Đổi sang {account.accessLevel === "WRITE" ? "Chỉ xem" : "Ghi"}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canTarget || pending}
                            onClick={() => {
                              setResetTarget(account.id)
                              setResetPassword("")
                            }}
                          >
                            Đặt lại mật khẩu
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canTarget || pending}
                            onClick={() =>
                              void run(async () => {
                                await api.setAccountStatus(
                                  account.id,
                                  account.version,
                                  account.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                                )
                                toast.success(
                                  account.status === "ACTIVE" ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.",
                                )
                                await refresh()
                              })
                            }
                          >
                            {account.status === "ACTIVE" ? "Khóa" : "Mở khóa"}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {canManage && resetTarget !== null ? (
          <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto_auto]">
            <Input
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              placeholder={`Mật khẩu mới, tối thiểu ${PASSWORD_MIN} ký tự`}
              onChange={(event) => setResetPassword(event.target.value)}
            />
            <Button
              disabled={pending || resetPassword.length < PASSWORD_MIN}
              onClick={() =>
                void run(async () => {
                  const account = accounts.data?.accounts.find((item) => item.id === resetTarget)
                  if (!account) return
                  await api.resetAccountPassword(account.id, account.version, resetPassword)
                  setResetTarget(null)
                  setResetPassword("")
                  toast.success("Đã đặt lại mật khẩu và thu hồi phiên cũ.")
                  await refresh()
                })
              }
            >
              Xác nhận
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setResetTarget(null)
                setResetPassword("")
              }}
            >
              Hủy
            </Button>
          </div>
        ) : null}

        {canManage ? (
          !open ? (
            <GuardedButton
              permission="user.manage"
              variant="outline"
              className="justify-self-start"
              disabled={!liveServer || roles.length === 0}
              onClick={() => setOpen(true)}
            >
              Tạo tài khoản
            </GuardedButton>
          ) : (
            <div className="grid gap-3 rounded-xl border border-border bg-surface-1 p-4 shadow-xs sm:grid-cols-2">
              <Field
                id="acc-username"
                label="Tên đăng nhập"
                value={draft.username}
                onChange={(value) => setDraft((item) => ({ ...item, username: value }))}
              />
              <Field
                id="acc-name"
                label="Tên hiển thị"
                value={draft.displayName}
                onChange={(value) => setDraft((item) => ({ ...item, displayName: value }))}
              />
              <Field
                id="acc-password"
                label={`Mật khẩu ban đầu (tối thiểu ${PASSWORD_MIN} ký tự)`}
                value={draft.password}
                type="password"
                onChange={(value) => setDraft((item) => ({ ...item, password: value }))}
              />
              <div className="grid gap-1.5">
                <Label>Vai trò</Label>
                <ToggleGroup
                  type="single"
                  value={draft.roleCode || roles[0]?.code || ""}
                  onValueChange={(value) => value && setDraft((item) => ({ ...item, roleCode: value }))}
                  className="flex-wrap justify-start"
                >
                  {roles.map((role) => (
                    <ToggleGroupItem key={role.code} value={role.code}>
                      {roleLabel(role.code)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              {(draft.roleCode || roles[0]?.code) === "ADMIN" ? (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Cấp truy cập ADMIN</Label>
                  <ToggleGroup
                    type="single"
                    value={draft.accessLevel}
                    onValueChange={(value) =>
                      value && setDraft((item) => ({ ...item, accessLevel: value as AccessLevel }))
                    }
                  >
                    <ToggleGroupItem value="WRITE">Ghi</ToggleGroupItem>
                    <ToggleGroupItem value="READ_ONLY">Chỉ xem</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              ) : null}
              <div className="flex gap-2 sm:col-span-2">
                <GuardedButton
                  permission="user.manage"
                  disabled={
                    pending ||
                    !draft.username.trim() ||
                    !draft.displayName.trim() ||
                    draft.password.length < PASSWORD_MIN
                  }
                  onClick={() => void create()}
                >
                  Tạo tài khoản
                </GuardedButton>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(emptyDraft)
                    setOpen(false)
                  }}
                >
                  Hủy
                </Button>
              </div>
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={type === "password" ? "new-password" : "off"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function OwnPasswordSection() {
  const expire = useSession((state) => state.expire)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [pending, setPending] = useState(false)
  if (api.mode !== "http") return null
  return (
    <section className="grid gap-2">
      <SectionTitle>Đổi mật khẩu của tôi</SectionTitle>
      <div className="grid gap-2 rounded-2xl border p-4 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Mật khẩu hiện tại"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={`Mật khẩu mới, tối thiểu ${PASSWORD_MIN} ký tự`}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Button
          disabled={pending || !currentPassword || newPassword.length < PASSWORD_MIN}
          onClick={() => {
            if (pending) return
            setPending(true)
            void api
              .changeOwnPassword(currentPassword, newPassword)
              .then(() => {
                expire("Đã đổi mật khẩu. Vui lòng đăng nhập lại.")
              })
              .catch(reportError)
              .finally(() => setPending(false))
          }}
        >
          Đổi mật khẩu
        </Button>
      </div>
    </section>
  )
}
