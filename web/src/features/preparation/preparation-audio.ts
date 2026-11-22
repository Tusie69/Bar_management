import { useEffect, useRef, useSyncExternalStore } from "react"
import type { PreparationStation, PreparationTicket } from "./preparation-queue-data"

const settingKey = (venueId: number | null, station: PreparationStation) =>
  `preparation-audio:${venueId ?? "none"}:${station}`
const highWaterKey = (venueId: number | null, station: PreparationStation) =>
  `preparation-audio-high-water:${venueId ?? "none"}:${station}`
const playedKey = (venueId: number | null, station: PreparationStation) =>
  `preparation-audio-played:${venueId ?? "none"}:${station}`

function playPreparationBeep() {
  const AudioContextClass = window.AudioContext
  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 880
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.24)
  oscillator.addEventListener("ended", () => void context.close())
}

async function playOnceAcrossTabs(venueId: number | null, station: PreparationStation, ticketId: number) {
  const run = () => {
    const key = playedKey(venueId, station)
    const played = Number(localStorage.getItem(key) ?? 0)
    if (ticketId <= played) return
    localStorage.setItem(key, String(ticketId))
    playPreparationBeep()
  }
  if (navigator.locks) {
    await navigator.locks.request(`preparation-audio:${venueId ?? "none"}:${station}`, run)
  } else {
    run()
  }
}

/** Âm báo là tùy chọn theo thiết bị; snapshot đầu tiên không bao giờ phát âm. */
export function usePreparationAudio(
  venueId: number | null,
  station: PreparationStation,
  tickets: readonly PreparationTicket[] | undefined,
) {
  const key = settingKey(venueId, station)
  const enabled = useSyncExternalStore(
    (onStoreChange) => {
      const changed = () => onStoreChange()
      window.addEventListener("storage", changed)
      window.addEventListener("preparation-audio-setting", changed)
      return () => {
        window.removeEventListener("storage", changed)
        window.removeEventListener("preparation-audio-setting", changed)
      }
    },
    () => localStorage.getItem(key) === "on",
    () => false,
  )
  const initialized = useRef(false)

  useEffect(() => {
    initialized.current = false
  }, [station, venueId])

  useEffect(() => {
    if (!tickets) return
    const maxTicketId = tickets.reduce((max, ticket) => Math.max(max, ticket.ticketId), 0)
    const key = highWaterKey(venueId, station)
    const stored = Number(sessionStorage.getItem(key) ?? 0)
    if (!initialized.current) {
      sessionStorage.setItem(key, String(Math.max(stored, maxTicketId)))
      initialized.current = true
      return
    }
    if (maxTicketId <= stored) return
    sessionStorage.setItem(key, String(maxTicketId))
    if (enabled) void playOnceAcrossTabs(venueId, station, maxTicketId)
  }, [enabled, station, tickets, venueId])

  const setEnabled = (next: boolean) => {
    localStorage.setItem(key, next ? "on" : "off")
    window.dispatchEvent(new Event("preparation-audio-setting"))
  }
  return { enabled, setEnabled }
}
