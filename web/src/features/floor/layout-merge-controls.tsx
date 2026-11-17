import { useState } from "react"
import { Combine, Split } from "lucide-react"
import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { api } from "@/services"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import { startLayoutMerge, layoutSelection } from "./layout-merge"
import { SplitDialog } from "./floor-dialogs"
import type { FloorModel } from "./use-floor-model"

/** Shared by the desktop detail and phone sheet; BA-021 keeps its existing owner/keep rules. */
export function LayoutActions({ model, tableId }: { model: FloorModel; tableId: number }) {
  const { run, pending } = useAction()
  const [open, setOpen] = useState(false)
  const [key, renew] = useIdempotencyKey()
  const group = model.floor?.groups.find((g) => g.tableIds.includes(tableId))
  const claim = model.states.get(tableId)?.claim
  const idle = !claim
  return (
    <>
      <div className="grid grid-cols-2 gap-2" aria-label="Thao tác mặt bằng">
        <GuardedButton
          permission="table.group.manage"
          variant="outline"
          onClick={() => startLayoutMerge(model, tableId)}
        >
          <Combine /> Ghép bàn
        </GuardedButton>
        <GuardedButton
          permission={idle ? "table.group.manage" : "visit.split"}
          variant="outline"
          disabledReason={group ? undefined : "Bàn chưa thuộc cụm bàn."}
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          <Split /> Tách bàn
        </GuardedButton>
      </div>
      <SplitDialog
        open={open}
        onOpenChange={setOpen}
        idle={idle}
        tables={(group?.tableIds ?? []).map((id) => ({ id, label: model.label(id) }))}
        onConfirm={async (keep) => {
          if (!group) return
          const result = await run(() => {
            if (idle) {
              if (group.version === undefined)
                throw new Error("Cụm bàn chưa có phiên bản mặt bằng. Vui lòng tải lại sơ đồ.")
              // Tách bàn on an empty cluster: ends the cluster, keeps the history.
              return api.dissolveTableGroup({ groupId: group.id, version: group.version, idempotencyKey: key })
            }
            return api.splitGroup({ groupId: group.id, keepTableIds: keep, idempotencyKey: key })
          })
          if (result) {
            renew()
            setOpen(false)
          }
        }}
      />
    </>
  )
}

export function LayoutMergeControls({ model, overlay = false }: { model: FloorModel; overlay?: boolean }) {
  const pick = useUi((s) => s.pick)
  const ids = useUi((s) => s.pickSelection)
  const draft = useUi((s) => s.draft)
  const { run, pending } = useAction()
  if (draft || (pick && pick.intent !== "layout")) return null
  if (!pick)
    return (
      <GuardedButton permission="table.group.manage" variant="outline" onClick={() => startLayoutMerge(model)}>
        <Combine /> Ghép bàn
      </GuardedButton>
    )
  const { reason, owner } = layoutSelection(model, ids)
  const total = ids.reduce((n, id) => n + (model.byId.get(id)?.capacity ?? 0), 0)
  // Adding to a cluster the selection already touches keeps one cluster identity
  // instead of dissolving and re-forming it.
  const existingGroup = owner
    ? undefined
    : model.floor?.groups.find((g) => g.version !== undefined && g.tableIds.some((id) => ids.includes(id)))
  const canBook =
    ids.length > 0 &&
    !owner &&
    ids.every((id) => {
      const t = model.byId.get(id)
      return (
        t && !t.isSpare && t.status === "ACTIVE" && model.catalog?.zones.some((z) => z.id === t.zoneId && z.isBookable)
      )
    }) &&
    new Set(ids.map((id) => model.byId.get(id)?.zoneId)).size === 1
  return (
    <section
      className={cn(
        "grid text-sm",
        overlay
          ? // Sits in the strip UNDER the plan, where the undo pair normally is.
            // The mockup drew it over the top of the plan, but in the real app
            // that hid the whole of Khu C; and pushing the plan down the old way
            // shrank it until the tables were hard to hit. Below the plan it
            // covers no table at all and costs the camera about 8% of its scale.
            "gap-1.5 rounded-[18px] border border-border bg-surface-1 px-3 pt-2 pb-2.5 shadow-[var(--shadow-float)]"
          : "gap-2 rounded-lg border bg-surface-1 p-2",
      )}
      aria-label="Chế độ ghép bàn"
    >
      {overlay ? (
        // Everything that can share a line does. The strip lives under the plan
        // and every pixel it takes is a pixel the camera loses, so the title,
        // the chips and Hủy sit on one row and the hint shares the next with
        // the reason.
        <div className="flex min-w-0 items-center gap-1.5">
          <strong className="shrink-0 text-[13px]">Ghép bàn</strong>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-live="polite">
            <span className="sr-only">Đang chọn {ids.length} vị trí:</span>
            {ids.map((id) => (
              <span key={id} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[13px] font-semibold text-tx-strong">
                {model.label(id)}
              </span>
            ))}
            {ids.length ? (
              <span className="rounded-md bg-tx-strong px-1.5 py-0.5 text-[13px] font-bold text-background">
                {total}
                <span className="sr-only"> chỗ</span>
              </span>
            ) : null}
            {existingGroup ? (
              <span className="truncate text-[12px] text-muted-foreground">
                + cụm {existingGroup.displayCode ?? "#" + existingGroup.id}
              </span>
            ) : null}
          </span>
          <Button variant="ghost" aria-label="Hủy" className="h-8 shrink-0 px-2" onClick={useUi.getState().cancelPick}>
            Hủy
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <strong>Đang ghép bàn</strong>
          <Button variant="ghost" aria-label="Hủy" onClick={useUi.getState().cancelPick}>
            Hủy
          </Button>
        </div>
      )}
      {overlay ? (
        <p className="truncate text-xs text-muted-foreground" id={reason ? "layout-merge-reason" : undefined}>
          {reason ?? `Chạm ${ids.length ? "tiếp " : ""}các bàn cần ghép trên sơ đồ.`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Chạm các bàn cần ghép trên sơ đồ.</p>
      )}
      {!overlay && ids.length ? (
        <p aria-live="polite">
          Đang chọn ({ids.length} vị trí): {ids.map((id) => model.label(id)).join(" - ")} · tổng {total} chỗ
          {existingGroup ? ` · thêm vào cụm ${existingGroup.displayCode ?? "#" + existingGroup.id}` : ""}
        </p>
      ) : null}
      {reason && !overlay ? (
        <p id="layout-merge-reason" className="text-xs text-muted-foreground">
          {reason}
        </p>
      ) : null}
      {api.mode === "mock" && !overlay ? (
        <p className="text-xs text-muted-foreground">Bản mô phỏng: chỉ lưu trên máy này.</p>
      ) : null}
      <div className={cn("flex gap-2", overlay ? "flex-row-reverse [&>button]:h-10" : "flex-wrap")}>
        <GuardedButton
          permission={owner ? "visit.combine" : "table.group.manage"}
          disabled={pending || !!reason}
          aria-describedby={reason ? "layout-merge-reason" : undefined}
          onClick={async () => {
            const result = await run((_reason, confirmations) =>
              // No guest involved: this is a layout cluster of its own, so it goes
              // to the cluster endpoint rather than through a booking merge.
              owner
                ? api.combineTables({
                    claim: owner.visitId
                      ? { visitId: owner.visitId, version: owner.version }
                      : { reservationId: owner.reservationId!, version: owner.version },
                    addTableIds: ids.filter((id) => !owner.tableIds.includes(id)),
                    ...confirmations,
                  })
                : existingGroup
                  ? api.addTableGroupMembers({
                      groupId: existingGroup.id,
                      version: existingGroup.version!,
                      tableIds: ids.filter((id) => !existingGroup.tableIds.includes(id)),
                      ...confirmations,
                    })
                  : api.createTableGroup({ tableIds: ids, ...confirmations }),
            )
            if (result) {
              useUi.getState().cancelPick()
              useUi.getState().selectTable(ids[0])
            }
          }}
        >
          {ids.length ? `Ghép ${ids.length} bàn` : "Ghép bàn"}
        </GuardedButton>
        {canBook ? (
          <GuardedButton
            permission="reservation.create"
            variant={overlay ? "default" : "outline"}
            className={overlay ? "flex-1" : undefined}
            onClick={() =>
              useUi
                .getState()
                .openBooking({ tableIds: ids, date: model.floor?.businessDate, party: Math.min(total, 6) })
            }
          >
            {/* Mockup 03 calls this one button "Xong · Nhập thông tin đặt". The
                merge-only button stays beside it: a layout cluster with no guest
                is a real case the mockup does not draw. */}
            {overlay ? "Xong · Nhập thông tin đặt" : "Tiếp tục đặt bàn"}
          </GuardedButton>
        ) : null}
      </div>
    </section>
  )
}
