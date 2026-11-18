/**
 * Coordinates focus capture and return across controlled Radix overlays and
 * non-modal sheets in Mobile Reception so sheet-to-screen handoffs (e.g.
 * CreateSheet -> FormScreen, StatusDialog -> ConfirmDialog, DetailScreen ->
 * EntryDetailScreen) keep focus in the newly opened overlay and restore focus
 * to a surviving trigger on close.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react"

const OVERLAY_SELECTOR =
  "[data-gm-overlay-id], [data-slot='sheet-content'], [data-slot='dialog-content'], [data-slot='alert-dialog-content'], [data-mobile-table-sheet]"

const ACTIVE_QUICK_FORM_SELECTOR = "[aria-label='Đặt bàn trên sơ đồ'][data-motion-state='open']"

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

interface OverlayRecord {
  id: string
  seq: number
  open: boolean
  modal: boolean
  trigger: HTMLElement | null
}

let nextSeq = 0
const records = new Map<string, OverlayRecord>()

function isAliveFocusTarget(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false
  return true
}

function isUsableFocusTarget(el: HTMLElement | null): el is HTMLElement {
  if (!isAliveFocusTarget(el)) return false
  if (el.closest("[inert], [aria-hidden='true']")) return false
  return true
}

function getRecordForElement(overlayEl: HTMLElement): OverlayRecord | null {
  const id = overlayEl.getAttribute("data-gm-overlay-id")
  if (id) return records.get(id) ?? null
  return null
}

function resolveSurvivingTrigger(
  candidate: HTMLElement | null,
  ignoreOverlayId?: string,
  requireUsable = true,
): HTMLElement | null {
  let current = candidate
  const visited = new Set<HTMLElement>()
  const check = requireUsable ? isUsableFocusTarget : isAliveFocusTarget
  while (current && !visited.has(current)) {
    visited.add(current)
    const ownerOverlay = current.closest<HTMLElement>(OVERLAY_SELECTOR)
    if (!ownerOverlay) {
      return check(current) ? current : null
    }
    const ownerId = ownerOverlay.getAttribute("data-gm-overlay-id")
    const ownerRec = getRecordForElement(ownerOverlay)
    const isClosingOrSelf =
      ownerId === ignoreOverlayId ||
      ownerOverlay.dataset.motionState === "closing" ||
      (ownerRec ? !ownerRec.open : false)

    if (isClosingOrSelf) {
      let inherited: HTMLElement | null = ownerRec?.trigger ?? null
      if (!inherited) {
        const closing = Array.from(records.values())
          .filter((r) => !r.open && r.id !== ignoreOverlayId)
          .sort((a, b) => b.seq - a.seq)
        inherited = closing[0]?.trigger ?? null
      }
      current = inherited
      continue
    }

    return check(current) ? current : null
  }
  return null
}

function findFallbackFocusTarget(excludeOverlayId?: string): HTMLElement | null {
  if (typeof document === "undefined") return null
  const openRecords = Array.from(records.values())
    .filter((r) => r.open && r.id !== excludeOverlayId)
    .sort((a, b) => b.seq - a.seq)

  for (const rec of openRecords) {
    const el = document.querySelector<HTMLElement>(`[data-gm-overlay-id="${rec.id}"]`)
    if (!el || el.dataset.motionState === "closing") continue
    const focusable = el.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )
    if (focusable && isUsableFocusTarget(focusable)) return focusable
  }

  const shell = document.querySelector<HTMLElement>("[data-gm]")
  if (!shell) return null
  const shellFocusable = shell.querySelector<HTMLElement>(
    "header button:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )
  return isUsableFocusTarget(shellFocusable) ? shellFocusable : null
}

export function hasNewerOpenOverlay(mySeq: number): boolean {
  for (const rec of records.values()) {
    if (rec.open && rec.seq > mySeq) return true
  }
  if (typeof document !== "undefined" && document.querySelector(ACTIVE_QUICK_FORM_SELECTOR)) {
    return true
  }
  return false
}

export function clearOverlayFocusRegistryForTest(): void {
  records.clear()
  nextSeq = 0
}

export function useRestoreTriggerFocus(
  open: boolean,
  options?: {
    modal?: boolean
    suppressRestore?: boolean
  },
) {
  const id = useId()
  const modal = options?.modal ?? true
  const suppressRestore = options?.suppressRestore ?? false
  const candidateRef = useRef<HTMLElement | null>(null)
  const resolvedTriggerRef = useRef<HTMLElement | null>(null)
  const seqRef = useRef<number>(0)
  const prevOpenRef = useRef<boolean>(false)

  useEffect(() => {
    if (typeof document === "undefined") return
    if (open) return

    const capture = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return
      const owner = target.closest<HTMLElement>("[data-gm-overlay-id]")
      if (owner?.getAttribute("data-gm-overlay-id") === id) return
      const focusable = target.closest<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='button']",
      )
      candidateRef.current = focusable ?? target
    }

    const onFocusIn = (e: FocusEvent) => capture(e.target)
    const onPointerDown = (e: PointerEvent) => capture(e.target)
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      document.removeEventListener("focusin", onFocusIn, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) {
        const owner = active.closest<HTMLElement>("[data-gm-overlay-id]")
        if (owner?.getAttribute("data-gm-overlay-id") !== id) {
          candidateRef.current = active
        }
      }
    }
  }, [id, open])

  useSafeLayoutEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open

    if (open && !wasOpen) {
      const seq = ++nextSeq
      seqRef.current = seq

      let rawCandidate = candidateRef.current
      if (!rawCandidate && typeof document !== "undefined") {
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body) {
          rawCandidate = active
        }
      }
      // Do not reject targets hidden temporarily by an outgoing modal's Radix aria-hidden; usability is verified on restore.
      const resolved = resolveSurvivingTrigger(rawCandidate, id, false)
      resolvedTriggerRef.current = resolved
      records.set(id, { id, seq, open: true, modal, trigger: resolved })
    } else if (!open && wasOpen) {
      const existing = records.get(id)
      if (existing) {
        existing.open = false
      }
    }
  }, [id, modal, open])

  useEffect(() => {
    return () => {
      records.delete(id)
    }
  }, [id])

  const restoreNonModal = useCallback(() => {
    if (suppressRestore || hasNewerOpenOverlay(seqRef.current)) {
      resolvedTriggerRef.current = null
      return
    }
    const target = resolveSurvivingTrigger(resolvedTriggerRef.current, id)
    resolvedTriggerRef.current = null
    if (target) {
      target.focus({ preventScroll: true })
    }
  }, [id, suppressRestore])

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      if (suppressRestore || hasNewerOpenOverlay(seqRef.current)) {
        event.preventDefault()
        resolvedTriggerRef.current = null
        return
      }
      const target = resolveSurvivingTrigger(resolvedTriggerRef.current, id) ?? findFallbackFocusTarget(id)
      resolvedTriggerRef.current = null
      if (target) {
        event.preventDefault()
        target.focus({ preventScroll: true })
      }
    },
    [id, suppressRestore],
  )

  return {
    overlayId: id,
    onCloseAutoFocus,
    restoreNonModal,
  }
}
