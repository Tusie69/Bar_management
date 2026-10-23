import { Check, Lock, Minus } from "lucide-react"
import { useState } from "react"
import { GroupSymbolIcon, GuardedButton, PendingTag, SectionTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PERMISSION_GROUPS, PERMISSION_LABEL, PERMISSION_MATRIX } from "@/domain/access"
import { ROLE_LABEL, type RoleCode } from "@/domain/enums"
import type { VenueConfig } from "@/domain/models"
import { DDL_TABLES } from "@/domain/schema"
import { GROUP_SYMBOLS } from "@/domain/symbols"
import { useAction } from "@/hooks/use-action"
import { useCatalog } from "@/hooks/use-data"
import { cn } from "@/lib/utils"
import { api, REST_ENDPOINTS } from "@/services"
import { useCan, useSession } from "@/state/session"

const ROLES: RoleCode[] = ["OWNER_ADMIN", "RECEPTIONIST", "CUSTOMER_CARE", "CASHIER"]

export default function SettingsPage() {
  const canConfigure = useCan("venue.configure")
  return (
    <div className="h-full scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-5 p-4 md:p-6">
        {!canConfigure ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            <Lock className="size-4" /> Chế độ chỉ xem. Chỉ Chủ quán / Admin thay đổi được cấu hình (quyền
            venue.configure).
          </p>
        ) : null}
        <Tabs defaultValue="venue" className="gap-5">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
            <TabsTrigger value="venue" className="px-4">
              Vận hành
            </TabsTrigger>
            <TabsTrigger value="floor" className="px-4">
              Khu & bàn
            </TabsTrigger>
            <TabsTrigger value="access" className="px-4">
              Phân quyền
            </TabsTrigger>
            <TabsTrigger value="integration" className="px-4">
              Tích hợp
            </TabsTrigger>
          </TabsList>
          <TabsContent value="venue">
            <VenueSettings readOnly={!canConfigure} />
          </TabsContent>
          <TabsContent value="floor">
            <FloorSettings readOnly={!canConfigure} />
          </TabsContent>
          <TabsContent value="access">
            <AccessSettings />
          </TabsContent>
          <TabsContent value="integration">
            <IntegrationSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Row({
  label,
  hint,
  pending,
  children,
}: {
  label: string
  hint?: string
  pending?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {label}
          {pending ? <PendingTag /> : null}
        </p>
        {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function NumberField({
  id,
  value,
  onChange,
  unit,
  disabled,
  min,
  max,
  label,
}: {
  id: string
  value: number
  onChange: (v: number) => void
  unit: string
  disabled: boolean
  min: number
  max: number
  label: string
}) {
  return (
    <span className="flex items-center gap-2">
      <Input
        id={id}
        aria-label={`${label} (${unit})`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="h-11 w-24 text-right"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="min-w-10 text-sm whitespace-nowrap text-muted-foreground">{unit}</span>
    </span>
  )
}

function VenueSettings({ readOnly }: { readOnly: boolean }) {
  const catalog = useCatalog()
  const v = catalog.data?.venue
  if (!v) return null
  return <VenueForm key={v.version} v={v} readOnly={readOnly} />
}

const formFrom = (v: VenueConfig) => ({
  late: v.lateWarningMinutes,
  noShow: v.noShowWarningMinutes,
  hold: v.waitlistHoldDefaultMinutes,
  lease: v.waitlistClaimLeaseSeconds,
  policy: v.reservationHoldPolicy,
  window: v.reservationWindowMinutes ?? 180,
  symbols: v.groupSymbolCount,
})

function VenueForm({ v, readOnly }: { v: VenueConfig; readOnly: boolean }) {
  const { run, pending } = useAction()
  const [form, setForm] = useState(() => formFrom(v))
  const set = <K extends keyof typeof form>(k: K, val: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: val }))
  const dirty =
    form.late !== v.lateWarningMinutes ||
    form.noShow !== v.noShowWarningMinutes ||
    form.hold !== v.waitlistHoldDefaultMinutes ||
    form.lease !== v.waitlistClaimLeaseSeconds ||
    form.policy !== v.reservationHoldPolicy ||
    (form.policy === "WINDOWED" && form.window !== v.reservationWindowMinutes) ||
    form.symbols !== v.groupSymbolCount
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border px-4 md:px-5">
        <Row
          label="Ngày kinh doanh"
          hint="business_date = DATE(giờ địa phương - 05:00). Ví dụ 01:30 ngày 21/10 thuộc ca 20/10."
        >
          <span className="text-sm">
            {v.businessDayStartLocal.slice(0, 5)} → {v.businessDayCutoffLocal.slice(0, 5)} · {v.timezone}
          </span>
        </Row>
        <Row label="Cảnh báo đến muộn" hint="Chỉ hiển thị cảnh báo, không đổi trạng thái booking.">
          <NumberField
            id="late"
            label="Cảnh báo đến muộn"
            value={form.late}
            onChange={(x) => set("late", x)}
            unit="phút"
            disabled={readOnly}
            min={1}
            max={120}
          />
        </Row>
        <Row
          label="Cảnh báo không đến"
          hint="Không tự hủy booking, không tự nhả bàn. Nút Xác nhận không đến chỉ bật sau mốc này."
          pending
        >
          <NumberField
            id="noshow"
            label="Cảnh báo không đến"
            value={form.noShow}
            onChange={(x) => set("noShow", x)}
            unit="phút"
            disabled={readOnly}
            min={2}
            max={240}
          />
        </Row>
        <Row label="Giữ bàn cho khách chờ" hint="Tính từ lúc khách xác nhận nhận bàn. Quá hạn chỉ cảnh báo.">
          <NumberField
            id="hold"
            label="Giữ bàn cho khách chờ"
            value={form.hold}
            onChange={(x) => set("hold", x)}
            unit="phút"
            disabled={readOnly}
            min={1}
            max={240}
          />
        </Row>
        <Row label="Phiên liên hệ danh sách chờ" hint="Thời gian một nhân viên giữ quyền liên hệ một mục chờ." pending>
          <NumberField
            id="lease"
            label="Phiên liên hệ danh sách chờ"
            value={form.lease}
            onChange={(x) => set("lease", x)}
            unit="giây"
            disabled={readOnly}
            min={30}
            max={3600}
          />
        </Row>
        <Row
          label="Chính sách giữ bàn cho booking"
          hint="SEQUENTIAL: mỗi bàn tối đa một claim mở trong ngày. WINDOWED: giữ theo khung giờ. Quán không giới hạn thời gian ngồi."
          pending
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={form.policy}
            disabled={readOnly}
            onValueChange={(x) => x && set("policy", x as "SEQUENTIAL" | "WINDOWED")}
          >
            <ToggleGroupItem value="SEQUENTIAL" className="px-3">
              SEQUENTIAL
            </ToggleGroupItem>
            <ToggleGroupItem value="WINDOWED" className="px-3">
              WINDOWED
            </ToggleGroupItem>
          </ToggleGroup>
          {form.policy === "WINDOWED" ? (
            <NumberField
              id="window"
              label="Khung giữ bàn"
              value={form.window}
              onChange={(x) => set("window", x)}
              unit="phút"
              disabled={readOnly}
              min={15}
              max={720}
            />
          ) : null}
        </Row>
        <Row
          label="Số ký hiệu ghép bàn trong ca"
          hint="Ký hiệu nhỏ nhất còn trống được gán khi ghép. Hết ký hiệu thì phải tách nhóm cũ."
        >
          <NumberField
            id="symbols"
            label="Số ký hiệu ghép bàn"
            value={form.symbols}
            onChange={(x) => set("symbols", x)}
            unit="ký hiệu"
            disabled={readOnly}
            min={1}
            max={12}
          />
        </Row>
        <div className="flex flex-wrap gap-2 pt-1 pb-4" aria-label="Bộ ký hiệu ghép">
          {GROUP_SYMBOLS.map((s) => (
            <span
              key={s.no}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm",
                s.no > form.symbols && "opacity-35",
              )}
            >
              <GroupSymbolIcon no={s.no} size={14} /> {s.name}
            </span>
          ))}
        </div>
      </section>
      <div className="flex justify-end gap-2">
        {dirty ? (
          <Button variant="ghost" onClick={() => setForm(formFrom(v))}>
            Hoàn lại
          </Button>
        ) : null}
        <GuardedButton
          permission="venue.configure"
          disabled={!dirty || pending}
          onClick={() =>
            run(() =>
              api.updateVenueConfig({
                version: v.version,
                lateWarningMinutes: form.late,
                noShowWarningMinutes: form.noShow,
                waitlistHoldDefaultMinutes: form.hold,
                waitlistClaimLeaseSeconds: form.lease,
                reservationHoldPolicy: form.policy,
                reservationWindowMinutes: form.policy === "WINDOWED" ? form.window : null,
                groupSymbolCount: form.symbols,
              }),
            )
          }
        >
          Lưu cấu hình
        </GuardedButton>
      </div>
      <p className="text-xs text-subtle">
        Cấu hình chưa được PO duyệt không trở thành mặc định production; giá trị hiện tại là đề xuất kỹ thuật
        (TECH_PROPOSED) trong tài liệu database.
      </p>
    </div>
  )
}

function FloorSettings({ readOnly }: { readOnly: boolean }) {
  const catalog = useCatalog()
  const { run } = useAction()
  const c = catalog.data
  if (!c) return null
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <SectionTitle>Khu vực</SectionTitle>
        <div className="rounded-2xl border px-4 md:px-5">
          {c.zones.map((z) => (
            <Row
              key={z.id}
              label={z.name}
              pending={z.code === "C"}
              hint={
                z.isWaitingArea
                  ? "Khu chờ: không nhận đặt bàn, không mở bàn."
                  : z.isBookable
                    ? "Nhận đặt bàn và khách ngồi."
                    : "Tạm đóng."
              }
            >
              <Label htmlFor={`zone-${z.id}`} className="text-sm font-normal text-muted-foreground">
                {z.isBookable ? "Nhận khách" : "Khu chờ"}
              </Label>
              <Switch
                id={`zone-${z.id}`}
                checked={z.isBookable}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  run(() => api.setZoneFlags(z.id, z.version, { isBookable: on, isWaitingArea: !on }))
                }
              />
            </Row>
          ))}
        </div>
      </section>

      <section className="grid gap-2">
        <SectionTitle aside={<PendingTag>Danh mục bàn chờ xác nhận (18 hay 20 bàn)</PendingTag>}>
          Cấu hình ghép sẵn
        </SectionTitle>
        <ul className="grid gap-2 sm:grid-cols-3">
          {c.combinations.map((k) => (
            <li key={k.id} className="rounded-xl border px-4 py-3">
              <p className="font-semibold">{k.code}</p>
              <p className="text-sm text-muted-foreground">
                {k.displayName} · {k.capacity} chỗ
              </p>
              <p className="mt-1 text-xs text-subtle">
                Không phải tài nguyên riêng: đặt {k.code} sẽ giữ cả {k.memberIds.length} bàn thành viên.
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <SectionTitle
          aside={
            <span className="text-xs text-subtle">
              {c.tables.filter((t) => t.kind === "TABLE").length} bàn ·{" "}
              {c.tables.filter((t) => t.kind === "BAR_SEAT").length} ghế Bar
            </span>
          }
        >
          Danh mục bàn
        </SectionTitle>
        <div className="scrollbar-thin overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Mã</TableHead>
                <TableHead>Khu</TableHead>
                <TableHead className="text-right">Sức chứa</TableHead>
                <TableHead className="text-center">Sơ cua</TableHead>
                <TableHead className="pr-4 text-center">Đang phục vụ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.tables.map((t) => (
                <TableRow key={t.id} className="h-12">
                  <TableCell className="pl-4 font-semibold">
                    {t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.zones.find((z) => z.id === t.zoneId)?.name}
                  </TableCell>
                  <TableCell className="tnum text-right">{t.capacity}</TableCell>
                  <TableCell className="text-center">
                    {t.kind === "TABLE" ? (
                      <Switch
                        aria-label={`Sơ cua ${t.code}`}
                        checked={t.isSpare}
                        disabled={readOnly}
                        onCheckedChange={(on) => run(() => api.setTableStatus(t.id, t.version, { isSpare: on }))}
                      />
                    ) : (
                      <Minus className="mx-auto size-4 text-subtle" aria-label="Không áp dụng" />
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-center">
                    <Switch
                      aria-label={`Đang phục vụ ${t.code}`}
                      checked={t.status === "ACTIVE"}
                      disabled={readOnly}
                      onCheckedChange={(on) =>
                        run(() => api.setTableStatus(t.id, t.version, { status: on ? "ACTIVE" : "OUT_OF_SERVICE" }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function AccessSettings() {
  const { user, users, setUser } = useSession()
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <SectionTitle>Vai trò đang dùng (demo)</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {users.map((u) => (
            <Button key={u.id} variant={u.id === user.id ? "default" : "outline"} onClick={() => setUser(u.id)}>
              {ROLE_LABEL[u.role]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-subtle">
          Máy chủ là nơi kiểm tra quyền. Giao diện chỉ ẩn/khóa nút và giải thích lý do. Lễ tân không bao giờ nhận số
          điện thoại đầy đủ từ API.
        </p>
      </section>
      <section className="grid gap-2">
        <SectionTitle aside={<PendingTag>Vai trò TECH_PROPOSED</PendingTag>}>Ma trận quyền</SectionTitle>
        <div className="scrollbar-thin overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Quyền</TableHead>
                {ROLES.map((r) => (
                  <TableHead key={r} className={cn("text-center", r === user.role && "text-foreground")}>
                    {ROLE_LABEL[r]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_GROUPS.map((g) => (
                <PermGroup key={g.title} title={g.title}>
                  {g.items.map((p) => (
                    <TableRow key={p} className="h-11">
                      <TableCell className="pl-4">
                        <span className="block">{PERMISSION_LABEL[p]}</span>
                        <span className="text-[11px] text-subtle">{p}</span>
                      </TableCell>
                      {ROLES.map((r) => (
                        <TableCell key={r} className={cn("text-center", r === user.role && "bg-surface-2")}>
                          {PERMISSION_MATRIX[p].includes(r) ? (
                            <Check className="mx-auto size-4" aria-label="Có" />
                          ) : (
                            <span className="text-subtle" aria-label="Không">
                              ·
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </PermGroup>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function PermGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={5} className="bg-surface-1 pl-4">
          <span className="eyebrow">{title}</span>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

function IntegrationSettings() {
  const catalog = useCatalog()
  return (
    <div className="grid gap-6">
      <section className="grid gap-2 rounded-2xl border p-4 md:p-5">
        <SectionTitle>Trạng thái kết nối</SectionTitle>
        <p className="text-sm">
          Chế độ API: <b className="font-mono">{api.mode}</b>.{" "}
          {api.mode === "mock"
            ? "Dữ liệu giả trong trình duyệt, không gửi dữ liệu khách ra dịch vụ ngoài, không ghi vào MySQL."
            : "Đang gọi REST API."}
        </p>
        <p className="text-sm text-muted-foreground">
          change_seq hiện tại: <span className="text-foreground">{catalog.data?.venue.changeSeq ?? "-"}</span>. Bật API
          thật bằng <span className="font-mono">VITE_API_MODE=http</span> và{" "}
          <span className="font-mono">VITE_API_BASE_URL</span>.
        </p>
      </section>
      <section className="grid gap-2">
        <SectionTitle aside={<span className="text-xs text-subtle">PROPOSED = cần thống nhất với backend</span>}>
          Hợp đồng REST đề xuất
        </SectionTitle>
        <ul className="grid gap-1 rounded-2xl border p-4 text-xs md:grid-cols-2">
          {Object.entries(REST_ENDPOINTS).map(([k, v]) => (
            <li key={k} className="flex gap-2">
              <span className="w-28 shrink-0 text-subtle">{k}</span>
              <span className="break-all">{v}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-2">
        <SectionTitle aside={<span className="text-xs text-subtle">DDL draft, chưa migrate</span>}>
          26 bảng được ánh xạ sang TypeScript
        </SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {DDL_TABLES.map((t) => (
            <span key={t} className="rounded-md border px-2 py-1 text-xs">
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
