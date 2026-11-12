import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import type { BusinessDate } from "@/lib/time"
import { api } from "@/services"
import { qk } from "./use-data"

export function useReceptionSearch(date: BusinessDate, enabled: boolean) {
  const [mode, setMode] = useState<"last3" | "name">("last3")
  const [value, setValue] = useState("")
  const [debounced, setDebounced] = useState("")
  const keyword = value.trim()
  const active = mode === "last3" ? /^\d{3}$/.test(keyword) : keyword.length > 0
  const searchKey = active ? `${mode}:${keyword}` : ""
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(searchKey), 200)
    return () => window.clearTimeout(timer)
  }, [searchKey])
  const current = !!searchKey && debounced === searchKey
  const query = useQuery({
    queryKey: qk.receptionSearch(date, searchKey),
    queryFn: () => api.searchReception(date, mode === "name" ? { name: keyword } : { last3: keyword }),
    enabled: enabled && current,
    retry: api.mode === "mock" ? 1 : false,
  })
  const result = current ? query.data : undefined
  const tableIds = useMemo(
    () => [...new Set([
      ...(result?.bookings.flatMap((row) => row.tableIds) ?? []),
      ...(result?.waitlist.flatMap((row) => row.tableIds) ?? []),
    ])],
    [result],
  )
  const toggleMode = () => {
    setValue("")
    setMode(mode === "last3" ? "name" : "last3")
  }
  return { value, setValue, mode, toggleMode, active, searching: active && (!current || query.isFetching),
    result, tableIds, error: current ? query.error : null }
}
