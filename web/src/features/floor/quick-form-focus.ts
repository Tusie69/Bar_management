/**
 * Locates the visible floor creation trigger outside any active or closing
 * dialog/form overlay so focus has a deterministic destination when a draft
 * is discarded or its invoking control unmounts.
 */
export function findVisibleFloorCreateControl(preferBooking: boolean): HTMLElement | null {
  if (typeof document === "undefined") return null
  const candidates = preferBooking ? ["Tạo đặt bàn", "Tạo mới", "Walk-in"] : ["Walk-in", "Tạo đặt bàn", "Tạo mới"]
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
  const isVisible = (el: HTMLElement) =>
    !el.closest('[inert],[aria-hidden="true"],[role="dialog"],[role="alertdialog"],[role="form"]') &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden"
  for (const label of candidates) {
    const match = buttons.find(
      (btn) =>
        isVisible(btn) &&
        ((btn.getAttribute("aria-label") ?? "").trim() === label || (btn.textContent ?? "").trim() === label),
    )
    if (match) return match
  }
  return null
}

/**
 * Picks the target to focus when the dirty-form confirmation closes: returns
 * the invoking control on cancel if it is still mounted and focusable, or
 * falls back to the visible floor create trigger when discarded or unmounted.
 */
export function resolveLeaveConfirmFocusTarget<T>({
  discarded,
  invoker,
  isFocusable = (el) => {
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) {
      return (
        el.isConnected &&
        !el.hasAttribute("disabled") &&
        !el.closest('[inert],[aria-hidden="true"]') &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== "hidden"
      )
    }
    return false
  },
  findFallback,
}: {
  discarded: boolean
  invoker: T | null
  isFocusable?: (el: T) => boolean
  findFallback: () => T | null
}): T | null {
  if (!discarded && invoker && isFocusable(invoker)) {
    return invoker
  }
  return findFallback()
}
