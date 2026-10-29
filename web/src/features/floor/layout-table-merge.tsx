import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Combine, X } from "lucide-react"
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
import type { MergeWorkflow } from "./use-layout-table-controller"

interface Props {
  workflow: MergeWorkflow
  model: FloorModel
  cancel: () => void
  confirm: () => void
  back: () => void
  submitting: () => void
  success: () => void
  fail: (message: string) => void
}

export function LayoutTableMerge({ workflow, model, cancel, confirm, back, submitting, success, fail }: Props) {
  const queryClient = useQueryClient()
  if (workflow.phase === "IDLE") return null
  const codes = model.codes(workflow.tableIds).join(" + ")
  const hasAddition = workflow.tableIds.length > workflow.context.sourceTableIds.length
  const source = model.byId.get(workflow.context.sourceTableIds[0] ?? -1)
  const zoneName = model.catalog?.zones.find((zone) => zone.id === source?.zoneId)?.name ?? source?.zoneCode ?? "khu nguồn"

  const submit = async () => {
    if (workflow.phase !== "CONFIRMING") return
    submitting()
    try {
      if (workflow.context.entityKind === "booking") {
        if (!bookingApi) throw new Error("Booking API chưa được cấu hình.")
        await bookingApi.merge(workflow.context.entityId, workflow.context.version, workflow.tableIds)
      } else {
        if (!visitApi) throw new Error("Visit API chưa được cấu hình.")
        await visitApi.merge(workflow.context.entityId, workflow.context.version, workflow.tableIds)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings", "detail", workflow.context.entityId] }),
      ])
      success()
      toast.success(`Backend đã tạo nhóm ${codes}.`)
    } catch (cause) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["floor"] }),
        queryClient.invalidateQueries({ queryKey: ["http-bookings"] }),
      ])
      fail(cause instanceof Error ? cause.message : "Không thể ghép bàn.")
    }
  }

  return (
    <>
      {workflow.phase === "SELECTING_MERGE_TARGETS" || workflow.phase === "SUCCESS" ? (
        <div className="absolute top-3 right-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:left-1/2 sm:max-w-xl sm:-translate-x-1/2">
          {workflow.phase === "SUCCESS" ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Combine className="size-5 text-primary" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {workflow.phase === "SUCCESS" ? "Backend đã xác nhận nhóm bàn" : "Chọn các bàn cùng khu"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workflow.context.displayName} · {codes} · chỉ chọn bàn cùng {zoneName}; bàn khác khu bị khóa
            </p>
          </div>
          {workflow.phase === "SUCCESS" ? (
            <Button size="sm" onClick={cancel}>Hoàn tất</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancel}><X /> Hủy</Button>
              <Button size="sm" disabled={!hasAddition} onClick={confirm}>Tiếp tục</Button>
            </>
          )}
        </div>
      ) : null}

      {workflow.phase === "CONFIRMING" || workflow.phase === "SUBMITTING" ? (
        <Dialog open onOpenChange={(open) => !open && workflow.phase === "CONFIRMING" && back()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xác nhận ghép {codes}?</DialogTitle>
              <DialogDescription>
                Các bàn đã chọn: {codes}. Backend sẽ đọc zone từ database và kiểm tra lại quyền, version, cùng chủ booking/visit, trạng thái trống trong một transaction.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border bg-surface-1 p-3 text-sm">
              <b>{workflow.context.displayName}</b> · {workflow.context.partySize} khách · {workflow.context.entityKind === "booking" ? "Booking" : "Visit"} #{workflow.context.entityId}
            </p>
            <DialogFooter>
              <Button variant="ghost" disabled={workflow.phase === "SUBMITTING"} onClick={back}>Quay lại</Button>
              <Button disabled={workflow.phase === "SUBMITTING"} onClick={() => void submit()}>
                {workflow.phase === "SUBMITTING" ? "Đang ghép…" : "Xác nhận ghép bàn"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {workflow.phase === "ERROR" ? (
        <Dialog open onOpenChange={(open) => !open && cancel()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Không thể ghép bàn</DialogTitle>
              <DialogDescription>Không có thay đổi optimistic; Floor State đã được tải lại.</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-destructive" role="alert">{workflow.message}</p>
            <DialogFooter>
              <Button variant="ghost" onClick={cancel}>Hủy thao tác</Button>
              <Button onClick={back}>Chọn lại</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
