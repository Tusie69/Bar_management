import { useQuery } from "@tanstack/react-query"
import { ClipboardCopy, RefreshCw } from "lucide-react"
import { useState } from "react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { BusinessDate } from "@/lib/time"
import { bookingApi } from "@/services"

export function ZaloBookingExport({
  businessDate,
  open,
  onOpenChange,
}: {
  businessDate: BusinessDate
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copyError, setCopyError] = useState<string | null>(null)
  const exportText = useQuery({
    queryKey: ["http-booking-export", businessDate],
    queryFn: () => bookingApi!.exportDailyText(businessDate),
    enabled: open && bookingApi !== null,
    retry: false,
    refetchInterval: open ? 15_000 : false,
  })

  const copy = async () => {
    if (!exportText.data) return
    setCopyError(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API không khả dụng trên trình duyệt này.")
      await navigator.clipboard.writeText(exportText.data)
      toast.success("Đã sao chép nội dung. Bạn có thể dán thủ công vào Zalo.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể sao chép nội dung."
      setCopyError(message)
      toast.error("Sao chép thất bại.", { description: message })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setCopyError(null)
        onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[92dvh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Xuất text booking cho Zalo</DialogTitle>
          <DialogDescription>
            Xem trước dữ liệu backend theo ngày nghiệp vụ. Website chỉ sao chép; không tự gửi hoặc mở Zalo.
          </DialogDescription>
        </DialogHeader>
        {exportText.isLoading ? (
          <Skeleton className="h-[52dvh] min-h-80" />
        ) : exportText.error ? (
          <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
            Không tải được nội dung xuất:{" "}
            {exportText.error instanceof Error ? exportText.error.message : "Lỗi backend."}
          </div>
        ) : (
          <Textarea
            aria-label="Nội dung text booking"
            readOnly
            value={exportText.data ?? ""}
            className="h-[52dvh] min-h-80 resize-none overflow-auto font-mono text-sm whitespace-pre"
          />
        )}
        {copyError ? (
          <p role="alert" className="text-sm text-destructive">
            {copyError}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={exportText.isFetching} onClick={() => void exportText.refetch()}>
            <RefreshCw className={exportText.isFetching ? "animate-spin" : ""} /> Cập nhật
          </Button>
          <Button disabled={!exportText.data || exportText.isFetching} onClick={() => void copy()}>
            <ClipboardCopy /> Sao chép
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
