/**
 * Module Phục vụ 5 — hàng chờ phê duyệt hủy món.
 *
 * Màn này KHÔNG thuộc khu vực Phục vụ, và đó là chủ ý: người đọc nó là người có
 * `order.cancel.approve`, còn Phục vụ thì không có quyền đó. Một màn duyệt mà
 * chính người gọi món mở được thì "cần phê duyệt" chỉ là một cú bấm thêm.
 *
 * Cửa thật vẫn là máy chủ: mọi endpoint ở đây canh theo permission, nên gõ
 * thẳng URL không mở được gì. Cái `useCan` dưới đây chỉ để người vào sai chỗ
 * đọc được một câu rõ ràng thay vì một danh sách trống.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { isApiError, newIdempotencyKey } from "@/services"
import { useCan, useSession } from "@/state/session"
import {
  decideCancellation,
  decideCancellationGroup,
  fetchCancellationQueue,
  type CancellationQueueEntry,
  type CancellationStatus,
} from "@/features/waiter-menu/waiter-order-api"
import { CancellationCard } from "./cancellation-card"
import { CancellationGroupCard } from "./cancellation-group-card"
import { groupCancellationEntries, type CancellationGroupItem } from "./cancellation-grouping"

const TABS: { status: CancellationStatus; label: string }[] = [
  { status: "PENDING", label: "Chờ duyệt" },
  { status: "APPROVED", label: "Đã duyệt" },
  { status: "REJECTED", label: "Đã từ chối" },
]

export default function CancellationQueuePage() {
  const navigate = useNavigate()
  const canApprove = useCan("order.cancel.approve")
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<CancellationStatus>("PENDING")
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const queue = useQuery({
    queryKey: ["cancellation-queue", venueId, status],
    queryFn: () => fetchCancellationQueue(status),
    enabled: canApprove && venueId !== null,
    staleTime: 5_000,
    refetchInterval: status === "PENDING" ? 20_000 : false,
  })

  const decideGroup = useMutation({
    mutationFn: (input: { group: CancellationGroupItem; decision: "approve" | "reject" }) =>
      decideCancellationGroup(input.group.groupId, input.decision, {
        ...(notes[input.group.groupId]?.trim() ? { note: notes[input.group.groupId]!.trim() } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ["cancellation-queue", venueId] })
      void queryClient.invalidateQueries({ queryKey: ["waiter-orders", venueId] })
      void queryClient.invalidateQueries({ queryKey: ["waiter-visit-items", venueId] })
    },
    onError: (error: unknown) => {
      setActionError(isApiError(error) ? error.message : "Không ghi được quyết định. Tải lại hàng chờ rồi thử lại.")
      void queryClient.invalidateQueries({ queryKey: ["cancellation-queue", venueId] })
    },
  })

  const decide = useMutation({
    mutationFn: (input: { entry: CancellationQueueEntry; decision: "approve" | "reject" }) =>
      decideCancellation(input.entry.cancellationId, input.decision, {
        expectedVersion: input.entry.version,
        ...(notes[input.entry.cancellationId]?.trim() ? { note: notes[input.entry.cancellationId]!.trim() } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ["cancellation-queue", venueId] })
      void queryClient.invalidateQueries({ queryKey: ["waiter-orders", venueId] })
    },
    onError: (error: unknown) => {
      setActionError(isApiError(error) ? error.message : "Không ghi được quyết định. Tải lại hàng chờ rồi thử lại.")
      void queryClient.invalidateQueries({ queryKey: ["cancellation-queue", venueId] })
    },
  })

  if (!canApprove) {
    return (
      <main className="mx-auto grid max-w-md gap-4 p-6 text-center">
        <AlertCircle className="mx-auto size-9 text-destructive" aria-hidden />
        <div className="grid gap-1.5">
          <h1 className="text-lg font-semibold">Không có quyền phê duyệt hủy món</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Màn này dành cho người có quyền phê duyệt. Nếu bạn vừa gửi một yêu cầu hủy, nó đang chờ người có quyền quyết
            định.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft /> Quay lại
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl content-start gap-4 px-4 py-4 sm:px-5">
      <header className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          onClick={() => navigate(-1)}
          aria-label="Quay lại"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">Phê duyệt hủy món</h1>
          <p className="text-xs text-muted-foreground">
            {queue.data ? `${queue.data.pendingCount} yêu cầu đang chờ` : "Đang tải"}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          onClick={() => void queue.refetch()}
          aria-label="Tải lại hàng chờ"
        >
          <RefreshCw />
        </Button>
      </header>

      <div className="flex gap-2" role="tablist" aria-label="Trạng thái yêu cầu">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={
              status === tab.status
                ? "min-h-11 rounded-lg border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-[0.97]"
                : "min-h-11 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-tx-2 transition-colors hover:border-border-strong hover:text-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-[0.97]"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      {queue.isPending ? (
        <div className="grid gap-3" aria-label="Đang tải hàng chờ">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : queue.isError ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {isApiError(queue.error) ? queue.error.message : "Không tải được hàng chờ."}
        </p>
      ) : (queue.data?.entries.length ?? 0) === 0 ? (
        <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-border bg-surface-1 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {status === "PENDING" ? "Không có yêu cầu nào đang chờ." : "Chưa có yêu cầu nào ở trạng thái này."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {groupCancellationEntries(queue.data!.entries).map((item) =>
            item.kind === "order" ? (
              <CancellationGroupCard
                key={item.key}
                group={item}
                note={notes[item.groupId] ?? ""}
                busy={decide.isPending || decideGroup.isPending}
                decided={status !== "PENDING"}
                onNoteChange={(value) => setNotes((current) => ({ ...current, [item.groupId]: value }))}
                onDecide={(decision) => decideGroup.mutate({ group: item, decision })}
              />
            ) : (
              <CancellationCard
                key={item.key}
                entry={item.entry}
                note={notes[item.entry.cancellationId] ?? ""}
                busy={decide.isPending || decideGroup.isPending}
                onNoteChange={(value) => setNotes((current) => ({ ...current, [item.entry.cancellationId]: value }))}
                onDecide={(decision) => decide.mutate({ entry: item.entry, decision })}
              />
            ),
          )}
        </ul>
      )}
    </main>
  )
}
