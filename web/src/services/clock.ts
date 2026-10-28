/**
 * Simulated venue clock.
 *
 * The prototype opens at 21:30 of the current business day so late (15')
 * and no-show (30') warnings, hold deadlines and live timers are visible
 * immediately. Time keeps ticking in real time and can be fast-forwarded
 * from the clock menu. The HTTP implementation would use server time.
 */
import { atBusinessTime, businessDateOf } from "@/lib/time"

type Listener = () => void

const SCENARIO_START = "21:30"

class SimClock {
  private offsetMs = 0
  private simulated = true
  private listeners = new Set<Listener>()

  constructor() {
    this.resetToScenario()
  }

  now(): Date {
    return new Date(Date.now() + this.offsetMs)
  }

  get isSimulated() {
    return this.simulated
  }

  advance(minutes: number) {
    this.offsetMs += minutes * 60_000
    this.emit()
  }

  resetToScenario() {
    const bd = businessDateOf(new Date())
    this.offsetMs = atBusinessTime(bd, SCENARIO_START).getTime() - Date.now()
    this.simulated = true
    this.emit()
  }

  useRealTime() {
    this.offsetMs = 0
    this.simulated = false
    this.emit()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

export const clock = new SimClock()
