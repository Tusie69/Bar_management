import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, CheckCircle2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { bookingApi, visitApi } from "@/services"
import type { FloorModel } from "./use-floor-model"
import type { MoveWorkflow } from "./use-layout-table-controller"

interface Props {
  workflow: MoveWorkflow
  model: FloorModel
  cancel: () => void
  back: () => void
  submitting: () => void
  success: () => void
  fail: (message: string) => void
}

export function LayoutTableMove({ workflow, model, cancel, back, submitting, success, fail }: Props) {
  const queryClient = useQueryClient()
  if (workflow.phase === "IDLE") return null

  const sourceCodes = model.codes(workflow.context.sourceTableIds).join(" + ")
  const target = "targetTableId" in workflow ? model.byId.get(workflow.targetTableId) : null

  const submit = async () => {
    if (workflow.phase !== "CONFIRMING" || !target) return
    submitting()
    try {
      if (workflow.context.entityKind === "booking") {
        if (!bookingApi) throw new Error("Booking API chưa được cấu hình.")
        await bookingApi.assignVersion(
          workflow.context.entityId,
          workflow.context.version,
          [target.id],
        )
      } else {
        if (!visitApi) throw new Error("Visit API chưa được cấu hình.")
        await visitApi.move(workflow.context.entityId, workflow.context.version, [target.id])
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings", "detail", workflow.context.entityId] }),
      ])
      success()
      toast.success(`Đã chuyển ${sourceCodes} sang ${target.code} theo phản hồi backend.`)
    } catch (cause) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings"] }),
      ])
      fail(cause instanceof Error ? cause.message : "Không thể chuyển bàn.")
    }
  }

  return (
    <>
      {(workflow.phase === "SELECTING_MOVE_TARGET" || workflow.phase === "SUCCESS") ? (
        <div className="absolute top-3 right-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:left-1/2 sm:max-w-xl sm:-translate-x-1/2">
          {workflow.phase === "SUCCESS" ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ArrowRightLeft className="size-5 text-primary" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {workflow.phase === "SUCCESS" ? "Backend đã xác nhận chuyển bàn" : "Đang chọn bàn đích"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workflow.context.displayName} · {sourceCodes} · {workflow.context.partySize} khách
            </p>
          </div>
          {workflow.phase === "SUCCESS" ? (
            <Button size="sm" onClick={cancel}>Hoàn tất</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={cancel}><X /> Hủy thao tác</Button>
          )}
        </div>
      ) : null}

      {workflow.phase === "CONFIRMING" || workflow.phase === "SUBMITTING" ? (
        <Dialog open onOpenChange={(open) => !open && workflow.phase === "CONFIRMING" && back()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xác nhận chuyển sang {target?.code}?</DialogTitle>
              <DialogDescription>
                {sourceCodes} → {target?.code}. Backend sẽ kiểm tra lại version, quyền, trạng thái, conflict và capacity trong transaction.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border bg-surface-1 p-3 text-sm">
              <b>{workflow.context.displayName}</b> · {workflow.context.partySize} khách · {workflow.context.entityKind === "booking" ? "Booking" : "Visit"} #{workflow.context.entityId}
            </p>
            <DialogFooter>
              <Button variant="ghost" disabled={workflow.phase === "SUBMITTING"} onClick={back}>Quay lại chọn bàn</Button>
              <Button disabled={workflow.phase === "SUBMITTING" || !target} onClick={() => void submit()}>
                {workflow.phase === "SUBMITTING" ? "Đang chuyển…" : "Xác nhận chuyển bàn"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {workflow.phase === "ERROR" ? (
        <Dialog open onOpenChange={(open) => !open && cancel()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Không thể chuyển bàn</DialogTitle>
              <DialogDescription>Không có thay đổi optimistic được áp dụng. Floor State đã được tải lại.</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-destructive" role="alert">{workflow.message}</p>
            <DialogFooter>
              <Button variant="ghost" onClick={cancel}>Hủy thao tác</Button>
              <Button onClick={back}>Chọn bàn khác</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
