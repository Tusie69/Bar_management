import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, Clock3, ReceiptText, RefreshCw, Search, Users } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-data"
import { fmtElapsed } from "@/lib/time"
import { isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import { CartBar, CartSheet, OrderSentBanner } from "./cart-sheet"
import {
  MAX_CART_LINES,
  cartPayload,
  describePriceChanges,
  type MenuPriceChange,
  type PriceChangeView,
} from "./cart-model"
import { MenuCategoryTabs } from "./menu-category-tabs"
import { MenuItemList } from "./menu-item-list"
import { MenuItemSheet } from "./menu-item-sheet"
import { filterMenuItems, type WaiterMenuItem } from "./menu-model"
import { PriceChangeDialog } from "./price-change-dialog"
import { useWaiterCart } from "./use-waiter-cart"
import { fetchWaiterMenu } from "./waiter-menu-api"
import { submitWaiterOrder, type WaiterOrderDetail } from "./waiter-order-api"

/**
 * Module Phục vụ 3 — màn gọi món: danh mục, giỏ và gửi đơn.
 *
 * Bốn luật của màn này, theo đúng thứ tự quan trọng:
 *
 * 1. Giỏ chỉ trống SAU khi máy chủ trả về đơn. Mọi lỗi đều giữ nguyên giỏ.
 * 2. Không có cú gửi nào xảy ra mà nhân viên không bấm: xác nhận giá mới chỉ
 *    cập nhật giỏ, rồi họ bấm "Gửi đơn" lần nữa.
 * 3. Một lần bấm = một đơn. Cờ `submittingRef` chặn lần bấm thứ hai trước khi
 *    React kịp render lại, và mã chống trùng của giỏ lo phần còn lại ở máy chủ.
 * 4. Món bị bỏ khỏi giỏ luôn được NÓI RA. Một dòng tự biến mất là một món mà
 *    khách đã gọi và sẽ không bao giờ tới.
 */

function readPriceChanges(details: Record<string, unknown>): MenuPriceChange[] {
  const changes = details.changes
  if (!Array.isArray(changes)) return []
  return changes.filter(
    (change): change is MenuPriceChange =>
      typeof change === "object" &&
      change !== null &&
      typeof (change as MenuPriceChange).variantId === "number" &&
      typeof (change as MenuPriceChange).currentAmountVnd === "number",
  )
}

interface UnavailableVariant {
  variantId: number
  itemName: string
  variantDisplayName: string
}

function readUnavailable(details: Record<string, unknown>): UnavailableVariant[] {
  const variants = details.variants
  if (!Array.isArray(variants)) return []
  return variants.filter(
    (variant): variant is UnavailableVariant =>
      typeof variant === "object" && variant !== null && typeof (variant as UnavailableVariant).variantId === "number",
  )
}

/**
 * Ba mã mà máy chủ dùng cho "đơn chưa gửi được vì nội dung giỏ".
 *
 * `details` của cả ba luôn mang đủ hai mảng `variants` và `changes`, nên màn
 * hình xử lý chúng bằng một nhánh duy nhất.
 */
const ORDER_REJECTION_CODES = new Set(["MENU_ITEM_UNAVAILABLE", "MENU_PRICE_CHANGED", "ORDER_LINES_REJECTED"])

function describeDropped(names: readonly string[]): string {
  return `Đã bỏ khỏi giỏ: ${names.join(", ")}. Món vừa hết hoặc không còn được bán — đơn chưa được gửi.`
}

export default function WaiterMenuPage() {
  const navigate = useNavigate()
  const params = useParams<{ visitId: string }>()
  const visitId = Number(params.visitId)
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const userId = useSession((state) => state.principal?.id ?? null)
  const canOrder = useCan("order.create")
  const now = useNow(1_000)
  const [catalogVersion, setCatalogVersion] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [selectedItem, setSelectedItem] = useState<WaiterMenuItem | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cartError, setCartError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [priceChanges, setPriceChanges] = useState<PriceChangeView[] | null>(null)
  const [sentOrder, setSentOrder] = useState<WaiterOrderDetail | null>(null)
  const submittingRef = useRef(false)
  const validVisitId = Number.isSafeInteger(visitId) && visitId > 0

  const cart = useWaiterCart({ visitId, userId, venueId })
  const menu = useQuery({
    queryKey: ["waiter-menu", venueId, visitId, catalogVersion ?? "latest"],
    queryFn: async () => {
      const next = await fetchWaiterMenu(visitId)
      setCatalogVersion((current) => (current === next.catalogVersion ? current : next.catalogVersion))
      return next
    },
    enabled: validVisitId && venueId !== null,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  })

  const items = useMemo(
    () => filterMenuItems(menu.data?.items ?? [], menu.data?.categories ?? [], categoryId, search),
    [categoryId, menu.data?.categories, menu.data?.items, search],
  )

  // Nháp của lần mở trước có thể chứa món đã hết. Soi lại với danh mục vừa tải
  // và nói ra những gì bị bỏ, thay vì để nhân viên bấm gửi rồi mới biết.
  const reconcile = cart.reconcile
  const menuItems = menu.data?.items
  useEffect(() => {
    if (!menuItems) return
    const dropped = reconcile(menuItems)
    if (dropped.length) {
      setNotice(describeDropped(dropped.map((line) => `${line.itemName} (${line.variantDisplayName})`)))
    }
  }, [menuItems, reconcile])

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setCartError(null)
    setNotice(null)
    try {
      const order = await submitWaiterOrder(cartPayload(cart.cart))
      // Thứ tự quan trọng: xóa giỏ CHỈ sau khi có đơn thật trong tay.
      cart.clear()
      setCartOpen(false)
      setSentOrder(order)
      void menu.refetch()
    } catch (error) {
      if (isApiError(error) && ORDER_REJECTION_CODES.has(error.code)) {
        // MỘT lỗi mang cả hai loại vấn đề. Đọc cả hai mảng bất kể mã nào:
        // một giỏ vừa có món hết vừa có giá đổi phải được xử lý trong một lần,
        // không phải bấm gửi hai lần để lần lượt phát hiện ra.
        const changes = describePriceChanges(cart.cart, readPriceChanges(error.details))
        const variants = readUnavailable(error.details)
        const messages: string[] = []
        if (variants.length) {
          cart.dropVariants(variants.map((variant) => variant.variantId))
          messages.push(
            describeDropped(
              variants.map((variant) =>
                variant.itemName ? `${variant.itemName} (${variant.variantDisplayName})` : `#${variant.variantId}`,
              ),
            ),
          )
        }
        if (changes.length) {
          setPriceChanges(changes)
          messages.push("Giá vừa thay đổi. Đơn chưa được gửi.")
        }
        setCartError(messages.join(" ") || error.message)
        if (variants.length) void menu.refetch()
        return
      }
      if (isApiError(error) && error.code === "MENU_PRICE_OUT_OF_RANGE") {
        // Giá trong danh mục vượt khoảng còn giữ được từng đồng. Bỏ món đó khỏi
        // giỏ và nói ra: giữ lại thì mọi lần bấm gửi sau đều trả cùng lỗi này.
        const variantId = error.details.variantId
        if (typeof variantId === "number") cart.dropVariants([variantId])
        setCartError(error.message)
        return
      }
      setCartError(isApiError(error) ? error.message : "Không gửi được đơn. Giỏ vẫn được giữ, thử lại sau.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [cart, menu])

  if (!validVisitId) return <MenuFailure message="Mã Phiên bàn không hợp lệ." onBack={() => navigate("/phucvu")} />
  if (menu.isError) {
    const message = isApiError(menu.error) ? menu.error.message : "Không thể tải danh mục món."
    return <MenuFailure message={message} onBack={() => navigate("/phucvu")} onRetry={() => void menu.refetch()} />
  }

  const visit = menu.data?.visit
  const tableLabel = visit?.tableCodes.join(" + ") ?? `Phiên #${visitId}`
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-3 py-3 sm:px-5">
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => navigate("/phucvu")}
            aria-label="Quay lại sơ đồ bàn"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold">
                Gọi món · {visit?.tableCodes.join(" + ") ?? "Đang tải"}
              </h1>
              {visit ? <Badge variant="secondary">Đang phục vụ</Badge> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden /> {visit?.guestCount ?? "—"} khách
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3" aria-hidden />{" "}
                {visit ? fmtElapsed(now.getTime() - new Date(visit.startedAt).getTime()) : "—"}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => navigate(`/phucvu/orders/${visitId}`)}
            aria-label="Xem đơn đã gọi"
          >
            <ReceiptText />
          </Button>
        </div>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 content-start gap-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {sentOrder ? (
          <OrderSentBanner
            visitSequence={sentOrder.visitSequence}
            itemCount={sentOrder.itemCount}
            totalVnd={sentOrder.totalAmountVnd}
            stations={sentOrder.stations}
            onDismiss={() => setSentOrder(null)}
          />
        ) : null}
        {notice ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl border border-border-strong bg-surface-2 px-4 py-3 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{notice}</span>
          </p>
        ) : null}
        {!canOrder ? (
          <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
            Tài khoản này chỉ xem được danh mục, không gửi đơn.
          </p>
        ) : null}
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 rounded-xl pl-10"
            placeholder="Tìm tên món…"
            aria-label="Tìm món"
          />
        </div>
        {menu.data ? (
          <MenuCategoryTabs categories={menu.data.categories} selected={categoryId} onSelect={setCategoryId} />
        ) : null}
        {menu.isPending ? <MenuSkeleton /> : <MenuItemList items={items} onOpen={setSelectedItem} />}
      </div>

      {canOrder ? (
        <CartBar itemCount={cart.itemCount} totalVnd={cart.totalVnd} onOpen={() => setCartOpen(true)} />
      ) : null}

      <MenuItemSheet
        item={selectedItem}
        addDisabledReason={cart.isFull ? `Giỏ đã đủ ${MAX_CART_LINES} dòng món. Gửi đơn này trước rồi gọi tiếp.` : null}
        onClose={() => setSelectedItem(null)}
        onAdd={(input) => {
          if (!canOrder) return
          cart.add(input)
          setCartError(null)
        }}
      />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        cart={cart.cart}
        itemCount={cart.itemCount}
        totalVnd={cart.totalVnd}
        submitting={submitting}
        errorMessage={cartError}
        tableLabel={tableLabel}
        exceedsMoneyLimit={cart.exceedsMoneyLimit}
        onQuantityChange={cart.setQuantity}
        onNoteChange={cart.setNote}
        onRemove={cart.remove}
        onSubmit={() => void submit()}
      />
      <PriceChangeDialog
        changes={priceChanges}
        onCancel={() => setPriceChanges(null)}
        onAccept={() => {
          if (priceChanges) cart.applyPrices(priceChanges)
          setPriceChanges(null)
          setCartError("Giỏ đã cập nhật giá mới. Bấm Gửi đơn để gửi.")
        }}
      />
    </section>
  )
}

function MenuSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Đang tải danh mục món">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid min-h-32 gap-3 rounded-2xl border border-border bg-surface-1 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ))}
    </div>
  )
}

function MenuFailure({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry?: () => void }) {
  return (
    <section className="grid min-h-0 flex-1 place-items-center bg-background p-4">
      <section className="w-full max-w-md rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-md">
        <AlertCircle className="mx-auto size-9 text-destructive" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Không thể mở danh mục món</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft /> Về sơ đồ bàn
          </Button>
          {onRetry ? (
            <Button onClick={onRetry}>
              <RefreshCw /> Thử lại
            </Button>
          ) : null}
        </div>
      </section>
    </section>
  )
}
