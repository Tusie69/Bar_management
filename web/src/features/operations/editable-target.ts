/**
 * BA-020 / US-10 — draft preservation for the Undo/Redo keyboard shortcut.
 *
 * Ctrl/Cmd+Z inside a form control must stay the browser's own text undo, so a
 * receptionist typing a booking never loses the draft to a server compensation.
 * Kept free of React and DOM globals so it can be unit tested directly.
 */
export interface ClosestTarget {
  closest(selector: string): unknown
}

export const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable=true]"

export function isEditableTarget(target: ClosestTarget | null | undefined): boolean {
  if (!target || typeof target.closest !== "function") return false
  return target.closest(EDITABLE_SELECTOR) != null
}
