import { useState } from "react"
import { Combine, Split } from "lucide-react"
import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { api } from "@/services"
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

export function LayoutMergeControls({ model }: { model: FloorModel }) {
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
    <section className="grid gap-2 rounded-lg border bg-surface-1 p-2 text-sm" aria-label="Chế độ ghép bàn">
      <div className="flex items-center justify-between gap-2">
        <strong>Đang ghép bàn</strong>
        <Button variant="ghost" aria-label="Hủy" onClick={useUi.getState().cancelPick}>
          Hủy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Chạm các bàn muốn ghép trên sơ đồ.</p>
      {ids.length ? (
        <p aria-live="polite">
          Đang chọn ({ids.length} vị trí): {ids.map((id) => model.label(id)).join(" - ")} · tổng {total} chỗ
          {existingGroup ? ` · thêm vào cụm ${existingGroup.displayCode ?? "#" + existingGroup.id}` : ""}
        </p>
      ) : null}
      {reason ? (
        <p id="layout-merge-reason" className="text-xs text-muted-foreground">
          {reason}
        </p>
      ) : null}
      {api.mode === "mock" ? (
        <p className="text-xs text-muted-foreground">Bản mô phỏng: chỉ lưu trên máy này.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
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
            variant="outline"
            onClick={() =>
              useUi
                .getState()
                .openBooking({ tableIds: ids, date: model.floor?.businessDate, party: Math.min(total, 6) })
            }
          >
            Tiếp tục đặt bàn
          </GuardedButton>
        ) : null}
      </div>
    </section>
  )
}
