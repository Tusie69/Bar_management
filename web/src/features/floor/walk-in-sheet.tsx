import { ListPlus, MapPinned, UserPlus } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { GuardedButton, QuickCounts, SectionTitle, Stepper } from "@/components/common"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAction } from "@/hooks/use-action"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { useFloorModel } from "./use-floor-model"

/**
 * Walk-in in two taps: party size -> suggested table (fits, free, not spare).
 * If nothing fits now: add to the WALK_IN waitlist instead of seating.
 */
export function WalkInSheet() {
  const open = useUi((s) => s.walkInOpen)
  const close = useUi((s) => s.closeWalkIn)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[440px]">{open ? <WalkInBody /> : null}</SheetContent>
    </Sheet>
  )
}

function WalkInBody() {
  const ui = useUi()
  const model = useFloorModel()
  const navigate = useNavigate()
  const { run, pending } = useAction()
  const [party, setParty] = useState(2)
  const [name, setName] = useState("")
  // null = not touched yet: follow the best-fitting suggestion automatically (2-tap walk-in).
  const [picked, setPicked] = useState<number[] | null>(() => (ui.walkInPrefill.length ? ui.walkInPrefill : null))

  const suggestions = useMemo(() => {
    const zoneOk = new Set(model.catalog?.zones.filter((z) => z.isBookable).map((z) => z.id))
    return model.tables
      .filter((t) => model.states.get(t.id)?.state === "free" && zoneOk.has(t.zoneId))
      .filter((t) => (party <= 2 ? true : t.kind === "TABLE"))
      .map((t) => ({ t, fit: t.capacity - party }))
      .filter((x) => x.t.kind === "BAR_SEAT" || x.fit >= 0)
      .sort((a, b) =>
        a.t.kind === b.t.kind ? a.fit - b.fit || a.t.code.localeCompare(b.t.code) : a.t.kind === "TABLE" ? -1 : 1,
      )
  }, [model.tables, model.states, model.catalog, party])

  const tables = suggestions.filter((s) => s.t.kind === "TABLE")
  const bar = suggestions.filter((s) => s.t.kind === "BAR_SEAT")
  const chosen = picked ?? (tables[0] ? [tables[0].t.id] : [])
  const capacity = chosen.reduce((s, id) => s + (model.byId.get(id)?.capacity ?? 0), 0)

  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])

  const seat = async () => {
    const r = await run((o) =>
      api.seatWalkIn({ tableIds: chosen, guestCount: party, contactName: name || undefined, overrideReason: o }),
    )
    if (r) {
      ui.closeWalkIn()
      if (chosen[0]) ui.selectTable(chosen[0])
    }
  }

  const pickOnMap = () => {
    ui.closeWalkIn()
    navigate("/floor")
    ui.startPick({
      intent: "walkin",
      title: `Walk-in ${party} khách`,
      hint: "Chạm bàn trống (có thể chọn nhiều bàn để ghép).",
      multi: true,
      confirmLabel: "Mở bàn",
      onConfirm: async (ids) =>
        !!(await run((o) =>
          api.seatWalkIn({ tableIds: ids, guestCount: party, contactName: name || undefined, overrideReason: o }),
        )),
    })
  }

  const toWaitlist = async () => {
    const label = name.trim() || `Khách Walk-in ${party} người`
    const r = await run(() =>
      api.addWaitlist({
        kind: "WALK_IN",
        contactName: label,
        partySize: party,
        channel: "IN_PERSON",
        preferenceMode: "ANY",
        preferences: [],
      }),
    )
    if (r) ui.closeWalkIn()
  }

  return (
    <>
      <SheetHeader className="border-b px-5 pt-5 pb-4">
        <SheetTitle className="text-xl">Nhận khách Walk-in</SheetTitle>
        <SheetDescription>Mở bàn ngay khi có chỗ phù hợp. Không cần tạo booking.</SheetDescription>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 scrollbar-thin content-start gap-5 overflow-y-auto px-5 py-5">
        <section className="grid gap-3">
          <SectionTitle>Số khách</SectionTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Stepper value={party} onChange={setParty} label="số khách" />
            <QuickCounts value={party} onChange={setParty} options={[1, 2, 3, 4, 6, 8]} />
          </div>
        </section>
        <section className="grid gap-1.5">
          <Label htmlFor="wi-name" className="text-muted-foreground">
            Tên hoặc đặc điểm nhận dạng (tùy chọn)
          </Label>
          <Input
            id="wi-name"
            className="h-11"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: anh Minh, nhóm áo trắng"
          />
        </section>
        <section className="grid gap-2">
          <SectionTitle>Bàn trống phù hợp · {tables.length}</SectionTitle>
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Không có bàn đủ {party} chỗ đang trống. Có thể ghép bàn trên sơ đồ hoặc thêm vào danh sách chờ.
            </p>
          ) : null}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {tables.map(({ t }) => (
              <TableChip
                key={t.id}
                label={t.code}
                sub={`${t.capacity} chỗ`}
                active={chosen.includes(t.id)}
                onClick={() => toggle(t.id)}
              />
            ))}
          </div>
        </section>
        {party <= 2 ? (
          <section className="grid gap-2">
            <SectionTitle>Ghế Bar trống · {bar.length}</SectionTitle>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-7">
              {bar.map(({ t }) => (
                <TableChip
                  key={t.id}
                  label={String(t.seqNo)}
                  active={chosen.includes(t.id)}
                  onClick={() => toggle(t.id)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <SheetFooter className="grid gap-2 border-t px-5 py-4">
        {chosen.length ? (
          <p className={cn("text-sm", capacity < party ? "text-st-late" : "text-muted-foreground")}>
            {chosen.map((id) => model.label(id)).join(" + ")} · {capacity} chỗ
            {capacity < party ? " (thiếu chỗ, cần Chủ quán duyệt)" : ""}
          </p>
        ) : null}
        <GuardedButton permission="visit.walkin" size="lg" disabled={!chosen.length || pending} onClick={seat}>
          <UserPlus /> Mở bàn cho {party} khách
        </GuardedButton>
        <div className="grid grid-cols-2 gap-2">
          <GuardedButton permission="visit.walkin" variant="outline" disabled={pending} onClick={pickOnMap}>
            <MapPinned /> Chọn trên sơ đồ
          </GuardedButton>
          <GuardedButton permission="waitlist.create" variant="outline" disabled={pending} onClick={toWaitlist}>
            <ListPlus /> Vào danh sách chờ
          </GuardedButton>
        </div>
      </SheetFooter>
    </>
  )
}

function TableChip({
  label,
  sub,
  active,
  onClick,
}: {
  label: string
  sub?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-14 flex-col items-center justify-center rounded-lg border transition-colors",
        active ? "border-foreground bg-foreground text-background" : "bg-surface-1 hover:bg-surface-2",
      )}
    >
      <span className="text-base leading-none font-semibold">{label}</span>
      {sub ? (
        <span className={cn("mt-1 text-[10px]", active ? "text-background/70" : "text-muted-foreground")}>{sub}</span>
      ) : null}
    </button>
  )
}
