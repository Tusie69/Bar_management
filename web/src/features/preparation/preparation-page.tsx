import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { roleCan, type Permission } from "@/domain/access"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { PreparationQueue } from "./preparation-queue"
import type { PreparationStation } from "./preparation-queue-data"
import { fixedPreparationStation } from "./preparation-layout"

export default function PreparationPage() {
  const role = useSession((state) => state.user.role)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const fixedStation = fixedPreparationStation(role)
  const [station, setStation] = useState<PreparationStation>(fixedStation ?? "BAR")
  const can = useCallback(
    (permission: Permission) => (api.mode === "http" ? permissions.includes(permission) : roleCan(role, permission)),
    [permissions, role],
  )

  return (
    <PreparationQueue
      station={station}
      canRead={can(`preparation.${station.toLowerCase()}.read` as Permission)}
      canTransition={can(`preparation.${station.toLowerCase()}.transition` as Permission)}
      canRetry={can("preparation.print.retry")}
      stationControls={
        !fixedStation ? (
          <div className="flex rounded-lg border border-border p-1">
            <Button size="sm" variant={station === "BAR" ? "default" : "ghost"} onClick={() => setStation("BAR")}>
              Bar
            </Button>
            <Button
              size="sm"
              variant={station === "KITCHEN" ? "default" : "ghost"}
              onClick={() => setStation("KITCHEN")}
            >
              Bếp
            </Button>
          </div>
        ) : undefined
      }
      onLogout={() => void logout()}
    />
  )
}
