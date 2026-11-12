/**
 * BA-022 — account management (US-11).
 *
 * Only an account holding `user.manage` sees this; the server is the authority
 * and refuses anything else. Creating an account and locking or unlocking one
 * are the approved operations. Changing a role and resetting a password have no
 * approved contract yet, so no control for them is shown here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { GuardedButton, PendingTag, SectionTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ROLE_LABEL, type RoleCode } from "@/domain/enums"
import { toast } from "sonner"
import { reportError } from "@/hooks/use-action"
import { qk } from "@/hooks/use-data"
import { api } from "@/services"
import { useCan, useSession } from "@/state/session"

const PASSWORD_MIN = 12
const emptyDraft = { username: "", displayName: "", password: "", roleCode: "" }

export function AccountsSection() {
  const canManage = useCan("user.manage")
  const currentUserId = useSession((state) => state.user.id)
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)

  const accounts = useQuery({
    queryKey: qk.accounts,
    queryFn: () => api.listAccounts(),
    enabled: canManage,
    retry: false,
  })

  if (!canManage) return null

  const roles = accounts.data?.roles ?? []
  const liveServer = api.mode === "http"
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.accounts })
  const roleLabel = (code: string) => ROLE_LABEL[code as RoleCode] ?? code

  // Account changes are not undoable, so they do not use the MutationResult UX.
  const create = async () => {
    if (pending) return
    setPending(true)
    try {
      const roleCode = draft.roleCode || roles[0]?.code || ""
      const created = await api.createAccount({ ...draft, roleCode })
      toast.success(`Đã tạo tài khoản ${created.username}.`)
      // The password never stays in component state once it has been sent.
      setDraft(emptyDraft)
      setOpen(false)
      await refresh()
    } catch (error) {
      reportError(error)
    } finally {
      setPending(false)
    }
  }

  const toggle = async (id: number, version: number, status: "ACTIVE" | "DISABLED") => {
    if (pending) return
    setPending(true)
    try {
      const account = await api.setAccountStatus(id, version, status)
      toast.success(
        account.status === "DISABLED"
          ? `Đã khóa ${account.username}. Mọi phiên của tài khoản này đã kết thúc.`
          : `Đã mở khóa ${account.username}.`,
      )
      await refresh()
    } catch (error) {
      reportError(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="grid gap-2">
      <SectionTitle aside={accounts.isFetching ? <PendingTag>Đang tải</PendingTag> : null}>
        Tài khoản nhân viên
      </SectionTitle>
      <p className="text-xs text-subtle">
        Tạo tài khoản và khóa / mở khóa theo US-11. Khóa tài khoản kết thúc ngay mọi phiên đang đăng nhập của tài khoản
        đó. Đổi vai trò và đặt lại mật khẩu chưa có quyết định nghiệp vụ nên chưa mở ở đây.
      </p>
      {!liveServer ? (
        <p className="text-xs text-muted-foreground">Chế độ demo chỉ xem. Quản lý tài khoản thật cần máy chủ.</p>
      ) : null}
      {accounts.isError ? <p className="text-sm text-destructive">Không tải được danh sách tài khoản.</p> : null}

      <div className="scrollbar-thin overflow-x-auto rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Tài khoản</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="pr-4 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(accounts.data?.accounts ?? []).map((account) => (
              <TableRow key={account.id}>
                <TableCell className="pl-4">
                  <span className="font-medium">{account.displayName}</span>
                  <span className="ml-2 text-xs text-subtle">{account.username}</span>
                </TableCell>
                <TableCell className="text-sm">{account.roles.map(roleLabel).join(", ") || "—"}</TableCell>
                <TableCell className="text-sm">
                  {account.status === "ACTIVE" ? "Đang hoạt động" : "Đã khóa"}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <GuardedButton
                    permission="user.manage"
                    variant="outline"
                    size="sm"
                    disabled={pending || !liveServer || account.id === currentUserId}
                    disabledReason={
                      account.id === currentUserId ? "Không thể tự khóa tài khoản đang dùng" : null
                    }
                    onClick={() =>
                      void toggle(account.id, account.version, account.status === "ACTIVE" ? "DISABLED" : "ACTIVE")
                    }
                  >
                    {account.status === "ACTIVE" ? "Khóa" : "Mở khóa"}
                  </GuardedButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!open ? (
        <GuardedButton
          permission="user.manage"
          variant="outline"
          className="justify-self-start"
          disabled={!liveServer}
          onClick={() => setOpen(true)}
        >
          Tạo tài khoản
        </GuardedButton>
      ) : (
        <div className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="acc-username">Tên đăng nhập</Label>
            <Input
              id="acc-username"
              autoComplete="off"
              value={draft.username}
              onChange={(event) => setDraft((d) => ({ ...d, username: event.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-name">Tên hiển thị</Label>
            <Input
              id="acc-name"
              value={draft.displayName}
              onChange={(event) => setDraft((d) => ({ ...d, displayName: event.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-password">Mật khẩu ban đầu (tối thiểu {PASSWORD_MIN} ký tự)</Label>
            <Input
              id="acc-password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => setDraft((d) => ({ ...d, password: event.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Vai trò</Label>
            <ToggleGroup
              type="single"
              value={draft.roleCode || roles[0]?.code || ""}
              onValueChange={(value) => value && setDraft((d) => ({ ...d, roleCode: value }))}
              className="flex-wrap justify-start"
            >
              {roles.map((role) => (
                <ToggleGroupItem key={role.code} value={role.code} className="px-3">
                  {roleLabel(role.code)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <GuardedButton
              permission="user.manage"
              disabled={
                pending
                || !draft.username.trim()
                || !draft.displayName.trim()
                || draft.password.length < PASSWORD_MIN
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
      )}
    </section>
  )
}
