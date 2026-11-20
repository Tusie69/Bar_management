/**
 * Module Phục vụ 3 — giỏ gọi món gắn với một Phiên bàn và một người đăng nhập.
 *
 * Hook này chỉ làm ba việc: giữ giỏ trong bộ nhớ, ghi nháp vào `sessionStorage`
 * theo phân vùng `userId + venueId + visitId`, và sinh mã chống trùng mới mỗi
 * lần giỏ đổi. Toàn bộ luật của giỏ nằm trong `cart-model.ts`, nơi test chạy
 * được mà không cần React.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  readWaiterCartDraft,
  removeWaiterCartDraft,
  waiterCartKey,
  writeWaiterCartDraft,
} from "@/domain/waiter-cart-storage"
import { newIdempotencyKey } from "@/services"
import {
  addToCart,
  applyPriceChanges,
  cartExceedsMoneyLimit,
  cartIsFull,
  cartItemCount,
  cartTotalVnd,
  emptyCart,
  parseCart,
  reconcileCart,
  removeLine,
  removeVariants,
  setLineNote,
  setLineQuantity,
  type AddToCartInput,
  type Cart,
  type CartLine,
  type MenuPriceChange,
} from "./cart-model"
import type { WaiterMenuItem } from "./menu-model"

export interface WaiterCartController {
  cart: Cart
  itemCount: number
  totalVnd: number
  exceedsMoneyLimit: boolean
  isFull: boolean
  add: (input: AddToCartInput) => void
  /** Mọi thao tác sửa/xóa đi theo `cartLineId`: hai dòng cùng biến thể khác ghi chú là hai dòng. */
  setQuantity: (cartLineId: string, quantity: number) => void
  setNote: (cartLineId: string, note: string) => void
  remove: (cartLineId: string) => void
  applyPrices: (changes: readonly MenuPriceChange[]) => void
  dropVariants: (variantIds: readonly number[]) => void
  /** Chỉ gọi SAU khi máy chủ trả về đơn đã tạo. */
  clear: () => void
  /** Soi giỏ với danh mục vừa tải; trả về những dòng đã bị bỏ để màn hình nói ra. */
  reconcile: (items: readonly WaiterMenuItem[]) => CartLine[]
}

export function useWaiterCart(input: {
  visitId: number
  userId: number | null
  venueId: number | null
}): WaiterCartController {
  const { visitId, userId, venueId } = input
  const storageKey = userId !== null && venueId !== null ? waiterCartKey(userId, venueId, visitId) : null
  const [cart, setCart] = useState<Cart>(() => {
    const fresh = emptyCart(visitId, newIdempotencyKey())
    if (!storageKey) return fresh
    return parseCart(readWaiterCartDraft(storageKey), visitId, fresh.submitKey) ?? fresh
  })

  // Đổi người đăng nhập, đổi địa điểm hay đổi Phiên là một giỏ khác. Không nạp
  // lại ở đây thì giỏ của Phiên trước đi theo sang Phiên sau.
  const loadedKey = useRef(storageKey)
  useEffect(() => {
    if (loadedKey.current === storageKey) return
    loadedKey.current = storageKey
    const fresh = emptyCart(visitId, newIdempotencyKey())
    setCart(storageKey ? (parseCart(readWaiterCartDraft(storageKey), visitId, fresh.submitKey) ?? fresh) : fresh)
  }, [storageKey, visitId])

  useEffect(() => {
    if (!storageKey) return
    if (cart.lines.length === 0) removeWaiterCartDraft(storageKey)
    else writeWaiterCartDraft(storageKey, cart)
  }, [cart, storageKey])

  const add = useCallback((value: AddToCartInput) => {
    // Một mã mới cho dòng mới, và một mã chống trùng mới cho giỏ: hai thứ khác
    // nhau, cùng sinh từ cùng một nguồn ngẫu nhiên.
    setCart((current) => addToCart(current, value, newIdempotencyKey(), newIdempotencyKey()))
  }, [])
  const setQuantity = useCallback((cartLineId: string, quantity: number) => {
    setCart((current) => setLineQuantity(current, cartLineId, quantity, newIdempotencyKey()))
  }, [])
  const setNote = useCallback((cartLineId: string, note: string) => {
    setCart((current) => setLineNote(current, cartLineId, note, newIdempotencyKey()))
  }, [])
  const remove = useCallback((cartLineId: string) => {
    setCart((current) => removeLine(current, cartLineId, newIdempotencyKey()))
  }, [])
  const applyPrices = useCallback((changes: readonly MenuPriceChange[]) => {
    setCart((current) => applyPriceChanges(current, changes, newIdempotencyKey()))
  }, [])
  const dropVariants = useCallback((variantIds: readonly number[]) => {
    setCart((current) => removeVariants(current, variantIds, newIdempotencyKey()))
  }, [])
  const clear = useCallback(() => {
    setCart(emptyCart(visitId, newIdempotencyKey()))
  }, [visitId])

  // `reconcile` phải TRẢ VỀ ngay những dòng đã bỏ để màn hình nói ra, nên nó
  // đọc giỏ qua ref: updater của `setCart` chạy sau, và một biến gán trong
  // updater sẽ luôn rỗng ở chỗ gọi.
  const cartRef = useRef(cart)
  useEffect(() => {
    cartRef.current = cart
  }, [cart])
  const reconcile = useCallback((items: readonly WaiterMenuItem[]) => {
    const result = reconcileCart(cartRef.current, items, newIdempotencyKey())
    if (result.dropped.length === 0) return []
    cartRef.current = result.cart
    setCart(result.cart)
    return result.dropped
  }, [])

  return useMemo(
    () => ({
      cart,
      itemCount: cartItemCount(cart),
      totalVnd: cartTotalVnd(cart),
      exceedsMoneyLimit: cartExceedsMoneyLimit(cart),
      isFull: cartIsFull(cart),
      add,
      setQuantity,
      setNote,
      remove,
      applyPrices,
      dropVariants,
      clear,
      reconcile,
    }),
    [cart, add, setQuantity, setNote, remove, applyPrices, dropVariants, clear, reconcile],
  )
}
