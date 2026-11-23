/**
 * TU-34 — 02 · Tài khoản & phân quyền.
 *
 * Bố cục theo prototype: thanh tìm + chip lọc + nút tạo, bảng tài khoản bên
 * trái, bảng checkbox quyền bên phải. Checkbox chứ không phải droplist — đây
 * là yêu cầu 08/11, vì droplist giấu mất việc một người đang có những quyền
 * gì cho tới khi mở ra.
 *
 * Mọi nút thao tác đều làm mờ theo quyền, nhưng server mới là nơi chặn thật:
 * `canActOn` chỉ tránh cho người dùng bấm vào thứ chắc chắn sẽ bị từ chối.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  Eye,
  KeyRound,
  LoaderCircle,
  Lock,
  LockOpen,
  MoreHorizontal,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { reportError } from "@/hooks/use-action"
import { api } from "@/services"
import type { AccountSummary } from "@/services/contracts"
import { useSession } from "@/state/session"
import {
  ACCOUNT_FILTERS,
  accountState,
  canActOn,
  filterAccounts,
  filterCounts,
  portalPath,
  roleLabel,
} from "../accounts-model"
import { groupPayload, groupStates } from "../permission-groups"
import { useAdminSession } from "../use-admin-session"
import { CreateAccountForm } from "./accounts-create-form"
import { AccountDetailDialog } from "./accounts-detail-dialog"
import { PasswordResetDialog } from "./accounts-password-dialog"

const TONE_DOT: Record<string, string> = {
  active: "var(--adm-state-inuse)",
  readonly: "var(--adm-state-soon)",
  locked: "var(--adm-state-late)",
}

const TONE_BADGE_CLASS: Record<string, string> = {
  active: "border-transparent bg-[var(--adm-tint-green)] text-[var(--admin-state-inuse-ink)]",
  readonly: "border-transparent bg-[var(--adm-tint-amber)] text-[var(--admin-state-soon-ink)]",
  locked: "border-transparent bg-[var(--adm-tint-red)] text-[var(--admin-state-late-ink)]",
}

const accountsKey = ["admin", "accounts"] as const
const permissionsKey = (userId: number) => ["admin", "account-permissions", userId] as const

export default function AdminAccountsPage() {
  const { can, readOnly } = useAdminSession()
  const actorUserId = useSession((state) => state.user.id)
  const actorRole = useSession((state) => state.user.role)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [filterKey, setFilterKey] = useState("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  // Hai hộp thoại giữ ID chứ không giữ bản sao tài khoản: đổi mật khẩu làm
  // `version` tăng, bản sao cũ sẽ gửi lên version hết hạn ở lần bấm sau.
  const [passwordTargetId, setPasswordTargetId] = useState<number | null>(null)
  const [detailTargetId, setDetailTargetId] = useState<number | null>(null)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const menuTriggerRefs = useRef(new Map<number, HTMLButtonElement | null>())
  const switchingToPasswordRef = useRef(false)

  const openDetailDialog = (accountId: number, trigger: HTMLElement) => {
    dialogReturnFocusRef.current = trigger
    setDetailTargetId(accountId)
  }

  const openPasswordDialog = (accountId: number, trigger: HTMLElement | null) => {
    dialogReturnFocusRef.current = trigger
    setPasswordTargetId(accountId)
  }

  const accounts = useQuery({ queryKey: accountsKey, queryFn: () => api.listAccounts(), retry: false })
  const rows = filterAccounts(accounts.data?.accounts ?? [], filterKey, search)
  const counts = filterCounts(accounts.data?.accounts ?? [])
  const actor = { userId: actorUserId, role: actorRole, readOnly }

  // Chọn sẵn tài khoản đầu tiên để panel bên phải không trống khi mở màn.
  // Suy ra lúc render, không set state trong effect: dòng được chọn là hàm
  // của danh sách đang hiện, nên nó tự đúng khi lọc hoặc tìm làm đổi danh sách.
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0] ?? null

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountsKey })

  const byId = (id: number | null) =>
    id === null ? null : ((accounts.data?.accounts ?? []).find((item) => item.id === id) ?? null)
  const passwordTarget = byId(passwordTargetId)
  const detailTarget = byId(detailTargetId)

  const run = async (account: AccountSummary, operation: () => Promise<string>) => {
    if (busyId !== null) return
    setBusyId(account.id)
    try {
      toast.success(await operation())
      await refresh()
      await queryClient.invalidateQueries({ queryKey: permissionsKey(account.id) })
    } catch (error) {
      reportError(error)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid min-w-0 gap-4" data-testid="admin-accounts-page">
      <div data-adm-reveal className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full md:max-w-80 md:basis-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--adm-text-muted)]"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo tên hoặc tài khoản"
            aria-label="Tìm theo tên hoặc tài khoản"
            className="h-11 bg-[var(--adm-surface)] pl-10"
          />
        </div>
        <div
          role="group"
          aria-label="Lọc theo vai trò"
          className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 md:w-auto md:flex-wrap md:overflow-visible md:pb-0"
        >
          {ACCOUNT_FILTERS.map((filter) => {
            const active = filter.key === filterKey
            return (
              <Button
                key={filter.key}
                type="button"
                variant="outline"
                disabled={filter.unsupported}
                title={filter.unsupported ? "Vai trò Kho chưa có trong hệ thống phân quyền." : undefined}
                aria-pressed={active}
                onClick={() => setFilterKey(filter.key)}
                className={
                  active
                    ? "shrink-0 border-[var(--adm-action)] bg-[var(--adm-tint-blue)] text-[var(--adm-action-active)] hover:bg-[var(--adm-tint-blue-hover)] hover:text-[var(--adm-action-active)]"
                    : "shrink-0 bg-[var(--adm-surface)] text-[var(--adm-text)]"
                }
              >
                <span>{filter.label}</span>
                <span
                  className={
                    active
                      ? "rounded-full bg-[var(--adm-action)]/12 px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                      : "rounded-full bg-[var(--adm-surface-sunken)] px-1.5 py-0.5 text-xs font-medium text-[var(--adm-text-muted)] tabular-nums"
                  }
                >
                  {counts[filter.key] ?? 0}
                </span>
              </Button>
            )
          })}
        </div>
        <Button
          type="button"
          disabled={!can("user.manage") || readOnly}
          onClick={() => setCreating((open) => !open)}
          className="w-full sm:w-auto md:ml-auto"
        >
          <UserPlus className="size-4" aria-hidden />
          Tạo tài khoản
        </Button>
      </div>

      {creating ? (
        <CreateAccountForm
          roles={accounts.data?.roles ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => void refresh()}
        />
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <section data-adm-reveal className="adm-card min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="adm-h2">Danh sách tài khoản</h2>
              <p className="adm-supporting mt-0.5 text-[var(--adm-text-muted)]">
                SuperAdmin tạo Admin · Admin tạo tài khoản nhân viên
              </p>
            </div>
            {!accounts.isPending && !accounts.isError ? (
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {rows.length} tài khoản
              </Badge>
            ) : null}
          </div>

          {accounts.isPending ? (
            <div className="mt-5 grid gap-3" aria-busy="true">
              <p className="sr-only">Đang tải danh sách tài khoản…</p>
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : accounts.isError ? (
            <div className="mt-5 grid gap-2.5 rounded-xl border border-[var(--adm-state-late)]/25 bg-[var(--adm-tint-red)] p-4">
              <p className="adm-h3 flex items-center gap-2 text-[var(--admin-state-late-ink)]">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> Không tải được danh sách tài khoản
              </p>
              <p className="adm-body text-[var(--adm-text-muted)]">
                {accounts.error instanceof Error ? accounts.error.message : "Lỗi không xác định."}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void accounts.refetch()}
                className="justify-self-start bg-[var(--adm-surface)]"
              >
                Thử lại
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="adm-body mt-5 rounded-xl border border-dashed border-[var(--adm-border)] bg-[var(--adm-canvas)]/60 p-6 text-center text-[var(--adm-text-muted)]">
              {search || filterKey !== "all"
                ? "Không có tài khoản nào khớp bộ lọc."
                : "Chưa có tài khoản nào trong phạm vi quản lý."}
            </p>
          ) : (
            <>
              {/*
                Điện thoại và máy tính bảng (< 1024px): thẻ xếp chồng, mọi trường và thao tác >= 44px.
                Ngưỡng là `lg` chứ không phải `md`: ở 768px bảng 5 cột cộng 4 nút thao tác bị dồn
                thành ba hàng nút, cao hơn cả hàng dữ liệu và khó bấm. Thẻ vốn được thiết kế cho
                bề ngang hẹp nên tablet dùng thẻ là đúng chỗ.
              */}
              <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 lg:hidden">
                {rows.map((account) => {
                  const state = accountState(account)
                  const allowed = canActOn(actor, account) && can("user.manage")
                  const busy = busyId === account.id
                  const locked = account.status === "DISABLED"
                  const isSelected = selected?.id === account.id
                  return (
                    <li
                      key={account.id}
                      className={
                        isSelected
                          ? "grid min-w-0 gap-3 rounded-xl border border-[var(--adm-action)] bg-[var(--adm-tint-blue)]/45 p-3.5 shadow-xs"
                          : "grid min-w-0 gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-surface)] p-3.5"
                      }
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="adm-h3 truncate text-[var(--adm-text)]">{account.displayName}</p>
                          <p className="adm-caption truncate text-[var(--adm-text-muted)]">@{account.username}</p>
                        </div>
                        <Badge className={`shrink-0 ${TONE_BADGE_CLASS[state.tone]}`}>
                          <span
                            aria-hidden
                            className="size-1.5 rounded-full"
                            style={{ background: TONE_DOT[state.tone] }}
                          />
                          {state.label}
                        </Badge>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--adm-border-subtle)] py-2 text-xs text-[var(--adm-text-muted)]">
                        <span className="min-w-0 break-words">
                          Vai trò: <strong className="font-medium text-[var(--adm-text)]">{roleLabel(account)}</strong>
                        </span>
                        <span className="min-w-0 break-words">
                          Cổng: <code className="font-mono text-[var(--adm-text)]">{portalPath(account)}</code>
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          disabled={busy}
                          onClick={() => setSelectedId(account.id)}
                          className={
                            isSelected
                              ? "min-h-11 min-w-0 flex-1 basis-[120px] px-3"
                              : "min-h-11 min-w-0 flex-1 basis-[120px] bg-[var(--adm-surface-sunken)]/70 px-3 hover:bg-[var(--adm-surface-sunken)]"
                          }
                        >
                          <ShieldCheck className="size-4" aria-hidden /> Đổi quyền
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={(event) => openDetailDialog(account.id, event.currentTarget)}
                          className="min-h-11 min-w-0 flex-1 basis-[120px] bg-[var(--adm-surface)] px-3"
                        >
                          <Eye className="size-4" aria-hidden /> Xem
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!allowed || busy}
                          onClick={(event) => openPasswordDialog(account.id, event.currentTarget)}
                          className="min-h-11 min-w-0 flex-1 basis-[120px] bg-[var(--adm-surface)] px-3"
                        >
                          <KeyRound className="size-4" aria-hidden /> Đổi mật khẩu
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!allowed || busy}
                          onClick={() =>
                            void run(account, async () => {
                              await api.setAccountStatus(account.id, account.version, locked ? "ACTIVE" : "DISABLED")
                              return locked
                                ? "Đã mở khóa tài khoản."
                                : "Đã khóa tài khoản và thu hồi phiên đang đăng nhập."
                            })
                          }
                          className="min-h-11 min-w-0 flex-1 basis-[120px] bg-[var(--adm-surface)] px-3"
                        >
                          {locked ? (
                            <>
                              <LockOpen className="size-4" aria-hidden /> Mở khóa
                            </>
                          ) : (
                            <>
                              <Lock className="size-4" aria-hidden /> Khóa
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Máy tính (>= 1024px): Table primitive với cuộn ngang an toàn */}
              <div className="mt-4 hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2.5">Tài khoản</TableHead>
                      <TableHead className="px-2.5">Vai trò</TableHead>
                      <TableHead className="px-2.5">Cổng đăng nhập</TableHead>
                      <TableHead className="px-2.5">Trạng thái</TableHead>
                      <TableHead className="px-2.5 text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((account) => {
                      const state = accountState(account)
                      const allowed = canActOn(actor, account) && can("user.manage")
                      const busy = busyId === account.id
                      const locked = account.status === "DISABLED"
                      const isSelected = selected?.id === account.id
                      return (
                        <TableRow key={account.id} data-state={isSelected ? "selected" : undefined}>
                          <TableCell className="px-2.5 whitespace-normal">
                            <span className="block font-medium text-[var(--adm-text)]">{account.displayName}</span>
                            <span className="adm-caption block text-[var(--adm-text-muted)]">@{account.username}</span>
                          </TableCell>
                          <TableCell className="px-2.5">
                            <Badge variant="secondary">{roleLabel(account)}</Badge>
                          </TableCell>
                          <TableCell className="px-2.5 font-mono text-xs text-[var(--adm-text-muted)]">
                            {portalPath(account)}
                          </TableCell>
                          <TableCell className="px-2.5">
                            <Badge className={TONE_BADGE_CLASS[state.tone]}>
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full"
                                style={{ background: TONE_DOT[state.tone] }}
                              />
                              {state.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2.5 text-right whitespace-nowrap">
                            {/* UI-51: Một hàng thao tác chính + menu "..." cho Đổi mật khẩu và Khóa/Mở khóa. */}
                            <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant={isSelected ? "default" : "secondary"}
                                disabled={busy}
                                onClick={() => setSelectedId(account.id)}
                                className="h-11 px-2.5 xl:h-9"
                              >
                                Đổi quyền
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={(event) => openDetailDialog(account.id, event.currentTarget)}
                                className="h-11 px-2.5 xl:h-9"
                              >
                                Xem
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    ref={(node) => {
                                      menuTriggerRefs.current.set(account.id, node)
                                    }}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    aria-label={`Thao tác khác cho ${account.displayName}`}
                                    data-testid={`account-actions-menu-${account.id}`}
                                    className="size-11 p-0 xl:size-9"
                                  >
                                    <MoreHorizontal className="size-4" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="admin-portal">
                                  <DropdownMenuItem
                                    disabled={!allowed || busy}
                                    onSelect={() =>
                                      openPasswordDialog(account.id, menuTriggerRefs.current.get(account.id) ?? null)
                                    }
                                  >
                                    <KeyRound className="size-4" aria-hidden /> Đổi mật khẩu
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!allowed || busy}
                                    onSelect={() =>
                                      void run(account, async () => {
                                        await api.setAccountStatus(
                                          account.id,
                                          account.version,
                                          locked ? "ACTIVE" : "DISABLED",
                                        )
                                        return locked
                                          ? "Đã mở khóa tài khoản."
                                          : "Đã khóa tài khoản và thu hồi phiên đang đăng nhập."
                                      })
                                    }
                                  >
                                    {locked ? (
                                      <>
                                        <LockOpen className="size-4" aria-hidden /> Mở khóa
                                      </>
                                    ) : (
                                      <>
                                        <Lock className="size-4" aria-hidden /> Khóa
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>

        <PermissionPanel
          // TU-32: phân quyền là chức năng của riêng SuperAdmin.
          superAdmin={actorRole === "OWNER"}
          // key: đổi tài khoản thì panel dựng lại, nháp checkbox của người
          // trước không theo sang người sau.
          key={selected?.id ?? "none"}
          account={selected}
          canManage={can("user.manage") && !readOnly}
          actor={actor}
        />
      </div>

      <AccountDetailDialog
        open={detailTarget !== null}
        account={detailTarget}
        onChangePassword={
          detailTarget && canActOn(actor, detailTarget) && can("user.manage")
            ? () => {
                switchingToPasswordRef.current = true
                setDetailTargetId(null)
                setPasswordTargetId(detailTarget.id)
              }
            : null
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // Chuyển thẳng sang hộp thoại đổi mật khẩu: giữ focus trong hộp thoại mới,
          // không trả về nút "Xem" phía sau.
          if (switchingToPasswordRef.current) {
            switchingToPasswordRef.current = false
            return
          }
          const target = dialogReturnFocusRef.current
          dialogReturnFocusRef.current = null
          if (target?.isConnected) target.focus()
        }}
        onClose={() => {
          switchingToPasswordRef.current = false
          setDetailTargetId(null)
        }}
      />

      <PasswordResetDialog
        open={passwordTarget !== null}
        account={passwordTarget}
        onDone={() => void refresh()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = dialogReturnFocusRef.current
          dialogReturnFocusRef.current = null
          if (target?.isConnected) target.focus()
        }}
        onClose={() => setPasswordTargetId(null)}
      />
    </div>
  )
}

function PermissionPanel({
  account,
  canManage,
  superAdmin,
  actor,
}: {
  account: AccountSummary | null
  canManage: boolean
  superAdmin: boolean
  actor: { userId: number; role: string; readOnly: boolean }
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, boolean>>({})

  const query = useQuery({
    queryKey: permissionsKey(account?.id ?? 0),
    queryFn: () => api.getAccountPermissions(account!.id),
    // Admin Edit và Admin Read-Only không được xem bảng quyền; gọi API sẽ bị
    // 403, nên đừng gọi rồi hiện hộp lỗi đỏ như thể hệ thống hỏng.
    enabled: account !== null && superAdmin,
    retry: false,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!account) return
      await api.updateAccountPermissions(account.id, account.version, draft)
    },
    onSuccess: async () => {
      toast.success("Đã lưu thay đổi quyền.")
      setDraft({})
      await queryClient.invalidateQueries({ queryKey: permissionsKey(account?.id ?? 0) })
      await queryClient.invalidateQueries({ queryKey: accountsKey })
    },
    onError: reportError,
  })

  if (!superAdmin) {
    return (
      <section data-adm-reveal className="adm-card grid min-w-0 content-start gap-2 p-5">
        <h2 className="adm-h2">Quyền của tài khoản</h2>
        <p className="adm-supporting text-[var(--adm-text-muted)]">
          Chỉ SuperAdmin xem và đổi được bảng phân quyền. Tài khoản Admin dùng được mọi tính năng vận hành, nhưng không
          phân quyền cho người khác.
        </p>
      </section>
    )
  }

  if (!account) {
    return (
      <section data-adm-reveal className="adm-card grid min-w-0 content-start gap-2 p-5">
        <h2 className="adm-h2">Quyền của tài khoản</h2>
        <p className="adm-supporting text-[var(--adm-text-muted)]">
          Chọn một tài khoản trong danh sách để xem và sửa quyền.
        </p>
      </section>
    )
  }

  const states = groupStates(query.data?.permissions ?? [])
  const editable = superAdmin && canManage && canActOn(actor, account)
  const dirty = Object.keys(draft).length > 0

  return (
    <section data-adm-reveal className="adm-card grid min-w-0 content-start gap-3.5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="adm-h2 break-words">
            Quyền của: {account.displayName} ({roleLabel(account)})
          </h2>
          <p className="adm-supporting mt-0.5 text-[var(--adm-text-muted)]">
            Chỉ SuperAdmin được đổi quyền của Admin khác
          </p>
        </div>
        {dirty ? (
          <Badge className="shrink-0 border-transparent bg-[var(--adm-tint-amber)] text-[var(--admin-state-soon-ink)]">
            Chưa lưu
          </Badge>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="grid gap-2.5" aria-busy="true">
          <p className="sr-only">Đang tải quyền…</p>
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="adm-body rounded-xl border border-[var(--adm-state-late)]/25 bg-[var(--adm-tint-red)] p-3">
          {query.error instanceof Error ? query.error.message : "Không tải được quyền của tài khoản."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {states.map((state) => {
            const checked = state.group.codes.some((code) => code in draft)
              ? state.group.codes.every((code) => draft[code] ?? state.checked)
              : state.checked
            const disabled = !editable || state.unsupported || !state.editable || save.isPending
            const checkboxId = `perm-${account.id}-${state.group.key}`
            const rowClass = disabled
              ? "border-[var(--adm-border-subtle)] bg-[var(--adm-surface-sunken)]/55"
              : checked
                ? "border-[var(--adm-action)]/35 bg-[var(--adm-tint-blue)]/40"
                : "border-[var(--adm-border)] bg-[var(--adm-surface)] hover:border-[var(--adm-border-strong)]"
            return (
              <li key={state.group.key}>
                <label
                  htmlFor={checkboxId}
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${rowClass}`}
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) =>
                      setDraft((current) => ({ ...current, ...groupPayload(state, next === true) }))
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`adm-body block font-medium ${disabled ? "text-[var(--adm-text-muted)]" : "text-[var(--adm-text)]"}`}
                    >
                      {state.group.label}
                    </span>
                    {state.unsupported ? (
                      <span className="adm-caption mt-0.5 block">Chưa hỗ trợ — {state.group.unsupportedNote}</span>
                    ) : state.outOfCeiling ? (
                      <span className="adm-caption mt-0.5 block">Không cấp được cho loại tài khoản này.</span>
                    ) : !state.editable ? (
                      <span className="adm-caption mt-0.5 block">Quyền này không tắt được.</span>
                    ) : !state.checked ? (
                      <span className="adm-caption mt-0.5 block">Vai trò chưa có — tick để cấp thêm.</span>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <p className="adm-supporting rounded-xl border border-[var(--adm-border-subtle)] bg-[var(--adm-surface-sunken)]/70 p-3 text-[var(--adm-text-muted)]">
        Dùng checkbox thay cho droplist theo yêu cầu 08/11 của anh Luân. SuperAdmin cấp thêm được quyền ngoài vai trò
        của tài khoản; riêng cấu hình quán và ẩn danh khách thì không cấp lẻ cho ai, và Admin Read-Only chỉ nhận thêm
        quyền xem.
      </p>

      <Button
        type="button"
        disabled={!editable || !dirty || save.isPending}
        onClick={() => save.mutate()}
        className="w-full"
      >
        {save.isPending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <ShieldCheck className="size-4" aria-hidden />
        )}
        {save.isPending ? "Đang lưu…" : "Lưu thay đổi quyền"}
      </Button>
      {!editable ? (
        <p className="adm-caption flex items-center gap-1.5 text-[var(--adm-text-muted)]">
          <Check className="size-3.5 shrink-0" aria-hidden />
          Tài khoản của bạn chỉ được xem bảng quyền này.
        </p>
      ) : null}
    </section>
  )
}
