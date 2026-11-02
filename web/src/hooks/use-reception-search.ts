import { useMemo, useState } from "react"
import { phoneMatches } from "@/features/floor/reception-rules"
import type { BusinessDate } from "@/lib/time"
import { useReservations } from "./use-data"

export function useReceptionSearch(date: BusinessDate, enabled: boolean) {
  const [suffix, setSuffix] = useState("")
  const query = useReservations(enabled && /^\d{3}$/.test(suffix) ? date : "", suffix)
  const matches = useMemo(() => phoneMatches(query.data, date, suffix), [query.data, date, suffix])
  const tableIds = useMemo(() => [...new Set(matches.flatMap((row) => row.tableIds))], [matches])
  return { suffix, setSuffix, matches, tableIds, query }
}
