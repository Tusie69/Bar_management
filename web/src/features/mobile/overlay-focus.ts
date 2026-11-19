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

export type FocusTarget = HTMLElement | SVGElement

interface OverlayRecord {
  id: string
  seq: number
  open: boolean
  modal: boolean
  trigger: FocusTarget | null
  tablePrefix: string | null
}

let nextSeq = 0
const records = new Map<string, OverlayRecord>()

function isFocusElement(el: unknown): el is FocusTarget {
  return (
    (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) ||
    (typeof SVGElement !== "undefined" && el instanceof SVGElement)
  )
}

function extractTablePrefix(el: FocusTarget | null): string | null {
  if (!el) return null
  const label = el.getAttribute("aria-label")
  if (!label) return null
  const match = label.match(/^(Bàn [^,:]+|Ghế Bar \d+)(?=[,:])/)
  return match ? match[1] : null
}

function findSurvivingTableTarget(prefix: string | null): FocusTarget | null {
  if (!prefix || typeof document === "undefined") return null
  const buttons = document.querySelectorAll<SVGElement>('svg[role="group"] [role="button"]')
  for (const btn of buttons) {
    const label = btn.getAttribute("aria-label")
    if (label && (label.startsWith(`${prefix},`) || label.startsWith(`${prefix}:`))) {
      if (isUsableFocusTarget(btn)) return btn
    }
  }
  return null
}

function isAliveFocusTarget(el: FocusTarget | null): el is FocusTarget {
  if (!el || !el.isConnected) return false
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false
  return true
}

function isUsableFocusTarget(el: FocusTarget | null): el is FocusTarget {
  if (!isAliveFocusTarget(el)) return false
  if (el.closest("[inert], [aria-hidden='true']")) return false
  return true
}

function getRecordForElement(overlayEl: Element): OverlayRecord | null {
  const id = overlayEl.getAttribute("data-gm-overlay-id")
  if (id) return records.get(id) ?? null
  return null
}

function resolveSurvivingTrigger(
  candidate: FocusTarget | null,
  ignoreOverlayId?: string,
  requireUsable = true,
  fallbackTablePrefix: string | null = null,
): { target: FocusTarget | null; tablePrefix: string | null } {
  let current = candidate
  let tablePrefix = fallbackTablePrefix ?? extractTablePrefix(candidate)
  const visited = new Set<FocusTarget>()
  const check = requireUsable ? isUsableFocusTarget : isAliveFocusTarget
  while (current && !visited.has(current)) {
    visited.add(current)
    const ownerOverlay = current.closest<HTMLElement>(OVERLAY_SELECTOR)
    if (!ownerOverlay) {
      if (check(current)) {
        return { target: current, tablePrefix: tablePrefix ?? extractTablePrefix(current) }
      }
      break
    }
    const ownerId = ownerOverlay.getAttribute("data-gm-overlay-id")
    const ownerRec = getRecordForElement(ownerOverlay)
    const isClosingOrSelf =
      ownerId === ignoreOverlayId ||
      ownerOverlay.dataset.motionState === "closing" ||
      (ownerRec ? !ownerRec.open : false)

    if (isClosingOrSelf) {
      let inherited: FocusTarget | null = ownerRec?.trigger ?? null
      let inheritedPrefix: string | null = ownerRec?.tablePrefix ?? null
      if (!inherited && !inheritedPrefix) {
        const closing = Array.from(records.values())
          .filter((r) => !r.open && r.id !== ignoreOverlayId)
          .sort((a, b) => b.seq - a.seq)
        inherited = closing[0]?.trigger ?? null
        inheritedPrefix = closing[0]?.tablePrefix ?? null
      }
      if (inheritedPrefix) tablePrefix = inheritedPrefix
      current = inherited
      continue
    }

    if (check(current)) {
      return { target: current, tablePrefix: tablePrefix ?? extractTablePrefix(current) }
    }
    break
  }
  const byTable = requireUsable ? findSurvivingTableTarget(tablePrefix) : null
  return { target: byTable, tablePrefix }
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
    sourceKey?: unknown
  },
) {
  const id = useId()
  const modal = options?.modal ?? true
  const suppressRestore = options?.suppressRestore ?? false
  const sourceKey = options?.sourceKey
  const candidateRef = useRef<FocusTarget | null>(null)
  const resolvedTriggerRef = useRef<FocusTarget | null>(null)
  const tablePrefixRef = useRef<string | null>(null)
  const seqRef = useRef<number>(0)
  const prevOpenRef = useRef<boolean>(false)
  const prevSourceKeyRef = useRef<unknown>(sourceKey)

  useEffect(() => {
    if (typeof document === "undefined") return
    if (open && modal) return

    const capture = (target: EventTarget | null) => {
      if (!isFocusElement(target)) return
      const owner = target.closest(OVERLAY_SELECTOR)
      if (owner) {
        if (open) return
        if (owner.getAttribute("data-gm-overlay-id") === id) return
      }
      const focusable = target.closest(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='button']",
      )
      candidateRef.current = isFocusElement(focusable) ? focusable : target
    }

    const onFocusIn = (e: FocusEvent) => capture(e.target)
    const onPointerDown = (e: PointerEvent) => capture(e.target)
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      document.removeEventListener("focusin", onFocusIn, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      if (open) return
      const active = document.activeElement
      if (isFocusElement(active) && active !== document.body) {
        const owner = active.closest(OVERLAY_SELECTOR)
        if (owner?.getAttribute("data-gm-overlay-id") !== id) {
          candidateRef.current = active
        }
      }
    }
  }, [id, modal, open])

  useSafeLayoutEffect(() => {
    const wasOpen = prevOpenRef.current
    const prevSourceKey = prevSourceKeyRef.current
    prevOpenRef.current = open
    prevSourceKeyRef.current = sourceKey

    if (open && (!wasOpen || (!modal && prevSourceKey !== sourceKey))) {
      const seq = !wasOpen ? ++nextSeq : seqRef.current
      seqRef.current = seq

      let rawCandidate = candidateRef.current
      if (!rawCandidate && typeof document !== "undefined") {
        const active = document.activeElement
        if (isFocusElement(active) && active !== document.body) {
          rawCandidate = active
        }
      }
      // Do not reject targets hidden temporarily by an outgoing modal's Radix aria-hidden; usability is verified on restore.
      const resolved = resolveSurvivingTrigger(rawCandidate, id, false)
      resolvedTriggerRef.current = resolved.target
      tablePrefixRef.current = resolved.tablePrefix
      records.set(id, { id, seq, open: true, modal, trigger: resolved.target, tablePrefix: resolved.tablePrefix })
    } else if (!open && wasOpen) {
      const existing = records.get(id)
      if (existing) {
        existing.open = false
      }
    }
  }, [id, modal, open, sourceKey])

  useEffect(() => {
    return () => {
      records.delete(id)
    }
  }, [id])

  const restoreNonModal = useCallback(() => {
    if (suppressRestore || hasNewerOpenOverlay(seqRef.current)) {
      resolvedTriggerRef.current = null
      tablePrefixRef.current = null
      return
    }
    const resolved = resolveSurvivingTrigger(resolvedTriggerRef.current, id, true, tablePrefixRef.current)
    resolvedTriggerRef.current = null
    tablePrefixRef.current = null
    if (resolved.target) {
      resolved.target.focus({ preventScroll: true })
    }
  }, [id, suppressRestore])

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      if (suppressRestore || hasNewerOpenOverlay(seqRef.current)) {
        event.preventDefault()
        resolvedTriggerRef.current = null
        tablePrefixRef.current = null
        return
      }
      const resolved = resolveSurvivingTrigger(resolvedTriggerRef.current, id, true, tablePrefixRef.current)
      const target = resolved.target ?? findFallbackFocusTarget(id)
      resolvedTriggerRef.current = null
      tablePrefixRef.current = null
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
