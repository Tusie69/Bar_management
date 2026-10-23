/**
 * Client UI state: floor mode/filters/selection, pick-mode on the canvas,
 * global dialogs (conflict / override reason), sheets, undo/redo stacks.
 */
import { create } from "zustand"
import type { ZoneCode } from "@/domain/venue-layout"
import { businessDateOf, type BusinessDate } from "@/lib/time"
import { clock } from "@/services"

export type FloorMode = "live" | "availability"
/** Workspace view on the Điều phối screen (v2). */
export type FloorView = "list" | "timeline" | "map"

export interface PickRequest {
  intent: "walkin" | "assign" | "move" | "combine" | "checkin" | "offer" | "seat-waitlist" | "booking"
  title: string
  hint: string
  multi: boolean
  confirmLabel: string
  /** Tables that cannot be chosen (e.g. the source of a move). */
  excludeIds?: number[]
  preselected?: number[]
  /** Return true to close pick mode. */
  onConfirm: (tableIds: number[]) => Promise<boolean> | boolean
}

export interface ConflictInfo {
  title: string
  message: string
  by?: string
  hint?: string
}

interface OverrideRequest {
  needs: string
  resolve: (reason: string | null) => void
}

export interface BookingPrefill {
  tableIds?: number[]
  date?: BusinessDate
  time?: string
  party?: number
}

export interface UndoItem {
  id: number
  summary: string
}

const defaultTime = () => {
  const now = clock.now()
  const minutes = Math.ceil((now.getUTCMinutes() + 1) / 15) * 15
  const shifted = new Date(now.getTime() + 7 * 3600_000)
  let h = shifted.getUTCHours()
  let m = minutes
  if (m >= 60) {
    m = 0
    h = (h + 1) % 24
  }
  if (h >= 5 && h < 17) return "19:00"
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

interface UiState {
  floorMode: FloorMode
  view: FloorView
  availDate: BusinessDate
  availTime: string
  availParty: number
  zone: ZoneCode | "ALL"
  selectedTableId: number | null
  pick: PickRequest | null
  pickSelection: number[]

  conflict: ConflictInfo | null
  override: OverrideRequest | null

  bookingOpen: boolean
  bookingPrefill: BookingPrefill
  walkInOpen: boolean
  walkInPrefill: number[]
  reservationDetail: { id: number; bd: BusinessDate } | null

  undoStack: UndoItem[]
  redoStack: UndoItem[]

  setFloorMode: (mode: FloorMode) => void
  setView: (view: FloorView) => void
  setAvailability: (patch: Partial<{ date: BusinessDate; time: string; party: number }>) => void
  setZone: (zone: ZoneCode | "ALL") => void
  selectTable: (id: number | null) => void
  startPick: (req: PickRequest) => void
  togglePick: (id: number) => void
  cancelPick: () => void

  showConflict: (info: ConflictInfo) => void
  closeConflict: () => void
  askOverride: (needs: string) => Promise<string | null>
  resolveOverride: (reason: string | null) => void

  openBooking: (prefill?: BookingPrefill) => void
  closeBooking: () => void
  openWalkIn: (tableIds?: number[]) => void
  closeWalkIn: () => void
  openReservation: (id: number | null, bd?: BusinessDate) => void

  pushUndo: (item: UndoItem) => void
  popUndo: () => UndoItem | undefined
  pushRedo: (item: UndoItem) => void
  popRedo: () => UndoItem | undefined
  clearHistory: () => void
}

export const useUi = create<UiState>((set, get) => ({
  floorMode: "live",
  view: "map",
  availDate: businessDateOf(clock.now()),
  availTime: defaultTime(),
  availParty: 2,
  zone: "ALL",
  selectedTableId: null,
  pick: null,
  pickSelection: [],
  conflict: null,
  override: null,
  bookingOpen: false,
  bookingPrefill: {},
  walkInOpen: false,
  walkInPrefill: [],
  reservationDetail: null,
  undoStack: [],
  redoStack: [],

  setFloorMode: (floorMode) => set({ floorMode, pick: null, pickSelection: [] }),
  setView: (view) => set({ view }),
  setAvailability: (patch) =>
    set((s) => ({
      availDate: patch.date ?? s.availDate,
      availTime: patch.time ?? s.availTime,
      availParty: patch.party ?? s.availParty,
    })),
  setZone: (zone) => set({ zone }),
  selectTable: (selectedTableId) => set({ selectedTableId }),
  startPick: (pick) => set({ pick, pickSelection: pick.preselected ?? [], view: "map" }),
  togglePick: (id) => {
    const { pick, pickSelection } = get()
    if (!pick) return
    if (pick.multi)
      set({
        pickSelection: pickSelection.includes(id) ? pickSelection.filter((x) => x !== id) : [...pickSelection, id],
      })
    else set({ pickSelection: pickSelection[0] === id ? [] : [id] })
  },
  cancelPick: () => set({ pick: null, pickSelection: [] }),

  showConflict: (conflict) => set({ conflict }),
  closeConflict: () => set({ conflict: null }),
  askOverride: (needs) => new Promise((resolve) => set({ override: { needs, resolve } })),
  resolveOverride: (reason) => {
    get().override?.resolve(reason)
    set({ override: null })
  },

  openBooking: (bookingPrefill = {}) => set({ bookingOpen: true, bookingPrefill }),
  closeBooking: () => set({ bookingOpen: false }),
  openWalkIn: (walkInPrefill = []) => set({ walkInOpen: true, walkInPrefill }),
  closeWalkIn: () => set({ walkInOpen: false }),
  openReservation: (id, bd) =>
    set({ reservationDetail: id === null ? null : { id, bd: bd ?? businessDateOf(clock.now()) } }),

  pushUndo: (item) => set((s) => ({ undoStack: [...s.undoStack, item].slice(-20) })),
  popUndo: () => {
    const stack = get().undoStack
    const item = stack[stack.length - 1]
    if (item) set({ undoStack: stack.slice(0, -1) })
    return item
  },
  pushRedo: (item) => set((s) => ({ redoStack: [...s.redoStack, item].slice(-20) })),
  popRedo: () => {
    const stack = get().redoStack
    const item = stack[stack.length - 1]
    if (item) set({ redoStack: stack.slice(0, -1) })
    return item
  },
  clearHistory: () => set({ undoStack: [], redoStack: [] }),
}))
