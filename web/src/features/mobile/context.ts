import { createContext, useContext } from "react"
import type { RoleCode } from "@/domain/enums"
import type { Permission } from "@/domain/access"
import type { ReservationView, WaitlistEntryView } from "@/domain/models"
import type { BusinessDate } from "@/lib/time"
import type { FloorModel } from "../floor/use-floor-model"
import type { Thresholds } from "./model"

export type Tab = "home" | "list" | "map" | "wait"

export interface Confirm {
  title: string
  body: string
  label: string
  run: () => Promise<unknown>
}

/** Choose tables on the map (assign, move, combine, split). */
export interface TablePick {
  title: string
  hint: string
  multi: boolean
  /** Only these tables can be tapped. Default: free tables. */
  only?: number[]
  exclude?: number[]
  preselected?: number[]
  targetDate?: BusinessDate
  targetTime?: string
  targetExpectedAt?: Date
  targetParty?: number
  confirmLabel: string
  onConfirm: (ids: number[]) => Promise<boolean>
}

export interface FormRequest {
  mode: "booking" | "walkin"
  tableIds?: number[]
  date?: BusinessDate
}

export interface MobileCtx {
  model: FloorModel
  now: Date
  today: BusinessDate
  businessDate: BusinessDate
  role: RoleCode
  isOwner: boolean
  can: (permission: Permission) => boolean
  th: Thresholds
  reservations: ReservationView[] | undefined
  waitlist: WaitlistEntryView[] | undefined
  waitlistError?: unknown
  unread: number
  go: (tab: Tab) => void
  openAlerts: () => void
  openAccount: () => void
  openCount: () => void
  openDetail: (id: number, bd: BusinessDate) => void
  openStatus: (r: ReservationView) => void
  openForm: (f: FormRequest) => void
  openTable: (id: number) => void
  ask: (c: Confirm) => void
  startPick: (p: TablePick) => void
}

export const MobileContext = createContext<MobileCtx | null>(null)

export function useM(): MobileCtx {
  const ctx = useContext(MobileContext)
  if (!ctx) throw new Error("useM outside MobileApp")
  return ctx
}
