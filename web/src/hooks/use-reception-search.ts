import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import type { BusinessDate } from "@/lib/time"
import { api } from "@/services"
import { qk } from "./use-data"

export function useReceptionSearch(date: BusinessDate, enabled: boolean) {
  const [suffix, setSuffix] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(/^\d{3}$/.test(suffix) ? suffix : ""), 200)
    return () => window.clearTimeout(timer)
  }, [suffix])
  const query = useQuery({
    queryKey: qk.receptionSearch(date, debounced),
    queryFn: () => api.searchReception(date, { last3: debounced }),
    enabled: enabled && /^\d{3}$/.test(debounced),
    retry: api.mode === "mock" ? 1 : false,
  })
  const tableIds = useMemo(
    () => [
      ...new Set([
        ...(query.data?.bookings.flatMap((row) => row.tableIds) ?? []),
        ...(query.data?.waitlist.flatMap((row) => row.tableIds) ?? []),
      ]),
    ],
    [query.data],
  )
  return { suffix, setSuffix, debounced, tableIds, query }
}
