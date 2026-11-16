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
import { AlertTriangle, Check, LoaderCircle, Lock, LockOpen, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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

const TONE_DOT: Record<string, string> = {
  active: "var(--adm-state-inuse)",
  readonly: "var(--adm-state-soon)",
  locked: "var(--adm-state-late)",
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

  const accounts = useQuery({ queryKey: accountsKey, queryFn: () => api.listAccounts(), retry: false })
  const rows = filterAccounts(accounts.data?.accounts ?? [], filterKey, search)
  const counts = filterCounts(accounts.data?.accounts ?? [])
  const actor = { userId: actorUserId, role: actorRole, readOnly }

  // Chọn sẵn tài khoản đầu tiên để panel bên phải không trống khi mở màn.
  // Suy ra lúc render, không set state trong effect: dòng được chọn là hàm
  // của danh sách đang hiện, nên nó tự đúng khi lọc hoặc tìm làm đổi danh sách.
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0] ?? null

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountsKey })

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên hoặc tài khoản"
          aria-label="Tìm theo tên hoặc tài khoản"
          className="adm-body h-11 min-w-0 flex-1 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 md:max-w-80"
        />
        <div className="flex flex-wrap items-center gap-2">
          {ACCOUNT_FILTERS.map((filter) => {
            const active = filter.key === filterKey
            return (
              <button
                key={filter.key}
                type="button"
                disabled={filter.unsupported}
                title={filter.unsupported ? "Vai trò Kho chưa có trong hệ thống phân quyền." : undefined}
                aria-pressed={active}
                onClick={() => setFilterKey(filter.key)}
                className="adm-body h-11 rounded-lg border px-4 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  borderColor: active ? "var(--adm-action)" : "var(--adm-border)",
                  background: active ? "var(--adm-tint-blue)" : "var(--adm-surface)",
                  color: active ? "var(--adm-action)" : "var(--adm-text)",
                }}
              >
                {filter.label} {counts[filter.key] ?? 0}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          disabled={!can("user.manage") || readOnly}
          onClick={() => setCreating((open) => !open)}
          className="adm-body h-11 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)] disabled:cursor-not-allowed disabled:opacity-45 md:ml-auto"
        >
          Tạo tài khoản
        </button>
      </div>

      {creating ? (
        <CreateAccountForm
          roles={accounts.data?.roles ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => void refresh()}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="adm-card min-w-0 p-5">
          <h2 className="adm-h2">Danh sách tài khoản</h2>
          <p className="adm-body text-[var(--adm-text-muted)]">SuperAdmin tạo Admin · Admin tạo tài khoản nhân viên</p>

          {accounts.isPending ? (
            <p className="adm-body mt-6 flex items-center gap-2 text-[var(--adm-text-muted)]">
              <LoaderCircle className="size-4 animate-spin" /> Đang tải danh sách tài khoản…
            </p>
          ) : accounts.isError ? (
            <div className="mt-6 grid gap-2 rounded-lg bg-[var(--adm-tint-red)] p-4">
              <p className="adm-h3 flex items-center gap-2">
                <AlertTriangle className="size-4" /> Không tải được danh sách tài khoản
              </p>
              <p className="adm-body text-[var(--adm-text-muted)]">
                {accounts.error instanceof Error ? accounts.error.message : "Lỗi không xác định."}
              </p>
              <button
                type="button"
                onClick={() => void accounts.refetch()}
                className="adm-body h-10 justify-self-start rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] px-4"
              >
                Thử lại
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="adm-body mt-6 text-[var(--adm-text-muted)]">
              {search || filterKey !== "all"
                ? "Không có tài khoản nào khớp bộ lọc."
                : "Chưa có tài khoản nào trong phạm vi quản lý."}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[var(--adm-border)]">
                    {["Tài khoản", "Vai trò", "Cổng đăng nhập", "Trạng thái", "Thao tác"].map((head) => (
                      <th
                        key={head}
                        scope="col"
                        className="adm-label pb-2 tracking-wide text-[var(--adm-text-muted)] uppercase"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => {
                    const state = accountState(account)
                    const allowed = canActOn(actor, account) && can("user.manage")
                    const busy = busyId === account.id
                    const locked = account.status === "DISABLED"
                    return (
                      <tr
                        key={account.id}
                        className="border-b border-[var(--adm-border)] last:border-0"
                        style={selected?.id === account.id ? { background: "var(--adm-tint-blue)" } : undefined}
                      >
                        <td className="adm-body py-3 font-medium">
                          {account.displayName}
                          <span className="adm-label block text-[var(--adm-text-muted)]">@{account.username}</span>
                        </td>
                        <td className="adm-body py-3">{roleLabel(account)}</td>
                        <td className="adm-body py-3 text-[var(--adm-text-muted)]">{portalPath(account)}</td>
                        <td className="adm-body py-3">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2 rounded-full"
                              style={{ background: TONE_DOT[state.tone] }}
                            />
                            {state.label}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <RowButton
                              disabled={busy}
                              onClick={() => setSelectedId(account.id)}
                              active={selected?.id === account.id}
                            >
                              Đổi quyền
                            </RowButton>
                            <RowButton
                              disabled={!allowed || busy}
                              onClick={() =>
                                void run(account, async () => {
                                  const result = await api.resetAccountPassword(account.id, account.version)
                                  return result.temporaryPassword
                                    ? `Mật khẩu tạm của ${account.displayName}: ${result.temporaryPassword} — chỉ hiện một lần.`
                                    : "Đã đặt lại mật khẩu và thu hồi phiên cũ."
                                })
                              }
                            >
                              Đổi mật khẩu
                            </RowButton>
                            <RowButton
                              disabled={!allowed || busy}
                              onClick={() =>
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
                                  <LockOpen className="size-3.5" /> Mở khóa
                                </>
                              ) : (
                                <>
                                  <Lock className="size-3.5" /> Khóa
                                </>
                              )}
                            </RowButton>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
    </div>
  )
}

function RowButton({
  children,
  disabled,
  active,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="adm-label inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: active ? "var(--adm-tint-blue)" : "var(--adm-surface-sunken)",
        color: active ? "var(--adm-action)" : "var(--adm-text)",
      }}
    >
      {children}
    </button>
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
      <section className="adm-card grid gap-2 p-5">
        <h2 className="adm-h2">Quyền của tài khoản</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Chỉ SuperAdmin xem và đổi được bảng phân quyền. Tài khoản Admin dùng được mọi tính năng vận hành, nhưng không
          phân quyền cho người khác.
        </p>
      </section>
    )
  }

  if (!account) {
    return (
      <section className="adm-card grid gap-2 p-5">
        <h2 className="adm-h2">Quyền của tài khoản</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">Chọn một tài khoản trong danh sách để xem và sửa quyền.</p>
      </section>
    )
  }

  const states = groupStates(query.data?.permissions ?? [])
  const editable = superAdmin && canManage && canActOn(actor, account)
  const dirty = Object.keys(draft).length > 0

  return (
    <section className="adm-card grid content-start gap-3 p-5">
      <div>
        <h2 className="adm-h2">
          Quyền của: {account.displayName} ({roleLabel(account)})
        </h2>
        <p className="adm-body text-[var(--adm-text-muted)]">Chỉ SuperAdmin được đổi quyền của Admin khác</p>
      </div>

      {query.isPending ? (
        <p className="adm-body flex items-center gap-2 text-[var(--adm-text-muted)]">
          <LoaderCircle className="size-4 animate-spin" /> Đang tải quyền…
        </p>
      ) : query.isError ? (
        <p className="adm-body rounded-lg bg-[var(--adm-tint-red)] p-3">
          {query.error instanceof Error ? query.error.message : "Không tải được quyền của tài khoản."}
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {states.map((state) => {
            const checked = state.group.codes.some((code) => code in draft)
              ? state.group.codes.every((code) => draft[code] ?? state.checked)
              : state.checked
            const disabled = !editable || state.unsupported || !state.editable || save.isPending
            return (
              <li key={state.group.key}>
                <label className="adm-body flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, ...groupPayload(state, event.target.checked) }))
                    }
                    className="mt-1 size-4 accent-[var(--adm-action)] disabled:opacity-40"
                  />
                  <span className={disabled ? "text-[var(--adm-text-muted)]" : undefined}>
                    {state.group.label}
                    {state.unsupported ? (
                      <span className="adm-label block">Chưa hỗ trợ — {state.group.unsupportedNote}</span>
                    ) : state.outOfCeiling ? (
                      <span className="adm-label block">Không cấp được cho loại tài khoản này.</span>
                    ) : !state.editable ? (
                      <span className="adm-label block">Quyền này không tắt được.</span>
                    ) : !state.checked ? (
                      <span className="adm-label block">Vai trò chưa có — tick để cấp thêm.</span>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <p className="adm-body rounded-lg bg-[var(--adm-surface-sunken)] p-3 text-[var(--adm-text-muted)]">
        Dùng checkbox thay cho droplist theo yêu cầu 08/11 của anh Luân. SuperAdmin cấp thêm được quyền ngoài vai trò
        của tài khoản; riêng cấu hình quán và ẩn danh khách thì không cấp lẻ cho ai, và Admin Read-Only chỉ nhận thêm
        quyền xem.
      </p>

      <button
        type="button"
        disabled={!editable || !dirty || save.isPending}
        onClick={() => save.mutate()}
        className="adm-body inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--adm-action)] px-4 font-medium text-[var(--adm-text-invert)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {save.isPending ? "Đang lưu…" : "Lưu thay đổi quyền"}
      </button>
      {!editable ? (
        <p className="adm-label text-[var(--adm-text-muted)]">
          <Check className="mr-1 inline size-3" />
          Tài khoản của bạn chỉ được xem bảng quyền này.
        </p>
      ) : null}
    </section>
  )
}
