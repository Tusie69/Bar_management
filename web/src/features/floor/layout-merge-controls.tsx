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
          ? // Mockup 03: the panel COVERS the top of the plan instead of pushing
            // it down. Pushing re-fits the camera, which is what made the plan
            // jump back to the top twice during one merge.
            "gap-1.5 rounded-[18px] bg-[#1b1a17] px-3 pt-2 pb-2.5 text-white shadow-[var(--shadow-float)]"
          : "gap-2 rounded-lg border bg-surface-1 p-2",
      )}
      aria-label="Chế độ ghép bàn"
    >
      <div className="flex items-center justify-between gap-2">
        <strong>Đang ghép bàn</strong>
        <Button
          variant="ghost"
          aria-label="Hủy"
          className={overlay ? "h-8 px-2 text-white hover:bg-white/10 hover:text-white" : undefined}
          onClick={useUi.getState().cancelPick}
        >
          Hủy
        </Button>
      </div>
      <p className={cn("text-xs", overlay ? "text-white/70" : "text-muted-foreground")}>
        Chạm {overlay && ids.length ? "tiếp " : ""}các bàn cần ghép trên sơ đồ.
      </p>
      {ids.length && overlay ? (
        // The chips say what is selected at a glance; the old sentence made the
        // panel taller than the 172px the mockup gives it.
        <p className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          <span className="sr-only">Đang chọn {ids.length} vị trí:</span>
          {ids.map((id) => (
            <span key={id} className="rounded-md bg-white/15 px-2 py-0.5 text-[13px] font-semibold">
              {model.label(id)}
            </span>
          ))}
          <span className="rounded-md bg-white px-2 py-0.5 text-[13px] font-bold text-[#1b1a17]">
            {total}
            <span className="sr-only"> chỗ</span>
          </span>
          {existingGroup ? (
            <span className="text-[12px] text-white/70">
              thêm vào cụm {existingGroup.displayCode ?? "#" + existingGroup.id}
            </span>
          ) : null}
        </p>
      ) : ids.length ? (
        <p aria-live="polite">
          Đang chọn ({ids.length} vị trí): {ids.map((id) => model.label(id)).join(" - ")} · tổng {total} chỗ
          {existingGroup ? ` · thêm vào cụm ${existingGroup.displayCode ?? "#" + existingGroup.id}` : ""}
        </p>
      ) : null}
      {reason ? (
        <p id="layout-merge-reason" className={cn("text-xs", overlay ? "text-white/70" : "text-muted-foreground")}>
          {reason}
        </p>
      ) : null}
      {api.mode === "mock" && !overlay ? (
        <p className="text-xs text-muted-foreground">Bản mô phỏng: chỉ lưu trên máy này.</p>
      ) : null}
      <div className={cn("flex flex-wrap gap-2", overlay && "mt-0.5 flex-row-reverse")}>
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
