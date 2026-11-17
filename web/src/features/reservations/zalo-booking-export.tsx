import { ClipboardCopy } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { useBookingExport } from "@/hooks/use-data"
import type { BusinessDate } from "@/lib/time"
import { writeBookingExportToClipboard } from "./booking-clipboard"

export interface ZaloBookingExportAction {
  copy: () => Promise<void>
  loading: boolean
}

/**
 * Preloads the approved backend export so a click can call Clipboard API while
 * the browser still has the user's transient activation (important on iOS).
 * The dialog is rendered only after clipboard access fails, as a manual-copy
 * fallback; it is never a preview step in the successful path.
 */
export function ZaloBookingExport({
  businessDate,
  enabled = true,
  children,
}: {
  businessDate: BusinessDate
  enabled?: boolean
  children: (action: ZaloBookingExportAction) => ReactNode
}) {
  const exportText = useBookingExport(businessDate, enabled)
  const [fallbackText, setFallbackText] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    let text = exportText.data
    if (!text) text = (await exportText.refetch()).data
    if (!text) {
      toast.error("Không tải được danh sách bàn đặt.")
      return
    }

    try {
      await writeBookingExportToClipboard(text, globalThis.isSecureContext, navigator.clipboard)
      toast.success("Đã sao chép danh sách bàn đặt")
    } catch {
      setFallbackText(text)
      toast.error("Không thể tự động sao chép.", { description: "Hãy sao chép thủ công trong cửa sổ vừa mở." })
    }
  }

  const selectAll = () => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }

  return (
    <>
      {children({ copy, loading: exportText.isLoading })}
      <Dialog open={fallbackText !== null} onOpenChange={(open) => !open && setFallbackText(null)}>
        <DialogContent className="max-h-[92dvh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sao chép danh sách bàn đặt</DialogTitle>
            <DialogDescription>
              Trình duyệt đã từ chối clipboard. Chọn toàn bộ nội dung bên dưới và sao chép thủ công.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            ref={textareaRef}
            aria-label="Nội dung danh sách bàn đặt để sao chép thủ công"
            readOnly
            value={fallbackText ?? ""}
            className="h-[52dvh] min-h-80 resize-none overflow-auto font-mono text-sm whitespace-pre"
          />
          <DialogFooter>
            <Button onClick={selectAll}>
              <ClipboardCopy /> Chọn toàn bộ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
